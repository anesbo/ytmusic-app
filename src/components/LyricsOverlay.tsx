import React, { useEffect, useState } from "react";
import { Lock, Minus, Plus, Unlock, X } from "lucide-react";
import { api } from "../api";

export const LyricsOverlay: React.FC = () => {
  const [title, setTitle] = useState("LiquidYTM Lyrics");
  const [artist, setArtist] = useState("Waiting for synced lyrics...");
  const [activeLine, setActiveLine] = useState("♪");
  const [nextLine, setNextLine] = useState("");
  const [fontSize, setFontSize] = useState(20);
  const [clickthrough, setClickthrough] = useState(false);

  useEffect(() => {
    document.body.style.background = "transparent";
    document.documentElement.style.background = "transparent";
    let unlisten: (() => void) | undefined;
    api
      .onLyricsSync((p) => {
        setTitle(p.title || "LiquidYTM");
        setArtist(p.artist || "");
        setActiveLine(p.activeLine || "♪");
        setNextLine(p.nextLine || "");
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});
    return () => {
      unlisten?.();
    };
  }, []);

  const toggleClickthrough = async () => {
    const next = !clickthrough;
    setClickthrough(next);
    try {
      await api.setLyricsClickthrough(next);
    } catch {
      setClickthrough(!next);
    }
  };

  return (
    <div className="lyrics-overlay-shell">
      <div className="lyrics-overlay-header" data-tauri-drag-region>
        <div className="lyrics-overlay-meta" data-tauri-drag-region>
          <span>{title}</span>
          {artist && <span className="lyrics-overlay-artist">· {artist}</span>}
        </div>
        <div className="lyrics-overlay-controls">
          <button
            className="icon-btn"
            style={{ width: 22, height: 22 }}
            onClick={() => setFontSize((s) => Math.max(14, s - 2))}
            title="Smaller text"
          >
            <Minus size={12} />
          </button>
          <button
            className="icon-btn"
            style={{ width: 22, height: 22 }}
            onClick={() => setFontSize((s) => Math.min(32, s + 2))}
            title="Larger text"
          >
            <Plus size={12} />
          </button>
          <button
            className={`icon-btn ${clickthrough ? "active" : ""}`}
            style={{ width: 22, height: 22 }}
            onClick={toggleClickthrough}
            title={clickthrough ? "Unlock clicks" : "Lock click-through"}
          >
            {clickthrough ? <Lock size={12} /> : <Unlock size={12} />}
          </button>
          <button
            className="icon-btn"
            style={{ width: 22, height: 22 }}
            onClick={() => api.closeLyricsOverlay().catch(() => {})}
            title="Close floating lyrics"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      <div className="lyrics-overlay-body" data-tauri-drag-region>
        <div className="lyrics-overlay-active" style={{ fontSize }}>
          {activeLine}
        </div>
        {nextLine && (
          <div className="lyrics-overlay-next" style={{ fontSize: Math.max(12, fontSize - 5) }}>
            {nextLine}
          </div>
        )}
      </div>
    </div>
  );
};
