import React, { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  CloudRain,
  Download,
  Gauge,
  Heart,
  ListPlus,
  Loader2,
  MicOff,
  Moon,
  Pause,
  PictureInPicture2,
  Play,
  Repeat,
  Repeat1,
  Repeat2,
  Scissors,
  Shuffle,
  SkipBack,
  SkipForward,
  Sliders,
  Sparkles,
  ThumbsDown,
  Tv2,
  Volume2,
  VolumeX,
  Wand2,
} from "lucide-react";
import { formatTime } from "../api";
import { AMBIENCE_PRESETS, FX_PRESETS } from "../data/autoeq";
import { AudioVisualizer } from "./AudioVisualizer";
import type {
  AmbienceSettings,
  AudioFxSettings,
  PlaybackSnapshot,
  SponsorSegment,
  Track,
  TrackBookmark,
} from "../types";

export type SleepTimerMode =
  | { kind: "off" }
  | { kind: "end_of_track" }
  | { kind: "minutes"; endsAtMs: number };

export interface AbLoopState {
  aMs: number | null;
  bMs: number | null;
}

interface PlayerBarProps {
  playback: PlaybackSnapshot;
  shuffle: boolean;
  repeatMode: "off" | "all" | "one";
  nowPlayingOpen: boolean;
  eqEnabled: boolean;
  visualizerEnabled: boolean;
  playbackSpeed: number;
  preservePitch: boolean;
  pitchSemitones: number;
  fxSettings: AudioFxSettings;
  ambienceSettings: AmbienceSettings;
  sleepTimer: SleepTimerMode;
  abLoop: AbLoopState;
  bookmarks: TrackBookmark[];
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
  onSetPitch: (semitones: number) => void;
  onExportAbClip: () => void;
  onApplyFxPreset: (presetId: AudioFxSettings["preset"]) => void;
  onToggleVocalRemover: () => void;
  onUpdateAmbience: (next: AmbienceSettings) => void;
  onSetSleepTimer: (mode: SleepTimerMode) => void;
  onCycleAbLoop: () => void;
  onOpenLyricsOverlay: () => void;
  onOpenLounge: () => void;
  onOpenDynamicIsland: () => void;
  onOpenMiniPlayerWindow: () => void;
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
  pitchSemitones,
  fxSettings,
  ambienceSettings,
  sleepTimer,
  abLoop,
  bookmarks,
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
  onSetPitch,
  onExportAbClip,
  onApplyFxPreset,
  onToggleVocalRemover,
  onUpdateAmbience,
  onSetSleepTimer,
  onCycleAbLoop,
  onOpenLyricsOverlay,
  onOpenLounge,
  onOpenDynamicIsland,
  onOpenMiniPlayerWindow,
}) => {
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);
  const [openMenu, setOpenMenu] = useState<"none" | "audio" | "tools" | "modes">("none");
  const [audioTab, setAudioTab] = useState<"speed" | "fx" | "ambience">("speed");
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
  const isLive = Boolean(track?.videoId.startsWith("live_"));
  const durationMs = isLive ? 0 : playback.durationMs || (track ? track.durationSecs * 1000 : 0);
  const progressRatio = isLive ? 1 : durationMs > 0 ? Math.min(1, playback.positionMs / durationMs) : 0;
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
            {durationMs > 0 && abLoop.aMs !== null && (
              <div
                className="seek-ab-loop"
                style={{
                  left: `${Math.min(100, (abLoop.aMs / durationMs) * 100)}%`,
                  width: `${
                    abLoop.bMs !== null
                      ? Math.max(0.8, ((abLoop.bMs - abLoop.aMs) / durationMs) * 100)
                      : 0.8
                  }%`,
                }}
                title={
                  abLoop.bMs !== null
                    ? `A-B Loop: ${formatTime(abLoop.aMs)} → ${formatTime(abLoop.bMs)}`
                    : `Loop start A: ${formatTime(abLoop.aMs)}`
                }
              />
            )}
            {durationMs > 0 &&
              bookmarks.map((bm) => (
                <div
                  key={bm.id}
                  className="seek-bookmark-pin"
                  style={{ left: `${Math.min(99, (bm.timeMs / durationMs) * 100)}%` }}
                  title={`Bookmark: ${bm.label || formatTime(bm.timeMs)}`}
                />
              ))}
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

            {isLive ? (
              <span className="live-pill-badge" style={{ marginLeft: 6 }}>
                <span className="live-dot" /> LIVE
              </span>
            ) : (
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
            )}

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

          {/* Right: Visualizer, 3 Grouped Feature Mini-Windows (Audio Lab / Tools / Modes), Volume, Shuffle, Repeat, Expand */}
          <div className="player-controls-right" ref={menuWrapRef} style={{ position: "relative" }}>
            <AudioVisualizer
              enabled={visualizerEnabled}
              isPlaying={playback.isPlaying}
              variant="mini"
            />

            {(() => {
              const audioActive =
                eqEnabled ||
                fxSettings.preset !== "off" ||
                fxSettings.vocalRemover ||
                ambienceSettings.enabled ||
                Math.abs(playbackSpeed - 1.0) > 0.01 ||
                Math.abs(pitchSemitones) > 0.05;
              const toolsActive = abLoop.aMs !== null || sleepTimer.kind !== "off";
              return (
                <>
                  <button
                    className={`player-group-btn ${openMenu === "audio" || audioActive ? "active" : ""}`}
                    onClick={() => setOpenMenu((m) => (m === "audio" ? "none" : "audio"))}
                    title="Audio Lab — Speed, Pitch, Studio FX, Karaoke & Ambience"
                  >
                    <Sliders size={15} />
                    <span>Sound</span>
                    {audioActive && <span className="group-dot" />}
                  </button>

                  <button
                    className={`player-group-btn ${openMenu === "tools" || toolsActive ? "active" : ""}`}
                    onClick={() => setOpenMenu((m) => (m === "tools" ? "none" : "tools"))}
                    title="Playback Tools — A–B Loop, Clip Exporter & Sleep Timer"
                  >
                    <Moon size={15} />
                    <span>{sleepLabel || (abLoop.bMs !== null ? "A↔B" : abLoop.aMs !== null ? "A→?" : "Tools")}</span>
                    {toolsActive && <span className="group-dot" />}
                  </button>

                  <button
                    className={`player-group-btn ${openMenu === "modes" ? "active" : ""}`}
                    onClick={() => setOpenMenu((m) => (m === "modes" ? "none" : "modes"))}
                    title="Display Modes — Dynamic Island, Mini Player, Lyrics & Lounge"
                  >
                    <PictureInPicture2 size={15} />
                    <span>Modes</span>
                  </button>
                </>
              );
            })()}

            {/* Grouped Mini-Window 1: Sound & Audio Lab */}
            {openMenu === "audio" && (
              <div className="player-popover player-mini-win glass-panel" style={{ width: 324 }}>
                <div className="mini-win-tabs">
                  <button
                    className={`mini-win-tab ${audioTab === "speed" ? "active" : ""}`}
                    onClick={() => setAudioTab("speed")}
                  >
                    <Gauge size={13} /> Speed & Pitch
                  </button>
                  <button
                    className={`mini-win-tab ${audioTab === "fx" ? "active" : ""}`}
                    onClick={() => setAudioTab("fx")}
                  >
                    <Wand2 size={13} /> FX & Vocal
                  </button>
                  <button
                    className={`mini-win-tab ${audioTab === "ambience" ? "active" : ""}`}
                    onClick={() => setAudioTab("ambience")}
                  >
                    <CloudRain size={13} /> Ambience
                  </button>
                </div>

                {audioTab === "speed" && (
                  <div className="mini-win-section">
                    <div className="settings-row" style={{ marginBottom: 4 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 500 }}>
                        Speed ({playbackSpeed.toFixed(2)}x)
                      </span>
                      <button
                        className="glass-pill"
                        style={{ padding: "3px 9px", fontSize: 11.5 }}
                        onClick={() => {
                          setOpenMenu("none");
                          onOpenAudioSettings();
                        }}
                      >
                        <Sliders size={12} /> 10-Band EQ {eqEnabled ? "(On)" : ""}
                      </button>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 5 }}>
                      {[0.75, 0.85, 1.0, 1.15, 1.25, 1.5, 1.75, 2.0].map((sp) => (
                        <button
                          key={sp}
                          className={`glass-pill ${Math.abs(playbackSpeed - sp) < 0.01 ? "active" : ""}`}
                          style={{ justifyContent: "center", padding: "5px 6px", fontSize: 11.5 }}
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
                    <div className="sort-popover-divider" />
                    <div className="settings-row" style={{ marginTop: 4 }}>
                      <span style={{ fontSize: 12.5 }}>
                        Pitch shift ({pitchSemitones > 0 ? "+" : ""}
                        {pitchSemitones} st)
                      </span>
                      {Math.abs(pitchSemitones) > 0.05 && (
                        <button
                          className="glass-pill"
                          style={{ padding: "2px 8px", fontSize: 11 }}
                          onClick={() => onSetPitch(0)}
                        >
                          Reset
                        </button>
                      )}
                    </div>
                    <input
                      type="range"
                      className="range-input"
                      style={{ width: "100%", marginTop: 4 }}
                      min={-6}
                      max={6}
                      step={0.5}
                      value={pitchSemitones}
                      onChange={(e) => onSetPitch(Number(e.target.value))}
                      aria-label="Pitch shift semitones"
                    />
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "var(--text-muted)" }}>
                      <span>-6 st</span>
                      <span>0</span>
                      <span>+6 st</span>
                    </div>
                  </div>
                )}

                {audioTab === "fx" && (
                  <div className="mini-win-section">
                    <div className="settings-row" style={{ padding: "2px 4px" }}>
                      <span style={{ fontSize: 12.5, display: "flex", alignItems: "center", gap: 6 }}>
                        <MicOff size={13} style={{ color: "var(--accent)" }} /> Vocal remover (Karaoke)
                      </span>
                      <button
                        className={`toggle-switch ${fxSettings.vocalRemover ? "on" : ""}`}
                        onClick={onToggleVocalRemover}
                      >
                        <span className="toggle-knob" />
                      </button>
                    </div>
                    <div className="sort-popover-divider" />
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      {FX_PRESETS.map((p) => (
                        <button
                          key={p.id}
                          className={`sort-popover-item ${fxSettings.preset === p.id ? "selected" : ""}`}
                          style={{ flexDirection: "column", alignItems: "flex-start", gap: 1, padding: "6px 9px" }}
                          onClick={() => onApplyFxPreset(p.id)}
                        >
                          <span style={{ fontSize: 12.5, color: fxSettings.preset === p.id ? "var(--accent)" : undefined }}>
                            {p.label}
                          </span>
                          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{p.desc}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {audioTab === "ambience" && (
                  <div className="mini-win-section">
                    <div className="settings-row" style={{ marginBottom: 4 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 500 }}>Ambient soundscape</span>
                      <button
                        className={`toggle-switch ${ambienceSettings.enabled ? "on" : ""}`}
                        onClick={() =>
                          onUpdateAmbience({ ...ambienceSettings, enabled: !ambienceSettings.enabled })
                        }
                      >
                        <span className="toggle-knob" />
                      </button>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
                      {AMBIENCE_PRESETS.map((p) => (
                        <button
                          key={p.id}
                          className={`glass-pill ${ambienceSettings.preset === p.id ? "active" : ""}`}
                          style={{ padding: "4px 9px", fontSize: 11.5 }}
                          onClick={() => onUpdateAmbience({ ...p.settings })}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                    {(
                      [
                        ["Rain", "rain"],
                        ["Fireplace", "fireplace"],
                        ["Ocean waves", "ocean"],
                        ["Brown noise", "brownNoise"],
                        ["Thunder", "thunder"],
                      ] as const
                    ).map(([label, key]) => (
                      <div key={key} className="settings-row" style={{ gap: 8 }}>
                        <span style={{ fontSize: 12, color: "var(--text-secondary)", minWidth: 82 }}>{label}</span>
                        <input
                          type="range"
                          className="range-input"
                          style={{ flex: 1 }}
                          min={0}
                          max={1}
                          step={0.05}
                          value={ambienceSettings[key]}
                          onChange={(e) =>
                            onUpdateAmbience({
                              ...ambienceSettings,
                              enabled: true,
                              preset: "custom",
                              [key]: Number(e.target.value),
                            })
                          }
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Grouped Mini-Window 2: Playback Tools (A–B Loop, Clip Exporter, Sleep Timer) */}
            {openMenu === "tools" && (
              <div className="player-popover player-mini-win glass-panel" style={{ width: 274 }}>
                <div className="settings-section-title" style={{ marginBottom: 4 }}>
                  A–B Loop & Clip
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button
                    className={`glass-pill ${abLoop.aMs !== null ? "active" : ""}`}
                    style={{ flex: 1, justifyContent: "center", padding: "6px 10px", fontSize: 12 }}
                    onClick={onCycleAbLoop}
                  >
                    <Repeat2 size={13} />
                    {abLoop.aMs === null
                      ? "Set start (A)"
                      : abLoop.bMs === null
                      ? `A ${formatTime(abLoop.aMs)} → Set B`
                      : `Clear (${formatTime(abLoop.aMs)}–${formatTime(abLoop.bMs)})`}
                  </button>
                  {abLoop.aMs !== null && abLoop.bMs !== null && !isLive && (
                    <button
                      className="glass-pill active"
                      style={{ padding: "6px 10px", fontSize: 12 }}
                      onClick={() => {
                        setOpenMenu("none");
                        onExportAbClip();
                      }}
                    >
                      <Scissors size={13} /> Export
                    </button>
                  )}
                </div>

                <div className="sort-popover-divider" style={{ margin: "6px 0" }} />

                <div className="settings-section-title" style={{ marginBottom: 4 }}>
                  Sleep timer {sleepLabel ? `(${sleepLabel})` : ""}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
                  {[
                    { label: "Off", mode: { kind: "off" } as SleepTimerMode },
                    { label: "15 min", mode: { kind: "minutes", endsAtMs: Date.now() + 15 * 60000 } as SleepTimerMode },
                    { label: "30 min", mode: { kind: "minutes", endsAtMs: Date.now() + 30 * 60000 } as SleepTimerMode },
                    { label: "45 min", mode: { kind: "minutes", endsAtMs: Date.now() + 45 * 60000 } as SleepTimerMode },
                    { label: "60 min", mode: { kind: "minutes", endsAtMs: Date.now() + 60 * 60000 } as SleepTimerMode },
                    { label: "End of track", mode: { kind: "end_of_track" } as SleepTimerMode },
                  ].map((opt) => (
                    <button
                      key={opt.label}
                      className="glass-pill"
                      style={{ justifyContent: "center", padding: "5px 8px", fontSize: 12 }}
                      onClick={() => {
                        onSetSleepTimer(opt.mode);
                        setOpenMenu("none");
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Grouped Mini-Window 3: Display & Floating Modes */}
            {openMenu === "modes" && (
              <div className="player-popover player-mini-win glass-panel" style={{ width: 256 }}>
                <div className="settings-section-title" style={{ marginBottom: 4 }}>
                  Windows & Display Modes
                </div>
                <button
                  className="sort-popover-item"
                  onClick={() => {
                    setOpenMenu("none");
                    onOpenDynamicIsland();
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Sparkles size={14} style={{ color: "var(--accent)" }} /> Dynamic Island Pill
                  </span>
                </button>
                <button
                  className="sort-popover-item"
                  onClick={() => {
                    setOpenMenu("none");
                    onOpenMiniPlayerWindow();
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <PictureInPicture2 size={14} /> Floating Mini-Player
                  </span>
                </button>
                <button
                  className="sort-popover-item"
                  onClick={() => {
                    setOpenMenu("none");
                    onOpenLyricsOverlay();
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <PictureInPicture2 size={14} /> Floating Synced Lyrics
                  </span>
                </button>
                <button
                  className="sort-popover-item"
                  onClick={() => {
                    setOpenMenu("none");
                    onOpenLounge();
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Tv2 size={14} /> Ambient TV / Lounge (F11)
                  </span>
                </button>
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
