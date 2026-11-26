import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { ListMusic, Plus, X } from "lucide-react";
import { api, extractArtworkPalette } from "./api";
import { pageCache } from "./cache";
import { CommandPalette } from "./components/CommandPalette";
import { NowPlayingView } from "./components/NowPlayingView";
import { PlayerBar, type SleepTimerMode } from "./components/PlayerBar";
import { SettingsView } from "./components/SettingsView";
import { Sidebar } from "./components/Sidebar";
import { StatsView } from "./components/StatsView";
import { TitleBar } from "./components/TitleBar";
import {
  ArtistView,
  DownloadsView,
  ExploreView,
  HomeView,
  LibraryView,
  PlaylistView,
  SearchView,
} from "./components/Views";
import {
  DEFAULT_SETTINGS,
  type AccountInfo,
  type AppSettings,
  type DownloadItem,
  type LocalPlaylistSummary,
  type LyricsData,
  type PlaybackSnapshot,
  type Route,
  type ShelfItem,
  type SponsorSegment,
  type Track,
} from "./types";

const INITIAL_PLAYBACK: PlaybackSnapshot = {
  isPlaying: false,
  isLoading: false,
  positionMs: 0,
  durationMs: 0,
  bufferedRatio: 0,
  volume: 0.85,
  muted: false,
  currentTrack: null,
  telemetry: null,
  error: null,
};

