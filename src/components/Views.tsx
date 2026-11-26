import React, { useEffect, useRef, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  ArrowUpDown,
  Check,
  CheckCircle2,
  Clock,
  Download,
  Flame,
  FolderOpen,
  GitMerge,
  HardDrive,
  Heart,
  History,
  Library,
  ListMusic,
  Loader2,
  Pin,
  PinOff,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Share2,
  Shuffle,
  Sliders,
  Sparkles,
  Trash2,
  Upload,
  UserCheck,
  UserPlus,
  X,
} from "lucide-react";
import { api, formatTime, shelfItemToTrack } from "../api";
import { pageCache } from "../cache";
import type {
  ArtistDetail,
  DownloadItem,
  ExploreResponse,
  HomeResponse,
  LocalPlaylistSummary,
  PinnedItem,
  PlaylistDetail,
  Route,
  SearchResponse,
  Shelf,
  ShelfItem,
  Track,
} from "../types";
import { TrackRow } from "./TrackRow";

interface CommonViewProps {
  currentTrackId?: string;
  isPlaying: boolean;
  onPlayTrack: (track: Track, list?: Track[]) => void;
  onStartRadio: (track: Track) => void;
  onLike: (track: Track) => void;
  onDownload: (track: Track) => void;
  onDownloadBatch: (tracks: Track[]) => void;
  onAddToPlaylist: (track: Track) => void;
  onContextMenuTrack?: (e: React.MouseEvent, track: Track, extra?: { onMoveToTop?: () => void }) => void;
  onNavigate: (route: Route) => void;
}

const handleCardMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
  const rect = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty("--mx", `${e.clientX - rect.left}px`);
  e.currentTarget.style.setProperty("--my", `${e.clientY - rect.top}px`);
};

