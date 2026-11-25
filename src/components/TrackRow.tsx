import React from "react";
import {
  CheckCircle2,
  Download,
  Heart,
  ListPlus,
  Pause,
  Play,
  Radio,
  Trash2,
} from "lucide-react";
import { formatTime } from "../api";
import type { Track } from "../types";

interface TrackRowProps {
  track: Track;
  index?: number;
  isCurrent: boolean;
  isPlaying: boolean;
  onPlay: (track: Track) => void;
  onLike: (track: Track) => void;
  onDownload: (track: Track) => void;
  onAddToPlaylist: (track: Track) => void;
  onStartRadio?: (track: Track) => void;
  onOpenArtist?: (artistId: string) => void;
  onRemove?: (track: Track) => void;
}

export const TrackRow: React.FC<TrackRowProps> = ({
  track,
  isCurrent,
  isPlaying,
  onPlay,
  onLike,
  onDownload,
  onAddToPlaylist,
  onStartRadio,
  onOpenArtist,
  onRemove,
}) => {
  const liked = track.likeStatus === "LIKE";

  return (
    <div
      className={`track-row ${isCurrent ? "playing" : ""}`}
      onClick={() => onPlay(track)}
    >
      <div className="track-thumb">
        {track.thumbnail && <img src={track.thumbnail} alt="" loading="lazy" />}
        <div className="track-thumb-overlay">
          {isCurrent && isPlaying ? <Pause size={16} /> : <Play size={16} />}
        </div>
      </div>

      <div style={{ minWidth: 0 }}>
        <div
          className="media-title"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            color: isCurrent ? "var(--accent)" : undefined,
          }}
        >
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
            {track.title}
          </span>
          {track.isExplicit && (
            <span className="badge" style={{ padding: "1px 5px", fontSize: 9.5 }}>
              E
            </span>
          )}
          {track.isDownloaded && (
            <CheckCircle2
              size={13}
              style={{ color: "#4ade80", flexShrink: 0 }}
              aria-label="Downloaded offline"
            />
          )}
        </div>
        <div className="media-subtitle">
          {track.artistId && onOpenArtist ? (
            <span
              style={{ cursor: "pointer", textDecoration: "underline transparent" }}
              onClick={(e) => {
                e.stopPropagation();
                onOpenArtist(track.artistId!);
              }}
            >
              {track.artist}
            </span>
          ) : (
            track.artist
          )}
        </div>
      </div>

      <div className="media-subtitle" style={{ fontSize: 12.5 }}>
        {track.album || ""}
      </div>

      <div className="track-actions" onClick={(e) => e.stopPropagation()}>
        <button
          className={`icon-btn ${liked ? "active" : ""}`}
          onClick={() => onLike(track)}
          title={liked ? "Unlike" : "Like"}
        >
          <Heart size={15} fill={liked ? "currentColor" : "none"} />
        </button>
        <button
          className="icon-btn"
          onClick={() => onDownload(track)}
          title={track.isDownloaded ? "Downloaded" : "Download high-res audio"}
        >
          <Download size={15} />
        </button>
        <button
          className="icon-btn"
          onClick={() => onAddToPlaylist(track)}
          title="Add to Playlist"
        >
          <ListPlus size={15} />
        </button>
        {onStartRadio && (
          <button
            className="icon-btn"
            onClick={() => onStartRadio(track)}
            title="Start Radio"
          >
            <Radio size={15} />
          </button>
        )}
        {onRemove && (
          <button
            className="icon-btn"
            onClick={() => onRemove(track)}
            title="Remove from playlist"
          >
            <Trash2 size={15} />
          </button>
        )}
        <span
          style={{
            minWidth: 42,
            textAlign: "right",
            fontSize: 12.5,
            color: "var(--text-muted)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {track.durationSecs > 0 ? formatTime(track.durationSecs * 1000) : "--:--"}
        </span>
      </div>
    </div>
  );
};
