import React, { useEffect, useRef, useState } from "react";
import {
  Compass,
  Download,
  Heart,
  Home,
  Library,
  Search,
  Settings,
  Sliders,
  WifiOff,
} from "lucide-react";
import type { Route } from "../types";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onNavigate: (route: Route) => void;
  onToggleOffline: () => void;
  onToggleEq: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  open,
  onClose,
  onNavigate,
  onToggleOffline,
  onToggleEq,
}) => {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setInput("");
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  if (!open) return null;

  const actions = [
    { label: "Go to Home", icon: <Home size={15} />, run: () => onNavigate({ page: "home" }) },
    { label: "Go to Explore & Charts", icon: <Compass size={15} />, run: () => onNavigate({ page: "explore" }) },
    { label: "Go to Library", icon: <Library size={15} />, run: () => onNavigate({ page: "library" }) },
    { label: "Open Liked Music", icon: <Heart size={15} />, run: () => onNavigate({ page: "playlist", id: "LM" }) },
    { label: "Open Download Manager", icon: <Download size={15} />, run: () => onNavigate({ page: "downloads" }) },
    { label: "Liquid Glass Appearance Settings", icon: <Settings size={15} />, run: () => onNavigate({ page: "settings", tab: "appearance" }) },
    { label: "Audio Engine & 10-Band Equalizer", icon: <Sliders size={15} />, run: () => onNavigate({ page: "settings", tab: "audio" }) },
    { label: "Toggle 10-Band Equalizer On/Off", icon: <Sliders size={15} />, run: onToggleEq },
    { label: "Toggle Offline Mode", icon: <WifiOff size={15} />, run: onToggleOffline },
  ].filter((a) => !input.trim() || a.label.toLowerCase().includes(input.toLowerCase()));

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="glass-panel"
        style={{ width: "min(560px, 92vw)", padding: 14 }}
        onClick={(e) => e.stopPropagation()}
      >
        <form
          className="search-input-box"
          style={{ marginBottom: 10 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (input.trim()) {
              onNavigate({ page: "search", query: input.trim(), filter: "all" });
              onClose();
            }
          }}
        >
          <Search size={16} style={{ opacity: 0.7 }} />
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Search YouTube Music or run a command..."
          />
        </form>

        <div style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 340, overflowY: "auto" }}>
          {input.trim() && (
            <button
              className="suggestion-item"
              onClick={() => {
                onNavigate({ page: "search", query: input.trim(), filter: "all" });
                onClose();
              }}
            >
              <Search size={15} style={{ color: "var(--accent)" }} />
              <span>
                Search YouTube Music for <strong>"{input.trim()}"</strong>
              </span>
            </button>
          )}
          {actions.map((a) => (
            <button
              key={a.label}
              className="suggestion-item"
              onClick={() => {
                a.run();
                onClose();
              }}
            >
              {a.icon}
              <span>{a.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
