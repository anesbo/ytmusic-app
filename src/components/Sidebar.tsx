import React from "react";
import {
  BarChart3,
  Compass,
  Download,
  Heart,
  Home,
  Library,
  ListMusic,
  Plus,
  Radio,
  Settings,
  Sparkles,
} from "lucide-react";
import type { LocalPlaylistSummary, Route, ShelfItem } from "../types";

interface SidebarProps {
  route: Route;
  rail: boolean;
  galaxyEnabled: boolean;
  hiddenItems: string[];
  remotePlaylists: ShelfItem[];
  localPlaylists: LocalPlaylistSummary[];
  activeDownloadsCount: number;
  onNavigate: (route: Route) => void;
  onOpenCreatePlaylist: () => void;
}

export const Sidebar: React.FC<SidebarProps> = React.memo(({
  route,
  rail,
  galaxyEnabled,
  hiddenItems,
  remotePlaylists,
  localPlaylists,
  activeDownloadsCount,
  onNavigate,
  onOpenCreatePlaylist,
}) => {
  const isHidden = (k: string) => hiddenItems.includes(k);
  const allNavItems: Array<{
    key: Route["page"];
    label: string;
    icon: React.ReactNode;
    badge?: number;
  }> = [
    { key: "home", label: "Home", icon: <Home size={18} /> },
    { key: "explore", label: "Explore", icon: <Compass size={18} /> },
    { key: "radio", label: "Live Radio", icon: <Radio size={18} /> },
    ...(galaxyEnabled ? [{ key: "galaxy" as const, label: "Music Galaxy", icon: <Sparkles size={18} /> }] : []),
    { key: "library", label: "Library", icon: <Library size={18} /> },
    { key: "stats", label: "Stats", icon: <BarChart3 size={18} /> },
    {
      key: "downloads",
      label: "Downloads",
      icon: <Download size={18} />,
      badge: activeDownloadsCount > 0 ? activeDownloadsCount : undefined,
    },
    { key: "settings", label: "Settings", icon: <Settings size={18} /> },
  ];
  const navItems = allNavItems.filter(
    (item) => item.key === "home" || item.key === "settings" || !isHidden(item.key)
  );

  return (
    <aside className={`sidebar glass-panel ${rail ? "rail" : ""}`}>
      {navItems.map((item) => (
        <button
          key={item.key}
          className={`nav-item ${route.page === item.key ? "active" : ""}`}
          onClick={() => onNavigate({ page: item.key } as Route)}
          title={item.label}
        >
          {item.icon}
          {!rail && <span style={{ flex: 1 }}>{item.label}</span>}
          {!rail && item.badge !== undefined && (
            <span className="badge hires">{item.badge}</span>
          )}
        </button>
      ))}

      <div className="sidebar-divider" />

      <button
        className={`nav-item ${
          route.page === "playlist" && route.id === "LM" ? "active" : ""
        }`}
        onClick={() => onNavigate({ page: "playlist", id: "LM", isLocal: false })}
        title="Liked Music"
      >
        <Heart size={18} style={{ color: "var(--accent)" }} />
        {!rail && <span>Liked Music</span>}
      </button>

      {!rail && !isHidden("playlists") && (
        <>
          <div className="sidebar-section-header" style={{ marginTop: 8 }}>
            <span>Playlists</span>
            <button
              className="icon-btn"
              style={{ width: 24, height: 24 }}
              onClick={onOpenCreatePlaylist}
              title="New Playlist"
            >
              <Plus size={14} />
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {localPlaylists.map((pl) => (
              <button
                key={pl.id}
                className="sidebar-playlist-item"
                onClick={() =>
                  onNavigate({ page: "playlist", id: pl.id, isLocal: true })
                }
              >
                {pl.thumbnail ? (
                  <img
                    src={pl.thumbnail}
                    alt=""
                    className="sidebar-playlist-thumb"
                  />
                ) : (
                  <div className="sidebar-playlist-thumb">
                    <ListMusic size={14} style={{ opacity: 0.6 }} />
                  </div>
                )}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="media-title" style={{ fontSize: 13 }}>
                    {pl.title}
                  </div>
                  <div className="media-subtitle" style={{ fontSize: 11 }}>
                    Local • {pl.trackCount} songs
                  </div>
                </div>
              </button>
            ))}

            {remotePlaylists.map((pl) => (
              <button
                key={pl.id}
                className="sidebar-playlist-item"
                onClick={() =>
                  onNavigate({ page: "playlist", id: pl.id, isLocal: false })
                }
              >
                {pl.thumbnail ? (
                  <img
                    src={pl.thumbnail}
                    alt=""
                    className="sidebar-playlist-thumb"
                  />
                ) : (
                  <div className="sidebar-playlist-thumb">
                    <ListMusic size={14} style={{ opacity: 0.6 }} />
                  </div>
                )}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="media-title" style={{ fontSize: 13 }}>
                    {pl.title}
                  </div>
                  <div className="media-subtitle" style={{ fontSize: 11 }}>
                    {pl.subtitle || "YouTube Music"}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </aside>
  );
});
