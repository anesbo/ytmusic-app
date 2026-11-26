import React, { useEffect, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { Copy, Download, Sparkles, X } from "lucide-react";
import { api } from "../api";
import type { Track } from "../types";

interface LyricCardModalProps {
  track: Track | null;
  initialLines: string[];
  allLines: string[];
  onClose: () => void;
  onToast: (msg: string) => void;
}

type CardLayout = "minimal_glass" | "editorial" | "vinyl_sleeve" | "story";

const CARD_PALETTES = [
  { id: "obsidian", label: "Obsidian Rose", bg1: "#140b12", bg2: "#0b0d14", accent: "#e11d48", text: "#fafafa", sub: "#a1a1aa" },
  { id: "midnight", label: "Midnight Blue", bg1: "#0d1b36", bg2: "#090d1a", accent: "#3b82f6", text: "#f1f5f9", sub: "#94a3b8" },
  { id: "espresso", label: "Warm Espresso", bg1: "#261910", bg2: "#100c09", accent: "#f59e0b", text: "#fef3c7", sub: "#b8a693" },
  { id: "emerald", label: "Forest Emerald", bg1: "#0c221b", bg2: "#080f0d", accent: "#10b981", text: "#ecfdf5", sub: "#8cb0a2" },
  { id: "paper", label: "Editorial Paper", bg1: "#f5f1e8", bg2: "#e8e2d5", accent: "#b45309", text: "#18181b", sub: "#57534e" },
];

export const LyricCardModal: React.FC<LyricCardModalProps> = ({
  track,
  initialLines,
  allLines,
  onClose,
  onToast,
}) => {
  const [quoteText, setQuoteText] = useState(
    initialLines.length > 0 ? initialLines.join("\n") : track ? `"${track.title}"` : ""
  );
  const [layout, setLayout] = useState<CardLayout>("minimal_glass");
  const [paletteId, setPaletteId] = useState("obsidian");
  const [filmGrain, setFilmGrain] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (initialLines.length > 0) {
      setQuoteText(initialLines.join("\n"));
    } else if (track) {
      setQuoteText(track.title);
    }
  }, [track, initialLines]);

  const palette = CARD_PALETTES.find((p) => p.id === paletteId) || CARD_PALETTES[0];

  useEffect(() => {
    if (!track || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const isStory = layout === "story";
    const W = 900;
    const H = isStory ? 1400 : 900;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const drawPoster = (img?: HTMLImageElement) => {
      // Background gradient
      const grad = ctx.createLinearGradient(0, 0, W, H);
      grad.addColorStop(0, palette.bg1);
      grad.addColorStop(1, palette.bg2);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);

      // Soft ambient glow
      const glow = ctx.createRadialGradient(W * 0.25, H * 0.2, 40, W * 0.5, H * 0.45, W * 0.85);
      glow.addColorStop(0, `${palette.accent}44`);
      glow.addColorStop(1, "transparent");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);

      // Optional subtle glass container
      const pad = 74;
      if (layout === "minimal_glass" || layout === "story") {
        ctx.fillStyle = palette.id === "paper" ? "rgba(255,255,255,0.65)" : "rgba(255,255,255,0.06)";
        ctx.strokeStyle = palette.id === "paper" ? "rgba(0,0,0,0.10)" : "rgba(255,255,255,0.14)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(pad, pad, W - pad * 2, H - pad * 2, 32);
        ctx.fill();
        ctx.stroke();
      }

      // Header: artwork + track meta
      const innerX = pad + 56;
      const artY = pad + 56;
      const artSize = layout === "vinyl_sleeve" ? 210 : 128;

      if (layout === "vinyl_sleeve") {
        // Draw sleek dark vinyl record peeking right behind sleeve
        ctx.save();
        ctx.beginPath();
        ctx.arc(innerX + artSize + 52, artY + artSize / 2, artSize * 0.46, 0, Math.PI * 2);
        ctx.fillStyle = "#111216";
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.12)";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(innerX + artSize + 52, artY + artSize / 2, 24, 0, Math.PI * 2);
        ctx.fillStyle = palette.accent;
        ctx.fill();
        ctx.restore();
      }

      if (img) {
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(innerX, artY, artSize, artSize, 18);
        ctx.clip();
        ctx.drawImage(img, innerX, artY, artSize, artSize);
        ctx.restore();
      } else {
        ctx.fillStyle = `${palette.accent}33`;
        ctx.beginPath();
        ctx.roundRect(innerX, artY, artSize, artSize, 18);
        ctx.fill();
      }

      const metaX = innerX + artSize + (layout === "vinyl_sleeve" ? 132 : 28);
      ctx.fillStyle = palette.text;
      ctx.font = "600 32px Inter, 'Segoe UI', sans-serif";
      ctx.fillText(truncate(track.title, 26), metaX, artY + artSize * 0.44);
      ctx.fillStyle = palette.sub;
      ctx.font = "400 24px Inter, 'Segoe UI', sans-serif";
      ctx.fillText(truncate(track.artist, 32), metaX, artY + artSize * 0.72);

      // Quote lines
      const lines = quoteText
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(0, 6);

      ctx.fillStyle = palette.text;
      const fontSize = lines.length > 4 ? 42 : isStory ? 56 : 48;
      ctx.font =
        layout === "editorial"
          ? `600 ${fontSize}px Georgia, serif`
          : `600 ${fontSize}px Inter, 'Segoe UI', sans-serif`;

      const maxTextW = W - (innerX * 2);
      const wrapped: string[] = [];
      for (const l of lines) {
        const words = l.split(" ");
        let cur = "";
        for (const w of words) {
          const test = cur ? `${cur} ${w}` : w;
          if (ctx.measureText(test).width > maxTextW && cur) {
            wrapped.push(cur);
            cur = w;
          } else {
            cur = test;
          }
        }
        if (cur) wrapped.push(cur);
      }

      const lineH = fontSize * 1.32;
      const blockH = wrapped.length * lineH;
      let startY = Math.max(artY + artSize + 96, (H - blockH) / 2 + fontSize * 0.6);
      for (const wl of wrapped.slice(0, isStory ? 12 : 7)) {
        ctx.fillText(wl, innerX, startY);
        startY += lineH;
      }

      // Subtle footer branding
      ctx.fillStyle = palette.accent;
      ctx.fillRect(innerX, H - pad - 68, 36, 4);
      ctx.fillStyle = palette.sub;
      ctx.font = "500 20px Inter, 'Segoe UI', sans-serif";
      ctx.fillText("LiquidYTM", innerX + 48, H - pad - 59);

      // Optional subtle film grain
      if (filmGrain) {
        const imgData = ctx.getImageData(0, 0, W, H);
        const d = imgData.data;
        let seed = 42;
        for (let i = 0; i < d.length; i += 16) {
          seed = (seed * 1664525 + 1013904223) | 0;
          const n = ((seed >> 24) & 0x1f) - 16;
          d[i] = Math.max(0, Math.min(255, d[i] + n * 0.45));
          d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n * 0.45));
          d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n * 0.45));
        }
        ctx.putImageData(imgData, 0, 0);
      }
    };

    if (track.thumbnail) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => drawPoster(img);
      img.onerror = () => drawPoster();
      img.src = track.thumbnail;
    } else {
      drawPoster();
    }
  }, [track, quoteText, layout, palette, filmGrain]);

  if (!track) return null;

  const handleSave = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const dataUrl = canvas.toDataURL("image/png");
      const chosen = await save({
        defaultPath: `${track.title.replace(/[\\/:*?"<>|]/g, "_")}_lyric_card.png`,
        filters: [{ name: "PNG Image", extensions: ["png"] }],
      });
      if (!chosen) return;
      const saved = await api.savePngDataUrl(dataUrl, track.title, chosen);
      onToast(`Saved lyric card to ${saved}`);
    } catch (e) {
      onToast(`Save failed: ${e}`);
    }
  };

  const handleCopy = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      canvas.toBlob(async (blob) => {
        if (!blob) return;
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        onToast("Lyric card copied to clipboard");
      }, "image/png");
    } catch (e) {
      onToast(`Copy failed: ${e}`);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="glass-panel"
        style={{
          width: "min(860px, 94vw)",
          maxHeight: "90vh",
          overflowY: "auto",
          padding: 20,
          display: "grid",
          gridTemplateColumns: "minmax(260px, 340px) 1fr",
          gap: 20,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left: Live Poster Preview */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <canvas
            ref={canvasRef}
            style={{
              width: "100%",
              maxHeight: 440,
              objectFit: "contain",
              borderRadius: 12,
              border: "1px solid var(--border-color)",
            }}
          />
          <div style={{ display: "flex", gap: 8, width: "100%" }}>
            <button className="glass-pill active" style={{ flex: 1, justifyContent: "center" }} onClick={handleSave}>
              <Download size={14} /> Save PNG
            </button>
            <button className="glass-pill" style={{ flex: 1, justifyContent: "center" }} onClick={handleCopy}>
              <Copy size={14} /> Copy image
            </button>
          </div>
        </div>

        {/* Right: Controls */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ fontSize: 16, display: "flex", alignItems: "center", gap: 6 }}>
              <Sparkles size={15} style={{ color: "var(--accent)" }} /> Lyric card studio
            </h3>
            <button className="icon-btn" onClick={onClose}>
              <X size={16} />
            </button>
          </div>

          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="settings-label">Lyrics / quote (up to 4–6 lines)</span>
            <textarea
              className="glass-textarea"
              rows={4}
              value={quoteText}
              onChange={(e) => setQuoteText(e.target.value)}
            />
          </label>

          {allLines.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span className="settings-desc">Quick-pick lines from this track:</span>
              <div style={{ maxHeight: 110, overflowY: "auto", display: "flex", flexWrap: "wrap", gap: 4 }}>
                {allLines.slice(0, 40).map((ln, idx) => (
                  <button
                    key={idx}
                    className="glass-pill"
                    style={{ padding: "3px 8px", fontSize: 11.5 }}
                    onClick={() =>
                      setQuoteText((prev) => (prev.trim() ? `${prev.trim()}\n${ln}` : ln))
                    }
                  >
                    + {truncate(ln, 34)}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="settings-label">Layout</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {(
                [
                  ["minimal_glass", "Minimal Glass"],
                  ["editorial", "Editorial"],
                  ["vinyl_sleeve", "Vinyl Sleeve"],
                  ["story", "Story 9:16"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  className={`glass-pill ${layout === id ? "active" : ""}`}
                  style={{ padding: "5px 10px", fontSize: 12 }}
                  onClick={() => setLayout(id)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="settings-label">Palette</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {CARD_PALETTES.map((p) => (
                <button
                  key={p.id}
                  className={`appearance-theme-btn ${paletteId === p.id ? "active" : ""}`}
                  style={{ padding: "5px 10px" }}
                  onClick={() => setPaletteId(p.id)}
                >
                  <span className="color-dots">
                    <span className="color-dot" style={{ background: p.bg1 }} />
                    <span className="color-dot" style={{ background: p.accent }} />
                  </span>
                  <span>{p.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="settings-row">
            <span className="settings-label">Subtle film grain</span>
            <button
              className={`toggle-switch ${filmGrain ? "on" : ""}`}
              onClick={() => setFilmGrain((g) => !g)}
            >
              <span className="toggle-knob" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
