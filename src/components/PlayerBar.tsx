import React, { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Download,
  Gauge,
  Heart,
  ListPlus,
  Loader2,
  Moon,
  Pause,
  PictureInPicture2,
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
import { AudioVisualizer } from "./AudioVisualizer";
import type { PlaybackSnapshot, SponsorSegment, Track } from "../types";

export type SleepTimerMode =
  | { kind: "off" }
  | { kind: "end_of_track" }
  | { kind: "minutes"; endsAtMs: number };

interface PlayerBarProps {
  playback: PlaybackSnapshot;
  shuffle: boolean;
  repeatMode: "off" | "all" | "one";
  nowPlayingOpen: boolean;
  eqEnabled: boolean;
  visualizerEnabled: boolean;
  playbackSpeed: number;
  preservePitch: boolean;
  sleepTimer: SleepTimerMode;
  sponsorSegments: SponsorSegment[];
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
  onSetSpeed: (speed: number, preservePitch: boolean) => void;
  onSetSleepTimer: (mode: SleepTimerMode) => void;
  onOpenLyricsOverlay: () => void;
}

export const PlayerBar: React.FC<PlayerBarProps> = ({
  playback,
  shuffle,
  repeatMode,
  nowPlayingOpen,
  eqEnabled,
  visualizerEnabled,
  playbackSpeed,
  preservePitch,
  sleepTimer,
  sponsorSegments,
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
  onSetSpeed,
  onSetSleepTimer,
  onOpenLyricsOverlay,
}) => {
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);
  const [openMenu, setOpenMenu] = useState<"none" | "sleep" | "speed">("none");
  const menuWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (menuWrapRef.current && !menuWrapRef.current.contains(e.target as Node)) {
        setOpenMenu("none");
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const track = playback.currentTrack;
  const durationMs = playback.durationMs || (track ? track.durationSecs * 1000 : 0);
  const progressRatio = durationMs > 0 ? Math.min(1, playback.positionMs / durationMs) : 0;
  const tel = playback.telemetry;

  const sleepLabel =
    sleepTimer.kind === "off"
      ? null
      : sleepTimer.kind === "end_of_track"
      ? "End"
      : `${Math.max(1, Math.ceil((sleepTimer.endsAtMs - Date.now()) / 60000))}m`;

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
            {durationMs > 0 &&
              sponsorSegments.map((seg, idx) => {
                const left = Math.min(100, Math.max(0, ((seg.startSecs * 1000) / durationMs) * 100));
                const width = Math.min(
                  100 - left,
                  Math.max(0.6, (((seg.endSecs - seg.startSecs) * 1000) / durationMs) * 100)
                );
                return (
                  <div
                    key={idx}
                    className="seek-sponsor-seg"
                    style={{ left: `${left}%`, width: `${width}%` }}
                    title={`SponsorBlock: ${seg.category}`}
                  />
                );
              })}
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

          {/* Right: Visualizer, Speed, Sleep Timer, Lyrics, EQ, Volume, Shuffle, Repeat, Expand */}
          <div className="player-controls-right" ref={menuWrapRef} style={{ position: "relative" }}>
            <AudioVisualizer
              enabled={visualizerEnabled}
              isPlaying={playback.isPlaying}
              variant="mini"
            />

            {/* Speed / Pitch Popover */}
            <button
              className={`icon-btn ${Math.abs(playbackSpeed - 1.0) > 0.01 ? "active" : ""}`}
              onClick={() => setOpenMenu((m) => (m === "speed" ? "none" : "speed"))}
              title={`Playback speed: ${playbackSpeed.toFixed(2)}x`}
              style={{ width: "auto", padding: "0 6px", gap: 3, fontSize: 11.5, fontVariantNumeric: "tabular-nums" }}
            >
              <Gauge size={15} />
              {Math.abs(playbackSpeed - 1.0) > 0.01 && <span>{playbackSpeed.toFixed(2)}x</span>}
            </button>

            {/* Sleep Timer Popover */}
            <button
              className={`icon-btn ${sleepTimer.kind !== "off" ? "active" : ""}`}
              onClick={() => setOpenMenu((m) => (m === "sleep" ? "none" : "sleep"))}
              title="Sleep timer"
              style={{ width: "auto", padding: "0 6px", gap: 3, fontSize: 11.5, fontVariantNumeric: "tabular-nums" }}
            >
              <Moon size={15} />
              {sleepLabel && <span>{sleepLabel}</span>}
            </button>

            <button
              className="icon-btn"
              onClick={onOpenLyricsOverlay}
              title="Floating lyrics window"
            >
              <PictureInPicture2 size={15} />
            </button>

            <button
              className={`icon-btn ${eqEnabled ? "active" : ""}`}
              onClick={onOpenAudioSettings}
              title="10-Band Equalizer & Audiophile DSP"
            >
              <Sliders size={16} />
            </button>

            {openMenu === "speed" && (
              <div className="player-popover glass-panel">
                <div className="settings-section-title" style={{ marginBottom: 4 }}>
                  Playback speed ({playbackSpeed.toFixed(2)}x)
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
                  {[0.75, 0.85, 1.0, 1.15, 1.25, 1.5, 1.75, 2.0].map((sp) => (
                    <button
                      key={sp}
                      className={`glass-pill ${Math.abs(playbackSpeed - sp) < 0.01 ? "active" : ""}`}
                      style={{ justifyContent: "center", padding: "5px 8px", fontSize: 12 }}
                      onClick={() => onSetSpeed(sp, preservePitch)}
                    >
                      {sp}x
                    </button>
                  ))}
                </div>
                <div className="settings-row" style={{ marginTop: 8 }}>
                  <span style={{ fontSize: 12.5 }}>Preserve pitch</span>
                  <button
                    className={`toggle-switch ${preservePitch ? "on" : ""}`}
                    onClick={() => onSetSpeed(playbackSpeed, !preservePitch)}
                  >
                    <span className="toggle-knob" />
                  </button>
                </div>
              </div>
            )}

            {openMenu === "sleep" && (
              <div className="player-popover glass-panel">
                <div className="settings-section-title" style={{ marginBottom: 4 }}>
                  Sleep timer
                </div>
                {[
                  { label: "Off", mode: { kind: "off" } as SleepTimerMode },
                  { label: "15 minutes", mode: { kind: "minutes", endsAtMs: Date.now() + 15 * 60000 } as SleepTimerMode },
                  { label: "30 minutes", mode: { kind: "minutes", endsAtMs: Date.now() + 30 * 60000 } as SleepTimerMode },
                  { label: "45 minutes", mode: { kind: "minutes", endsAtMs: Date.now() + 45 * 60000 } as SleepTimerMode },
                  { label: "60 minutes", mode: { kind: "minutes", endsAtMs: Date.now() + 60 * 60000 } as SleepTimerMode },
                  { label: "End of current track", mode: { kind: "end_of_track" } as SleepTimerMode },
                ].map((opt) => (
                  <button
                    key={opt.label}
                    className="sort-popover-item"
                    onClick={() => {
                      onSetSleepTimer(opt.mode);
                      setOpenMenu("none");
                    }}
                  >
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>
            )}

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
