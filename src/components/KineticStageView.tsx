import React, { useEffect, useRef, useState } from "react";
import {
  Activity,
  Disc3,
  Loader2,
  Pause,
  Play,
  Power,
  SkipBack,
  SkipForward,
  Sparkles,
} from "lucide-react";
import { api, formatTime } from "../api";
import type { LyricsData, PlaybackSnapshot } from "../types";

type KineticStyle = "silk" | "rings" | "starfield" | "editorial";

interface KineticStageViewProps {
  playback: PlaybackSnapshot;
  lyricsBrowseId?: string | null;
  visualizerEnabled: boolean;
  onToggleVisualizer: () => void;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onDisable: () => void;
}

export const KineticStageView: React.FC<KineticStageViewProps> = ({
  playback,
  lyricsBrowseId,
  visualizerEnabled,
  onToggleVisualizer,
  onTogglePlay,
  onPrev,
  onNext,
  onDisable,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [styleMode, setStyleMode] = useState<KineticStyle>("silk");
  const [lyrics, setLyrics] = useState<LyricsData | null>(null);
  const [hudVisible, setHudVisible] = useState(true);
  const [bassKick, setBassKick] = useState(0);

  const spectrumRef = useRef<number[]>(new Array(32).fill(0));
  const bassSmoothRef = useRef(0);
  const hideTimerRef = useRef<number | null>(null);

  const track = playback.currentTrack;

  // Escape key turns off Kinetic Stage
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDisable();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDisable]);

  // Fetch synced lyrics for kinetic typography
  useEffect(() => {
    if (!track) {
      setLyrics(null);
      return;
    }
    let cancelled = false;
    api
      .getLyrics(track.videoId, track.title, track.artist, track.durationSecs, lyricsBrowseId)
      .then((res) => {
        if (!cancelled) setLyrics(res);
      })
      .catch(() => {
        if (!cancelled) setLyrics(null);
      });
    return () => {
      cancelled = true;
    };
  }, [track?.videoId, lyricsBrowseId]);

  // Subscribe to real-time FFT spectrum
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    api
      .onAudioSpectrum((bars) => {
        spectrumRef.current = bars;
        const bass = (bars[0] + bars[1] + bars[2] + bars[3]) / 4;
        bassSmoothRef.current = bassSmoothRef.current * 0.45 + bass * 0.55;
      })
      .then((u) => (unlisten = u))
      .catch(() => {});
    return () => unlisten?.();
  }, []);

  // Auto-hide HUD after 3s of mouse stillness
  const bumpHud = () => {
    setHudVisible(true);
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => setHudVisible(false), 3200);
  };

  useEffect(() => {
    bumpHud();
    return () => {
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    };
  }, []);

  // 60 FPS Reactive Shader / Motion-Graphics Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let lastKickUpdate = 0;
    const rings: Array<{ r: number; alpha: number; hue: number }> = [];
    let lastRingTime = 0;

    const stars = Array.from({ length: 160 }, () => ({
      x: (Math.random() - 0.5) * 2,
      y: (Math.random() - 0.5) * 2,
      z: Math.random(),
    }));

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(window.innerWidth * dpr));
      canvas.height = Math.max(1, Math.floor(window.innerHeight * dpr));
    };
    resize();
    window.addEventListener("resize", resize);

    const draw = (t: number) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      ctx.save();
      ctx.scale(dpr, dpr);

      const bars = spectrumRef.current;
      const syntheticBeat = playback.isPlaying
        ? 0.22 + 0.16 * Math.pow(Math.max(0, Math.sin(t * 0.0065)), 3)
        : 0.03;
      const bass = visualizerEnabled && playback.isPlaying ? Math.max(bassSmoothRef.current, syntheticBeat * 0.4) : syntheticBeat;
      const mid = visualizerEnabled && playback.isPlaying
        ? (bars[8] + bars[10] + bars[12] + bars[14]) / 4
        : syntheticBeat * 0.7;

      // Throttle React bassKick state to ~20fps for subtle CSS kinetic word bounce
      if (t - lastKickUpdate > 48) {
        lastKickUpdate = t;
        setBassKick(bass);
      }

      // Rich deep dark wash
      ctx.fillStyle = styleMode === "starfield" ? "rgba(6, 7, 13, 0.28)" : "rgba(8, 9, 14, 0.92)";
      ctx.fillRect(0, 0, w, h);

      // Reactive ambient glow
      const cx = w * 0.5;
      const cy = h * 0.5;
      const accentHue = (346 + Math.sin(t * 0.0003) * 28 + mid * 40) % 360;

      if (styleMode === "silk") {
        // Flowing liquid-metal silk ribbons driven by live frequency bands
        for (let layer = 0; layer < 4; layer++) {
          ctx.beginPath();
          const yBase = cy + (layer - 1.5) * 68;
          const amp = (36 + bass * 115) * (1 - layer * 0.15);
          for (let x = 0; x <= w; x += 22) {
            const normX = x / w;
            const bIdx = Math.min(31, Math.floor(normX * 28));
            const spec = visualizerEnabled ? (bars[bIdx] || 0) : syntheticBeat;
            const wave =
              Math.sin(normX * 4.5 + t * 0.0011 + layer * 1.4) * amp +
              Math.cos(normX * 9.0 - t * 0.0017 + layer) * (18 + spec * 70);
            const y = yBase + wave;
            if (x === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.strokeStyle = `hsla(${(accentHue + layer * 34) % 360}, 78%, 62%, ${0.14 + bass * 0.2})`;
          ctx.lineWidth = 2.2 + bass * 2.5;
          ctx.stroke();
        }
      } else if (styleMode === "rings") {
        // Expanding beat-reactive concentric shockwave rings
        if (playback.isPlaying && bass > 0.34 && t - lastRingTime > 260) {
          lastRingTime = t;
          rings.push({ r: 40, alpha: 0.65, hue: accentHue });
        }
        for (let i = rings.length - 1; i >= 0; i--) {
          const rg = rings[i];
          rg.r += 3.4 + bass * 7.5;
          rg.alpha *= 0.975;
          ctx.strokeStyle = `hsla(${rg.hue}, 82%, 64%, ${rg.alpha.toFixed(3)})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(cx, cy, rg.r, 0, Math.PI * 2);
          ctx.stroke();
          if (rg.alpha < 0.02 || rg.r > Math.max(w, h) * 0.85) rings.splice(i, 1);
        }
        // Central halo
        const haloR = 130 + bass * 140;
        const g = ctx.createRadialGradient(cx, cy, 10, cx, cy, haloR);
        g.addColorStop(0, `hsla(${accentHue}, 80%, 55%, ${0.22 + bass * 0.25})`);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, haloR, 0, Math.PI * 2);
        ctx.fill();
      } else if (styleMode === "starfield") {
        // Hyperspace warp stars accelerating on bass kicks
        const speed = playback.isPlaying ? 0.005 + bass * 0.032 : 0.0012;
        for (const s of stars) {
          s.z -= speed;
          if (s.z <= 0.02) {
            s.x = (Math.random() - 0.5) * 2;
            s.y = (Math.random() - 0.5) * 2;
            s.z = 1;
          }
          const sx = cx + (s.x / s.z) * (w * 0.42);
          const sy = cy + (s.y / s.z) * (h * 0.42);
          const size = Math.max(0.8, (1 - s.z) * 3.4);
          ctx.fillStyle = `hsla(${accentHue}, 45%, 88%, ${(1 - s.z).toFixed(2)})`;
          ctx.beginPath();
          ctx.arc(sx, sy, size, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        // Editorial: clean atmospheric glow pulse behind kinetic words
        const r = Math.min(w, h) * (0.45 + bass * 0.16);
        const g = ctx.createRadialGradient(cx, cy, 10, cx, cy, r);
        g.addColorStop(0, `hsla(${accentHue}, 70%, 50%, 0.18)`);
        g.addColorStop(1, "rgba(8, 9, 14, 0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }

      ctx.restore();
      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [styleMode, playback.isPlaying, visualizerEnabled]);

  // Compute active synced lyric line
  const activeIdx = (() => {
    if (!lyrics || lyrics.synced.length === 0) return -1;
    let idx = -1;
    for (let i = 0; i < lyrics.synced.length; i++) {
      if (lyrics.synced[i].timeMs <= playback.positionMs + 180) idx = i;
      else break;
    }
    return idx;
  })();

  const prevLine = activeIdx > 0 ? lyrics?.synced[activeIdx - 1]?.text : "";
  const activeLine = activeIdx >= 0 ? lyrics?.synced[activeIdx]?.text : "";
  const nextLine = activeIdx >= 0 ? lyrics?.synced[activeIdx + 1]?.text : lyrics?.synced[0]?.text || "";
  const words = (activeLine || "").split(/\s+/).filter(Boolean);
  const durMs = playback.durationMs || (track ? track.durationSecs * 1000 : 0);

  return (
    <div className="kinetic-stage-overlay" onMouseMove={bumpHud}>
      {track?.thumbnail && (
        <div
          className="kinetic-art-backdrop"
          style={{ backgroundImage: `url(${track.thumbnail})` }}
          aria-hidden="true"
        />
      )}

      <canvas ref={canvasRef} className="kinetic-canvas" />

      {/* Top HUD (auto-hides when idle) */}
      <div className={`kinetic-hud-top ${hudVisible ? "visible" : "hidden"}`}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {track?.thumbnail ? (
            <img src={track.thumbnail} alt="" className="kinetic-mini-art" />
          ) : (
            <div className="kinetic-mini-art">
              <Disc3 size={16} style={{ opacity: 0.6 }} />
            </div>
          )}
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>{track?.title || "Nothing playing"}</div>
            <div style={{ fontSize: 11.5, color: "rgba(244,244,245,0.68)" }}>{track?.artist || "Kinetic Stage"}</div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {(
            [
              ["silk", "Liquid Silk"],
              ["rings", "Pulse Rings"],
              ["starfield", "Starfield"],
              ["editorial", "Editorial"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              className={`glass-pill ${styleMode === id ? "active" : ""}`}
              style={{ padding: "5px 10px", fontSize: 12 }}
              onClick={() => setStyleMode(id)}
            >
              {label}
            </button>
          ))}

          <button
            className={`glass-pill ${visualizerEnabled ? "active" : ""}`}
            style={{ padding: "5px 10px", fontSize: 12 }}
            onClick={onToggleVisualizer}
            title="Use live pure-Rust FFT audio spectrum for beat kicks"
          >
            <Activity size={13} /> Beat sync {visualizerEnabled ? "On" : "Off"}
          </button>

          <button
            className="glass-pill"
            style={{ padding: "5px 10px", fontSize: 12 }}
            onClick={onDisable}
            title="Turn off Kinetic Video Stage (Esc)"
          >
            <Power size={13} /> Turn Off
          </button>
        </div>
      </div>

      {/* Center Kinetic Typography Stage */}
      <div className="kinetic-center">
        {words.length > 0 ? (
          <div className="kinetic-lyrics-stack">
            {prevLine && <div className="kinetic-line-ghost prev">{prevLine}</div>}
            <div
              key={`${track?.videoId}-${activeIdx}`}
              className="kinetic-line-active"
              style={{
                transform: `scale(${(1 + bassKick * 0.085).toFixed(3)})`,
              }}
            >
              {words.map((word, idx) => (
                <span
                  key={`${activeIdx}-${idx}`}
                  className="kinetic-word"
                  style={{ animationDelay: `${Math.min(idx * 42, 340)}ms` }}
                >
                  {word}
                </span>
              ))}
            </div>
            {nextLine && <div className="kinetic-line-ghost next">{nextLine}</div>}
          </div>
        ) : (
          <div
            className="kinetic-fallback-showcase"
            style={{ transform: `scale(${(1 + bassKick * 0.06).toFixed(3)})` }}
          >
            {track?.thumbnail && (
              <img src={track.thumbnail} alt="" className="kinetic-hero-art" />
            )}
            <div className="kinetic-hero-title">{track?.title || "Play any song"}</div>
            <div className="kinetic-hero-artist">
              {track?.artist || "Synced lyrics & kinetic visuals activate automatically"}
            </div>
            <div style={{ marginTop: 10, fontSize: 12, color: "rgba(244,244,245,0.5)", display: "flex", alignItems: "center", gap: 6 }}>
              <Sparkles size={13} /> Kinetic Stage Active
            </div>
          </div>
        )}
      </div>

      {/* Bottom Transport HUD */}
      <div className={`kinetic-hud-bottom ${hudVisible ? "visible" : "hidden"}`}>
        <span style={{ fontSize: 12, color: "rgba(244,244,245,0.7)", fontVariantNumeric: "tabular-nums" }}>
          {formatTime(playback.positionMs)} / {formatTime(durMs)}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button className="icon-btn" onClick={onPrev} title="Previous">
            <SkipBack size={18} />
          </button>
          <button className="play-main-btn" onClick={onTogglePlay} title={playback.isPlaying ? "Pause" : "Play"}>
            {playback.isLoading ? (
              <Loader2 size={18} className="spin" />
            ) : playback.isPlaying ? (
              <Pause size={18} />
            ) : (
              <Play size={18} style={{ marginLeft: 2 }} />
            )}
          </button>
          <button className="icon-btn" onClick={onNext} title="Next">
            <SkipForward size={18} />
          </button>
        </div>
      </div>
    </div>
  );
};
