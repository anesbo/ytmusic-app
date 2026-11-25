import React, { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Download,
  Heart,
  ListPlus,
  Loader2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Sliders,
  Sparkles,
  ThumbsDown,
  Volume2,
  VolumeX,
} from "lucide-react";
import { formatTime } from "../api";
import type { PlaybackSnapshot, Track } from "../types";

interface PlayerBarProps {
  playback: PlaybackSnapshot;
  shuffle: boolean;
  repeatMode: "off" | "all" | "one";
  nowPlayingOpen: boolean;
  eqEnabled: boolean;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeek: (ms: number) => void;
  onVolume: (v: number) => void;
  onToggleMute: () => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
  onToggleNowPlaying: () => void;
  onRate: (track: Track, rating: "LIKE" | "DISLIKE" | "INDIFFERENT") => void;
  onDownload: (track: Track) => void;
  onAddToPlaylist: (track: Track) => void;
  onOpenAudioSettings: () => void;
  onOpenArtist: (artistId: string) => void;
}

export const PlayerBar: React.FC<PlayerBarProps> = ({
  playback,
  shuffle,
  repeatMode,
  nowPlayingOpen,
  eqEnabled,
  onTogglePlay,
  onPrev,
  onNext,
  onSeek,
  onVolume,
  onToggleMute,
  onToggleShuffle,
  onCycleRepeat,
  onToggleNowPlaying,
  onRate,
  onDownload,
  onAddToPlaylist,
  onOpenAudioSettings,
  onOpenArtist,
}) => {
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);
  const track = playback.currentTrack;
  const durationMs = playback.durationMs || (track ? track.durationSecs * 1000 : 0);
  const progressRatio = durationMs > 0 ? Math.min(1, playback.positionMs / durationMs) : 0;
  const tel = playback.telemetry;

  const handleSeekClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (durationMs <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeek(Math.round(ratio * durationMs));
  };

  return (
    <div className="player-dock-wrap">
      <div className="player-dock glass-panel">
        {/* Interactive Full-Width Seekbar */}
        <div
          className="seek-bar-wrap"
          onClick={handleSeekClick}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            setHoverRatio(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
          }}
          onMouseLeave={() => setHoverRatio(null)}
        >
          <div className="seek-track">
            <div
              className="seek-buffered"
              style={{ width: `${Math.round(playback.bufferedRatio * 100)}%` }}
            />
            <div
              className="seek-fill"
              style={{ width: `${(progressRatio * 100).toFixed(2)}%` }}
            />
          </div>
          {hoverRatio !== null && durationMs > 0 && (
            <div
              className="badge"
              style={{
                position: "absolute",
                bottom: 16,
                left: `calc(${(hoverRatio * 100).toFixed(1)}% - 22px)`,
                pointerEvents: "none",
                background: "rgba(10, 12, 20, 0.86)",
              }}
            >
              {formatTime(hoverRatio * durationMs)}
            </div>
          )}
        </div>

        <div className="player-row">
          {/* Left: Transport + Time + Signal Path */}
          <div className="player-controls-left">
            <button className="icon-btn" onClick={onPrev} title="Previous">
              <SkipBack size={18} />
            </button>
            <button
              className="play-main-btn"
              onClick={onTogglePlay}
              title={playback.isPlaying ? "Pause (Space)" : "Play (Space)"}
            >
              {playback.isLoading ? (
                <Loader2 size={20} className="spin" />
              ) : playback.isPlaying ? (
                <Pause size={20} />
              ) : (
                <Play size={20} style={{ marginLeft: 2 }} />
              )}
            </button>
            <button className="icon-btn" onClick={onNext} title="Next">
              <SkipForward size={18} />
            </button>

            <span
              style={{
                fontSize: 12,
                color: "var(--text-secondary)",
                marginLeft: 6,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {formatTime(playback.positionMs)} / {formatTime(durationMs)}
            </span>

            {tel && (
              <button
                className="badge hires"
                onClick={onOpenAudioSettings}
                style={{ cursor: "pointer", marginLeft: 4 }}
                title={`Signal Path: ${tel.codec} ${tel.bitrateKbps}kbps • ${(
                  tel.sourceSampleRate / 1000
                ).toFixed(1)}kHz → ${(tel.outputSampleRate / 1000).toFixed(
                  1
                )}kHz on ${tel.outputDevice} (Norm ${tel.loudnessGainDb.toFixed(1)} dB)`}
              >
                <Sparkles size={11} />
                {tel.codec} {tel.bitrateKbps > 0 ? `${tel.bitrateKbps}k` : ""} •{" "}
                {(tel.outputSampleRate / 1000).toFixed(1)}kHz
              </button>
            )}
          </div>

          {/* Center: Current Track + Quick Actions */}
          <div className="player-track-center">
            {track ? (
              <>
                {track.thumbnail && (
                  <img
                    src={track.thumbnail}
                    alt=""
                    className="player-art"
                    onClick={onToggleNowPlaying}
                  />
                )}
                <div style={{ minWidth: 0, maxWidth: 280 }}>
                  <div
                    className="media-title"
                    style={{ cursor: "pointer" }}
                    onClick={onToggleNowPlaying}
                  >
                    {track.title}
                  </div>
                  <div
                    className="media-subtitle"
                    style={{ cursor: track.artistId ? "pointer" : "default" }}
                    onClick={() => track.artistId && onOpenArtist(track.artistId)}
                  >
                    {track.artist}
                    {track.album ? ` • ${track.album}` : ""}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                  <button
                    className={`icon-btn ${track.likeStatus === "DISLIKE" ? "active" : ""}`}
                    onClick={() =>
                      onRate(
                        track,
                        track.likeStatus === "DISLIKE" ? "INDIFFERENT" : "DISLIKE"
                      )
                    }
                    title="Dislike"
                  >
                    <ThumbsDown size={15} />
                  </button>
                  <button
                    className={`icon-btn ${track.likeStatus === "LIKE" ? "active" : ""}`}
                    onClick={() =>
                      onRate(
                        track,
                        track.likeStatus === "LIKE" ? "INDIFFERENT" : "LIKE"
                      )
                    }
                    title="Like"
                  >
                    <Heart
                      size={15}
                      fill={track.likeStatus === "LIKE" ? "currentColor" : "none"}
                    />
                  </button>
                  <button
                    className="icon-btn"
                    onClick={() => onDownload(track)}
                    title="Download Track"
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
                </div>
              </>
            ) : (
              <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
                Nothing playing
              </span>
            )}
          </div>

          {/* Right: EQ, Volume, Shuffle, Repeat, Expand */}
          <div className="player-controls-right">
            <button
              className={`icon-btn ${eqEnabled ? "active" : ""}`}
              onClick={onOpenAudioSettings}
              title="10-Band Equalizer & Audiophile DSP"
            >
              <Sliders size={16} />
            </button>

            <button
              className="icon-btn"
              onClick={onToggleMute}
              title={playback.muted ? "Unmute (M)" : "Mute (M)"}
            >
              {playback.muted || playback.volume <= 0.01 ? (
                <VolumeX size={17} />
              ) : (
                <Volume2 size={17} />
              )}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={playback.muted ? 0 : Math.min(1, playback.volume)}
              onChange={(e) => onVolume(parseFloat(e.target.value))}
              className="range-input"
              style={{ width: 84 }}
              aria-label="Volume"
            />

            <button
              className={`icon-btn ${shuffle ? "active" : ""}`}
              onClick={onToggleShuffle}
              title="Shuffle"
            >
              <Shuffle size={16} />
            </button>
            <button
              className={`icon-btn ${repeatMode !== "off" ? "active" : ""}`}
              onClick={onCycleRepeat}
              title={`Repeat: ${repeatMode}`}
            >
              {repeatMode === "one" ? <Repeat1 size={16} /> : <Repeat size={16} />}
            </button>

            <button
              className={`icon-btn ${nowPlayingOpen ? "active" : ""}`}
              onClick={onToggleNowPlaying}
              title="Up Next, Synced Lyrics & Related"
            >
              {nowPlayingOpen ? <ChevronDown size={19} /> : <ChevronUp size={19} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
