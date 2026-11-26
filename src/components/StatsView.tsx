import React, { useEffect, useState } from "react";
import {
  BarChart3,
  Clock,
  Flame,
  Loader2,
  Music2,
  Play,
  RefreshCw,
  Users,
} from "lucide-react";
import { api, formatTime } from "../api";
import type { ListeningStats, Route, Track } from "../types";

interface StatsViewProps {
  onPlayTrack: (track: Track, list?: Track[]) => void;
  onNavigate: (route: Route) => void;
}

export const StatsView: React.FC<StatsViewProps> = ({ onPlayTrack, onNavigate }) => {
  const [stats, setStats] = useState<ListeningStats | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api
      .getListeningStats()
      .then(setStats)
      .catch(() => setStats(null))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 28 }}>
        <Loader2 size={18} className="spin" /> Computing listening statistics...
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="glass-panel" style={{ padding: 24 }}>
        Unable to load listening statistics.
      </div>
    );
  }

  const maxDay = Math.max(1, ...stats.dailyPlays.map((d) => d.plays));
  const maxHour = Math.max(1, ...stats.hourlyPlays);
  const hours = Math.floor(stats.totalMinutes / 60);
  const mins = stats.totalMinutes % 60;
  const timeLabel = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  const topTracksOnly = stats.topTracks.map((t) => t.track);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 1080 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.02em", marginBottom: 4 }}>
            Listening stats
          </h1>
          <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            Built locally from your SQLite listening history — zero external tracking.
          </p>
        </div>
        <button className="glass-pill" onClick={load}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* 4 Summary Metrics */}
      <div className="stats-kpi-grid">
        <div className="settings-section stats-kpi-card">
          <div className="stats-kpi-label">
            <Music2 size={14} /> Total plays
          </div>
          <div className="stats-kpi-value">{stats.totalPlays.toLocaleString()}</div>
          <div className="stats-kpi-sub">{stats.uniqueTracks.toLocaleString()} unique tracks</div>
        </div>
        <div className="settings-section stats-kpi-card">
          <div className="stats-kpi-label">
            <Clock size={14} /> Listening time
          </div>
          <div className="stats-kpi-value">{timeLabel}</div>
          <div className="stats-kpi-sub">Estimated from track durations</div>
        </div>
        <div className="settings-section stats-kpi-card">
          <div className="stats-kpi-label">
            <Users size={14} /> Artists discovered
          </div>
          <div className="stats-kpi-value">{stats.uniqueArtists.toLocaleString()}</div>
          <div className="stats-kpi-sub">Across all sessions</div>
        </div>
        <div className="settings-section stats-kpi-card">
          <div className="stats-kpi-label">
            <Flame size={14} style={{ color: "var(--accent)" }} /> Active streak
          </div>
          <div className="stats-kpi-value">
            {stats.streakDays} {stats.streakDays === 1 ? "day" : "days"}
          </div>
          <div className="stats-kpi-sub">Consecutive days with music</div>
        </div>
      </div>

      {/* Activity Charts Row */}
      <div className="stats-charts-grid">
        <section className="settings-section">
          <div className="settings-section-title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <BarChart3 size={14} /> Last 7 days
          </div>
          <div className="stats-bar-chart">
            {stats.dailyPlays.map((d, idx) => (
              <div key={idx} className="stats-bar-col" title={`${d.dayLabel}: ${d.plays} plays (${d.minutes}m)`}>
                <div className="stats-bar-track">
                  <div
                    className="stats-bar-fill"
                    style={{ height: `${Math.max(4, Math.round((d.plays / maxDay) * 100))}%` }}
                  />
                </div>
                <span className="stats-bar-count">{d.plays}</span>
                <span className="stats-bar-label">{d.dayLabel}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section-title">Activity by hour of day</div>
          <div className="stats-hour-chart">
            {stats.hourlyPlays.map((count, hour) => (
              <div
                key={hour}
                className="stats-hour-col"
                title={`${String(hour).padStart(2, "0")}:00 — ${count} plays`}
              >
                <div className="stats-bar-track" style={{ height: 84 }}>
                  <div
                    className="stats-bar-fill"
                    style={{
                      height: `${count === 0 ? 3 : Math.max(8, Math.round((count / maxHour) * 100))}%`,
                      opacity: count === 0 ? 0.2 : 0.85,
                    }}
                  />
                </div>
                {hour % 6 === 0 && (
                  <span className="stats-bar-label">{String(hour).padStart(2, "0")}h</span>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Top Tracks + Top Artists */}
      <div className="stats-charts-grid">
        <section className="settings-section">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div className="settings-section-title" style={{ margin: 0 }}>
              Top tracks
            </div>
            {topTracksOnly.length > 0 && (
              <button
                className="glass-pill"
                style={{ padding: "4px 10px", fontSize: 12 }}
                onClick={() => onPlayTrack(topTracksOnly[0], topTracksOnly)}
              >
                <Play size={12} /> Play top 10
              </button>
            )}
          </div>
          {stats.topTracks.length === 0 ? (
            <div style={{ color: "var(--text-muted)", fontSize: 13 }}>
              Play a few songs and your top tracks will appear here.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {stats.topTracks.map((item, idx) => (
                <div
                  key={item.track.videoId}
                  className="track-row"
                  style={{ gridTemplateColumns: "24px 40px 1fr auto" }}
                  onClick={() => onPlayTrack(item.track, topTracksOnly)}
                >
                  <span style={{ fontSize: 12, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
                    {idx + 1}
                  </span>
                  <div className="track-thumb" style={{ width: 40, height: 40 }}>
                    {item.track.thumbnail && <img src={item.track.thumbnail} alt="" />}
                    <div className="track-thumb-overlay">
                      <Play size={14} />
                    </div>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div className="media-title">{item.track.title}</div>
                    <div className="media-subtitle">{item.track.artist}</div>
                  </div>
                  <span className="badge" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {item.playCount} {item.playCount === 1 ? "play" : "plays"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="settings-section">
          <div className="settings-section-title">Top artists</div>
          {stats.topArtists.length === 0 ? (
            <div style={{ color: "var(--text-muted)", fontSize: 13 }}>
              No artist data recorded yet.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {stats.topArtists.map((a, idx) => (
                <div
                  key={`${a.artist}-${idx}`}
                  className="track-row"
                  style={{
                    gridTemplateColumns: "24px 40px 1fr auto",
                    cursor: a.artistId ? "pointer" : "default",
                  }}
                  onClick={() => a.artistId && onNavigate({ page: "artist", browseId: a.artistId })}
                >
                  <span style={{ fontSize: 12, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
                    {idx + 1}
                  </span>
                  <div className="track-thumb" style={{ width: 40, height: 40, borderRadius: "50%" }}>
                    {a.thumbnail && (
                      <img src={a.thumbnail} alt="" style={{ borderRadius: "50%" }} />
                    )}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div className="media-title">{a.artist}</div>
                    <div className="media-subtitle">
                      {formatTime(a.totalSecs * 1000)} listened
                    </div>
                  </div>
                  <span className="badge" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {a.playCount} plays
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
