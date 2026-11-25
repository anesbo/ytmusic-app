import React, { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Crown,
  Disc3,
  FileText,
  Maximize2,
  Minimize2,
  Minus,
  Palette,
  Search,
  Sliders,
  Sparkles,
  User,
  WifiOff,
  X,
} from "lucide-react";
import { api } from "../api";
import { COLOR_PRESETS, type AccountInfo, type ColorPreset, type GlassSettings, type Route } from "../types";

interface TitleBarProps {
  account: AccountInfo;
  offlineMode: boolean;
  glass: GlassSettings;
  miniPlayer: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onNavigate: (route: Route) => void;
  onToggleLiquidGlass: () => void;
  onSelectThemePreset: (preset: ColorPreset) => void;
  onToggleMiniPlayer: () => void;
  onOpenCommandPalette: () => void;
}

export const TitleBar: React.FC<TitleBarProps> = ({
  account,
  offlineMode,
  glass,
  miniPlayer,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  onNavigate,
  onToggleLiquidGlass,
  onSelectThemePreset,
  onToggleMiniPlayer,
  onOpenCommandPalette,
}) => {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSug, setShowSug] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const debounceRef = useRef<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const appearanceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setShowSug(false);
      }
      if (appearanceRef.current && !appearanceRef.current.contains(e.target as Node)) {
        setAppearanceOpen(false);
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

  const isPresetActive = (p: ColorPreset) => {
    if (p.accentAuto) {
      return glass.themeMode === "adaptive" && glass.accentAuto;
    }
    return (
      glass.customColorsEnabled &&
      glass.bgColor.toLowerCase() === p.bgColor.toLowerCase() &&
      glass.accentColor.toLowerCase() === p.accentColor.toLowerCase()
    );
  };

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
          <span className="badge" style={{ color: "#f59e0b" }}>
            <WifiOff size={12} /> Offline
          </span>
        )}

        {/* Unified Appearance Button (Themes + Liquid Glass Toggle in One Place) */}
        <div className="sort-menu-wrap" ref={appearanceRef}>
          <button
            className={`glass-pill ${appearanceOpen ? "active" : ""}`}
            style={{ padding: "5px 11px", fontSize: 12.5 }}
            onClick={() => setAppearanceOpen((o) => !o)}
            title="Appearance, Themes & Liquid Glass"
          >
            <Palette size={14} />
            <span>Appearance</span>
          </button>

          {appearanceOpen && (
            <div className="appearance-popover">
              <div className="setting-row" style={{ padding: "4px 4px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Sparkles size={15} style={{ color: "var(--accent)" }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>Liquid Glass</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      {glass.liquidGlassEnabled ? "Frosted translucency on" : "Solid performance mode"}
                    </div>
                  </div>
                </div>
                <button
                  className={`toggle-switch ${glass.liquidGlassEnabled ? "on" : ""}`}
                  onClick={onToggleLiquidGlass}
                >
                  <span className="toggle-knob" />
                </button>
              </div>

              <div className="sort-popover-divider" style={{ margin: "2px 0" }} />

              <div style={{ fontSize: 11, fontWeight: 500, color: "var(--text-muted)", padding: "0 4px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Themes ({COLOR_PRESETS.length})
              </div>

              <div className="appearance-theme-grid">
                {COLOR_PRESETS.map((preset) => {
                  const active = isPresetActive(preset);
                  return (
                    <button
                      key={preset.name}
                      className={`appearance-theme-btn ${active ? "active" : ""}`}
                      onClick={() => onSelectThemePreset(preset)}
                    >
                      <span className="color-dots">
                        <span className="color-dot" style={{ background: preset.bgColor }} />
                        <span className="color-dot" style={{ background: preset.accentColor }} />
                      </span>
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {preset.name}
                      </span>
                      {active && <Check size={13} style={{ color: "var(--accent)", flexShrink: 0 }} />}
                    </button>
                  );
                })}
              </div>

              <div className="sort-popover-divider" style={{ margin: "2px 0" }} />

              <button
                className="sort-popover-item"
                style={{ padding: "8px 10px", fontSize: 12.5 }}
                onClick={() => {
                  setAppearanceOpen(false);
                  onNavigate({ page: "settings", tab: "appearance" });
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Sliders size={14} /> Custom colors & blur sliders
                </span>
              </button>
            </div>
          )}
        </div>

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
          <span>{account.loggedIn ? account.name || "Signed in" : "Sign in"}</span>
          {account.isPremium && <Crown size={12} style={{ color: "#f59e0b" }} />}
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