export function App() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [account, setAccount] = useState<AccountInfo>({
    loggedIn: false,
    isPremium: false,
    authSource: "none",
  });
  const [playback, setPlayback] = useState<PlaybackSnapshot>(INITIAL_PLAYBACK);
  const [queue, setQueue] = useState<Track[]>([]);
  const [queueIndex, setQueueIndex] = useState<number>(-1);
  const [shuffle, setShuffle] = useState(false);
  const [repeatMode, setRepeatMode] = useState<"off" | "all" | "one">("off");
  const [autoplay, setAutoplay] = useState(true);
  const [nowPlayingOpen, setNowPlayingOpen] = useState(false);
  const [miniPlayer, setMiniPlayer] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);

  const [lyricsBrowseId, setLyricsBrowseId] = useState<string | null>(null);
  const [relatedBrowseId, setRelatedBrowseId] = useState<string | null>(null);
  const [sleepTimer, setSleepTimer] = useState<SleepTimerMode>({ kind: "off" });
  const [sponsorSegments, setSponsorSegments] = useState<SponsorSegment[]>([]);
  const [overlayLyrics, setOverlayLyrics] = useState<LyricsData | null>(null);
  const [lyricsOverlayOpen, setLyricsOverlayOpen] = useState(false);

  // Navigation history stack
  const [history, setHistory] = useState<Route[]>([{ page: "home" }]);
  const [histIdx, setHistIdx] = useState(0);
  const route = history[histIdx];

  // Sidebar & downloads state
  const [remotePlaylists, setRemotePlaylists] = useState<ShelfItem[]>([]);
  const [localPlaylists, setLocalPlaylists] = useState<LocalPlaylistSummary[]>([]);
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [toasts, setToasts] = useState<Array<{ id: number; text: string }>>([]);

  // Modals
  const [createPlOpen, setCreatePlOpen] = useState(false);
  const [newPlTitle, setNewPlTitle] = useState("");
  const [newPlDesc, setNewPlDesc] = useState("");
  const [newPlSynced, setNewPlSynced] = useState(false);
  const [addTrackModal, setAddTrackModal] = useState<Track | null>(null);

  const preloadedIdRef = useRef<string | null>(null);
  const lastErrorRef = useRef<string | null>(null);
  const playDebounceRef = useRef<number | null>(null);
  const playReqSeqRef = useRef<number>(0);
  const pendingResumeMsRef = useRef<number | null>(null);
  const skippedSegsRef = useRef<Set<number>>(new Set());
  const lastLyricsSentRef = useRef<string>("");
  const sleepTimerRef = useRef<SleepTimerMode>(sleepTimer);
  const playbackRef = useRef(playback);
  const queueRef = useRef(queue);
  const queueIdxRef = useRef(queueIndex);
  const repeatRef = useRef(repeatMode);
  const shuffleRef = useRef(shuffle);
  sleepTimerRef.current = sleepTimer;
  playbackRef.current = playback;
  queueRef.current = queue;
  queueIdxRef.current = queueIndex;
  repeatRef.current = repeatMode;
  shuffleRef.current = shuffle;

  const toast = useCallback((text: string) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev.slice(-3), { id, text }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3800);
  }, []);

  const navigate = useCallback((next: Route) => {
    setNowPlayingOpen(false);
    setHistory((prev) => {
      const sliced = prev.slice(0, histIdx + 1);
      return [...sliced, next];
    });
    setHistIdx((idx) => idx + 1);
  }, [histIdx]);

  const refreshLibraries = useCallback(async () => {
    try {
      const [local, remote] = await Promise.all([
        api.listLocalPlaylists(),
        api.getLibraryPlaylists().catch(() => []),
      ]);
      setLocalPlaylists(local);
      setRemotePlaylists(remote);
    } catch {
      // ignore offline
    }
  }, []);

  const refreshDownloads = useCallback(async () => {
    try {
      const list = await api.listDownloads();
      setDownloads(list);
    } catch {
      // ignore
    }
  }, []);

  // Bootstrap settings, session restore, account, playlists, downloads, and live Tauri event listeners
  useEffect(() => {
    api
      .getSettings()
      .then((loaded) => {
        setSettings(loaded);
        if (loaded.restoreSession) {
          api
            .loadSessionState()
            .then((sess) => {
              if (!sess || sess.queue.length === 0) return;
              const safeIdx = Math.max(0, Math.min(sess.queue.length - 1, sess.queueIndex));
              const track = sess.queue[safeIdx];
              setQueue(sess.queue);
              setQueueIndex(safeIdx);
              setShuffle(Boolean(sess.shuffle));
              if (sess.repeatMode === "off" || sess.repeatMode === "all" || sess.repeatMode === "one") {
                setRepeatMode(sess.repeatMode);
              }
              if (track) {
                pendingResumeMsRef.current = sess.positionMs || 0;
                setPlayback((prev) =>
                  prev.currentTrack
                    ? prev
                    : {
                        ...prev,
                        currentTrack: track,
                        positionMs: sess.positionMs || 0,
                        durationMs: track.durationSecs * 1000,
                      }
                );
              }
            })
            .catch(() => {});
        }
      })
      .catch(() => {});
    api.getAccountInfo().then((acc) => {
      setAccount(acc);
      refreshLibraries();
    }).catch(() => {});
    api.getPlaybackSnapshot().then((snap) => {
      if (snap.currentTrack) setPlayback(snap);
    }).catch(() => {});
    refreshDownloads();

    let unPlayback: (() => void) | undefined;
    let unEnded: (() => void) | undefined;
    let unDownload: (() => void) | undefined;
    let unMedia: (() => void) | undefined;

    api.onPlaybackState((snap) => {
      if (playDebounceRef.current !== null) return;
      setPlayback(snap);
      if (snap.error && snap.error !== lastErrorRef.current) {
        lastErrorRef.current = snap.error;
        toast(`Audio error: ${snap.error}`);
        api.logFrontendEvent("ERROR", "player", snap.error).catch(() => {});
      } else if (!snap.error) {
        lastErrorRef.current = null;
      }
    }).then((u) => (unPlayback = u));

    api.onDownloadUpdated((item) => {
      setDownloads((prev) => {
        const exists = prev.some((d) => d.id === item.id);
        return exists ? prev.map((d) => (d.id === item.id ? item : d)) : [item, ...prev];
      });
    }).then((u) => (unDownload = u));

    api.onTrackEnded(() => {
      handleAdvanceNext(true);
    }).then((u) => (unEnded = u));

    api.onMediaControl((action) => {
      if (action === "next") {
        handleAdvanceNext(false);
      } else if (action === "previous") {
        handlePrev();
      } else if (action === "like") {
        const tr = playbackRef.current.currentTrack;
        if (tr) {
          handleRate(tr, tr.likeStatus === "LIKE" ? "INDIFFERENT" : "LIKE");
        }
      }
    }).then((u) => (unMedia = u));

    return () => {
      unPlayback?.();
      unEnded?.();
      unDownload?.();
      unMedia?.();
    };
  }, []);

  // Apply Liquid Glass, Custom Color Studio & Custom CSS live
  useEffect(() => {
    const g = settings.glass;
    const root = document.documentElement;
    const hexToRgb = (hex: string): string | null => {
      const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
      return m ? `${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}` : null;
    };

    root.setAttribute("data-theme", g.themeMode);
    root.setAttribute("data-density", g.density);
    root.style.setProperty("--glass-blur", `${g.blurPx}px`);
    root.style.setProperty("--glass-opacity", `${g.opacity}`);
    root.style.setProperty("--glass-sat", `${g.saturation}%`);
    root.style.setProperty("--glass-specular", `${g.specularStrength}`);
    root.style.setProperty("--glass-radius", `${g.borderRadius}px`);
    root.style.setProperty("--mesh-speed", `${g.meshSpeed}`);
    if (!g.accentAuto) {
      root.style.setProperty("--accent", g.accentColor);
      const accRgb = hexToRgb(g.accentColor);
      if (accRgb) root.style.setProperty("--accent-soft", `rgba(${accRgb}, 0.18)`);
    }

    if (g.customColorsEnabled) {
      root.style.setProperty("--bg-solid", g.bgColor);
      const bgRgb = hexToRgb(g.bgColor);
      if (bgRgb) root.style.setProperty("--bg-base", `rgba(${bgRgb}, 0.9)`);
      const surfRgb = hexToRgb(g.surfaceColor);
      if (surfRgb) {
        root.style.setProperty("--surface-rgb", surfRgb);
        root.style.setProperty("--surface-elevated-rgb", surfRgb);
      }
      root.style.setProperty("--text-primary", g.textColor);
      root.style.setProperty("--text-secondary", g.mutedTextColor);
    } else {
      root.style.removeProperty("--bg-solid");
      root.style.removeProperty("--bg-base");
      root.style.removeProperty("--surface-rgb");
      root.style.removeProperty("--surface-elevated-rgb");
      root.style.removeProperty("--text-primary");
      root.style.removeProperty("--text-secondary");
    }

    let styleEl = document.getElementById("liquidytm-custom-css") as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = "liquidytm-custom-css";
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = g.customCss || "";
  }, [settings.glass]);

  // Adaptive Liquid Glass artwork color extraction
  useEffect(() => {
    const thumb = playback.currentTrack?.thumbnail;
    if (!thumb || settings.glass.themeMode === "aurora") return;
    extractArtworkPalette(thumb).then((pal) => {
      if (!pal) return;
      const root = document.documentElement;
      root.style.setProperty("--mesh-c1", pal.c1);
      root.style.setProperty("--mesh-c2", pal.c2);
      root.style.setProperty("--mesh-c3", pal.c3);
      if (settings.glass.accentAuto) {
        root.style.setProperty("--accent", pal.accent);
      }
    });
  }, [playback.currentTrack?.thumbnail, settings.glass.accentAuto, settings.glass.themeMode]);

  // Pre-cache the next track + warm queue[i+2] URL ONLY after current track plays steadily for 5s
  useEffect(() => {
    if (!settings.audio.gapless || !playback.isPlaying) return;
    const nextTrack = queue[queueIndex + 1];
    const next2 = queue[queueIndex + 2];
    if (!nextTrack || preloadedIdRef.current === nextTrack.videoId) return;
    const timer = window.setTimeout(async () => {
      preloadedIdRef.current = nextTrack.videoId;
      await api.preloadTrack(nextTrack.videoId).catch(() => {});
      if (next2 && !next2.isDownloaded) {
        api.preloadQueueUrls([next2.videoId]).catch(() => {});
      }
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [playback.isPlaying, playback.currentTrack?.videoId, queue, queueIndex, settings.audio.gapless]);

  // Persist session queue & position periodically so app restarts resume right where you left off
  useEffect(() => {
    if (!settings.restoreSession || queue.length === 0) return;
    const saveNow = () => {
      api
        .saveSessionState({
          queue: queueRef.current.slice(0, 120),
          queueIndex: queueIdxRef.current,
          positionMs: playbackRef.current.positionMs,
          shuffle: shuffleRef.current,
          repeatMode: repeatRef.current,
        })
        .catch(() => {});
    };
    saveNow();
    const id = window.setInterval(() => {
      if (playbackRef.current.isPlaying) saveNow();
    }, 8000);
    return () => window.clearInterval(id);
  }, [queue, queueIndex, shuffle, repeatMode, settings.restoreSession]);

  // Sleep timer countdown monitor
  useEffect(() => {
    if (sleepTimer.kind !== "minutes") return;
    const id = window.setInterval(() => {
      if (Date.now() >= sleepTimer.endsAtMs) {
        api.pausePlayback().then(setPlayback).catch(() => {});
        setSleepTimer({ kind: "off" });
        toast("Sleep timer finished — playback paused");
      }
    }, 3000);
    return () => window.clearInterval(id);
  }, [sleepTimer, toast]);

  // SponsorBlock: fetch non-music intro/outro segments when track changes
  useEffect(() => {
    skippedSegsRef.current = new Set();
    const vid = playback.currentTrack?.videoId;
    if (!settings.audio.sponsorblockEnabled || !vid || vid.startsWith("localfile_")) {
      setSponsorSegments([]);
      return;
    }
    let cancelled = false;
    api
      .getSponsorBlockSegments(vid)
      .then((segs) => {
        if (!cancelled) setSponsorSegments(segs);
      })
      .catch(() => {
        if (!cancelled) setSponsorSegments([]);
      });
    return () => {
      cancelled = true;
    };
  }, [playback.currentTrack?.videoId, settings.audio.sponsorblockEnabled]);

  // SponsorBlock: auto-skip non-music segments during active playback
  useEffect(() => {
    if (!settings.audio.sponsorblockEnabled || !playback.isPlaying || sponsorSegments.length === 0) {
      return;
    }
    const posSecs = playback.positionMs / 1000;
    for (let i = 0; i < sponsorSegments.length; i++) {
      const seg = sponsorSegments[i];
      if (!skippedSegsRef.current.has(i) && posSecs >= seg.startSecs && posSecs < seg.endSecs - 0.5) {
        skippedSegsRef.current.add(i);
        api.seekPlayback(Math.round(seg.endSecs * 1000)).then(setPlayback).catch(() => {});
        toast(`Skipped ${seg.category.replace("_", " ")}`);
        break;
      }
    }
  }, [playback.positionMs, playback.isPlaying, sponsorSegments, settings.audio.sponsorblockEnabled, toast]);

  // Floating Lyrics Overlay: fetch synced lyrics when overlay is open
  useEffect(() => {
    const tr = playback.currentTrack;
    if (!lyricsOverlayOpen || !tr) return;
    let cancelled = false;
    api
      .getLyrics(tr.videoId, tr.title, tr.artist, tr.durationSecs, lyricsBrowseId)
      .then((res) => {
        if (!cancelled) setOverlayLyrics(res);
      })
      .catch(() => {
        if (!cancelled) setOverlayLyrics(null);
      });
    return () => {
      cancelled = true;
    };
  }, [lyricsOverlayOpen, playback.currentTrack?.videoId, lyricsBrowseId]);

  // Floating Lyrics Overlay: push live active & next line on timestamp tick
  useEffect(() => {
    if (!lyricsOverlayOpen) return;
    const tr = playback.currentTrack;
    if (!tr) return;
    let activeLine = "♪";
    let nextLine = "";
    if (overlayLyrics && overlayLyrics.synced.length > 0) {
      let idx = -1;
      for (let i = 0; i < overlayLyrics.synced.length; i++) {
        if (overlayLyrics.synced[i].timeMs <= playback.positionMs + 200) {
          idx = i;
        } else {
          break;
        }
      }
      if (idx >= 0) {
        activeLine = overlayLyrics.synced[idx].text || "♪";
        nextLine = overlayLyrics.synced[idx + 1]?.text || "";
      } else {
        activeLine = overlayLyrics.synced[0]?.text || "♪";
      }
    } else if (overlayLyrics?.plain) {
      activeLine = overlayLyrics.plain.split("\n")[0] || "♪";
    }
    const sig = `${tr.videoId}|${activeLine}|${nextLine}|${playback.isPlaying}`;
    if (sig !== lastLyricsSentRef.current) {
      lastLyricsSentRef.current = sig;
      api
        .emitLyricsSync({
          title: tr.title,
          artist: tr.artist,
          activeLine,
          nextLine,
          isPlaying: playback.isPlaying,
        })
        .catch(() => {});
    }
  }, [lyricsOverlayOpen, overlayLyrics, playback.positionMs, playback.isPlaying, playback.currentTrack]);

  // Global keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen((o) => !o);
        return;
      }
      if (typing) return;
      if (e.code === "Space") {
        e.preventDefault();
        api.togglePlayback().then(setPlayback).catch(() => {});
      } else if (e.key === "ArrowRight" && playback.durationMs > 0) {
        api.seekPlayback(Math.min(playback.durationMs, playback.positionMs + 5000)).then(setPlayback);
      } else if (e.key === "ArrowLeft" && playback.durationMs > 0) {
        api.seekPlayback(Math.max(0, playback.positionMs - 5000)).then(setPlayback);
      } else if (e.key.toLowerCase() === "m") {
        api.setMuted(!playback.muted).then(setPlayback);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playback.durationMs, playback.positionMs, playback.muted]);

  const startPlayingTrack = (track: Track, startMs?: number) => {
    pendingResumeMsRef.current = null;
    const reqSeq = ++playReqSeqRef.current;
    // Immediately silence old audio & update UI optimistically so rapid switching never overlaps!
    api.stopPlayback().catch(() => {});
    setPlayback((prev) => ({
      ...prev,
      isPlaying: false,
      isLoading: true,
      positionMs: startMs || 0,
      durationMs: track.durationSecs * 1000,
      currentTrack: track,
      error: null,
    }));

    if (playDebounceRef.current) {
      window.clearTimeout(playDebounceRef.current);
    }

    // 280ms debounce coalesces rapid Next/Next/Next clicks so skipped songs NEVER spawn yt-dlp!
    // Already-downloaded local files play with 0ms delay.
    const delayMs = track.isDownloaded || startMs ? 0 : 280;
    playDebounceRef.current = window.setTimeout(async () => {
      playDebounceRef.current = null;
      if (playReqSeqRef.current !== reqSeq) return;
      try {
        const snap = await api.playTrack(track, startMs);
        if (playReqSeqRef.current !== reqSeq) return;
        setPlayback(snap);
        pageCache.invalidateRecent();
        if (!settings.downloads.offlineMode && !track.videoId.startsWith("localfile_")) {
          api.getWatchPlaylist(track.videoId).then((watch) => {
            if (playReqSeqRef.current !== reqSeq) return;
            setLyricsBrowseId(watch.lyricsBrowseId ?? null);
            setRelatedBrowseId(watch.relatedBrowseId ?? null);
            if (autoplay && queueRef.current.length <= 1 && watch.tracks.length > 1) {
              const rest = watch.tracks.filter((w) => w.videoId !== track.videoId);
              setQueue([track, ...rest]);
              setQueueIndex(0);
            }
          }).catch(() => {});
        }
      } catch (e) {
        if (playReqSeqRef.current !== reqSeq) return;
        const msg = String(e);
        api.logFrontendEvent("ERROR", "play", `Failed to play ${track.videoId}: ${msg}`).catch(() => {});
        toast(msg);
      }
    }, delayMs);
  };

  const handleTogglePlay = () => {
    if (pendingResumeMsRef.current !== null && playbackRef.current.currentTrack) {
      const resumeAt = pendingResumeMsRef.current;
      startPlayingTrack(playbackRef.current.currentTrack, resumeAt);
      return;
    }
    api.togglePlayback().then(setPlayback).catch(() => {});
  };

  const handlePlayTrack = (track: Track, list?: Track[]) => {
    if (list && list.length > 0) {
      const idx = list.findIndex((t) => t.videoId === track.videoId);
      setQueue(list);
      setQueueIndex(idx >= 0 ? idx : 0);
    } else {
      setQueue([track]);
      setQueueIndex(0);
    }
    startPlayingTrack(track);
  };

  const handleStartRadio = async (track: Track) => {
    toast(`Starting radio for "${track.title}"...`);
    try {
      const watch = await api.getWatchPlaylist(track.videoId);
      setLyricsBrowseId(watch.lyricsBrowseId ?? null);
      setRelatedBrowseId(watch.relatedBrowseId ?? null);
      const list = watch.tracks.length > 0 ? watch.tracks : [track];
      setQueue(list);
      setQueueIndex(0);
      startPlayingTrack(list[0]);
    } catch (e) {
      handlePlayTrack(track);
      toast(`Radio fallback: ${e}`);
    }
  };

  const handleAdvanceNext = (autoEnded = false) => {
    if (autoEnded && sleepTimerRef.current.kind === "end_of_track") {
      setSleepTimer({ kind: "off" });
      toast("Sleep timer finished at end of track");
      return;
    }
    const q = queueRef.current;
    const idx = queueIdxRef.current;
    const rep = repeatRef.current;
    if (q.length === 0) return;

    if (autoEnded && rep === "one" && idx >= 0 && q[idx]) {
      startPlayingTrack(q[idx]);
      return;
    }

    let nextIdx = idx + 1;
    if (shuffleRef.current && q.length > 1) {
      nextIdx = Math.floor(Math.random() * q.length);
      if (nextIdx === idx) nextIdx = (idx + 1) % q.length;
    } else if (nextIdx >= q.length) {
      if (rep === "all") {
        nextIdx = 0;
      } else {
        return;
      }
    }
    setQueueIndex(nextIdx);
    startPlayingTrack(q[nextIdx]);
  };

  const handlePrev = () => {
    if (playback.positionMs > 3500) {
      api.seekPlayback(0).then(setPlayback);
      return;
    }
    if (queue.length === 0) return;
    const prevIdx = queueIndex > 0 ? queueIndex - 1 : queue.length - 1;
    setQueueIndex(prevIdx);
    startPlayingTrack(queue[prevIdx]);
  };

  const handleUpdateSettings = (next: AppSettings) => {
    setSettings(next);
    api.saveSettings(next).catch((e) => toast(`Save settings error: ${e}`));
  };

  const handleRate = async (
    track: Track,
    rating: "LIKE" | "DISLIKE" | "INDIFFERENT"
  ) => {
    try {
      await api.rateSong(track, rating);
      if (playback.currentTrack?.videoId === track.videoId) {
        setPlayback((p) =>
          p.currentTrack
            ? { ...p, currentTrack: { ...p.currentTrack, likeStatus: rating } }
            : p
        );
      }
      toast(rating === "LIKE" ? `Liked "${track.title}"` : rating === "DISLIKE" ? `Disliked "${track.title}"` : "Rating cleared");
    } catch (e) {
      const msg = String(e);
      api.logFrontendEvent("ERROR", "rate", `Failed to rate ${track.videoId}: ${msg}`).catch(() => {});
      toast(msg);
    }
  };

  const handleDownload = async (track: Track) => {
    try {
      await api.enqueueDownload(track);
      toast(`Queued download: ${track.title}`);
    } catch (e) {
      toast(`Download error: ${e}`);
    }
  };

  const handleDownloadBatch = async (tracks: Track[]) => {
    try {
      await api.enqueueBatchDownload(tracks);
      toast(`Queued ${tracks.length} tracks for offline download`);
    } catch (e) {
      toast(`Batch download error: ${e}`);
    }
  };

  const toggleMiniPlayer = async () => {
    const next = !miniPlayer;
    setMiniPlayer(next);
    try {
      const win = getCurrentWindow();
      await win.setAlwaysOnTop(next);
      if (next) {
        await win.setMinSize(new LogicalSize(420, 172));
        await win.setSize(new LogicalSize(460, 178));
      } else {
        await win.setMinSize(new LogicalSize(900, 600));
        await win.setSize(new LogicalSize(1320, 840));
      }
    } catch {
      // ignore outside desktop
    }
  };

  const activeDownloadsCount = downloads.filter(
    (d) => d.status === "downloading" || d.status === "queued" || d.status === "processing"
  ).length;

  const commonProps = {
    currentTrackId: playback.currentTrack?.videoId,
    isPlaying: playback.isPlaying,
    onPlayTrack: handlePlayTrack,
    onStartRadio: handleStartRadio,
    onLike: (t: Track) =>
      handleRate(t, t.likeStatus === "LIKE" ? "INDIFFERENT" : "LIKE"),
    onDownload: handleDownload,
    onDownloadBatch: handleDownloadBatch,
    onAddToPlaylist: (t: Track) => setAddTrackModal(t),
    onNavigate: navigate,
  };

  return (
    <div
      className={`app-shell ${settings.glass.cursorRefraction ? "refraction-on" : ""} ${
        !settings.glass.liquidGlassEnabled ? "no-glass" : ""
      }`}
    >
      {/* Adaptive Dynamic Ambient Mesh */}
      {settings.glass.liquidGlassEnabled && (
        <div className="ambient-mesh" aria-hidden="true">
          <div className="mesh-blob b1" />
          <div className="mesh-blob b2" />
          <div className="mesh-blob b3" />
        </div>
      )}

      <TitleBar
        account={account}
        offlineMode={settings.downloads.offlineMode}
        miniPlayer={miniPlayer}
        canGoBack={histIdx > 0}
        canGoForward={histIdx < history.length - 1}
        onBack={() => histIdx > 0 && setHistIdx((i) => i - 1)}
        onForward={() => histIdx < history.length - 1 && setHistIdx((i) => i + 1)}
        onNavigate={navigate}
        onToggleMiniPlayer={toggleMiniPlayer}
        onOpenCommandPalette={() => setCmdOpen(true)}
      />

      {!miniPlayer && (
        <div className="app-body">
          <Sidebar
            route={route}
            rail={settings.glass.sidebarMode === "rail"}
            remotePlaylists={remotePlaylists}
            localPlaylists={localPlaylists}
            activeDownloadsCount={activeDownloadsCount}
            onNavigate={navigate}
            onOpenCreatePlaylist={() => setCreatePlOpen(true)}
          />

          <main className="main-scroll glass-panel">
            {route.page === "home" && (
              <HomeView
                {...commonProps}
                offlineMode={settings.downloads.offlineMode}
              />
            )}
            {route.page === "explore" && <ExploreView {...commonProps} />}
            {route.page === "search" && (
              <SearchView
                {...commonProps}
                query={route.query}
                filter={route.filter}
              />
            )}
            {route.page === "library" && (
              <LibraryView
                {...commonProps}
                initialTab={route.tab}
                remotePlaylists={remotePlaylists}
                localPlaylists={localPlaylists}
                localMusicFolders={settings.downloads.localMusicFolders || []}
                onOpenCreatePlaylist={() => setCreatePlOpen(true)}
                onRefreshLibraries={() => {
                  refreshLibraries();
                  toast("Syncing YouTube Music playlists...");
                }}
                onToast={toast}
              />
            )}
            {route.page === "stats" && (
              <StatsView onPlayTrack={handlePlayTrack} onNavigate={navigate} />
            )}
            {route.page === "playlist" && (
              <PlaylistView
                {...commonProps}
                id={route.id}
                isLocal={route.isLocal}
                smartKind={route.smartKind}
                onPlaylistChanged={refreshLibraries}
                onToast={toast}
              />
            )}
            {route.page === "artist" && (
              <ArtistView {...commonProps} browseId={route.browseId} />
            )}
            {route.page === "downloads" && (
              <DownloadsView
                downloads={downloads}
                onRefresh={refreshDownloads}
                onSyncSmart={async () => {
                  try {
                    const count = await api.syncSmartDownloads();
                    toast(`Smart Downloads queued ${count} tracks`);
                    refreshDownloads();
                  } catch (e) {
                    toast(`Smart sync failed: ${e}`);
                  }
                }}
                onPlayTrack={(t) => handlePlayTrack(t)}
              />
            )}
            {route.page === "settings" && (
              <SettingsView
                initialTab={route.tab}
                settings={settings}
                account={account}
                onUpdateSettings={handleUpdateSettings}
                onAccountChanged={(acc) => {
                  setAccount(acc);
                  pageCache.clearAll();
                  refreshLibraries();
                }}
                onToast={toast}
              />
            )}
          </main>
        </div>
      )}

      {nowPlayingOpen && !miniPlayer && (
        <NowPlayingView
          playback={playback}
          queue={queue}
          queueIndex={queueIndex}
          autoplay={autoplay}
          visualizerEnabled={settings.audio.visualizerEnabled}
          lyricsBrowseId={lyricsBrowseId}
          relatedBrowseId={relatedBrowseId}
          onToggleAutoplay={() => setAutoplay((a) => !a)}
          onSelectQueueIndex={(idx) => {
            setQueueIndex(idx);
            if (queue[idx]) startPlayingTrack(queue[idx]);
          }}
          onRemoveQueueIndex={(idx) => {
            setQueue((prev) => prev.filter((_, i) => i !== idx));
            if (idx < queueIndex) setQueueIndex((i) => i - 1);
          }}
          onClearQueue={() => {
            setQueue([]);
            setQueueIndex(-1);
          }}
          onSeek={(ms) => api.seekPlayback(ms).then(setPlayback)}
          onPlayTrack={(t) => handlePlayTrack(t)}
          onOpenLyricsOverlay={() => {
            setLyricsOverlayOpen(true);
            api.openLyricsOverlay().catch((e) => toast(String(e)));
          }}
          onClose={() => setNowPlayingOpen(false)}
        />
      )}

      <PlayerBar
        playback={playback}
        shuffle={shuffle}
        repeatMode={repeatMode}
        nowPlayingOpen={nowPlayingOpen}
        eqEnabled={settings.audio.eq.enabled}
        visualizerEnabled={settings.audio.visualizerEnabled}
        playbackSpeed={settings.audio.playbackSpeed}
        preservePitch={settings.audio.preservePitch}
        sleepTimer={sleepTimer}
        sponsorSegments={sponsorSegments}
        onTogglePlay={handleTogglePlay}
        onPrev={handlePrev}
        onNext={() => handleAdvanceNext(false)}
        onSeek={(ms) => api.seekPlayback(ms).then(setPlayback)}
        onVolume={(v) => api.setVolume(v).then(setPlayback)}
        onToggleMute={() => api.setMuted(!playback.muted).then(setPlayback)}
        onToggleShuffle={() => setShuffle((s) => !s)}
        onCycleRepeat={() =>
          setRepeatMode((m) => (m === "off" ? "all" : m === "all" ? "one" : "off"))
        }
        onToggleNowPlaying={() => setNowPlayingOpen((o) => !o)}
        onRate={handleRate}
        onDownload={handleDownload}
        onAddToPlaylist={(t) => setAddTrackModal(t)}
        onOpenAudioSettings={() => {
          setNowPlayingOpen(false);
          navigate({ page: "settings", tab: "audio" });
        }}
        onOpenArtist={(aid) => {
          setNowPlayingOpen(false);
          navigate({ page: "artist", browseId: aid });
        }}
        onSetSpeed={(speed, preservePitch) => {
          handleUpdateSettings({
            ...settings,
            audio: { ...settings.audio, playbackSpeed: speed, preservePitch },
          });
          api.setPlaybackSpeed(speed, preservePitch).catch(() => {});
        }}
        onSetSleepTimer={(mode) => {
          setSleepTimer(mode);
          if (mode.kind === "off") toast("Sleep timer cancelled");
          else if (mode.kind === "end_of_track") toast("Playback will pause at end of current track");
          else toast(`Sleep timer set for ${Math.round((mode.endsAtMs - Date.now()) / 60000)} minutes`);
        }}
        onOpenLyricsOverlay={() => {
          setLyricsOverlayOpen(true);
          api.openLyricsOverlay().catch((e) => toast(String(e)));
        }}
      />

      {/* Command Palette (Ctrl+K) */}
      <CommandPalette
        open={cmdOpen}
        onClose={() => setCmdOpen(false)}
        onNavigate={navigate}
        onToggleOffline={() => {
          const next = !settings.downloads.offlineMode;
          handleUpdateSettings({
            ...settings,
            downloads: { ...settings.downloads, offlineMode: next },
          });
          toast(next ? "Offline Mode enabled" : "Offline Mode disabled");
        }}
        onToggleEq={() => {
          const next = !settings.audio.eq.enabled;
          handleUpdateSettings({
            ...settings,
            audio: { ...settings.audio, eq: { ...settings.audio.eq, enabled: next } },
          });
          toast(next ? "10-Band EQ enabled" : "10-Band EQ bypassed");
        }}
      />

      {/* Create Playlist Modal */}
      {createPlOpen && (
        <div className="modal-backdrop" onClick={() => setCreatePlOpen(false)}>
          <div
            className="glass-panel"
            style={{ width: 420, padding: 20, display: "flex", flexDirection: "column", gap: 12 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ fontSize: 17 }}>Create Playlist</h3>
              <button className="icon-btn" onClick={() => setCreatePlOpen(false)}>
                <X size={16} />
              </button>
            </div>
            <input
              className="glass-input"
              placeholder="Playlist title"
              value={newPlTitle}
              onChange={(e) => setNewPlTitle(e.target.value)}
            />
            <textarea
              className="glass-textarea"
              rows={2}
              placeholder="Description (optional)"
              value={newPlDesc}
              onChange={(e) => setNewPlDesc(e.target.value)}
            />
            {account.loggedIn && (
              <div className="setting-row">
                <span style={{ fontSize: 13 }}>Sync to YouTube Music Account</span>
                <button
                  className={`toggle-switch ${newPlSynced ? "on" : ""}`}
                  onClick={() => setNewPlSynced((s) => !s)}
                >
                  <span className="toggle-knob" />
                </button>
              </div>
            )}
            <button
              className="glass-pill active"
              style={{ alignSelf: "flex-end" }}
              onClick={async () => {
                if (!newPlTitle.trim()) return;
                try {
                  await api.createPlaylist(newPlTitle.trim(), newPlDesc.trim(), newPlSynced);
                  setNewPlTitle("");
                  setNewPlDesc("");
                  setCreatePlOpen(false);
                  refreshLibraries();
                  toast("Playlist created!");
                } catch (e) {
                  toast(String(e));
                }
              }}
            >
              <Plus size={15} /> Create
            </button>
          </div>
        </div>
      )}

      {/* Add Track to Playlist Modal */}
      {addTrackModal && (
        <div className="modal-backdrop" onClick={() => setAddTrackModal(null)}>
          <div
            className="glass-panel"
            style={{ width: 420, padding: 20, display: "flex", flexDirection: "column", gap: 10 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ fontSize: 16 }}>Add "{addTrackModal.title}" to Playlist</h3>
              <button className="icon-btn" onClick={() => setAddTrackModal(null)}>
                <X size={16} />
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 280, overflowY: "auto" }}>
              {localPlaylists.map((pl) => (
                <button
                  key={pl.id}
                  className="suggestion-item"
                  onClick={async () => {
                    await api.addToPlaylist(pl.id, addTrackModal);
                    setAddTrackModal(null);
                    refreshLibraries();
                    toast(`Added to ${pl.title}`);
                  }}
                >
                  <ListMusic size={15} />
                  <span>{pl.title} (Local)</span>
                </button>
              ))}
              {remotePlaylists.map((pl) => (
                <button
                  key={pl.id}
                  className="suggestion-item"
                  onClick={async () => {
                    try {
                      await api.addToPlaylist(pl.id, addTrackModal);
                      setAddTrackModal(null);
                      toast(`Added to ${pl.title}`);
                    } catch (e) {
                      toast(String(e));
                    }
                  }}
                >
                  <ListMusic size={15} />
                  <span>{pl.title} (YouTube Music)</span>
                </button>
              ))}
              {localPlaylists.length === 0 && remotePlaylists.length === 0 && (
                <div style={{ padding: 14, color: "var(--text-muted)", fontSize: 13 }}>
                  No playlists yet. Create one first!
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Toasts */}
      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className="toast-item glass-panel">
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;
