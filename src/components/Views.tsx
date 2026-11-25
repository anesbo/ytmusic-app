import React, { useEffect, useState } from "react";
import {
  ArrowUpDown,
  CheckCircle2,
  Clock,
  Download,
  Heart,
  Library,
  ListMusic,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Shuffle,
  Trash2,
  UserCheck,
  UserPlus,
  X,
} from "lucide-react";
import { api, formatTime, shelfItemToTrack } from "../api";
import type {
  ArtistDetail,
  DownloadItem,
  ExploreResponse,
  HomeResponse,
  LocalPlaylistSummary,
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

export const HomeView: React.FC<CommonViewProps & { offlineMode: boolean }> = React.memo((props) => {
  const [data, setData] = useState<HomeResponse | null>(null);
  const [activeMood, setActiveMood] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offlineTracks, setOfflineTracks] = useState<Track[]>([]);
  const [recentTracks, setRecentTracks] = useState<Track[]>([]);

  const load = async (mood?: string) => {
    setLoading(true);
    setError(null);
    try {
      const rec = await api.getRecentHistory(20).catch(() => []);
      setRecentTracks(rec);
      if (props.offlineMode) {
        const dl = await api.getDownloadedTracks();
        setOfflineTracks(dl);
        setData(null);
      } else {
        const res = await api.getHome(mood);
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
    load(activeMood || undefined);
  }, [activeMood, props.offlineMode]);

  const defaultMoods = ["Energize", "Relax", "Workout", "Focus", "Commute", "Party", "Feel Good", "Sleep"];

  return (
    <div style={{ paddingBottom: 40 }}>
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

export const ExploreView: React.FC<CommonViewProps> = (props) => {
  const [data, setData] = useState<ExploreResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api
      .getExplore()
      .then(setData)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
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
};

// ============================================================================
// Search View
// ============================================================================

export const SearchView: React.FC<
  CommonViewProps & { query: string; filter: string }
> = (props) => {
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const filters = ["all", "songs", "videos", "albums", "artists", "playlists"];

  useEffect(() => {
    setLoading(true);
    api
      .search(props.query, props.filter)
      .then(setData)
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
};

// ============================================================================
// Playlist & Album View
// ============================================================================

export const PlaylistView: React.FC<
  CommonViewProps & { id: string; isLocal?: boolean; onPlaylistChanged: () => void }
> = (props) => {
  const [detail, setDetail] = useState<PlaylistDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reorderMode, setReorderMode] = useState(false);
  const [sortBy, setSortBy] = useState<string>("custom");
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res =
        props.id === "LM"
          ? await api.getLikedSongs()
          : props.isLocal || props.id.startsWith("local_")
          ? await api.getLocalPlaylist(props.id)
          : await api.getPlaylist(props.id);
      setDetail(res);
      setSortBy("custom");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setReorderMode(false);
    load();
  }, [props.id, props.isLocal]);

  const commitOrder = async (
    nextTracks: Track[],
    movedTrack?: Track,
    beforeTrack?: Track | null
  ) => {
    if (!detail) return;
    setDetail({ ...detail, tracks: nextTracks });
    try {
      await api.reorderPlaylistTracks(
        detail.id,
        nextTracks.map((t) => t.videoId),
        movedTrack?.setVideoId,
        beforeTrack?.setVideoId
      );
    } catch {
      // local order still updated in state
    }
  };

  const moveTrack = (fromIdx: number, toIdx: number) => {
    if (!detail || fromIdx === toIdx || toIdx < 0 || toIdx >= detail.tracks.length) return;
    const next = [...detail.tracks];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    const successor = next[toIdx + 1] ?? null;
    setSortBy("custom");
    commitOrder(next, moved, successor);
  };

  const applySort = (mode: string) => {
    setSortBy(mode);
    if (!detail || mode === "custom") return;
    const sorted = [...detail.tracks];
    if (mode === "title") {
      sorted.sort((a, b) => a.title.localeCompare(b.title));
    } else if (mode === "artist") {
      sorted.sort((a, b) => a.artist.localeCompare(b.artist));
    } else if (mode === "dur_asc") {
      sorted.sort((a, b) => a.durationSecs - b.durationSecs);
    } else if (mode === "dur_desc") {
      sorted.sort((a, b) => b.durationSecs - a.durationSecs);
    }
    commitOrder(sorted);
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
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
            <button
              className="glass-pill active"
              onClick={() => detail.tracks[0] && props.onPlayTrack(detail.tracks[0], detail.tracks)}
              disabled={detail.tracks.length === 0}
            >
              <Play size={14} /> Play all
            </button>
            <button
              className="glass-pill"
              onClick={() => {
                if (detail.tracks.length === 0) return;
                const shuffled = [...detail.tracks].sort(() => Math.random() - 0.5);
                props.onPlayTrack(shuffled[0], shuffled);
              }}
              disabled={detail.tracks.length === 0}
            >
              <Shuffle size={14} /> Shuffle
            </button>
            <button
              className="glass-pill"
              onClick={() => props.onDownloadBatch(detail.tracks)}
              disabled={detail.tracks.length === 0}
            >
              <Download size={14} /> Download all ({detail.tracks.length})
            </button>
            <button
              className={`glass-pill ${reorderMode ? "active" : ""}`}
              onClick={() => setReorderMode((r) => !r)}
              disabled={detail.tracks.length < 2}
            >
              <ArrowUpDown size={14} /> {reorderMode ? "Done editing order" : "Edit order"}
            </button>
            {detail.isLocal && detail.id !== "LM" && (
              <button
                className="glass-pill"
                onClick={async () => {
                  await api.deleteLocalPlaylist(detail.id);
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

      {/* Playlist Order Toolbar */}
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
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <select
              className="glass-select"
              value={sortBy}
              onChange={(e) => applySort(e.target.value)}
            >
              <option value="custom">Sort: Custom order</option>
              <option value="title">Sort: Title (A–Z)</option>
              <option value="artist">Sort: Artist (A–Z)</option>
              <option value="dur_asc">Sort: Shortest first</option>
              <option value="dur_desc">Sort: Longest first</option>
            </select>
            <button
              className="glass-pill"
              onClick={async () => {
                await api.resetPlaylistOrder(detail.id);
                load();
              }}
            >
              <RotateCcw size={13} /> Reset order
            </button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {detail.tracks.map((t, i) => (
          <TrackRow
            key={`${t.videoId}-${i}`}
            track={t}
            index={i}
            reorderMode={reorderMode}
            canMoveUp={i > 0}
            canMoveDown={i < detail.tracks.length - 1}
            isDragging={dragIdx === i}
            isDragOver={dragOverIdx === i && dragIdx !== i}
            isCurrent={props.currentTrackId === t.videoId}
            isPlaying={props.isPlaying}
            onPlay={(tr) => props.onPlayTrack(tr, detail.tracks)}
            onLike={props.onLike}
            onDownload={props.onDownload}
            onAddToPlaylist={props.onAddToPlaylist}
            onStartRadio={props.onStartRadio}
            onOpenArtist={(aid) => props.onNavigate({ page: "artist", browseId: aid })}
            onMoveUp={() => moveTrack(i, i - 1)}
            onMoveDown={() => moveTrack(i, i + 1)}
            onDragStart={() => setDragIdx(i)}
            onDragOver={(e) => {
              e.preventDefault();
              if (dragOverIdx !== i) setDragOverIdx(i);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIdx !== null && dragIdx !== i) {
                moveTrack(dragIdx, i);
              }
              setDragIdx(null);
              setDragOverIdx(null);
            }}
            onDragEnd={() => {
              setDragIdx(null);
              setDragOverIdx(null);
            }}
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
        ))}
      </div>
    </div>
  );
};

// ============================================================================
// Artist View
// ============================================================================

export const ArtistView: React.FC<CommonViewProps & { browseId: string }> = (props) => {
  const [artist, setArtist] = useState<ArtistDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [subscribed, setSubscribed] = useState(false);

  useEffect(() => {
    setLoading(true);
    api
      .getArtist(props.browseId)
      .then((res) => {
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
            />
          ))}
        </section>
      )}

      {artist.shelves.map((shelf, i) => (
        <ShelfRenderer key={`${shelf.title}-${i}`} shelf={shelf} props={props} />
      ))}
    </div>
  );
};

// ============================================================================
// Library View
// ============================================================================

export const LibraryView: React.FC<
  CommonViewProps & {
    initialTab?: "playlists" | "liked" | "downloads" | "history";
    remotePlaylists: ShelfItem[];
    localPlaylists: LocalPlaylistSummary[];
    onOpenCreatePlaylist: () => void;
    onRefreshLibraries: () => void;
  }
> = (props) => {
  const [tab, setTab] = useState<"playlists" | "liked" | "downloads" | "history">(
    props.initialTab || "playlists"
  );
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (tab === "playlists") return;
    setLoading(true);
    const loader =
      tab === "liked"
        ? api.getLikedSongs().then((p) => p.tracks)
        : tab === "downloads"
        ? api.getDownloadedTracks()
        : api.getRecentHistory(80);
    loader
      .then(setTracks)
      .catch(() => setTracks([]))
      .finally(() => setLoading(false));
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
          <button className={`glass-pill ${tab === "history" ? "active" : ""}`} onClick={() => setTab("history")}>
            <Clock size={14} /> History
          </button>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button className="glass-pill" onClick={props.onRefreshLibraries}>
            <RefreshCw size={14} /> Sync Playlists
          </button>
          <button className="glass-pill active" onClick={props.onOpenCreatePlaylist}>
            <Plus size={15} /> New Playlist
          </button>
        </div>
      </div>

      {tab === "playlists" && (
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
