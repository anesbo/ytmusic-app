import React from "react";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Download,
  GripVertical,
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
  compact?: boolean;
  reorderMode?: boolean;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  isDragging?: boolean;
  isDragOver?: boolean;
  isCurrent: boolean;
  isPlaying: boolean;
  onPlay: (track: Track) => void;
  onLike: (track: Track) => void;
  onDownload: (track: Track) => void;
  onAddToPlaylist: (track: Track) => void;
  onStartRadio?: (track: Track) => void;
  onOpenArtist?: (artistId: string) => void;
  onRemove?: (track: Track) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onDragStart?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragOver?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd?: () => void;
}

export const TrackRow: React.FC<TrackRowProps> = ({
  track,
  compact = false,
  reorderMode = false,
  canMoveUp = false,
  canMoveDown = false,
  isDragging = false,
  isDragOver = false,
  isCurrent,
  isPlaying,
  onPlay,
  onLike,
  onDownload,
  onAddToPlaylist,
  onStartRadio,
  onOpenArtist,
  onRemove,
  onMoveUp,
  onMoveDown,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}) => {
  const liked = track.likeStatus === "LIKE";

  const rowClasses = [
    "track-row",
    compact ? "compact" : "",
    reorderMode ? "reorder-mode" : "",
    isCurrent ? "playing" : "",
    isDragging ? "dragging" : "",
    isDragOver ? "drag-over" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={rowClasses}
      draggable={reorderMode}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onClick={() => onPlay(track)}
    >
      {reorderMode && (
        <div
          style={{
            display: "grid",
            placeItems: "center",
            color: "var(--text-muted)",
            cursor: "grab",
          }}
          title="Drag to reorder"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical size={16} />
        </div>
      )}

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
            <span className="badge" style={{ padding: "1px 5px", fontSize: 10 }}>
              E
            </span>
          )}
          {track.isDownloaded && (
            <CheckCircle2
              size={13}
              style={{ color: "#22c55e", flexShrink: 0 }}
              aria-label="Downloaded offline"
            />
          )}
        </div>
        <div className="media-subtitle">
          {track.artistId && onOpenArtist ? (
            <span
              style={{ cursor: "pointer" }}
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

      {!compact && (
        <>
          <div className="media-subtitle" style={{ fontSize: 12.5 }}>
            {track.album || ""}
          </div>

          <div className="track-actions" onClick={(e) => e.stopPropagation()}>
            {reorderMode ? (
              <>
                <button
                  className="icon-btn"
                  disabled={!canMoveUp}
                  style={{ opacity: canMoveUp ? 1 : 0.3 }}
                  onClick={onMoveUp}
                  title="Move up"
                >
                  <ArrowUp size={15} />
                </button>
                <button
                  className="icon-btn"
                  disabled={!canMoveDown}
                  style={{ opacity: canMoveDown ? 1 : 0.3 }}
                  onClick={onMoveDown}
                  title="Move down"
                >
                  <ArrowDown size={15} />
                </button>
              </>
            ) : (
              <>
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
                  title={track.isDownloaded ? "Downloaded" : "Download"}
                >
                  <Download size={15} />
                </button>
                <button
                  className="icon-btn"
                  onClick={() => onAddToPlaylist(track)}
                  title="Add to playlist"
                >
                  <ListPlus size={15} />
                </button>
                {onStartRadio && (
                  <button
                    className="icon-btn"
                    onClick={() => onStartRadio(track)}
                    title="Start radio"
                  >
                    <Radio size={15} />
                  </button>
                )}
              </>
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
                fontSize: 12,
                color: "var(--text-muted)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {track.durationSecs > 0 ? formatTime(track.durationSecs * 1000) : "--:--"}
            </span>
          </div>
        </>
      )}
    </div>
  );
};
