import React, { useEffect, useRef, useState } from "react";
import {
  ArrowUpToLine,
  AudioWaveform,
  Bookmark,
  Disc3,
  GripVertical,
  Image as ImageIcon,
  Languages,
  ListMusic,
  PictureInPicture2,
  Play,
  Plus,
  Save,
  Shuffle,
  Sparkles,
  Trash2,
  Tv2,
  X,
} from "lucide-react";
import { api, formatTime } from "../api";
import { AudioVisualizer } from "./AudioVisualizer";
import type {
  LyricsData,
  PlaybackSnapshot,
  SavedQueueSnapshot,
  Shelf,
  Track,
  TrackBookmark,
} from "../types";

interface NowPlayingViewProps {
  playback: PlaybackSnapshot;
  queue: Track[];
  queueIndex: number;
  autoplay: boolean;
  visualizerEnabled: boolean;
  bookmarks: TrackBookmark[];
  savedQueues: SavedQueueSnapshot[];
  lyricsBrowseId?: string | null;
  relatedBrowseId?: string | null;
  onToggleAutoplay: () => void;
  onSelectQueueIndex: (idx: number) => void;
  onRemoveQueueIndex: (idx: number) => void;
  onReorderQueue: (fromIdx: number, toIdx: number) => void;
  onMoveQueueNext: (idx: number) => void;
  onShuffleRemaining: () => void;
  onRemoveQueueDuplicates: () => void;
  onClearQueue: () => void;
  onSaveQueue: (name: string) => void;
  onRestoreQueue: (snap: SavedQueueSnapshot) => void;
  onDeleteSavedQueue: (id: string) => void;
  onSeek: (ms: number) => void;
  onPlayTrack: (track: Track) => void;
  onAddBookmark: () => void;
  onDeleteBookmark: (id: number) => void;
  onOpenLyricsOverlay: () => void;
  onOpenLounge: () => void;
  onOpenLyricCard: (initialLines: string[], allLines: string[]) => void;
  onClose: () => void;
}