const ShelfRenderer: React.FC<{
  shelf: Shelf;
  props: CommonViewProps;
}> = ({ shelf, props }) => {
  const handleItemClick = (item: ShelfItem) => {
    if (item.kind === "song" || item.kind === "video") {
      const tracks = shelf.items
        .filter((i) => i.kind === "song" || i.kind === "video")
        .map(shelfItemToTrack);
      props.onPlayTrack(shelfItemToTrack(item), tracks);
    } else if (item.kind === "artist") {
      props.onNavigate({ page: "artist", browseId: item.id });
    } else {
      props.onNavigate({ page: "playlist", id: item.id, isLocal: false });
    }
  };

  return (
    <section className="shelf">
      <div className="shelf-header">
        <div>
          {shelf.strapline && <div className="shelf-strapline">{shelf.strapline}</div>}
          <h2 className="shelf-title">{shelf.title}</h2>
        </div>
      </div>

      {shelf.kind === "quick_picks" || shelf.kind === "list" ? (
        <div
          className={shelf.kind === "quick_picks" ? "quick-picks-grid" : ""}
          style={shelf.kind === "list" ? { display: "flex", flexDirection: "column", gap: 4 } : undefined}
        >
          {shelf.items.map((item, idx) => {
            if (item.kind === "song" || item.kind === "video") {
              const t = shelfItemToTrack(item);
              return (
                <TrackRow
                  key={`${item.id}-${idx}`}
                  track={t}
                  compact={shelf.kind === "quick_picks"}
                  isCurrent={props.currentTrackId === t.videoId}
                  isPlaying={props.isPlaying}
                  onPlay={(tr) =>
                    props.onPlayTrack(
                      tr,
                      shelf.items
                        .filter((i) => i.kind === "song" || i.kind === "video")
                        .map(shelfItemToTrack)
                    )
                  }
                  onLike={props.onLike}
                  onDownload={props.onDownload}
                  onAddToPlaylist={props.onAddToPlaylist}
                  onStartRadio={props.onStartRadio}
                  onOpenArtist={(aid) => props.onNavigate({ page: "artist", browseId: aid })}
                />
              );
            }
            return (
              <div
                key={`${item.id}-${idx}`}
                className="track-row"
                style={{ gridTemplateColumns: "44px 1fr auto" }}
                onClick={() => handleItemClick(item)}
              >
                <div className="track-thumb" style={{ borderRadius: item.kind === "artist" ? "50%" : 9 }}>
                  {item.thumbnail && <img src={item.thumbnail} alt="" loading="lazy" />}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="media-title">{item.title}</div>
                  <div className="media-subtitle">{item.subtitle}</div>
                </div>
                <span className="badge" style={{ textTransform: "capitalize" }}>
                  {item.kind}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="carousel-grid">
          {shelf.items.map((item, idx) => (
            <div
              key={`${item.id}-${idx}`}
              className="glass-card media-card"
              onMouseMove={handleCardMouseMove}
              onClick={() => handleItemClick(item)}
            >
              <div className={`media-thumb-wrap ${item.kind === "artist" ? "round" : ""}`}>
                {item.thumbnail && <img src={item.thumbnail} alt="" loading="lazy" />}
                <div className="card-play-fab">
                  <Play size={16} style={{ marginLeft: 2 }} />
                </div>
              </div>
              <div style={{ minWidth: 0 }}>
                <div className="media-title">{item.title}</div>
                <div className="media-subtitle">{item.subtitle}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

// ============================================================================
// Home View
// ============================================================================

export const HomeView: React.FC<
  CommonViewProps & {
    offlineMode: boolean;
    pinnedItems: PinnedItem[];
    onUnpinItem: (id: string) => void;
  }
> = React.memo((props) => {
  const [activeMood, setActiveMood] = useState<string>("");
  const [data, setData] = useState<HomeResponse | null>(() => pageCache.getHome(""));
  const [loading, setLoading] = useState(!pageCache.getHome("") && !props.offlineMode);
  const [error, setError] = useState<string | null>(null);
  const [offlineTracks, setOfflineTracks] = useState<Track[]>([]);
  const [recentTracks, setRecentTracks] = useState<Track[]>(() => pageCache.getRecent() || []);

  const load = async (mood?: string, force = false) => {
    const key = mood || "";
    const cachedHome = !force && !props.offlineMode ? pageCache.getHome(key) : null;
    const cachedRecent = !force ? pageCache.getRecent() : null;

    if (cachedRecent) {
      setRecentTracks(cachedRecent);
    } else {
      api.getRecentHistory(20).then((rec) => {
        pageCache.setRecent(rec);
        setRecentTracks(rec);
      }).catch(() => {});
    }

    if (cachedHome) {
      setData(cachedHome);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      if (props.offlineMode) {
        const dl = await api.getDownloadedTracks();
        setOfflineTracks(dl);
        setData(null);
      } else {
        const res = await api.getHome(mood);
        pageCache.setHome(key, res);
        setData(res);
      }
    } catch (e) {
      setError(String(e));
      const dl = await api.getDownloadedTracks().catch(() => []);
      setOfflineTracks(dl);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(activeMood || undefined, false);
  }, [activeMood, props.offlineMode]);

  const defaultMoods = ["Energize", "Relax", "Workout", "Focus", "Commute", "Party", "Feel Good", "Sleep"];

  return (
    <div style={{ paddingBottom: 40 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {data && data.chips.length > 0 ? (
            <div className="chips-row">
              <button
                className={`glass-pill ${activeMood === "" ? "active" : ""}`}
                onClick={() => setActiveMood("")}
              >
                All
              </button>
              {data.chips.map((c) => (
                <button
                  key={c.title}
                  className={`glass-pill ${activeMood === c.params ? "active" : ""}`}
                  onClick={() => setActiveMood(activeMood === c.params ? "" : c.params)}
                >
                  {c.title}
                </button>
              ))}
            </div>
          ) : (
            <div className="chips-row">
              {defaultMoods.map((m) => (
                <button
                  key={m}
                  className="glass-pill"
                  onClick={() => props.onNavigate({ page: "search", query: `${m} music mix`, filter: "playlists" })}
                >
                  {m}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          className="icon-btn"
          style={{ marginBottom: 16, flexShrink: 0 }}
          onClick={() => load(activeMood || undefined, true)}
          title="Refresh home feed"
        >
          <RefreshCw size={15} className={loading ? "spin" : ""} />
        </button>
      </div>

      {/* Pinned "Jump Back In" Quick-Launch Grid (max 6) */}
      {props.pinnedItems.length > 0 && (
        <section className="shelf" style={{ marginBottom: 22 }}>
          <div className="shelf-header" style={{ marginBottom: 10 }}>
            <div>
              <div className="shelf-strapline">PINNED</div>
              <h2 className="shelf-title">Quick Launch</h2>
            </div>
          </div>
          <div className="pinned-home-grid">
            {props.pinnedItems.slice(0, 6).map((item) => (
              <div
                key={`${item.kind}-${item.id}`}
                className="pinned-home-tile glass-card"
                onClick={() => {
                  if (item.kind === "artist") {
                    props.onNavigate({ page: "artist", browseId: item.id });
                  } else {
                    props.onNavigate({
                      page: "playlist",
                      id: item.id,
                      isLocal: item.isLocal,
                      smartKind: item.smartKind || undefined,
                    });
                  }
                }}
              >
                <div className={`pinned-tile-art ${item.kind === "artist" ? "round" : ""}`}>
                  {item.thumbnail ? (
                    <img src={item.thumbnail} alt="" loading="lazy" />
                  ) : (
                    <ListMusic size={18} style={{ opacity: 0.55 }} />
                  )}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="media-title" style={{ fontSize: 13.5 }}>{item.title}</div>
                  <div className="media-subtitle" style={{ fontSize: 11.5 }}>{item.subtitle}</div>
                </div>
                <button
                  className="icon-btn pinned-tile-unpin"
                  style={{ width: 24, height: 24 }}
                  title="Unpin from Home"
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onUnpinItem(item.id);
                  }}
                >
                  <PinOff size={12} />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Recently Played Shelf */}
      {recentTracks.length > 0 && (
        <section className="shelf">
          <div className="shelf-header">
            <div>
              <div className="shelf-strapline">JUMP BACK IN</div>
              <h2 className="shelf-title">Listen Again & Recent</h2>
            </div>
          </div>
          <div className="carousel-grid">
            {recentTracks.map((t) => (
              <div
                key={t.videoId}
                className="glass-card media-card"
                onMouseMove={handleCardMouseMove}
                onClick={() => props.onPlayTrack(t, recentTracks)}
              >
                <div className="media-thumb-wrap">
                  {t.thumbnail && <img src={t.thumbnail} alt="" loading="lazy" />}
                  <div className="card-play-fab">
                    <Play size={16} style={{ marginLeft: 2 }} />
                  </div>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="media-title">{t.title}</div>
                  <div className="media-subtitle">{t.artist}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {loading && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 28, color: "var(--text-secondary)" }}>
          <Loader2 size={18} className="spin" /> Loading YouTube Music Home, New Releases & Charts...
        </div>
      )}

      {error && !loading && (
        <div className="glass-panel" style={{ padding: 18, marginBottom: 20 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Could not reach YouTube Music</div>
          <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 12 }}>{error}</div>
          <button className="glass-pill" onClick={() => load(activeMood || undefined)}>
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      )}

      {!loading && data && data.shelves.map((shelf, i) => (
        <ShelfRenderer key={`${shelf.title}-${i}`} shelf={shelf} props={props} />
      ))}

      {!loading && offlineTracks.length > 0 && (!data || props.offlineMode) && (
        <section className="shelf">
          <div className="shelf-header">
            <h2 className="shelf-title">Downloaded for Offline Listening</h2>
          </div>
          {offlineTracks.map((t) => (
            <TrackRow
              key={t.videoId}
              track={t}
              isCurrent={props.currentTrackId === t.videoId}
              isPlaying={props.isPlaying}
              onPlay={(tr) => props.onPlayTrack(tr, offlineTracks)}
              onLike={props.onLike}
              onDownload={props.onDownload}
              onAddToPlaylist={props.onAddToPlaylist}
            />
          ))}
        </section>
      )}
    </div>
  );
});

// ============================================================================
// Explore View
// ============================================================================

export const ExploreView: React.FC<CommonViewProps> = React.memo((props) => {
  const [data, setData] = useState<ExploreResponse | null>(() => pageCache.getExplore());
  const [loading, setLoading] = useState(!pageCache.getExplore());
  const [error, setError] = useState<string | null>(null);

  const load = (force = false) => {
    const cached = !force ? pageCache.getExplore() : null;
    if (cached) {
      setData(cached);
      setLoading(false);
      return;
    }
    setLoading(true);
    api
      .getExplore()
      .then((res) => {
        pageCache.setExplore(res);
        setData(res);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load(false);
  }, []);

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 28, color: "var(--text-secondary)" }}>
        <Loader2 size={18} className="spin" /> Loading Charts, New Releases & Moods...
      </div>
    );
  }
  if (error) {
    return <div className="glass-panel" style={{ padding: 20 }}>Failed to load Explore: {error}</div>;
  }

  return (
    <div>
      {data && data.moods.length > 0 && (
        <section className="shelf">
          <h2 className="shelf-title" style={{ marginBottom: 12 }}>Moods & Genres</h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {data.moods.map((m) => (
              <button
                key={m.title}
                className="glass-pill"
                onClick={() => props.onNavigate({ page: "search", query: m.title, filter: "playlists" })}
              >
                {m.title}
              </button>
            ))}
          </div>
        </section>
      )}
      {data?.shelves.map((shelf, i) => (
        <ShelfRenderer key={`${shelf.title}-${i}`} shelf={shelf} props={props} />
      ))}
    </div>
  );
});

// ============================================================================
// Search View
// ============================================================================

export const SearchView: React.FC<
  CommonViewProps & { query: string; filter: string }
> = React.memo((props) => {
  const [data, setData] = useState<SearchResponse | null>(() =>
    pageCache.getSearch(props.query, props.filter)
  );
  const [loading, setLoading] = useState(!pageCache.getSearch(props.query, props.filter));
  const filters = ["all", "songs", "videos", "albums", "artists", "playlists"];

  useEffect(() => {
    const cached = pageCache.getSearch(props.query, props.filter);
    if (cached) {
      setData(cached);
      setLoading(false);
      return;
    }
    setLoading(true);
    api
      .search(props.query, props.filter)
      .then((res) => {
        pageCache.setSearch(props.query, props.filter, res);
        setData(res);
      })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [props.query, props.filter]);

  return (
    <div>
      <div className="chips-row">
        {filters.map((f) => (
          <button
            key={f}
            className={`glass-pill ${props.filter === f ? "active" : ""}`}
            style={{ textTransform: "capitalize" }}
            onClick={() =>
              props.onNavigate({ page: "search", query: props.query, filter: f })
            }
          >
            {f}
          </button>
        ))}
      </div>

      {loading && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 28, color: "var(--text-secondary)" }}>
          <Loader2 size={18} className="spin" /> Searching YouTube Music for "{props.query}"...
        </div>
      )}

      {!loading && data?.topResult && (
        <section className="shelf">
          <h2 className="shelf-title" style={{ marginBottom: 12 }}>Top Result</h2>
          <div
            className="glass-card"
            onMouseMove={handleCardMouseMove}
            style={{
              padding: 18,
              display: "flex",
              alignItems: "center",
              gap: 18,
              maxWidth: 540,
              cursor: "pointer",
            }}
            onClick={() => {
              const top = data.topResult!;
              if (top.kind === "song" || top.kind === "video") {
                props.onPlayTrack(shelfItemToTrack(top));
              } else if (top.kind === "artist") {
                props.onNavigate({ page: "artist", browseId: top.id });
              } else {
                props.onNavigate({ page: "playlist", id: top.id, isLocal: false });
              }
            }}
          >
            {data.topResult.thumbnail && (
              <img
                src={data.topResult.thumbnail}
                alt=""
                style={{
                  width: 92,
                  height: 92,
                  borderRadius: data.topResult.kind === "artist" ? "50%" : 14,
                  objectFit: "cover",
                }}
              />
            )}
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>
                {data.topResult.title}
              </div>
              <div style={{ color: "var(--text-secondary)", fontSize: 13.5, marginBottom: 10 }}>
                {data.topResult.subtitle}
              </div>
              <span className="glass-pill active" style={{ padding: "5px 14px", fontSize: 12.5 }}>
                <Play size={13} /> Open / Play
              </span>
            </div>
          </div>
        </section>
      )}

      {!loading &&
        data?.shelves.map((shelf, i) => (
          <ShelfRenderer key={`${shelf.title}-${i}`} shelf={shelf} props={props} />
        ))}
    </div>
  );
});

// ============================================================================
// Playlist & Album View
// ============================================================================

type SortKey = "playlist_order" | "title" | "artist" | "recently_added" | "length";

const SORT_OPTIONS: Array<{ key: SortKey; label: string }> = [
  { key: "playlist_order", label: "Playlist order" },
  { key: "title", label: "Title" },
  { key: "artist", label: "Artist" },
  { key: "recently_added", label: "Recently added" },
  { key: "length", label: "Length" },
];

/** Smart shuffle that interleaves artists so the same artist never repeats back-to-back. */
function smartArtistShuffle(tracks: Track[]): Track[] {
  const byArtist = new Map<string, Track[]>();
  for (const t of tracks) {
    const key = (t.artist || "unknown").toLowerCase();
    const list = byArtist.get(key) || [];
    list.push(t);
    byArtist.set(key, list);
  }
  const buckets = Array.from(byArtist.values()).map((arr) =>
    [...arr].sort(() => Math.random() - 0.5)
  );
  buckets.sort((a, b) => b.length - a.length);
  const out: Track[] = [];
  let lastArtist = "";
  while (buckets.some((b) => b.length > 0)) {
    const candidates = buckets
      .filter((b) => b.length > 0)
      .sort((a, b) => b.length - a.length);
    const chosen =
      candidates.find((b) => (b[0].artist || "").toLowerCase() !== lastArtist) ||
      candidates[0];
    const next = chosen.shift()!;
    out.push(next);
    lastArtist = (next.artist || "").toLowerCase();
  }
  return out;
}

export const PlaylistView: React.FC<
  CommonViewProps & {
    id: string;
    isLocal?: boolean;
    smartKind?: string;
    localPlaylists: LocalPlaylistSummary[];
    hasBoundEq: boolean;
    isPinned: boolean;
    onTogglePin: (item: PinnedItem) => void;
    onBindPlaylistEq: (playlistId: string) => void;
    onPlayPlaylistTracks: (playlistId: string, track: Track, list: Track[]) => void;
    onPlaylistChanged: () => void;
    onToast: (msg: string) => void;
  }
> = (props) => {
  const cacheKey = props.smartKind ? `smart_${props.smartKind}` : props.id;
  const [detail, setDetail] = useState<PlaylistDetail | null>(() =>
    props.smartKind ? null : pageCache.getPlaylist(cacheKey)
  );
  const [originalTracks, setOriginalTracks] = useState<Track[]>(
    () => (props.smartKind ? [] : pageCache.getPlaylist(cacheKey)?.tracks || [])
  );
  const [loading, setLoading] = useState(props.smartKind ? true : !pageCache.getPlaylist(cacheKey));
  const [error, setError] = useState<string | null>(null);
  const [reorderMode, setReorderMode] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("playlist_order");
  const [descending, setDescending] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const sortMenuRef = useRef<HTMLDivElement>(null);
  const filterInputRef = useRef<HTMLInputElement>(null);
  const justDraggedRef = useRef(false);
  const dragOverRef = useRef<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        filterInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) {
        setSortOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const load = async (force = false) => {
    const cached = !force && !props.smartKind ? pageCache.getPlaylist(cacheKey) : null;
    if (cached) {
      setDetail(cached);
      setOriginalTracks(cached.tracks);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = props.smartKind
        ? await api.getSmartPlaylist(props.smartKind)
        : props.id === "LM"
        ? await api.getLikedSongs()
        : props.isLocal || props.id.startsWith("local_")
        ? await api.getLocalPlaylist(props.id)
        : await api.getPlaylist(props.id);
      if (!props.smartKind) {
        pageCache.setPlaylist(cacheKey, res);
      }
      setDetail(res);
      setOriginalTracks(res.tracks);
      setSortKey("playlist_order");
      setDescending(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setReorderMode(false);
    setSortOpen(false);
    load(false);
  }, [props.id, props.isLocal, props.smartKind]);

  const computeSorted = (base: Track[], key: SortKey, desc: boolean): Track[] => {
    const arr = [...base];
    const dir = desc ? -1 : 1;
    if (key === "playlist_order") {
      return desc ? arr.reverse() : arr;
    }
    if (key === "recently_added") {
      // YouTube playlists return oldest-first or newest-first; Recently added reverses playlist order by default when Descending is checked
      return desc ? arr.reverse() : arr;
    }
    if (key === "title") {
      arr.sort((a, b) => a.title.localeCompare(b.title) * dir);
    } else if (key === "artist") {
      arr.sort((a, b) => a.artist.localeCompare(b.artist) * dir);
    } else if (key === "length") {
      arr.sort((a, b) => (a.durationSecs - b.durationSecs) * dir);
    }
    return arr;
  };

  const commitOrder = async (
    nextTracks: Track[],
    movedTrack?: Track,
    beforeTrack?: Track | null
  ) => {
    if (!detail) return;
    const updated = { ...detail, tracks: nextTracks };
    setDetail(updated);
    setOriginalTracks(nextTracks);
    pageCache.setPlaylist(detail.id, updated);
    try {
      await api.reorderPlaylistTracks(
        detail.id,
        nextTracks.map((t) => t.videoId),
        movedTrack?.setVideoId,
        beforeTrack?.setVideoId
      );
    } catch {
      // local order updated in state
    }
  };

  const moveTrack = (fromIdx: number, toIdx: number) => {
    if (!detail || fromIdx === toIdx || toIdx < 0 || toIdx >= detail.tracks.length) return;
    const next = [...detail.tracks];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    const successor = next[toIdx + 1] ?? null;
    setSortKey("playlist_order");
    setDescending(false);
    commitOrder(next, moved, successor);
  };

  const startPointerDrag = (fromIdx: number, startEvent: React.PointerEvent<HTMLDivElement>) => {
    const startY = startEvent.clientY;
    let movedEnough = false;
    dragOverRef.current = fromIdx;

    const onMove = (ev: PointerEvent) => {
      if (!movedEnough && Math.abs(ev.clientY - startY) < 6) return;
      if (!movedEnough) {
        movedEnough = true;
        setDragIdx(fromIdx);
        setDragOverIdx(fromIdx);
        document.body.style.cursor = "grabbing";
        document.body.style.userSelect = "none";
      }
      const els = document.elementsFromPoint(ev.clientX, ev.clientY);
      for (const el of els) {
        const attr = (el as HTMLElement).getAttribute?.("data-track-idx");
        if (attr !== null && attr !== undefined && attr !== "") {
          const targetIdx = Number(attr);
          if (!Number.isNaN(targetIdx) && targetIdx !== dragOverRef.current) {
            dragOverRef.current = targetIdx;
            setDragOverIdx(targetIdx);
          }
          break;
        }
      }
      // Gentle edge auto-scroll inside .main-scroll
      const main = document.querySelector(".main-scroll") as HTMLElement | null;
      if (main) {
        const rect = main.getBoundingClientRect();
        if (ev.clientY < rect.top + 60) main.scrollTop -= 12;
        else if (ev.clientY > rect.bottom - 60) main.scrollTop += 12;
      }
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (movedEnough) {
        justDraggedRef.current = true;
        window.setTimeout(() => {
          justDraggedRef.current = false;
        }, 180);
        const target = dragOverRef.current;
        if (target !== null && target !== fromIdx) {
          moveTrack(fromIdx, target);
        }
      }
      dragOverRef.current = null;
      setDragIdx(null);
      setDragOverIdx(null);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const selectSort = (nextKey: SortKey, nextDesc: boolean) => {
    setSortKey(nextKey);
    setDescending(nextDesc);
    if (!detail) return;
    const sorted = computeSorted(originalTracks, nextKey, nextDesc);
    const updated = { ...detail, tracks: sorted };
    setDetail(updated);
    pageCache.setPlaylist(detail.id, updated);
    api
      .reorderPlaylistTracks(
        detail.id,
        sorted.map((t) => t.videoId)
      )
      .catch(() => {});
  };

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 28 }}>
        <Loader2 size={18} className="spin" /> Loading playlist...
      </div>
    );
  }
  if (error || !detail) {
    return <div className="glass-panel" style={{ padding: 20 }}>Failed to load playlist: {error}</div>;
  }

  const activeSortLabel = SORT_OPTIONS.find((o) => o.key === sortKey)?.label || "Sort";
  const duplicateCount = (() => {
    const seen = new Set<string>();
    let dups = 0;
    for (const t of detail.tracks) {
      const k = `${t.title.toLowerCase().trim()}|${t.artist.toLowerCase().trim()}`;
      if (seen.has(t.videoId) || seen.has(k)) dups++;
      else {
        seen.add(t.videoId);
        seen.add(k);
      }
    }
    return dups;
  })();

  const visibleTracks = filterQuery.trim()
    ? detail.tracks.filter((t) => {
        const q = filterQuery.trim().toLowerCase();
        return (
          t.title.toLowerCase().includes(q) ||
          t.artist.toLowerCase().includes(q) ||
          (t.album || "").toLowerCase().includes(q)
        );
      })
    : detail.tracks;

  return (
    <div>
      <div
        className="glass-panel"
        style={{
          padding: 24,
          display: "flex",
          gap: 24,
          alignItems: "flex-end",
          marginBottom: 20,
        }}
      >
        {detail.thumbnail ? (
          <img
            src={detail.thumbnail}
            alt=""
            style={{
              width: 184,
              height: 184,
              borderRadius: 12,
              objectFit: "cover",
              border: "1px solid var(--border-color)",
              flexShrink: 0,
            }}
          />
        ) : (
          <div
            style={{
              width: 184,
              height: 184,
              borderRadius: 12,
              background: "var(--row-hover)",
              display: "grid",
              placeItems: "center",
              flexShrink: 0,
            }}
          >
            <ListMusic size={48} style={{ opacity: 0.45 }} />
          </div>
        )}

        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="badge" style={{ marginBottom: 8 }}>
            {detail.isAlbum ? "Album" : detail.isLocal ? "Local playlist" : "Playlist"}
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.02em", marginBottom: 6 }}>
            {detail.title}
          </h1>
          <div style={{ color: "var(--text-secondary)", fontSize: 13.5, marginBottom: 6 }}>
            {detail.subtitle} {detail.totalDurationText ? `• ${detail.totalDurationText}` : `• ${detail.tracks.length} songs`}
          </div>
          {detail.description && (
            <p style={{ color: "var(--text-muted)", fontSize: 13, maxWidth: 680, marginBottom: 12 }}>
              {detail.description}
            </p>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12, alignItems: "center" }}>
            <button
              className="glass-pill active"
              onClick={() => detail.tracks[0] && props.onPlayPlaylistTracks(detail.id, detail.tracks[0], detail.tracks)}
              disabled={detail.tracks.length === 0}
            >
              <Play size={14} /> Play all
            </button>
            <button
              className="glass-pill"
              onClick={() => {
                if (detail.tracks.length === 0) return;
                const shuffled = smartArtistShuffle(detail.tracks);
                props.onPlayPlaylistTracks(detail.id, shuffled[0], shuffled);
                props.onToast("Smart shuffle: spread artists evenly");
              }}
              disabled={detail.tracks.length === 0}
              title="Smart Shuffle (avoids repeating the same artist back-to-back)"
            >
              <Shuffle size={14} /> Smart shuffle
            </button>
            <button
              className="glass-pill"
              onClick={() => props.onDownloadBatch(detail.tracks)}
              disabled={detail.tracks.length === 0}
            >
              <Download size={14} /> Download all ({detail.tracks.length})
            </button>

            {/* Exact Floating Sort Popover Menu */}
            <div className="sort-menu-wrap" ref={sortMenuRef}>
              <button
                className={`glass-pill ${sortOpen ? "active" : ""}`}
                onClick={() => setSortOpen((o) => !o)}
                disabled={detail.tracks.length < 2}
              >
                <ArrowUpDown size={14} /> {activeSortLabel}
              </button>
              {sortOpen && (
                <div className="sort-popover">
                  {SORT_OPTIONS.map((opt) => (
                    <button
                      key={opt.key}
                      className={`sort-popover-item ${sortKey === opt.key ? "selected" : ""}`}
                      onClick={() => selectSort(opt.key, descending)}
                    >
                      <span>{opt.label}</span>
                      {sortKey === opt.key && <Check size={16} />}
                    </button>
                  ))}
                  <div className="sort-popover-divider" />
                  <button
                    className={`sort-popover-item ${descending ? "selected" : ""}`}
                    onClick={() => selectSort(sortKey, !descending)}
                  >
                    <span>Descending</span>
                    {descending && <Check size={16} />}
                  </button>
                </div>
              )}
            </div>

            <button
              className={`glass-pill ${reorderMode ? "active" : ""}`}
              onClick={() => setReorderMode((r) => !r)}
              disabled={detail.tracks.length < 2}
            >
              {reorderMode ? "Done reordering" : "Drag order"}
            </button>

            <button
              className="glass-pill"
              onClick={async () => {
                try {
                  const chosen = await save({
                    defaultPath: `${detail.title.replace(/[\\/:*?"<>|]/g, "_")}.m3u8`,
                    filters: [
                      { name: "M3U8 Playlist", extensions: ["m3u8", "m3u"] },
                      { name: "JSON Backup", extensions: ["json"] },
                    ],
                  });
                  if (!chosen) return;
                  const fmt = chosen.toLowerCase().endsWith(".json") ? "json" : "m3u8";
                  const saved = await api.exportPlaylist(detail, fmt, chosen);
                  props.onToast(`Exported playlist to ${saved}`);
                } catch (e) {
                  props.onToast(`Export failed: ${e}`);
                }
              }}
              disabled={detail.tracks.length === 0}
              title="Export playlist to M3U8 or JSON"
            >
              <Share2 size={14} /> Export
            </button>

            <button
              className={`glass-pill ${props.isPinned ? "active" : ""}`}
              onClick={() =>
                props.onTogglePin({
                  kind: detail.isAlbum ? "album" : props.smartKind ? "smart" : "playlist",
                  id: detail.id,
                  title: detail.title,
                  subtitle: detail.subtitle || `${detail.tracks.length} songs`,
                  thumbnail: detail.thumbnail,
                  isLocal: detail.isLocal,
                  smartKind: props.smartKind || null,
                })
              }
              title={props.isPinned ? "Unpin from Home" : "Pin to Home Quick Launch"}
            >
              {props.isPinned ? <PinOff size={14} /> : <Pin size={14} />}
              {props.isPinned ? "Pinned" : "Pin"}
            </button>

            <button
              className={`glass-pill ${props.hasBoundEq ? "active" : ""}`}
              onClick={() => props.onBindPlaylistEq(detail.id)}
              title="Bind or unbind your current EQ profile to auto-activate for this playlist"
            >
              <Sliders size={14} /> {props.hasBoundEq ? "EQ bound" : "Bind EQ"}
            </button>

            {duplicateCount > 0 && (
              <button
                className="glass-pill"
                onClick={() => {
                  const seen = new Set<string>();
                  const deduped: Track[] = [];
                  for (const t of detail.tracks) {
                    const k = `${t.title.toLowerCase().trim()}|${t.artist.toLowerCase().trim()}`;
                    if (seen.has(t.videoId) || seen.has(k)) continue;
                    seen.add(t.videoId);
                    seen.add(k);
                    deduped.push(t);
                  }
                  commitOrder(deduped);
                  props.onToast(`Removed ${duplicateCount} duplicate track${duplicateCount === 1 ? "" : "s"}`);
                }}
              >
                <Sparkles size={14} /> Remove {duplicateCount} dup{duplicateCount === 1 ? "" : "s"}
              </button>
            )}

            {props.localPlaylists.length > 0 && detail.tracks.length > 0 && (
              <div className="sort-menu-wrap">
                <button
                  className={`glass-pill ${mergeOpen ? "active" : ""}`}
                  onClick={() => setMergeOpen((o) => !o)}
                  title="Merge these tracks into a local playlist"
                >
                  <GitMerge size={14} /> Merge
                </button>
                {mergeOpen && (
                  <div className="sort-popover">
                    <div className="settings-section-title" style={{ padding: "4px 10px" }}>
                      Merge into local playlist
                    </div>
                    {props.localPlaylists
                      .filter((pl) => pl.id !== detail.id)
                      .map((pl) => (
                        <button
                          key={pl.id}
                          className="sort-popover-item"
                          onClick={async () => {
                            const added = await api.mergeTracksIntoLocalPlaylist(pl.id, detail.tracks);
                            setMergeOpen(false);
                            props.onPlaylistChanged();
                            props.onToast(`Merged ${added} tracks into "${pl.title}"`);
                          }}
                        >
                          <span>{pl.title}</span>
                        </button>
                      ))}
                  </div>
                )}
              </div>
            )}

            <button
              className="icon-btn"
              onClick={() => {
                pageCache.invalidatePlaylist(detail.id);
                load(true);
              }}
              title="Refresh playlist"
            >
              <RefreshCw size={15} />
            </button>

            {detail.isLocal && detail.id !== "LM" && !props.smartKind && (
              <button
                className="glass-pill"
                onClick={async () => {
                  await api.deleteLocalPlaylist(detail.id);
                  pageCache.invalidatePlaylist(detail.id);
                  props.onPlaylistChanged();
                  props.onNavigate({ page: "library" });
                }}
              >
                <Trash2 size={14} /> Delete
              </button>
            )}
          </div>
        </div>
      </div>

      {reorderMode && (
        <div
          className="glass-panel"
          style={{
            padding: "10px 14px",
            marginBottom: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 10,
          }}
        >
          <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            Drag any song using the handle or click the arrows to reorder. Order is saved automatically.
          </span>
          <button
            className="glass-pill"
            onClick={async () => {
              await api.resetPlaylistOrder(detail.id);
              pageCache.invalidatePlaylist(detail.id);
              load(true);
            }}
          >
            <RotateCcw size={13} /> Reset to default order
          </button>
        </div>
      )}

      {/* Live Playlist Search / Filter Bar (Ctrl+F) */}
      {detail.tracks.length > 4 && (
        <div style={{ position: "relative", marginBottom: 12, maxWidth: 360 }}>
          <Search size={14} style={{ position: "absolute", left: 11, top: 10, opacity: 0.55 }} />
          <input
            ref={filterInputRef}
            className="glass-input"
            style={{ width: "100%", paddingLeft: 32, paddingRight: 30, fontSize: 13 }}
            placeholder={`Filter ${detail.tracks.length} songs (Ctrl+F)...`}
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
          />
          {filterQuery && (
            <button
              className="icon-btn"
              style={{ position: "absolute", right: 4, top: 4, width: 24, height: 24 }}
              onClick={() => setFilterQuery("")}
            >
              <X size={13} />
            </button>
          )}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {visibleTracks.map((t, i) => {
          const origIdx = filterQuery.trim()
            ? detail.tracks.findIndex((x) => x.videoId === t.videoId)
            : i;
          const canMoveTop = origIdx > 0;
          const handleMoveToTop = () => {
            if (origIdx <= 0) return;
            moveTrack(origIdx, 0);
            props.onToast(`Moved "${t.title}" to #1`);
          };
          return (
            <TrackRow
              key={`${t.videoId}-${i}`}
              track={t}
              index={i}
              reorderMode={reorderMode && !filterQuery}
              canMoveUp={canMoveTop}
              canMoveDown={i < detail.tracks.length - 1}
              isDragging={dragIdx === i}
              isDragOver={dragOverIdx === i && dragIdx !== i}
              isCurrent={props.currentTrackId === t.videoId}
              isPlaying={props.isPlaying}
              onPlay={(tr) => {
                if (justDraggedRef.current) return;
                props.onPlayPlaylistTracks(detail.id, tr, detail.tracks);
              }}
              onLike={props.onLike}
              onDownload={props.onDownload}
              onAddToPlaylist={props.onAddToPlaylist}
              onStartRadio={props.onStartRadio}
              onContextMenuTrack={
                props.onContextMenuTrack
                  ? (e, tr) =>
                      props.onContextMenuTrack?.(e, tr, {
                        onMoveToTop: canMoveTop ? handleMoveToTop : undefined,
                      })
                  : undefined
              }
              onOpenArtist={(aid) => props.onNavigate({ page: "artist", browseId: aid })}
              onMoveToTop={handleMoveToTop}
              onMoveUp={() => moveTrack(i, i - 1)}
              onMoveDown={() => moveTrack(i, i + 1)}
              onPointerDragStart={
                reorderMode && !filterQuery ? (e) => startPointerDrag(i, e) : undefined
              }
              onRemove={
                detail.isLocal && detail.id !== "LM"
                  ? async (tr) => {
                      await api.removeFromLocalPlaylist(detail.id, tr.videoId);
                      props.onPlaylistChanged();
                      load();
                    }
                  : undefined
              }
            />
          );
        })}
      </div>
    </div>
  );
};

// ============================================================================
// Artist View
// ============================================================================

export const ArtistView: React.FC<
  CommonViewProps & {
    browseId: string;
    isPinned: boolean;
    onTogglePin: (item: PinnedItem) => void;
  }
> = React.memo((props) => {
  const [artist, setArtist] = useState<ArtistDetail | null>(() => pageCache.getArtist(props.browseId));
  const [loading, setLoading] = useState(!pageCache.getArtist(props.browseId));
  const [subscribed, setSubscribed] = useState(() => pageCache.getArtist(props.browseId)?.subscribed || false);

  useEffect(() => {
    const cached = pageCache.getArtist(props.browseId);
    if (cached) {
      setArtist(cached);
      setSubscribed(cached.subscribed);
      setLoading(false);
      return;
    }
    setLoading(true);
    api
      .getArtist(props.browseId)
      .then((res) => {
        pageCache.setArtist(props.browseId, res);
        setArtist(res);
        setSubscribed(res.subscribed);
      })
      .finally(() => setLoading(false));
  }, [props.browseId]);

  if (loading || !artist) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 28 }}>
        <Loader2 size={18} className="spin" /> Loading artist...
      </div>
    );
  }

  return (
    <div>
      <div
        className="glass-panel"
        style={{
          padding: 26,
          marginBottom: 26,
          display: "flex",
          gap: 24,
          alignItems: "center",
        }}
      >
        {artist.thumbnail && (
          <img
            src={artist.thumbnail}
            alt=""
            style={{
              width: 154,
              height: 154,
              borderRadius: "50%",
              objectFit: "cover",
              border: "2px solid rgba(255,255,255,0.28)",
              boxShadow: "0 16px 40px rgba(0,0,0,0.45)",
            }}
          />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontSize: 36, fontWeight: 800, letterSpacing: "-0.03em", marginBottom: 6 }}>
            {artist.name}
          </h1>
          {artist.subscribers && (
            <div style={{ color: "var(--text-secondary)", fontSize: 13.5, marginBottom: 8 }}>
              {artist.subscribers}
            </div>
          )}
          {artist.description && (
            <p
              style={{
                color: "var(--text-muted)",
                fontSize: 13,
                maxWidth: 700,
                marginBottom: 14,
                display: "-webkit-box",
                WebkitLineClamp: 3,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {artist.description}
            </p>
          )}
          <div style={{ display: "flex", gap: 10 }}>
            {artist.topSongs.length > 0 && (
              <button
                className="glass-pill active"
                onClick={() => props.onPlayTrack(artist.topSongs[0], artist.topSongs)}
              >
                <Play size={15} /> Play Top Songs
              </button>
            )}
            {artist.channelId && (
              <button
                className={`glass-pill ${subscribed ? "active" : ""}`}
                onClick={async () => {
                  const next = !subscribed;
                  setSubscribed(next);
                  try {
                    await api.subscribeArtist(artist.channelId!, next);
                  } catch {
                    setSubscribed(!next);
                  }
                }}
              >
                {subscribed ? <UserCheck size={15} /> : <UserPlus size={15} />}
                {subscribed ? "Subscribed" : "Subscribe"}
              </button>
            )}
            <button
              className={`glass-pill ${props.isPinned ? "active" : ""}`}
              onClick={() =>
                props.onTogglePin({
                  kind: "artist",
                  id: artist.browseId,
                  title: artist.name,
                  subtitle: artist.subscribers || "Artist",
                  thumbnail: artist.thumbnail,
                })
              }
              title={props.isPinned ? "Unpin from Home" : "Pin artist to Home Quick Launch"}
            >
              {props.isPinned ? <PinOff size={14} /> : <Pin size={14} />}
              {props.isPinned ? "Pinned" : "Pin"}
            </button>
          </div>
        </div>
      </div>

      {artist.topSongs.length > 0 && (
        <section className="shelf">
          <h2 className="shelf-title" style={{ marginBottom: 12 }}>Top Songs</h2>
          {artist.topSongs.map((t) => (
            <TrackRow
              key={t.videoId}
              track={t}
              isCurrent={props.currentTrackId === t.videoId}
              isPlaying={props.isPlaying}
              onPlay={(tr) => props.onPlayTrack(tr, artist.topSongs)}
              onLike={props.onLike}
              onDownload={props.onDownload}
              onAddToPlaylist={props.onAddToPlaylist}
              onStartRadio={props.onStartRadio}
              onContextMenuTrack={props.onContextMenuTrack}
            />
          ))}
        </section>
      )}

      {artist.shelves.map((shelf, i) => (
        <ShelfRenderer key={`${shelf.title}-${i}`} shelf={shelf} props={props} />
      ))}
    </div>
  );
});

// ============================================================================
// Library View
// ============================================================================

export const LibraryView: React.FC<
  CommonViewProps & {
    initialTab?: "playlists" | "liked" | "downloads" | "local" | "history";
    remotePlaylists: ShelfItem[];
    localPlaylists: LocalPlaylistSummary[];
    localMusicFolders: string[];
    onOpenCreatePlaylist: () => void;
    onRefreshLibraries: () => void;
    onToast: (msg: string) => void;
  }
> = (props) => {
  const [tab, setTab] = useState<"playlists" | "liked" | "downloads" | "local" | "history">(
    props.initialTab || "playlists"
  );
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanningLocal, setScanningLocal] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);

  const loadTabTracks = (activeTab: typeof tab) => {
    if (activeTab === "playlists") return;
    setLoading(true);
    const loader =
      activeTab === "liked"
        ? api.getLikedSongs().then((p) => p.tracks)
        : activeTab === "downloads"
        ? api.getDownloadedTracks()
        : activeTab === "local"
        ? api.getLocalLibraryTracks()
        : api.getRecentHistory(80);
    loader
      .then(setTracks)
      .catch(() => setTracks([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadTabTracks(tab);
  }, [tab]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18, flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className={`glass-pill ${tab === "playlists" ? "active" : ""}`} onClick={() => setTab("playlists")}>
            <Library size={14} /> Playlists ({props.localPlaylists.length + props.remotePlaylists.length + 1})
          </button>
          <button className={`glass-pill ${tab === "liked" ? "active" : ""}`} onClick={() => setTab("liked")}>
            <Heart size={14} /> Liked Songs
          </button>
          <button className={`glass-pill ${tab === "downloads" ? "active" : ""}`} onClick={() => setTab("downloads")}>
            <Download size={14} /> Downloaded
          </button>
          <button className={`glass-pill ${tab === "local" ? "active" : ""}`} onClick={() => setTab("local")}>
            <HardDrive size={14} /> Local Files
          </button>
          <button className={`glass-pill ${tab === "history" ? "active" : ""}`} onClick={() => setTab("history")}>
            <Clock size={14} /> History
          </button>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="glass-pill" onClick={() => setImportOpen(true)}>
            <Upload size={14} /> Import
          </button>
          <button className="glass-pill" onClick={props.onRefreshLibraries}>
            <RefreshCw size={14} /> Sync
          </button>
          <button className="glass-pill active" onClick={props.onOpenCreatePlaylist}>
            <Plus size={15} /> New Playlist
          </button>
        </div>
      </div>

      {tab === "playlists" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {/* Smart Auto-Playlists */}
          <section>
            <div className="settings-section-title" style={{ marginBottom: 10 }}>
              Smart auto-playlists
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
              {[
                { kind: "most_played", title: "Most Played", sub: "Your top replayed songs", icon: <Flame size={18} /> },
                { kind: "recently_downloaded", title: "Recently Downloaded", sub: "Offline & imported files", icon: <Download size={18} /> },
                { kind: "forgotten_favorites", title: "Forgotten Favorites", sub: "Favorites from earlier sessions", icon: <History size={18} /> },
              ].map((sp) => (
                <button
                  key={sp.kind}
                  className="glass-card"
                  style={{
                    padding: "14px 16px",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                  onClick={() =>
                    props.onNavigate({
                      page: "playlist",
                      id: `smart_${sp.kind}`,
                      isLocal: true,
                      smartKind: sp.kind,
                    })
                  }
                >
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 10,
                      background: "var(--accent-soft)",
                      color: "var(--accent)",
                      display: "grid",
                      placeItems: "center",
                      flexShrink: 0,
                    }}
                  >
                    {sp.icon}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div className="media-title" style={{ fontSize: 14 }}>{sp.title}</div>
                    <div className="media-subtitle" style={{ fontSize: 12 }}>{sp.sub}</div>
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section>
            <div className="settings-section-title" style={{ marginBottom: 10 }}>
              Your playlists
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(185px, 1fr))",
                gap: 16,
              }}
            >
              <div
                className="glass-card media-card"
                onMouseMove={handleCardMouseMove}
                onClick={() => props.onNavigate({ page: "playlist", id: "LM", isLocal: false })}
              >
                <div
                  className="media-thumb-wrap"
                  style={{
                    display: "grid",
                    placeItems: "center",
                    background: "linear-gradient(135deg, var(--accent), #5b2be0)",
                  }}
                >
                  <Heart size={48} color="#fff" fill="#fff" />
                </div>
                <div className="media-title">Liked Music</div>
                <div className="media-subtitle">Auto Playlist</div>
              </div>

              {props.localPlaylists.map((pl) => (
                <div
                  key={pl.id}
                  className="glass-card media-card"
                  onMouseMove={handleCardMouseMove}
                  onClick={() => props.onNavigate({ page: "playlist", id: pl.id, isLocal: true })}
                >
                  <div className="media-thumb-wrap">
                    {pl.thumbnail ? (
                      <img src={pl.thumbnail} alt="" />
                    ) : (
                      <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center" }}>
                        <ListMusic size={42} style={{ opacity: 0.45 }} />
                      </div>
                    )}
                  </div>
                  <div className="media-title">{pl.title}</div>
                  <div className="media-subtitle">Local • {pl.trackCount} songs</div>
                </div>
              ))}

              {props.remotePlaylists.map((pl) => (
                <div
                  key={pl.id}
                  className="glass-card media-card"
                  onMouseMove={handleCardMouseMove}
                  onClick={() => props.onNavigate({ page: "playlist", id: pl.id, isLocal: false })}
                >
                  <div className="media-thumb-wrap">
                    {pl.thumbnail && <img src={pl.thumbnail} alt="" loading="lazy" />}
                  </div>
                  <div className="media-title">{pl.title}</div>
                  <div className="media-subtitle">{pl.subtitle || "YouTube Music"}</div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {tab === "local" && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
          <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            {props.localMusicFolders.length > 0
              ? `Watching ${props.localMusicFolders.length} folder(s) • ${tracks.length} local audio files`
              : "No local music folders configured yet. Add a folder in Settings → Downloads & cache."}
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="glass-pill"
              onClick={() => props.onNavigate({ page: "settings", tab: "downloads" })}
            >
              <FolderOpen size={14} /> Manage folders
            </button>
            <button
              className="glass-pill active"
              disabled={scanningLocal || props.localMusicFolders.length === 0}
              onClick={async () => {
                setScanningLocal(true);
                try {
                  const count = await api.scanLocalMusicFolders(props.localMusicFolders);
                  props.onToast(`Indexed ${count} local audio files`);
                  loadTabTracks("local");
                } catch (e) {
                  props.onToast(`Scan failed: ${e}`);
                } finally {
                  setScanningLocal(false);
                }
              }}
            >
              {scanningLocal ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
              Rescan
            </button>
          </div>
        </div>
      )}

      {/* Import Playlist Modal */}
      {importOpen && (
        <div className="modal-backdrop" onClick={() => setImportOpen(false)}>
          <div
            className="glass-panel"
            style={{ width: 440, padding: 20, display: "flex", flexDirection: "column", gap: 12 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ fontSize: 16 }}>Import playlist</h3>
              <button className="icon-btn" onClick={() => setImportOpen(false)}>
                <X size={16} />
              </button>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>
              Import a YouTube / YouTube Music playlist URL or load an exported `.m3u8` / `.json` file.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                className="glass-input"
                style={{ flex: 1 }}
                placeholder="https://music.youtube.com/playlist?list=..."
                value={importUrl}
                onChange={(e) => setImportUrl(e.target.value)}
              />
              <button
                className="glass-pill active"
                disabled={importing || !importUrl.trim()}
                onClick={async () => {
                  setImporting(true);
                  try {
                    const [id, count] = await api.importPlaylistUrl(importUrl.trim());
                    setImportUrl("");
                    setImportOpen(false);
                    props.onRefreshLibraries();
                    props.onToast(`Imported ${count} tracks`);
                    props.onNavigate({ page: "playlist", id, isLocal: true });
                  } catch (e) {
                    props.onToast(`Import failed: ${e}`);
                  } finally {
                    setImporting(false);
                  }
                }}
              >
                {importing ? <Loader2 size={14} className="spin" /> : "Import URL"}
              </button>
            </div>
            <div className="settings-divider" />
            <button
              className="glass-pill"
              disabled={importing}
              onClick={async () => {
                try {
                  const chosen = await open({
                    multiple: false,
                    filters: [{ name: "Playlists", extensions: ["m3u8", "m3u", "json"] }],
                  });
                  if (typeof chosen !== "string" || !chosen) return;
                  setImporting(true);
                  const [id, count] = await api.importPlaylistFile(chosen);
                  setImportOpen(false);
                  props.onRefreshLibraries();
                  props.onToast(`Imported ${count} tracks from file`);
                  props.onNavigate({ page: "playlist", id, isLocal: true });
                } catch (e) {
                  props.onToast(`File import failed: ${e}`);
                } finally {
                  setImporting(false);
                }
              }}
            >
              <FolderOpen size={14} /> Choose .m3u8 or .json file
            </button>
          </div>
        </div>
      )}

      {tab !== "playlists" && (
        <div>
          {loading ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 24 }}>
              <Loader2 size={18} className="spin" /> Loading tracks...
            </div>
          ) : tracks.length === 0 ? (
            <div className="glass-panel" style={{ padding: 28, textAlign: "center", color: "var(--text-muted)" }}>
              No songs here yet.
            </div>
          ) : (
            tracks.map((t) => (
              <TrackRow
                key={t.videoId}
                track={t}
                isCurrent={props.currentTrackId === t.videoId}
                isPlaying={props.isPlaying}
                onPlay={(tr) => props.onPlayTrack(tr, tracks)}
                onLike={props.onLike}
                onDownload={props.onDownload}
                onAddToPlaylist={props.onAddToPlaylist}
                onStartRadio={props.onStartRadio}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
};

// ============================================================================
// Downloads Manager View
// ============================================================================

export const DownloadsView: React.FC<{
  downloads: DownloadItem[];
  onRefresh: () => void;
  onSyncSmart: () => void;
  onPlayTrack: (track: Track) => void;
}> = ({ downloads, onRefresh, onSyncSmart, onPlayTrack }) => {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800 }}>Downloads & Offline Library</h1>
          <p style={{ color: "var(--text-secondary)", fontSize: 13 }}>
            Powered by yt-dlp + FFmpeg + Lofty lossless metadata tagging
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="glass-pill active" onClick={onSyncSmart}>
            <RefreshCw size={14} /> Sync Smart Downloads
          </button>
          <button className="glass-pill" onClick={onRefresh}>
            Refresh
          </button>
        </div>
      </div>

      {downloads.length === 0 ? (
        <div className="glass-panel" style={{ padding: 36, textAlign: "center", color: "var(--text-muted)" }}>
          No downloads yet. Click the download icon on any track, album, or playlist to save it offline.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {downloads.map((d) => (
            <div
              key={d.id}
              className="glass-panel"
              style={{
                padding: 14,
                display: "grid",
                gridTemplateColumns: "48px 1fr auto",
                alignItems: "center",
                gap: 14,
              }}
            >
              <div className="track-thumb" style={{ width: 48, height: 48 }}>
                {d.thumbnail && <img src={d.thumbnail} alt="" />}
              </div>

              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                  <span className="media-title">{d.title}</span>
                  <span className="badge" style={{ textTransform: "uppercase" }}>
                    {d.format}
                  </span>
                  {d.status === "completed" && (
                    <CheckCircle2 size={14} style={{ color: "#4ade80" }} />
                  )}
                </div>
                <div className="media-subtitle" style={{ marginBottom: 6 }}>
                  {d.artist}
                  {d.durationSecs > 0 ? ` • ${formatTime(d.durationSecs * 1000)}` : ""}
                  {d.speed ? ` • ${d.speed}` : ""}
                  {d.eta ? ` • ETA ${d.eta}` : ""}
                </div>
                {d.status !== "completed" && (
                  <div className="seek-track" style={{ height: 5 }}>
                    <div className="seek-fill" style={{ width: `${d.progress}%` }} />
                  </div>
                )}
                {d.error && (
                  <div style={{ fontSize: 11.5, color: "#ff7a8a", marginTop: 4 }}>{d.error}</div>
                )}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {d.status === "completed" && d.filePath && (
                  <button
                    className="glass-pill active"
                    style={{ padding: "5px 12px", fontSize: 12 }}
                    onClick={() =>
                      onPlayTrack({
                        videoId: d.videoId,
                        title: d.title,
                        artist: d.artist,
                        album: d.album,
                        durationSecs: d.durationSecs,
                        thumbnail: d.thumbnail,
                        isExplicit: false,
                        isDownloaded: true,
                        localPath: d.filePath,
                        codec: d.format.toUpperCase(),
                      })
                    }
                  >
                    <Play size={13} /> Play
                  </button>
                )}
                {(d.status === "downloading" || d.status === "queued") && (
                  <button
                    className="icon-btn"
                    onClick={async () => {
                      await api.cancelDownload(d.id);
                      onRefresh();
                    }}
                    title="Cancel"
                  >
                    <X size={16} />
                  </button>
                )}
                <button
                  className="icon-btn"
                  onClick={async () => {
                    await api.removeDownload(d.id, d.status === "completed");
                    onRefresh();
                  }}
                  title="Remove download & file"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
