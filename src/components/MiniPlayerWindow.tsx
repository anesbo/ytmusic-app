import React, { useEffect, useState } from "react";
import {
  Disc3,
  Loader2,
  Maximize2,
  Pause,
  Play,
  Power,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import { api, formatTime } from "../api";
import type { PlaybackSnapshot } from "../types";

export const MiniPlayerWindow: React.FC = () => {
  const [snap, setSnap] = useState<PlaybackSnapshot | null>(null);

  useEffect(() => {
    document.body.style.background = "transparent";
    document.documentElement.style.background = "transparent";
    api.getPlaybackSnapshot().then(setSnap).catch(() => {});
    let unlisten: (() => void) | undefined;
    api
      .onPlaybackState((s) => setSnap(s))
      .then((u) => (unlisten = u))
      .catch(() => {});
    return () => unlisten?.();
  }, []);

  const track = snap?.currentTrack;
  const durMs = snap?.durationMs || (track ? track.durationSecs * 1000 : 0);
  const posMs = snap?.positionMs || 0;
  const pct = durMs > 0 ? Math.min(100, (posMs / durMs) * 100) : 0;

  return (
    <div className="mini-window-shell">
      <div className="mini-window-top" data-tauri-drag-region>
        <div className="mini-window-art" data-tauri-drag-region>
          {track?.thumbnail ? (
            <img src={track.thumbnail} alt="" />
          ) : (
            <Disc3 size={22} style={{ opacity: 0.45 }} />
          )}
        </div>

        <div className="mini-window-meta" data-tauri-drag-region>
          <div className="media-title" style={{ fontSize: 13 }}>
            {track?.title || "Nothing playing"}
          </div>
          <div className="media-subtitle" style={{ fontSize: 11.5 }}>
            {track?.artist || "LiquidYTM"}
          </div>
        </div>

        <div className="mini-window-winbtns">
          <button
            className="icon-btn"
            style={{ width: 26, height: 26 }}
            onClick={() => api.restoreMainWindow().catch(() => {})}
            title="Restore full LiquidYTM window"
          >
            <Maximize2 size={13} />
          </button>
          <button
            className="icon-btn"
            style={{ width: 26, height: 26 }}
            onClick={() => api.quitApp().catch(() => {})}
            title="Quit LiquidYTM completely"
          >
            <Power size={13} />
          </button>
        </div>
      </div>

      {/* Scrubbable progress bar */}
      <div
        className="mini-window-seek"
        onClick={(e) => {
          if (durMs <= 0) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          api.seekPlayback(Math.round(ratio * durMs)).then(setSnap).catch(() => {});
        }}
      >
        <div className="seek-track" style={{ height: 4 }}>
          <div className="seek-fill" style={{ width: `${pct.toFixed(1)}%` }} />
        </div>
      </div>

      <div className="mini-window-controls">
        <span style={{ fontSize: 11, color: "rgba(161,161,170,0.9)", fontVariantNumeric: "tabular-nums", minWidth: 68 }}>
          {formatTime(posMs)} / {formatTime(durMs)}
        </span>

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button
            className="icon-btn"
            style={{ width: 28, height: 28 }}
            onClick={() => api.triggerMediaControl("previous").catch(() => {})}
            title="Previous"
          >
            <SkipBack size={14} />
          </button>
          <button
            className="play-main-btn"
            style={{ width: 32, height: 32 }}
            onClick={() => api.togglePlayback().then(setSnap).catch(() => {})}
            title={snap?.isPlaying ? "Pause" : "Play"}
          >
            {snap?.isLoading ? (
              <Loader2 size={15} className="spin" />
            ) : snap?.isPlaying ? (
              <Pause size={15} />
            ) : (
              <Play size={15} style={{ marginLeft: 1 }} />
            )}
          </button>
          <button
            className="icon-btn"
            style={{ width: 28, height: 28 }}
            onClick={() => api.triggerMediaControl("next").catch(() => {})}
            title="Next"
          >
            <SkipForward size={14} />
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button
            className="icon-btn"
            style={{ width: 24, height: 24 }}
            onClick={() => api.setMuted(!(snap?.muted ?? false)).then(setSnap).catch(() => {})}
            title="Mute"
          >
            {snap?.muted || (snap?.volume ?? 0.85) <= 0.01 ? (
              <VolumeX size={13} />
            ) : (
              <Volume2 size={13} />
            )}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.02}
            value={snap?.muted ? 0 : Math.min(1, snap?.volume ?? 0.85)}
            onChange={(e) => api.setVolume(parseFloat(e.target.value)).then(setSnap).catch(() => {})}
            className="range-input"
            style={{ width: 64 }}
            aria-label="Volume"
          />
        </div>
      </div>
    </div>
  );
};