export const NowPlayingView: React.FC<NowPlayingViewProps> = ({
  playback,
  queue,
  queueIndex,
  autoplay,
  visualizerEnabled,
  bookmarks,
  savedQueues,
  lyricsBrowseId,
  relatedBrowseId,
  onToggleAutoplay,
  onSelectQueueIndex,
  onRemoveQueueIndex,
  onReorderQueue,
  onMoveQueueNext,
  onShuffleRemaining,
  onRemoveQueueDuplicates,
  onClearQueue,
  onSaveQueue,
  onRestoreQueue,
  onDeleteSavedQueue,
  onSeek,
  onPlayTrack,
  onAddBookmark,
  onDeleteBookmark,
  onOpenLyricsOverlay,
  onOpenLounge,
  onOpenLyricCard,
  onClose,
}) => {
  const [tab, setTab] = useState<"upnext" | "lyrics" | "related">("upnext");
  const [lyrics, setLyrics] = useState<LyricsData | null>(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [translateLang, setTranslateLang] = useState<string>("");
  const [translatedLines, setTranslatedLines] = useState<string[]>([]);
  const [translating, setTranslating] = useState(false);
  const [related, setRelated] = useState<Shelf[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [snapshotsOpen, setSnapshotsOpen] = useState(false);
  const [snapshotName, setSnapshotName] = useState("");
  const [qDragIdx, setQDragIdx] = useState<number | null>(null);
  const [qDragOverIdx, setQDragOverIdx] = useState<number | null>(null);
  const qDragOverRef = useRef<number | null>(null);
  const qJustDraggedRef = useRef(false);
  const qScrollRef = useRef<HTMLDivElement | null>(null);
  const activeLineRef = useRef<HTMLDivElement | null>(null);

  const startQueuePointerDrag = (fromIdx: number, e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const startY = e.clientY;
    let moved = false;
    qDragOverRef.current = fromIdx;

    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientY - startY) < 6) return;
      if (!moved) {
        moved = true;
        setQDragIdx(fromIdx);
        setQDragOverIdx(fromIdx);
        document.body.style.cursor = "grabbing";
        document.body.style.userSelect = "none";
      }
      const els = document.elementsFromPoint(ev.clientX, ev.clientY);
      for (const el of els) {
        const attr = (el as HTMLElement).getAttribute?.("data-queue-idx");
        if (attr !== null && attr !== undefined && attr !== "") {
          const targetIdx = Number(attr);
          if (!Number.isNaN(targetIdx) && targetIdx !== qDragOverRef.current) {
            qDragOverRef.current = targetIdx;
            setQDragOverIdx(targetIdx);
          }
          break;
        }
      }
      const scroller = qScrollRef.current;
      if (scroller) {
        const r = scroller.getBoundingClientRect();
        if (ev.clientY < r.top + 48) scroller.scrollTop -= 10;
        else if (ev.clientY > r.bottom - 48) scroller.scrollTop += 10;
      }
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (moved) {
        qJustDraggedRef.current = true;
        window.setTimeout(() => {
          qJustDraggedRef.current = false;
        }, 180);
        const target = qDragOverRef.current;
        if (target !== null && target !== fromIdx) {
          onReorderQueue(fromIdx, target);
        }
      }
      qDragOverRef.current = null;
      setQDragIdx(null);
      setQDragOverIdx(null);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const track = playback.currentTrack;
  const tel = playback.telemetry;

  // Fetch lyrics when track changes or lyrics tab opened
  useEffect(() => {
    if (!track) return;
    let cancelled = false;
    setLyricsLoading(true);
    api
      .getLyrics(
        track.videoId,
        track.title,
        track.artist,
        track.durationSecs,
        lyricsBrowseId
      )
      .then((res) => {
        if (!cancelled) setLyrics(res);
      })
      .catch(() => {
        if (!cancelled) setLyrics(null);
      })
      .finally(() => {
        if (!cancelled) setLyricsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [track?.videoId, lyricsBrowseId]);

  // Translate synced lyrics live when a target language is selected
  useEffect(() => {
    if (!translateLang || !lyrics || lyrics.synced.length === 0) {
      setTranslatedLines([]);
      return;
    }
    let cancelled = false;
    setTranslating(true);
    api
      .translateLyrics(
        lyrics.videoId,
        lyrics.synced.map((l) => l.text),
        translateLang
      )
      .then((res) => {
        if (!cancelled) setTranslatedLines(res);
      })
      .catch(() => {
        if (!cancelled) setTranslatedLines([]);
      })
      .finally(() => {
        if (!cancelled) setTranslating(false);
      });
    return () => {
      cancelled = true;
    };
  }, [translateLang, lyrics]);

  // Fetch related shelves when related tab opened
  useEffect(() => {
    if (tab !== "related" || !relatedBrowseId) return;
    let cancelled = false;
    setRelatedLoading(true);
    api
      .getRelated(relatedBrowseId)
      .then((res) => {
        if (!cancelled) setRelated(res);
      })
      .catch(() => {
        if (!cancelled) setRelated([]);
      })
      .finally(() => {
        if (!cancelled) setRelatedLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, relatedBrowseId]);

  // Compute active synced lyric line index
  const activeLyricIdx = (() => {
    if (!lyrics || lyrics.synced.length === 0) return -1;
    let idx = -1;
    for (let i = 0; i < lyrics.synced.length; i++) {
      if (lyrics.synced[i].timeMs <= playback.positionMs + 200) {
        idx = i;
      } else {
        break;
      }
    }
    return idx;
  })();

  useEffect(() => {
    if (tab === "lyrics" && activeLineRef.current) {
      activeLineRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [activeLyricIdx, tab]);

  return (
    <div className="now-playing-overlay">
      {/* Left Stage: Glowing Artwork + Audiophile Signal Telemetry */}
      <div className="np-art-stage">
        <div className="np-art-frame">
          {track?.thumbnail ? (
            <img src={track.thumbnail} alt="" />
          ) : (
            <div
              style={{
                width: "100%",
                height: "100%",
                display: "grid",
                placeItems: "center",
                background: "rgba(255,255,255,0.06)",
              }}
            >
              <Disc3 size={64} style={{ opacity: 0.4 }} />
            </div>
          )}
        </div>

        {track && (
          <div style={{ textAlign: "center", maxWidth: 420 }}>
            <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>
              {track.title}
            </h2>
            <p style={{ color: "var(--text-secondary)", fontSize: 14 }}>
              {track.artist}
              {track.album ? ` — ${track.album}` : ""}
            </p>
          </div>
        )}

        <AudioVisualizer
          enabled={visualizerEnabled}
          isPlaying={playback.isPlaying}
          variant="full"
        />

        {track && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center", maxWidth: 420 }}>
            <button
              className="glass-pill"
              style={{ padding: "4px 10px", fontSize: 12 }}
              onClick={onAddBookmark}
              title="Bookmark current timestamp"
            >
              <Bookmark size={12} /> <Plus size={11} /> Bookmark {formatTime(playback.positionMs)}
            </button>
            {bookmarks.map((bm) => (
              <span
                key={bm.id}
                className="glass-pill"
                style={{ padding: "3px 8px", fontSize: 11.5, gap: 5, cursor: "pointer" }}
                onClick={() => onSeek(bm.timeMs)}
              >
                <span>{bm.label || formatTime(bm.timeMs)}</span>
                <X
                  size={11}
                  style={{ opacity: 0.65 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteBookmark(bm.id);
                  }}
                />
              </span>
            ))}
          </div>
        )}

        {tel && (
          <div
            className="glass-panel"
            style={{
              padding: "12px 16px",
              width: "min(410px, 100%)",
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "8px 16px",
              fontSize: 12,
            }}
          >
            <div>
              <div style={{ color: "var(--text-muted)", fontSize: 10.5 }}>CODEC & BITRATE</div>
              <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 5 }}>
                <Sparkles size={12} style={{ color: "#ffd978" }} />
                {tel.codec} {tel.bitrateKbps > 0 ? `${tel.bitrateKbps} kbps` : ""}
                {tel.formatId ? ` (#${tel.formatId})` : ""}
              </div>
            </div>
            <div>
              <div style={{ color: "var(--text-muted)", fontSize: 10.5 }}>SAMPLE RATE PATH</div>
              <div style={{ fontWeight: 600 }}>
                {(tel.sourceSampleRate / 1000).toFixed(1)}kHz →{" "}
                {(tel.outputSampleRate / 1000).toFixed(1)}kHz
              </div>
            </div>
            <div>
              <div style={{ color: "var(--text-muted)", fontSize: 10.5 }}>OUTPUT DEVICE</div>
              <div
                style={{
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {tel.outputDevice}
              </div>
            </div>
            <div>
              <div style={{ color: "var(--text-muted)", fontSize: 10.5 }}>DSP NORMALIZATION</div>
              <div style={{ fontWeight: 600 }}>
                {tel.loudnessGainDb >= 0 ? "+" : ""}
                {tel.loudnessGainDb.toFixed(1)} dB • {tel.isLocalFile ? "Cached/Local" : "Stream"}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Right Stage: YT Music Tabs (Up Next | Lyrics | Related) */}
      <div className="np-right-panel glass-panel">
        <div className="np-tabs">
          <button
            className={`glass-pill ${tab === "upnext" ? "active" : ""}`}
            onClick={() => setTab("upnext")}
          >
            <ListMusic size={14} /> Up Next ({queue.length})
          </button>
          <button
            className={`glass-pill ${tab === "lyrics" ? "active" : ""}`}
            onClick={() => setTab("lyrics")}
          >
            <AudioWaveform size={14} /> Lyrics
          </button>
          <button
            className={`glass-pill ${tab === "related" ? "active" : ""}`}
            onClick={() => setTab("related")}
          >
            <Sparkles size={14} /> Related
          </button>
          <div style={{ flex: 1 }} />
          <button
            className="icon-btn"
            onClick={onOpenLounge}
            title="Ambient TV / Lounge Mode (F11)"
          >
            <Tv2 size={16} />
          </button>
          <button
            className="icon-btn"
            onClick={onOpenLyricsOverlay}
            title="Floating always-on-top lyrics"
          >
            <PictureInPicture2 size={16} />
          </button>
          <button className="icon-btn" onClick={onClose} title="Close Now Playing">
            <X size={18} />
          </button>
        </div>

        {tab === "upnext" && (
          <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 10,
                padding: "0 6px",
              }}
            >
              <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
                <span>Autoplay Radio</span>
                <button
                  className={`toggle-switch ${autoplay ? "on" : ""}`}
                  onClick={onToggleAutoplay}
                >
                  <span className="toggle-knob" />
                </button>
              </label>
              <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                {queue.length > 2 && (
                  <>
                    <button
                      className="glass-pill"
                      style={{ padding: "4px 8px", fontSize: 11.5 }}
                      onClick={onShuffleRemaining}
                      title="Shuffle remaining tracks after current song"
                    >
                      <Shuffle size={12} /> Shuffle next
                    </button>
                    <button
                      className="glass-pill"
                      style={{ padding: "4px 8px", fontSize: 11.5 }}
                      onClick={onRemoveQueueDuplicates}
                      title="Remove duplicate tracks from queue"
                    >
                      <Sparkles size={12} /> Dedupe
                    </button>
                  </>
                )}
                <button
                  className={`glass-pill ${snapshotsOpen ? "active" : ""}`}
                  style={{ padding: "4px 9px", fontSize: 11.5 }}
                  onClick={() => setSnapshotsOpen((s) => !s)}
                  title="Save or switch between multiple queue snapshots"
                >
                  <Save size={12} /> Snapshots ({savedQueues.length})
                </button>
                {queue.length > 0 && (
                  <button
                    className="glass-pill"
                    style={{ padding: "4px 9px", fontSize: 11.5 }}
                    onClick={onClearQueue}
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            {snapshotsOpen && (
              <div className="saved-queues-panel">
                {queue.length > 0 && (
                  <div style={{ display: "flex", gap: 6, marginBottom: savedQueues.length > 0 ? 8 : 0 }}>
                    <input
                      className="glass-input"
                      style={{ flex: 1, fontSize: 12.5, padding: "5px 9px" }}
                      placeholder={`Name this queue (${queue.length} songs)...`}
                      value={snapshotName}
                      onChange={(e) => setSnapshotName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && snapshotName.trim()) {
                          onSaveQueue(snapshotName.trim());
                          setSnapshotName("");
                        }
                      }}
                    />
                    <button
                      className="glass-pill active"
                      style={{ padding: "5px 10px", fontSize: 12 }}
                      onClick={() => {
                        const label = snapshotName.trim() || `Queue ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
                        onSaveQueue(label);
                        setSnapshotName("");
                      }}
                    >
                      Save
                    </button>
                  </div>
                )}
                {savedQueues.length === 0 ? (
                  <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "4px 2px" }}>
                    No saved queue snapshots yet. Save your current queue to switch back to it later.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 148, overflowY: "auto" }}>
                    {savedQueues.map((sq) => (
                      <div key={sq.id} className="saved-queue-row">
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div className="media-title" style={{ fontSize: 12.5 }}>{sq.name}</div>
                          <div className="media-subtitle" style={{ fontSize: 11 }}>
                            {sq.queue.length} tracks
                            {sq.queue[sq.queueIndex] ? ` • at "${sq.queue[sq.queueIndex].title}"` : ""}
                          </div>
                        </div>
                        <button
                          className="glass-pill"
                          style={{ padding: "3px 9px", fontSize: 11.5 }}
                          onClick={() => {
                            onRestoreQueue(sq);
                            setSnapshotsOpen(false);
                          }}
                        >
                          Restore
                        </button>
                        <button
                          className="icon-btn"
                          style={{ width: 24, height: 24 }}
                          onClick={() => onDeleteSavedQueue(sq.id)}
                          title="Delete saved queue"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div
              ref={qScrollRef}
              style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}
            >
              {queue.map((t, idx) => (
                <div
                  key={`${t.videoId}-${idx}`}
                  data-queue-idx={idx}
                  className={`track-row ${idx === queueIndex ? "playing" : ""} ${
                    qDragIdx === idx ? "dragging" : ""
                  } ${qDragOverIdx === idx && qDragIdx !== idx ? "drag-over" : ""}`}
                  style={{ gridTemplateColumns: "22px 40px 1fr auto", cursor: "grab", touchAction: "none" }}
                  onPointerDown={(e) => {
                    if ((e.target as HTMLElement | null)?.closest("button")) return;
                    startQueuePointerDrag(idx, e);
                  }}
                  onClick={() => {
                    if (qJustDraggedRef.current) return;
                    onSelectQueueIndex(idx);
                  }}
                >
                  <div className="drag-handle-grip" title="Drag to reorder Up Next">
                    <GripVertical size={14} />
                  </div>
                  <div className="track-thumb" style={{ width: 40, height: 40 }}>
                    {t.thumbnail && <img src={t.thumbnail} alt="" draggable={false} />}
                    <div className="track-thumb-overlay">
                      <Play size={14} />
                    </div>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div className="media-title">{t.title}</div>
                    <div className="media-subtitle">{t.artist}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ fontSize: 12, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
                      {t.durationSecs > 0 ? formatTime(t.durationSecs * 1000) : ""}
                    </span>
                    {idx > queueIndex + 1 && (
                      <button
                        className="icon-btn"
                        style={{ width: 26, height: 26 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          onMoveQueueNext(idx);
                        }}
                        title="Play next (#1 up next)"
                      >
                        <ArrowUpToLine size={13} />
                      </button>
                    )}
                    <button
                      className="icon-btn"
                      style={{ width: 26, height: 26 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveQueueIndex(idx);
                      }}
                      title="Remove from queue"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
              {queue.length === 0 && (
                <div style={{ padding: 30, textAlign: "center", color: "var(--text-muted)" }}>
                  Queue is empty. Play any song to populate Up Next & Radio.
                </div>
              )}
            </div>
          </div>
        )}

        {tab === "lyrics" && (
          <div className="lyrics-scroll">
            {lyricsLoading && (
              <div style={{ padding: 24, color: "var(--text-muted)" }}>
                Searching synced & YouTube Music lyrics...
              </div>
            )}
            {!lyricsLoading && lyrics && lyrics.synced.length > 0 && (
              <>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                  <div className="badge">
                    {lyrics.source} • Click any line to seek
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <button
                      className="glass-pill"
                      style={{ padding: "4px 9px", fontSize: 11.5 }}
                      onClick={() => {
                        const all = lyrics.synced.map((l) => l.text).filter(Boolean);
                        const start = Math.max(0, activeLyricIdx);
                        onOpenLyricCard(all.slice(start, start + 3), all);
                      }}
                      title="Export shareable lyric poster card"
                    >
                      <ImageIcon size={12} /> Lyric card
                    </button>
                    <Languages size={14} style={{ opacity: 0.65 }} />
                    <select
                      className="glass-select"
                      value={translateLang}
                      onChange={(e) => setTranslateLang(e.target.value)}
                      style={{ fontSize: 12, padding: "4px 8px" }}
                    >
                      <option value="">Original</option>
                      <option value="en">English</option>
                      <option value="fr">French</option>
                      <option value="ar">Arabic</option>
                      <option value="es">Spanish</option>
                      <option value="de">German</option>
                      <option value="ja">Japanese</option>
                      <option value="ko">Korean</option>
                    </select>
                    {translating && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>...</span>}
                  </div>
                </div>
                {lyrics.synced.map((line, i) => {
                  const isActive = i === activeLyricIdx;
                  const start = line.timeMs;
                  const end = lyrics.synced[i + 1]?.timeMs ?? start + 3500;
                  const pct = isActive
                    ? Math.max(0, Math.min(100, ((playback.positionMs - start) / Math.max(300, end - start)) * 100))
                    : 0;
                  const trLine = translatedLines[i];
                  return (
                    <div
                      key={`${line.timeMs}-${i}`}
                      ref={isActive ? activeLineRef : null}
                      className={`lyric-line ${isActive ? "active" : ""}`}
                      onClick={() => onSeek(line.timeMs)}
                    >
                      <div
                        className={isActive ? "karaoke-sweep" : undefined}
                        style={
                          isActive
                            ? {
                                backgroundImage: `linear-gradient(90deg, var(--text-primary) ${pct}%, rgba(161,161,170,0.42) ${pct}%)`,
                              }
                            : undefined
                        }
                      >
                        {line.text || "♪"}
                      </div>
                      {trLine && trLine !== line.text && (
                        <div className="lyric-translation">{trLine}</div>
                      )}
                    </div>
                  );
                })}
              </>
            )}
            {!lyricsLoading && lyrics && lyrics.synced.length === 0 && lyrics.plain && (
              <>
                <div className="badge" style={{ alignSelf: "flex-start", marginBottom: 8 }}>
                  {lyrics.source}
                </div>
                <pre
                  style={{
                    whiteSpace: "pre-wrap",
                    fontFamily: "inherit",
                    fontSize: 16,
                    lineHeight: 1.75,
                    color: "var(--text-secondary)",
                  }}
                >
                  {lyrics.plain}
                </pre>
              </>
            )}
            {!lyricsLoading && (!lyrics || (!lyrics.plain && lyrics.synced.length === 0)) && (
              <div style={{ padding: 30, color: "var(--text-muted)" }}>
                No lyrics available for this track.
              </div>
            )}
          </div>
        )}

        {tab === "related" && (
          <div style={{ flex: 1, overflowY: "auto" }}>
            {relatedLoading && (
              <div style={{ padding: 24, color: "var(--text-muted)" }}>
                Loading related music...
              </div>
            )}
            {!relatedLoading && related.length === 0 && (
              <div style={{ padding: 24, color: "var(--text-muted)" }}>
                Play a track from YouTube Music to see related tracks and playlists.
              </div>
            )}
            {related.map((shelf) => (
              <div key={shelf.title} style={{ marginBottom: 18 }}>
                <h4 style={{ fontSize: 15, marginBottom: 10 }}>{shelf.title}</h4>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {shelf.items.slice(0, 8).map((item) => (
                    <div
                      key={item.id}
                      className="track-row"
                      style={{ gridTemplateColumns: "40px 1fr" }}
                      onClick={() =>
                        onPlayTrack({
                          videoId: item.id,
                          title: item.title,
                          artist: item.subtitle,
                          durationSecs: item.durationSecs ?? 0,
                          thumbnail: item.thumbnail,
                          isExplicit: item.isExplicit,
                          isDownloaded: false,
                        })
                      }
                    >
                      <div className="track-thumb" style={{ width: 40, height: 40 }}>
                        {item.thumbnail && <img src={item.thumbnail} alt="" />}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div className="media-title">{item.title}</div>
                        <div className="media-subtitle">{item.subtitle}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
