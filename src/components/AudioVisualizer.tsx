import React, { useEffect, useRef } from "react";
import { api } from "../api";

interface AudioVisualizerProps {
  enabled: boolean;
  isPlaying: boolean;
  variant?: "full" | "mini";
}

export const AudioVisualizer: React.FC<AudioVisualizerProps> = ({
  enabled,
  isPlaying,
  variant = "full",
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const barsRef = useRef<number[]>(new Array(32).fill(0));
  const smoothRef = useRef<number[]>(new Array(32).fill(0));

  useEffect(() => {
    if (!enabled) return;
    let unlisten: (() => void) | undefined;
    api
      .onAudioSpectrum((bars) => {
        if (bars && bars.length > 0) {
          barsRef.current = bars;
        }
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});
    return () => {
      unlisten?.();
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    let rafId = 0;
    const render = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          const w = canvas.width;
          const h = canvas.height;
          ctx.clearRect(0, 0, w, h);

          const accent =
            getComputedStyle(document.documentElement)
              .getPropertyValue("--accent")
              .trim() || "#e11d48";

          const barCount = variant === "mini" ? 16 : 32;
          const step = Math.floor(32 / barCount);
          const gap = variant === "mini" ? 2 : 3;
          const barW = Math.max(2, (w - gap * (barCount - 1)) / barCount);

          ctx.fillStyle = accent;
          for (let i = 0; i < barCount; i++) {
            const raw = isPlaying ? barsRef.current[i * step] ?? 0 : 0;
            const prev = smoothRef.current[i] ?? 0;
            const next = raw > prev ? prev * 0.4 + raw * 0.6 : prev * 0.8 + raw * 0.2;
            smoothRef.current[i] = next;

            const barH = Math.max(2, next * (h - 2));
            const x = i * (barW + gap);
            const y = h - barH;
            ctx.globalAlpha = 0.35 + Math.min(0.65, next * 0.75);
            ctx.beginPath();
            ctx.roundRect(x, y, barW, barH, Math.min(3, barW / 2));
            ctx.fill();
          }
          ctx.globalAlpha = 1;
        }
      }
      rafId = requestAnimationFrame(render);
    };
    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, [enabled, isPlaying, variant]);

  if (!enabled) return null;

  return (
    <canvas
      ref={canvasRef}
      width={variant === "mini" ? 68 : 340}
      height={variant === "mini" ? 20 : 48}
      className={variant === "mini" ? "visualizer-mini" : "visualizer-full"}
      aria-hidden="true"
    />
  );
};
