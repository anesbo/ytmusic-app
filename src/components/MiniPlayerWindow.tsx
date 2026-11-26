import React, { useEffect, useState } from "react";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import {
  Disc3,
  GripHorizontal,
  Loader2,
  Maximize2,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { api, formatTime } from "../api";
import type { PlaybackSnapshot } from "../types";

export const MiniPlayerWindow: React.FC = () => {
  const [snap, setSnap] = useState<PlaybackSnapshot | null>(null);
  const [skin, setSkin] = useState<string>("bar");
  const [opacity, setOpacity] = useState<number>(0.94);
  const [accent, setAccent] = useState<string>("#e11d48");

  useEffect(() => {
    document.body.style.background = "transparent";
    document.documentElement.style.background = "transparent";
    api.getPlaybackSnapshot().then(setSnap).catch(() => {});
    const applySettings = (g: { miniPlayerSkin?: string; miniWindowOpacity?: number; accentColor?: string }) => {
      const nextSkin = g.miniPlayerSkin || "bar";
      setSkin(nextSkin);
      setOpacity(g.miniWindowOpacity ?? 0.94);
      if (g.accentColor) {
        setAccent(g.accentColor);
        document.documentElement.style.setProperty("--accent", g.accentColor);
      }
      const win = getCurrentWindow();
      if (nextSkin === "square") {
        win.setMinSize(new LogicalSize(220, 220)).catch(() => {});
        win.setSize(new LogicalSize(256, 256)).catch(() => {});
      } else if (nextSkin === "pill") {
        win.setMinSize(new LogicalSize(310, 58)).catch(() => {});
        win.setSize(new LogicalSize(376, 66)).catch(() => {});
      } else {
        win.setMinSize(new LogicalSize(320, 108)).catch(() => {});
        win.setSize(new LogicalSize(396, 124)).catch(() => {});
      }
    };
    api
      .getSettings()
      .then((s) => applySettings(s.glass))
      .catch(() => {});

    let unPlay: (() => void) | undefined;
    let unSet: (() => void) | undefined;
    api
      .onPlaybackState((s) => setSnap(s))
      .then((u) => (unPlay = u))
      .catch(() => {});
    api
      .onSettingsUpdated((s) => applySettings(s.glass))
      .then((u) => (unSet = u))
      .catch(() => {});
    return () => {
      unPlay?.();
      unSet?.();
    };
  }, []);

  const handleDragMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest("button, input, select, textarea, .mini-window-seek")) {
      return;
    }
    e.preventDefault();
    getCurrentWindow().startDragging().catch(() => {});
  };

  const track = snap?.currentTrack;
  const isLive = Boolean(track?.videoId.startsWith("live_"));
  const durMs = snap?.durationMs || (track ? track.durationSecs * 1000 : 0);
  const posMs = snap?.positionMs || 0;
  const pct = durMs > 0 ? Math.min(100, (posMs / durMs) * 100) : 0;
  const bgStyle = { background: `rgba(14, 16, 22, ${opacity.toFixed(2)})` };

  if (skin === "square") {
    return (
      <div className="mini-window-shell mini-skin-square" style={bgStyle} onMouseDown={handleDragMouseDown}>
        {track?.thumbnail ? (
          <img src={track.thumbnail} alt="" className="mini-square-bg" draggable={false} />
        ) : (
          <div className="mini-square-fallback">
            <Disc3 size={48} style={{ opacity: 0.35 }} />
          </div>
        )}
        <div className="mini-square-scrim" />
        <div className="mini-square-top">
          <button
            className="icon-btn"
            style={{ width: 26, height: 26, background: "rgba(0,0,0,0.45)" }}
            onClick={() => api.restoreMainWindow().catch(() => {})}
            title="Restore full LiquidYTM"
          >
            <Maximize2 size={13} />
          </button>
          <button
            className="icon-btn mini-exit-btn"
            style={{ width: 26, height: 26, background: "rgba(0,0,0,0.45)" }}
            onClick={() => api.closeMiniPlayer().catch(() => {})}
            title="Close mini player"
          >
            <X size={14} />
          </button>
        </div>

        <div className="mini-square-bottom">
          <div className="media-title" style={{ fontSize: 13.5, textShadow: "0 2px 8px rgba(0,0,0,0.8)" }}>
            {track?.title || "Nothing playing"}
          </div>
          <div className="media-subtitle" style={{ fontSize: 11.5, marginBottom: 8 }}>
            {track?.artist || "LiquidYTM"}
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 8 }}>
            <button
              className="icon-btn"
              style={{ width: 30, height: 30, background: "rgba(0,0,0,0.45)" }}
              onClick={() => api.triggerMediaControl("previous").catch(() => {})}
            >
              <SkipBack size={14} />
            </button>
            <button
              className="play-main-btn"
              style={{ width: 36, height: 36, background: accent }}
              onClick={() => api.togglePlayback().then(setSnap).catch(() => {})}
            >
              {snap?.isLoading ? (
                <Loader2 size={16} className="spin" />
              ) : snap?.isPlaying ? (
                <Pause size={16} />
              ) : (
                <Play size={16} style={{ marginLeft: 1 }} />
              )}
            </button>
            <button
              className="icon-btn"
              style={{ width: 30, height: 30, background: "rgba(0,0,0,0.45)" }}
              onClick={() => api.triggerMediaControl("next").catch(() => {})}
            >
              <SkipForward size={14} />
            </button>
          </div>
          <div
            className="mini-window-seek"
            onClick={(e) => {
              if (durMs <= 0 || isLive) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
              api.seekPlayback(Math.round(ratio * durMs)).then(setSnap).catch(() => {});
            }}
          >
            <div className="seek-track" style={{ height: 3.5 }}>
              <div className="seek-fill" style={{ width: isLive ? "100%" : `${pct.toFixed(1)}%` }} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (skin === "pill") {
    return (
      <div className="mini-window-shell mini-skin-pill" style={bgStyle} onMouseDown={handleDragMouseDown}>
        <div className="mini-pill-row">
          <div className="mini-window-art" style={{ width: 38, height: 38, borderRadius: "50%" }}>
            {track?.thumbnail ? (
              <img src={track.thumbnail} alt="" draggable={false} />
            ) : (
              <Disc3 size={18} style={{ opacity: 0.45 }} />
            )}
          </div>
          <div className="mini-window-meta">
            <div className="media-title" style={{ fontSize: 12.5 }}>
              {track?.title || "Nothing playing"}
            </div>
            <div className="media-subtitle" style={{ fontSize: 11 }}>
              {track?.artist || "LiquidYTM"}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button
              className="icon-btn"
              style={{ width: 26, height: 26 }}
              onClick={() => api.triggerMediaControl("previous").catch(() => {})}
            >
              <SkipBack size={13} />
            </button>
            <button
              className="play-main-btn"
              style={{ width: 30, height: 30 }}
              onClick={() => api.togglePlayback().then(setSnap).catch(() => {})}
            >
              {snap?.isLoading ? (
                <Loader2 size={14} className="spin" />
              ) : snap?.isPlaying ? (
                <Pause size={14} />
              ) : (
                <Play size={14} style={{ marginLeft: 1 }} />
              )}
            </button>
            <button
              className="icon-btn"
              style={{ width: 26, height: 26 }}
              onClick={() => api.triggerMediaControl("next").catch(() => {})}
            >
              <SkipForward size={13} />
            </button>
            <button
              className="icon-btn"
              style={{ width: 24, height: 24 }}
              onClick={() => api.restoreMainWindow().catch(() => {})}
              title="Restore full LiquidYTM"
            >
              <Maximize2 size={12} />
            </button>
            <button
              className="icon-btn mini-exit-btn"
              style={{ width: 24, height: 24 }}
              onClick={() => api.closeMiniPlayer().catch(() => {})}
              title="Close mini player"
            >
              <X size={13} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mini-window-shell" style={bgStyle} onMouseDown={handleDragMouseDown}>
      <div className="mini-window-top" data-tauri-drag-region title="Drag anywhere to move mini player">
        <div className="mini-window-art" data-tauri-drag-region>
          {track?.thumbnail ? (
            <img src={track.thumbnail} alt="" draggable={false} />
          ) : (
            <Disc3 size={22} style={{ opacity: 0.45 }} />
          )}
        </div>

        <div className="mini-window-meta" data-tauri-drag-region>
          <div className="media-title" style={{ fontSize: 13 }}>
            {track?.title || "Nothing playing"}
          </div>
          <div className="media-subtitle" style={{ fontSize: 11.5, display: "flex", alignItems: "center", gap: 5 }}>
            <GripHorizontal size={11} style={{ opacity: 0.45, flexShrink: 0 }} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {track?.artist || "LiquidYTM • Drag to move"}
            </span>
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
            className="icon-btn mini-exit-btn"
            style={{ width: 26, height: 26 }}
            onClick={() => api.closeMiniPlayer().catch(() => {})}
            title="Close mini player"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Scrubbable progress bar */}
      <div
        className="mini-window-seek"
        onClick={(e) => {
          if (durMs <= 0 || isLive) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          api.seekPlayback(Math.round(ratio * durMs)).then(setSnap).catch(() => {});
        }}
      >
        <div className="seek-track" style={{ height: 4 }}>
          <div className="seek-fill" style={{ width: isLive ? "100%" : `${pct.toFixed(1)}%` }} />
        </div>
      </div>

      <div className="mini-window-controls">
        {isLive ? (
          <span className="live-pill-badge">
            <span className="live-dot" /> LIVE
          </span>
        ) : (
          <span style={{ fontSize: 11, color: "rgba(161,161,170,0.9)", fontVariantNumeric: "tabular-nums", minWidth: 68 }}>
            {formatTime(posMs)} / {formatTime(durMs)}
          </span>
        )}

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
