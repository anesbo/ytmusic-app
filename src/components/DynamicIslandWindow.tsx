import React, { useEffect, useRef, useState } from "react";
import { getCurrentWindow, LogicalPosition, LogicalSize } from "@tauri-apps/api/window";
import {
  Disc3,
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

const COMPACT_W = 258;
const COMPACT_H = 52;
const EXPANDED_W = 412;
const EXPANDED_H = 144;

export const DynamicIslandWindow: React.FC = () => {
  const [snap, setSnap] = useState<PlaybackSnapshot | null>(null);
  const [morphed, setMorphed] = useState(false);
  const [windowExpanded, setWindowExpanded] = useState(false);

  const leaveTimerRef = useRef<number | null>(null);
  const shrinkTimerRef = useRef<number | null>(null);
  const windowExpandedRef = useRef(false);

  useEffect(() => {
    document.body.style.background = "transparent";
    document.documentElement.style.background = "transparent";
    api.getPlaybackSnapshot().then(setSnap).catch(() => {});
    let unlisten: (() => void) | undefined;
    api
      .onPlaybackState((s) => setSnap(s))
      .then((u) => (unlisten = u))
      .catch(() => {});
    return () => {
      unlisten?.();
      if (leaveTimerRef.current) window.clearTimeout(leaveTimerRef.current);
      if (shrinkTimerRef.current) window.clearTimeout(shrinkTimerRef.current);
    };
  }, []);

  const resizeWindowCentered = async (toExpanded: boolean) => {
    if (windowExpandedRef.current === toExpanded) return;
    windowExpandedRef.current = toExpanded;
    setWindowExpanded(toExpanded);
    try {
      const win = getCurrentWindow();
      const scale = await win.scaleFactor();
      const pos = await win.outerPosition();
      const logicalX = pos.x / scale;
      const logicalY = pos.y / scale;
      const deltaW = toExpanded ? EXPANDED_W - COMPACT_W : COMPACT_W - EXPANDED_W;
      const nextX = Math.max(6, Math.round(logicalX - deltaW / 2));
      const nextW = toExpanded ? EXPANDED_W : COMPACT_W;
      const nextH = toExpanded ? EXPANDED_H : COMPACT_H;
      if (toExpanded) {
        await win.setPosition(new LogicalPosition(nextX, Math.round(logicalY)));
        await win.setSize(new LogicalSize(nextW, nextH));
      } else {
        await win.setSize(new LogicalSize(nextW, nextH));
        await win.setPosition(new LogicalPosition(nextX, Math.round(logicalY)));
      }
    } catch {
      // ignore outside Tauri
    }
  };

  const handleMouseEnter = async () => {
    if (leaveTimerRef.current) {
      window.clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
    if (shrinkTimerRef.current) {
      window.clearTimeout(shrinkTimerRef.current);
      shrinkTimerRef.current = null;
    }
    if (!windowExpandedRef.current) {
      await resizeWindowCentered(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setMorphed(true);
        });
      });
    } else {
      setMorphed(true);
    }
  };

  const handleMouseLeave = () => {
    if (leaveTimerRef.current) window.clearTimeout(leaveTimerRef.current);
    leaveTimerRef.current = window.setTimeout(() => {
      leaveTimerRef.current = null;
      setMorphed(false);
      if (shrinkTimerRef.current) window.clearTimeout(shrinkTimerRef.current);
      shrinkTimerRef.current = window.setTimeout(() => {
        shrinkTimerRef.current = null;
        resizeWindowCentered(false);
      }, 270);
    }, 240);
  };

  const handleDragMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement | null)?.closest("button, input, .island-seek")) return;
    e.preventDefault();
    getCurrentWindow().startDragging().catch(() => {});
  };

  const track = snap?.currentTrack;
  const isLive = Boolean(track?.videoId.startsWith("live_"));
  const durMs = snap?.durationMs || (track ? track.durationSecs * 1000 : 0);
  const posMs = snap?.positionMs || 0;
  const pct = durMs > 0 ? Math.min(100, (posMs / durMs) * 100) : 0;
  const vol = snap?.muted ? 0 : Math.min(1, snap?.volume ?? 0.85);
  const volPct = Math.round(vol * 100);

  return (
    <div
      className="island-viewport"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseDown={handleDragMouseDown}
    >
      <div className={`island-shell ${morphed ? "expanded" : "compact"} ${windowExpanded ? "win-wide" : ""}`}>
        {!morphed ? (
          <div className="island-compact-row island-content-fade">
            <div className={`island-mini-art ${snap?.isPlaying ? "spinning" : ""}`}>
              {track?.thumbnail ? (
                <img src={track.thumbnail} alt="" draggable={false} />
              ) : (
                <Disc3 size={14} style={{ opacity: 0.6 }} />
              )}
            </div>
            <div className="island-compact-title">
              {track?.title || "LiquidYTM"}
            </div>
            {snap?.isPlaying && (
              <div className="island-eq-bars" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
            )}
            <button
              className="icon-btn"
              style={{ width: 26, height: 26, flexShrink: 0 }}
              onClick={() => api.togglePlayback().then(setSnap).catch(() => {})}
              title={snap?.isPlaying ? "Pause" : "Play"}
            >
              {snap?.isLoading ? (
                <Loader2 size={12} className="spin" />
              ) : snap?.isPlaying ? (
                <Pause size={12} />
              ) : (
                <Play size={12} style={{ marginLeft: 1 }} />
              )}
            </button>
          </div>
        ) : (
          <div className="island-expanded-body island-content-fade">
            <div className="island-expanded-top">
              <div className={`island-expanded-art ${snap?.isPlaying ? "playing" : ""}`}>
                {track?.thumbnail ? (
                  <img src={track.thumbnail} alt="" draggable={false} />
                ) : (
                  <Disc3 size={20} style={{ opacity: 0.5 }} />
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="media-title" style={{ fontSize: 13 }}>
                  {track?.title || "Nothing playing"}
                </div>
                <div className="media-subtitle" style={{ fontSize: 11.5 }}>
                  {track?.artist || "LiquidYTM Island • Drag to move"}
                </div>
              </div>
              <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
                <button
                  className="icon-btn"
                  style={{ width: 24, height: 24 }}
                  onClick={() => api.restoreMainWindow().catch(() => {})}
                  title="Open LiquidYTM"
                >
                  <Maximize2 size={12} />
                </button>
                <button
                  className="icon-btn"
                  style={{ width: 24, height: 24 }}
                  onClick={() => api.closeDynamicIsland().catch(() => {})}
                  title="Close Dynamic Island"
                >
                  <X size={13} />
                </button>
              </div>
            </div>

            <div
              className="island-seek"
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

            <div className="island-expanded-controls">
              {isLive ? (
                <span className="live-pill-badge">
                  <span className="live-dot" /> LIVE
                </span>
              ) : (
                <span style={{ fontSize: 10.5, color: "rgba(161,161,170,0.85)", fontVariantNumeric: "tabular-nums", minWidth: 66 }}>
                  {formatTime(posMs)} / {formatTime(durMs)}
                </span>
              )}

              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <button
                  className="icon-btn"
                  style={{ width: 26, height: 26 }}
                  onClick={() => api.triggerMediaControl("previous").catch(() => {})}
                  title="Previous"
                >
                  <SkipBack size={13} />
                </button>
                <button
                  className="play-main-btn"
                  style={{ width: 28, height: 28 }}
                  onClick={() => api.togglePlayback().then(setSnap).catch(() => {})}
                  title={snap?.isPlaying ? "Pause" : "Play"}
                >
                  {snap?.isLoading ? (
                    <Loader2 size={13} className="spin" />
                  ) : snap?.isPlaying ? (
                    <Pause size={13} />
                  ) : (
                    <Play size={13} style={{ marginLeft: 1 }} />
                  )}
                </button>
                <button
                  className="icon-btn"
                  style={{ width: 26, height: 26 }}
                  onClick={() => api.triggerMediaControl("next").catch(() => {})}
                  title="Next"
                >
                  <SkipForward size={13} />
                </button>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <button
                  className="icon-btn"
                  style={{ width: 24, height: 24 }}
                  onClick={() => api.setMuted(!(snap?.muted ?? false)).then(setSnap).catch(() => {})}
                  title={snap?.muted ? "Unmute" : "Mute"}
                >
                  {vol <= 0.01 ? <VolumeX size={12.5} /> : <Volume2 size={12.5} />}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.02}
                  value={vol}
                  onChange={(e) => api.setVolume(parseFloat(e.target.value)).then(setSnap).catch(() => {})}
                  className="range-input"
                  style={{ width: 58 }}
                  aria-label="Volume"
                />
                <span style={{ fontSize: 10, color: "rgba(161,161,170,0.85)", fontVariantNumeric: "tabular-nums", minWidth: 26, textAlign: "right" }}>
                  {volPct}%
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
