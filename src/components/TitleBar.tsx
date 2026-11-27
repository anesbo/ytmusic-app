import React, { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ArrowLeft,
  ArrowRight,
  Crown,
  FileText,
  Maximize2,
  Minimize2,
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  User,
  WifiOff,
  X,
} from "lucide-react";
import { api } from "../api";
import type { AccountInfo, Route } from "../types";

interface TitleBarProps {
  account: AccountInfo;
  offlineMode: boolean;
  miniPlayer: boolean;
  zenMode: boolean;
  searchMode: string;
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onNavigate: (route: Route) => void;
  onToggleMiniPlayer: () => void;
  onToggleZenMode: () => void;
  onOpenCommandPalette: () => void;
}

export const TitleBar: React.FC<TitleBarProps> = ({
  account,
  offlineMode,
  miniPlayer,
  zenMode,
  searchMode,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  onNavigate,
  onToggleMiniPlayer,
  onToggleZenMode,
  onOpenCommandPalette,
}) => {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSug, setShowSug] = useState(false);
  const [searchExpanded, setSearchExpanded] = useState(false);
  const debounceRef = useRef<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setShowSug(false);
        if (!query.trim()) setSearchExpanded(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [query]);

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
          title="Home"
        >
          <div className="brand-orb brand-logo-mark">
            <svg width="24" height="24" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <defs>
                <linearGradient id="lytmBg" x1="8" y1="4" x2="56" y2="60" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#1b1428" />
                  <stop offset="55%" stopColor="#0f111a" />
                  <stop offset="100%" stopColor="#160c18" />
                </linearGradient>
                <linearGradient id="lytmAccent" x1="14" y1="12" x2="52" y2="52" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#ff4d6d" />
                  <stop offset="50%" stopColor="#e11d48" />
                  <stop offset="100%" stopColor="#fb7185" />
                </linearGradient>
                <linearGradient id="lytmRim" x1="0" y1="0" x2="0" y2="64" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="rgba(255,255,255,0.38)" />
                  <stop offset="100%" stopColor="rgba(255,255,255,0.05)" />
                </linearGradient>
              </defs>
              <rect x="2" y="2" width="60" height="60" rx="16" fill="url(#lytmBg)" stroke="url(#lytmRim)" strokeWidth="2" />
              <circle cx="32" cy="32" r="20" stroke="url(#lytmAccent)" strokeWidth="2.8" strokeOpacity="0.35" />
              <path d="M24 21.5C24 19.6 26.1 18.4 27.7 19.4L44.8 29.9C46.4 30.9 46.4 33.1 44.8 34.1L27.7 44.6C26.1 45.6 24 44.4 24 42.5V21.5Z" fill="url(#lytmAccent)" />
              <path d="M27.5 24.5L39 31.6C39.6 32 39.6 32.8 39 33.2L27.5 40.2V24.5Z" fill="#ffffff" fillOpacity="0.18" />
              <rect x="48.5" y="25" width="3.2" height="14" rx="1.6" fill="#fda4af" />
              <rect x="12.3" y="27" width="3.2" height="10" rx="1.6" fill="#fda4af" fillOpacity="0.85" />
            </svg>
          </div>
          <span>LiquidYTM</span>
        </div>

        <div style={{ display: "flex", gap: 4, marginLeft: 8 }}>
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
          {!miniPlayer && (
            <button
              className={`icon-btn ${zenMode ? "active" : ""}`}
              onClick={onToggleZenMode}
              title={zenMode ? "Exit Zen Mode (Show sidebar)" : "Zen Mode (Hide sidebar)"}
            >
              {zenMode ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
            </button>
          )}
        </div>
      </div>

      <div className={`search-wrap ${searchMode === "compact" && !searchExpanded ? "compact-collapsed" : ""}`} ref={wrapRef}>
        {searchMode === "compact" && !searchExpanded ? (
          <button
            className="glass-pill compact-search-trigger"
            onClick={() => {
              setSearchExpanded(true);
              window.setTimeout(() => inputRef.current?.focus(), 40);
            }}
            title="Search (or press Ctrl+K)"
          >
            <Search size={14} />
            <span>Search</span>
            <span className="search-kbd">Ctrl+K</span>
          </button>
        ) : (
          <form
            className="search-input-box"
            onSubmit={(e) => {
              e.preventDefault();
              submitSearch(query);
            }}
          >
            <Search size={15} style={{ opacity: 0.65, flexShrink: 0 }} />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              onFocus={() => suggestions.length > 0 && setShowSug(true)}
              placeholder="Search songs, albums, artists..."
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
              title="Command palette"
            >
              Ctrl+K
            </span>
          </form>
        )}

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
          <span className="badge" style={{ color: "#f59e0b" }}>
            <WifiOff size={12} /> Offline
          </span>
        )}

        <button
          className="glass-pill"
          style={{ padding: "5px 11px", fontSize: 12.5 }}
          onClick={() => onNavigate({ page: "settings", tab: "account" })}
          title={account.loggedIn ? "Account" : "Sign in"}
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
          <span>{account.loggedIn ? account.name || "Signed in" : "Sign in"}</span>
          {account.isPremium && <Crown size={12} style={{ color: "#f59e0b" }} />}
        </button>

        <button
          className="icon-btn"
          onClick={() => onNavigate({ page: "settings", tab: "logs" })}
          title="Diagnostic logs"
        >
          <FileText size={15} />
        </button>

        <button
          className={`icon-btn ${miniPlayer ? "active" : ""}`}
          onClick={onToggleMiniPlayer}
          title={miniPlayer ? "Exit mini player" : "Mini player"}
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
