import React, { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ArrowLeft,
  ArrowRight,
  Disc3,
  FileText,
  Minimize2,
  Maximize2,
  Minus,
  Search,
  Sparkles,
  User,
  WifiOff,
  X,
  Crown,
} from "lucide-react";
import { api } from "../api";
import type { AccountInfo, Route } from "../types";

interface TitleBarProps {
  account: AccountInfo;
  offlineMode: boolean;
  liquidGlassEnabled: boolean;
  miniPlayer: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onNavigate: (route: Route) => void;
  onToggleLiquidGlass: () => void;
  onToggleMiniPlayer: () => void;
  onOpenCommandPalette: () => void;
}

export const TitleBar: React.FC<TitleBarProps> = ({
  account,
  offlineMode,
  liquidGlassEnabled,
  miniPlayer,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  onNavigate,
  onToggleLiquidGlass,
  onToggleMiniPlayer,
  onOpenCommandPalette,
}) => {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSug, setShowSug] = useState(false);
  const debounceRef = useRef<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setShowSug(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const handleQueryChange = (val: string) => {
    setQuery(val);
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (!val.trim() || offlineMode) {
      setSuggestions([]);
      return;
    }
    debounceRef.current = window.setTimeout(async () => {
      try {
        const res = await api.searchSuggestions(val);
        setSuggestions(res);
        setShowSug(res.length > 0);
      } catch {
        setSuggestions([]);
      }
    }, 220);
  };

  const submitSearch = (q: string) => {
    const clean = q.trim();
    if (!clean) return;
    setQuery(clean);
    setShowSug(false);
    onNavigate({ page: "search", query: clean, filter: "all" });
  };

  const win = (() => {
    try {
      return getCurrentWindow();
    } catch {
      return null;
    }
  })();

  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="titlebar-left" data-tauri-drag-region>
        <div
          className="brand-mark"
          onClick={() => onNavigate({ page: "home" })}
          title="LiquidYTM Home"
        >
          <div className="brand-orb">
            <Disc3 size={16} />
          </div>
          <span>LiquidYTM</span>
        </div>

        <div style={{ display: "flex", gap: 2, marginLeft: 8 }}>
          <button
            className="icon-btn"
            onClick={onBack}
            disabled={!canGoBack}
            style={{ opacity: canGoBack ? 1 : 0.35 }}
            title="Back"
          >
            <ArrowLeft size={16} />
          </button>
          <button
            className="icon-btn"
            onClick={onForward}
            disabled={!canGoForward}
            style={{ opacity: canGoForward ? 1 : 0.35 }}
            title="Forward"
          >
            <ArrowRight size={16} />
          </button>
        </div>
      </div>

      <div className="search-wrap" ref={wrapRef}>
        <form
          className="search-input-box"
          onSubmit={(e) => {
            e.preventDefault();
            submitSearch(query);
          }}
        >
          <Search size={15} style={{ opacity: 0.65, flexShrink: 0 }} />
          <input
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            onFocus={() => suggestions.length > 0 && setShowSug(true)}
            placeholder="Search songs, albums, artists, lyrics..."
          />
          {query && (
            <button
              type="button"
              className="icon-btn"
              style={{ width: 22, height: 22 }}
              onClick={() => {
                setQuery("");
                setSuggestions([]);
              }}
            >
              <X size={13} />
            </button>
          )}
          <span
            className="search-kbd"
            style={{ cursor: "pointer" }}
            onClick={onOpenCommandPalette}
            title="Command Palette"
          >
            Ctrl+K
          </span>
        </form>

        {showSug && suggestions.length > 0 && (
          <div className="suggestions-dropdown glass-panel">
            {suggestions.map((s) => (
              <button
                key={s}
                className="suggestion-item"
                onClick={() => submitSearch(s)}
              >
                <Search size={14} style={{ opacity: 0.55 }} />
                <span>{s}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="titlebar-right">
        {offlineMode && (
          <span className="badge" style={{ color: "#ffb86c", borderColor: "rgba(255,184,108,0.4)" }}>
            <WifiOff size={12} /> Offline
          </span>
        )}

        <button
          className="glass-pill"
          style={{ padding: "5px 11px", fontSize: 12.5 }}
          onClick={() => onNavigate({ page: "settings", tab: "account" })}
          title={account.loggedIn ? "YouTube Music Account" : "Sign in to YouTube Music"}
        >
          {account.avatarUrl ? (
            <img
              src={account.avatarUrl}
              alt=""
              style={{ width: 20, height: 20, borderRadius: "50%", objectFit: "cover" }}
            />
          ) : (
            <User size={14} />
          )}
          <span>{account.loggedIn ? account.name || "Signed In" : "Sign In"}</span>
          {account.isPremium && <Crown size={12} style={{ color: "#ffd978" }} />}
        </button>

        <button
          className={`icon-btn ${liquidGlassEnabled ? "active" : ""}`}
          onClick={onToggleLiquidGlass}
          title={
            liquidGlassEnabled
              ? "Liquid Glass ON (click to turn OFF for max speed)"
              : "Liquid Glass OFF / Performance Mode (click to turn ON)"
          }
        >
          <Sparkles size={15} />
        </button>

        <button
          className="icon-btn"
          onClick={() => onNavigate({ page: "settings", tab: "logs" })}
          title="Diagnostic Logs & Export"
        >
          <FileText size={15} />
        </button>

        <button
          className={`icon-btn ${miniPlayer ? "active" : ""}`}
          onClick={onToggleMiniPlayer}
          title={miniPlayer ? "Exit Mini Player" : "Floating Mini Player"}
        >
          <Minimize2 size={15} />
        </button>

        <div className="window-controls">
          <button
            className="win-btn"
            onClick={() => win?.minimize()}
            title="Minimize"
          >
            <Minus size={14} />
          </button>
          <button
            className="win-btn"
            onClick={() => win?.toggleMaximize()}
            title="Maximize"
          >
            <Maximize2 size={13} />
          </button>
          <button
            className="win-btn close"
            onClick={() => win?.close()}
            title="Close"
          >
            <X size={15} />
          </button>
        </div>
      </div>
    </header>
  );
};
