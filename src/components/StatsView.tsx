import React, { useEffect, useState } from "react";
import {
  Award,
  BarChart3,
  Calendar,
  Clock,
  Compass,
  Disc3,
  Download,
  Flame,
  Heart,
  Music2,
  Play,
  RefreshCw,
  Sparkles,
  Trophy,
  Users,
} from "lucide-react";
import { api } from "../api";
import type { ListeningStats, Route, Track } from "../types";
import { AppLoader } from "./AppLoader";

interface StatsViewProps {
  onPlayTrack: (track: Track, list?: Track[]) => void;
  onNavigate: (route: Route) => void;
}

const formatHourLabel = (h: number) => {
  const hr = ((h % 24) + 24) % 24;
  return `${String(hr).padStart(2, "0")}:00`;
};

export const StatsView: React.FC<StatsViewProps> = ({ onPlayTrack, onNavigate }) => {
  const [stats, setStats] = useState<ListeningStats | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.getListeningStats();
      setStats(res);
    } catch {
      setStats(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (loading) {
    return (
      <div className="page-loader-center">
        <AppLoader size={36} color="var(--accent)" />
        <span>Loading your listening insights...</span>
      </div>
    );
  }

  if (!stats || stats.totalPlays === 0) {
    return (
      <div className="glass-panel" style={{ padding: 32, textAlign: "center", maxWidth: 520, margin: "40px auto" }}>
        <BarChart3 size={34} style={{ color: "var(--accent)", marginBottom: 12 }} />
        <h2 style={{ marginBottom: 8 }}>Your Listening Wrapped</h2>
        <p style={{ fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.5 }}>
          Play songs in LiquidYTM to automatically build your local listening stats, streaks, 35-day heatmap,
          listening persona, top tracks, artists, and albums — 100% private and stored on your device.
        </p>
      </div>
    );
  }

  const maxDaily = Math.max(1, ...stats.dailyPlays.map((d) => d.plays));
  const maxWeekday = Math.max(1, ...(stats.weekdayPlays || []).map((d) => d.plays));
  const maxHourly = Math.max(1, ...stats.hourlyPlays);
  const maxHeat = Math.max(1, ...(stats.heatmapDays || []).map((d) => d.plays));
  const maxTrackPlays = Math.max(1, ...stats.topTracks.map((t) => t.playCount));
  const hours = Math.floor(stats.totalMinutes / 60);
  const mins = stats.totalMinutes % 60;
  const activeHeatmapDays = (stats.heatmapDays || []).filter((d) => d.plays > 0).length;

  return (
    <div style={{ paddingBottom: 44, display: "flex", flexDirection: "column", gap: 22 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="shelf-strapline">LOCAL WRAPPED & ANALYTICS</div>
          <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em" }}>Listening Stats</h1>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="badge hires" style={{ padding: "5px 11px", fontSize: 12 }}>
            <Sparkles size={13} style={{ color: "var(--accent)" }} /> {stats.listeningPersona || "Audiophile"}
          </span>
          <button className="glass-pill" onClick={load}>
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      {/* Persona Highlight Strip */}
      <div className="stats-persona-banner glass-panel">
        <div className="stats-persona-main">
          <div className="stats-persona-icon">
            <Award size={22} />
          </div>
          <div>
            <div style={{ fontSize: 11.5, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-muted)" }}>
              Your Listening Vibe
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>
              {stats.listeningPersona || "Audiophile"} • Peak at {formatHourLabel(stats.peakHour ?? 20)}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 3 }}>
              Averaging <strong>{(stats.avgPlaysPerDay ?? 0).toFixed(1)} plays</strong> per active day •{" "}
              <strong>{stats.discoveryRatePct ?? 0}%</strong> discovery diversity across{" "}
              <strong>{stats.uniqueTracks}</strong> unique songs
            </div>
          </div>
        </div>
        <div className="stats-persona-pills">
          <span className="badge">
            <Heart size={12} style={{ color: "var(--accent)" }} /> {stats.likedCount ?? 0} Liked
          </span>
          <span className="badge">
            <Download size={12} style={{ color: "#22c55e" }} /> {stats.downloadedCount ?? 0} Offline
          </span>
          <span className="badge">
            <Trophy size={12} style={{ color: "#f59e0b" }} /> Best Streak: {stats.longestStreakDays ?? stats.streakDays}d
          </span>
        </div>
      </div>

      {/* Top 6 KPI Cards */}
      <div className="stats-kpi-grid stats-kpi-6">
        <div className="glass-panel stats-kpi-card">
          <div className="stats-kpi-label">
            <Music2 size={14} style={{ color: "var(--accent)" }} /> Total Plays
          </div>
          <div className="stats-kpi-value">{stats.totalPlays.toLocaleString()}</div>
          <div className="stats-kpi-sub">{stats.uniqueTracks} unique tracks</div>
        </div>

        <div className="glass-panel stats-kpi-card">
          <div className="stats-kpi-label">
            <Clock size={14} style={{ color: "#38bdf8" }} /> Listening Time
          </div>
          <div className="stats-kpi-value">
            {hours > 0 ? `${hours}h ${mins}m` : `${mins}m`}
          </div>
          <div className="stats-kpi-sub">{stats.totalMinutes.toLocaleString()} total minutes</div>
        </div>

        <div className="glass-panel stats-kpi-card">
          <div className="stats-kpi-label">
            <Users size={14} style={{ color: "#a855f7" }} /> Artists Explored
          </div>
          <div className="stats-kpi-value">{stats.uniqueArtists}</div>
          <div className="stats-kpi-sub">
            {stats.topArtists[0] ? `Top: ${stats.topArtists[0].artist}` : "Keep listening"}
          </div>
        </div>

        <div className="glass-panel stats-kpi-card">
          <div className="stats-kpi-label">
            <Flame size={14} style={{ color: "#f97316" }} /> Active Streak
          </div>
          <div className="stats-kpi-value">
            {stats.streakDays} {stats.streakDays === 1 ? "day" : "days"}
          </div>
          <div className="stats-kpi-sub">
            Record: {stats.longestStreakDays ?? stats.streakDays} {(stats.longestStreakDays ?? stats.streakDays) === 1 ? "day" : "days"}
          </div>
        </div>

        <div className="glass-panel stats-kpi-card">
          <div className="stats-kpi-label">
            <Compass size={14} style={{ color: "#10b981" }} /> Discovery Rate
          </div>
          <div className="stats-kpi-value">{stats.discoveryRatePct ?? 0}%</div>
          <div className="stats-kpi-sub">
            {(stats.discoveryRatePct ?? 0) >= 65 ? "Explorer — loves variety" : "Loyalist — replays favorites"}
          </div>
        </div>

        <div className="glass-panel stats-kpi-card">
          <div className="stats-kpi-label">
            <Calendar size={14} style={{ color: "#f43f5e" }} /> Daily Pace
          </div>
          <div className="stats-kpi-value">{(stats.avgPlaysPerDay ?? 0).toFixed(1)}</div>
          <div className="stats-kpi-sub">plays / active day</div>
        </div>
      </div>

      {/* 35-Day Activity Heatmap Calendar */}
      {stats.heatmapDays && stats.heatmapDays.length > 0 && (
        <div className="glass-panel" style={{ padding: 18 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
            <div>
              <h3 style={{ fontSize: 15, fontWeight: 600 }}>35-Day Listening Heatmap</h3>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                Active on {activeHeatmapDays} of the last {stats.heatmapDays.length} days
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-muted)" }}>
              <span>Less</span>
              {[0, 0.25, 0.5, 0.75, 1].map((lvl, idx) => (
                <span
                  key={idx}
                  className="stats-heat-legend-dot"
                  style={{
                    background:
                      lvl === 0
                        ? "rgba(255,255,255,0.06)"
                        : `color-mix(in srgb, var(--accent) ${Math.round(lvl * 90 + 10)}%, rgba(255,255,255,0.08))`,
                  }}
                />
              ))}
              <span>More</span>
            </div>
          </div>
          <div className="stats-heatmap-grid">
            {stats.heatmapDays.map((day) => {
              const ratio = day.plays === 0 ? 0 : Math.max(0.2, day.plays / maxHeat);
              return (
                <div
                  key={day.date}
                  className={`stats-heat-cell ${day.plays > 0 ? "active" : ""}`}
                  style={{
                    background:
                      day.plays === 0
                        ? "rgba(255,255,255,0.05)"
                        : `color-mix(in srgb, var(--accent) ${Math.round(ratio * 88 + 12)}%, rgba(255,255,255,0.06))`,
                  }}
                  title={`${day.label} (${day.date}): ${day.plays} plays • ${day.minutes} min`}
                >
                  <span className="stats-heat-day-num">{day.date.slice(-2)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Charts Row: Last 7 Days + Day of Week + 24-Hour Rhythm */}
      <div className="stats-charts-row stats-charts-3">
        <div className="glass-panel" style={{ padding: 18 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 14 }}>Last 7 Days</h3>
          <div className="stats-bar-chart">
            {stats.dailyPlays.map((d, i) => (
              <div key={i} className="stats-bar-col" title={`${d.dayLabel}: ${d.plays} plays (${d.minutes}m)`}>
                <div className="stats-bar-val">{d.plays > 0 ? d.plays : ""}</div>
                <div className="stats-bar-track">
                  <div
                    className="stats-bar-fill"
                    style={{ height: `${Math.max(d.plays > 0 ? 10 : 2, (d.plays / maxDaily) * 100)}%` }}
                  />
                </div>
                <div className="stats-bar-label">{d.dayLabel}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="glass-panel" style={{ padding: 18 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 14 }}>Day of Week Pattern</h3>
          <div className="stats-bar-chart">
            {(stats.weekdayPlays || []).map((d, i) => (
              <div key={i} className="stats-bar-col" title={`${d.dayLabel}: ${d.plays} total plays (${d.minutes}m)`}>
                <div className="stats-bar-val">{d.plays > 0 ? d.plays : ""}</div>
                <div className="stats-bar-track">
                  <div
                    className="stats-bar-fill weekday"
                    style={{ height: `${Math.max(d.plays > 0 ? 10 : 2, (d.plays / maxWeekday) * 100)}%` }}
                  />
                </div>
                <div className="stats-bar-label">{d.dayLabel}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="glass-panel" style={{ padding: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
            <h3 style={{ fontSize: 15, fontWeight: 600 }}>24-Hour Clock</h3>
            <span style={{ fontSize: 11.5, color: "var(--accent)", fontWeight: 600 }}>
              Peak {formatHourLabel(stats.peakHour ?? 20)}
            </span>
          </div>
          <div className="stats-bar-chart hourly">
            {stats.hourlyPlays.map((cnt, hr) => {
              const isPeak = hr === stats.peakHour && cnt > 0;
              return (
                <div key={hr} className="stats-bar-col" title={`${formatHourLabel(hr)}: ${cnt} plays`}>
                  <div className="stats-bar-track">
                    <div
                      className={`stats-bar-fill ${isPeak ? "peak" : ""}`}
                      style={{ height: `${Math.max(cnt > 0 ? 10 : 2, (cnt / maxHourly) * 100)}%` }}
                    />
                  </div>
                  <div className="stats-bar-label">{hr % 6 === 0 ? `${hr}h` : ""}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Top Tracks & Top Artists */}
      <div className="stats-charts-row">
        <div className="glass-panel" style={{ padding: 18 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Top Tracks</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {stats.topTracks.map((item, idx) => (
              <div
                key={item.track.videoId}
                className="stats-rank-row"
                onClick={() =>
                  onPlayTrack(
                    item.track,
                    stats.topTracks.map((x) => x.track)
                  )
                }
              >
                <span className="stats-rank-num">#{idx + 1}</span>
                <div className="track-thumb" style={{ width: 40, height: 40 }}>
                  {item.track.thumbnail && <img src={item.track.thumbnail} alt="" loading="lazy" />}
                  <div className="track-thumb-overlay">
                    <Play size={14} />
                  </div>
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="media-title" style={{ fontSize: 13.5 }}>{item.track.title}</div>
                  <div className="media-subtitle" style={{ fontSize: 12 }}>{item.track.artist}</div>
                  <div className="stats-mini-bar">
                    <div style={{ width: `${Math.max(8, (item.playCount / maxTrackPlays) * 100)}%` }} />
                  </div>
                </div>
                <span className="badge">{item.playCount} plays</span>
              </div>
            ))}
          </div>
        </div>

        <div className="glass-panel" style={{ padding: 18 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Top Artists</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {stats.topArtists.map((a, idx) => (
              <div
                key={a.artist}
                className="stats-rank-row"
                onClick={() => {
                  if (a.artistId) onNavigate({ page: "artist", browseId: a.artistId });
                  else onNavigate({ page: "search", query: a.artist, filter: "all" });
                }}
              >
                <span className="stats-rank-num">#{idx + 1}</span>
                <div className="track-thumb" style={{ width: 40, height: 40, borderRadius: "50%" }}>
                  {a.thumbnail && <img src={a.thumbnail} alt="" loading="lazy" />}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="media-title" style={{ fontSize: 13.5 }}>{a.artist}</div>
                  <div className="media-subtitle" style={{ fontSize: 12 }}>
                    {Math.round(a.totalSecs / 60)} mins listened
                  </div>
                </div>
                <span className="badge">{a.playCount} plays</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Top Albums */}
      {stats.topAlbums && stats.topAlbums.length > 0 && (
        <div className="glass-panel" style={{ padding: 18 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, display: "flex", alignItems: "center", gap: 7 }}>
            <Disc3 size={15} style={{ color: "var(--accent)" }} /> Top Albums
          </h3>
          <div className="stats-albums-grid">
            {stats.topAlbums.map((al, idx) => (
              <div
                key={`${al.album}-${idx}`}
                className="glass-card stats-album-card"
                onClick={() => {
                  if (al.albumId) {
                    onNavigate({ page: "playlist", id: al.albumId, isLocal: false });
                  } else {
                    onNavigate({ page: "search", query: `${al.album} ${al.artist}`, filter: "albums" });
                  }
                }}
              >
                <div className="stats-album-art">
                  {al.thumbnail ? (
                    <img src={al.thumbnail} alt="" loading="lazy" />
                  ) : (
                    <Disc3 size={22} style={{ opacity: 0.45 }} />
                  )}
                  <span className="stats-album-rank">#{idx + 1}</span>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="media-title" style={{ fontSize: 13 }}>{al.album}</div>
                  <div className="media-subtitle" style={{ fontSize: 11.5 }}>{al.artist}</div>
                  <div style={{ fontSize: 11, color: "var(--accent)", marginTop: 3, fontWeight: 600 }}>
                    {al.playCount} {al.playCount === 1 ? "play" : "plays"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
