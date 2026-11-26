import React, { useEffect, useRef, useState } from "react";
import {
  Copy,
  Download,
  FolderOpen,
  Heart,
  ListEnd,
  ListPlus,
  ListStart,
  Pencil,
  Play,
  Radio,
  User,
  X,
} from "lucide-react";
import type { Track } from "../types";

export interface TrackContextMenuState {
  x: number;
  y: number;
  track: Track;
}

interface TrackContextMenuProps {
  menu: TrackContextMenuState | null;
  onClose: () => void;
  onPlayNow: (track: Track) => void;
  onPlayNext: (track: Track) => void;
  onAddToQueue: (track: Track) => void;
  onStartRadio: (track: Track) => void;
  onLike: (track: Track) => void;
  onAddToPlaylist: (track: Track) => void;
  onDownload: (track: Track) => void;
  onOpenArtist: (artistId: string) => void;
  onCopyLink: (track: Track) => void;
  onRevealFile: (path: string) => void;
  onEditTags: (track: Track) => void;
}

export const TrackContextMenu: React.FC<TrackContextMenuProps> = ({
  menu,
  onClose,
  onPlayNow,
  onPlayNext,
  onAddToQueue,
  onStartRadio,
  onLike,
  onAddToPlaylist,
  onDownload,
  onOpenArtist,
  onCopyLink,
  onRevealFile,
  onEditTags,
}) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  const { track } = menu;
  const liked = track.likeStatus === "LIKE";
  const left = Math.min(menu.x, window.innerWidth - 236);
  const top = Math.min(menu.y, window.innerHeight - 360);

  const run = (fn: () => void) => {
    fn();
    onClose();
  };

  return (
    <div
      ref={ref}
      className="context-menu glass-panel"
      style={{ left: Math.max(8, left), top: Math.max(8, top) }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="context-menu-header">
        <div className="media-title" style={{ fontSize: 12.5 }}>{track.title}</div>
        <div className="media-subtitle" style={{ fontSize: 11 }}>{track.artist}</div>
      </div>
      <div className="sort-popover-divider" />

      <button className="context-menu-item" onClick={() => run(() => onPlayNow(track))}>
        <Play size={14} /> Play now
      </button>
      <button className="context-menu-item" onClick={() => run(() => onPlayNext(track))}>
        <ListStart size={14} /> Play next
      </button>
      <button className="context-menu-item" onClick={() => run(() => onAddToQueue(track))}>
        <ListEnd size={14} /> Add to queue
      </button>
      {!track.videoId.startsWith("localfile_") && (
        <button className="context-menu-item" onClick={() => run(() => onStartRadio(track))}>
          <Radio size={14} /> Start radio
        </button>
      )}

      <div className="sort-popover-divider" />

      <button className="context-menu-item" onClick={() => run(() => onLike(track))}>
        <Heart size={14} fill={liked ? "currentColor" : "none"} />
        {liked ? "Remove from Liked" : "Like song"}
      </button>
      <button className="context-menu-item" onClick={() => run(() => onAddToPlaylist(track))}>
        <ListPlus size={14} /> Add to playlist
      </button>
      {track.artistId && (
        <button className="context-menu-item" onClick={() => run(() => onOpenArtist(track.artistId!))}>
          <User size={14} /> Go to artist
        </button>
      )}
      {!track.isDownloaded && !track.videoId.startsWith("localfile_") && (
        <button className="context-menu-item" onClick={() => run(() => onDownload(track))}>
          <Download size={14} /> Download offline
        </button>
      )}

      <div className="sort-popover-divider" />

      {!track.videoId.startsWith("localfile_") && (
        <button className="context-menu-item" onClick={() => run(() => onCopyLink(track))}>
          <Copy size={14} /> Copy YouTube Music link
        </button>
      )}
      {track.localPath && (
        <>
          <button className="context-menu-item" onClick={() => run(() => onRevealFile(track.localPath!))}>
            <FolderOpen size={14} /> Open file location
          </button>
          <button className="context-menu-item" onClick={() => run(() => onEditTags(track))}>
            <Pencil size={14} /> Edit file tags
          </button>
        </>
      )}
    </div>
  );
};

interface TagEditorModalProps {
  track: Track | null;
  onClose: () => void;
  onSave: (videoId: string, title: string, artist: string, album: string) => Promise<void>;
}

export const TagEditorModal: React.FC<TagEditorModalProps> = ({ track, onClose, onSave }) => {
  const [title, setTitle] = useState(track?.title || "");
  const [artist, setArtist] = useState(track?.artist || "");
  const [album, setAlbum] = useState(track?.album || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (track) {
      setTitle(track.title);
      setArtist(track.artist);
      setAlbum(track.album || "");
    }
  }, [track]);

  if (!track) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="glass-panel"
        style={{ width: 420, padding: 20, display: "flex", flexDirection: "column", gap: 12 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ fontSize: 16 }}>Edit audio tags</h3>
          <button className="icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", wordBreak: "break-all" }}>
          {track.localPath}
        </div>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="settings-label">Title</span>
          <input className="glass-input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="settings-label">Artist</span>
          <input className="glass-input" value={artist} onChange={(e) => setArtist(e.target.value)} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="settings-label">Album</span>
          <input className="glass-input" value={album} onChange={(e) => setAlbum(e.target.value)} />
        </label>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
          <button className="glass-pill" onClick={onClose}>
            Cancel
          </button>
          <button
            className="glass-pill active"
            disabled={saving || !title.trim()}
            onClick={async () => {
              setSaving(true);
              try {
                await onSave(track.videoId, title.trim(), artist.trim(), album.trim());
                onClose();
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Saving..." : "Save tags"}
          </button>
        </div>
      </div>
    </div>
  );
};
