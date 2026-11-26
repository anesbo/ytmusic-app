import React, { useEffect, useState } from "react";
import {
  Disc3,
  Languages,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  X,
} from "lucide-react";
import { api, formatTime } from "../api";
import { AudioVisualizer } from "./AudioVisualizer";
import type { LyricsData, PlaybackSnapshot } from "../types";

interface LoungeViewProps {
  playback: PlaybackSnapshot;
  lyricsBrowseId?: string | null;
  visualizerEnabled: boolean;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}

export const LoungeView: React.FC<LoungeViewProps> = ({
  playback,
  lyricsBrowseId,
  visualizerEnabled,
  onTogglePlay,
  onPrev,
  onNext,
  onClose,
}) => {
  const [clock, setClock] = useState(() =>
    new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  );
  const [lyrics, setLyrics] = useState<LyricsData | null>(null);
  const [translateLang, setTranslateLang] = useState<string>("");
  const [translated, setTranslated] = useState<string[]>([]);

  const track = playback.currentTrack;

  useEffect(() => {
    const id = window.setInterval(() => {
      setClock(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    }, 10_000);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  useEffect(() => {
    if (!track) return;
    let cancelled = false;
    setTranslated([]);
    api
      .getLyrics(track.videoId, track.title, track.artist, track.durationSecs, lyricsBrowseId)
      .then((res) => {
        if (!cancelled) setLyrics(res);
      })
      .catch(() => {
        if (!cancelled) setLyrics(null);
      });
    return () => {
      cancelled = true;
    };
  }, [track?.videoId, lyricsBrowseId]);

  useEffect(() => {
    if (!translateLang || !lyrics || lyrics.synced.length === 0) {
      setTranslated([]);
      return;
    }
    let cancelled = false;
    api
      .translateLyrics(
        lyrics.videoId,
        lyrics.synced.map((l) => l.text),
        translateLang
      )
      .then((lines) => {
        if (!cancelled) setTranslated(lines);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [translateLang, lyrics]);

  const activeIdx = (() => {
    if (!lyrics || lyrics.synced.length === 0) return -1;
    let idx = -1;
    for (let i = 0; i < lyrics.synced.length; i++) {
      if (lyrics.synced[i].timeMs <= playback.positionMs + 200) idx = i;
      else break;
    }
    return idx;
  })();

  const activeLine = activeIdx >= 0 ? lyrics?.synced[activeIdx]?.text || "♪" : "";
  const activeTranslated = activeIdx >= 0 ? translated[activeIdx] || "" : "";
  const nextLine = activeIdx >= 0 ? lyrics?.synced[activeIdx + 1]?.text || "" : "";

  // Word-by-word karaoke fill percentage across the current line
  const karaokeProgress = (() => {
    if (!lyrics || activeIdx < 0) return 100;
    const start = lyrics.synced[activeIdx].timeMs;
    const end = lyrics.synced[activeIdx + 1]?.timeMs ?? start + 4000;
    const span = Math.max(400, end - start);
    return Math.max(0, Math.min(100, ((playback.positionMs - start) / span) * 100));
  })();

  const durationMs = playback.durationMs || (track ? track.durationSecs * 1000 : 0);

  return (
    <div className="lounge-overlay">
      {track?.thumbnail && (
        <div
          className="lounge-backdrop"
          style={{ backgroundImage: `url(${track.thumbnail})` }}
          aria-hidden="true"
        />
      )}

      <div className="lounge-top">
        <div className="lounge-clock">{clock}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Languages size={15} style={{ opacity: 0.7 }} />
            <select
              className="glass-select"
              value={translateLang}
              onChange={(e) => setTranslateLang(e.target.value)}
              style={{ fontSize: 12, padding: "4px 8px" }}
            >
              <option value="">Original lyrics</option>
              <option value="en">Translate → English</option>
              <option value="fr">Translate → French</option>
              <option value="ar">Translate → Arabic</option>
              <option value="es">Translate → Spanish</option>
              <option value="de">Translate → German</option>
            </select>
          </div>
          <button className="icon-btn" onClick={onClose} title="Exit Lounge Mode (Esc)">
            <X size={20} />
          </button>
        </div>
      </div>

      <div className="lounge-center">
        <div className="lounge-art">
          {track?.thumbnail ? (
            <img src={track.thumbnail} alt="" />
          ) : (
            <Disc3 size={84} style={{ opacity: 0.35 }} />
          )}
        </div>

        <div className="lounge-info">
          <div className="lounge-title">{track?.title || "Nothing playing"}</div>
          <div className="lounge-artist">
            {track ? `${track.artist}${track.album ? ` — ${track.album}` : ""}` : "Select a song to begin"}
          </div>

          {activeLine && (
            <div className="lounge-lyrics-box">
              <div
                className="lounge-karaoke-line"
                style={{
                  backgroundImage: `linear-gradient(90deg, #ffffff ${karaokeProgress}%, rgba(255,255,255,0.34) ${karaokeProgress}%)`,
                }}
              >
                {activeLine}
              </div>
              {activeTranslated && activeTranslated !== activeLine && (
                <div className="lounge-translated-line">{activeTranslated}</div>
              )}
              {nextLine && <div className="lounge-next-line">{nextLine}</div>}
            </div>
          )}

          <div style={{ marginTop: 14 }}>
            <AudioVisualizer enabled={visualizerEnabled} isPlaying={playback.isPlaying} variant="full" />
          </div>
        </div>
      </div>

      <div className="lounge-bottom">
        <div style={{ fontSize: 12, color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>
          {formatTime(playback.positionMs)} / {formatTime(durationMs)}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <button className="icon-btn" onClick={onPrev} title="Previous">
            <SkipBack size={22} />
          </button>
          <button className="play-main-btn" style={{ width: 48, height: 48 }} onClick={onTogglePlay}>
            {playback.isPlaying ? <Pause size={22} /> : <Play size={22} style={{ marginLeft: 2 }} />}
          </button>
          <button className="icon-btn" onClick={onNext} title="Next">
            <SkipForward size={22} />
          </button>
        </div>
      </div>
    </div>
  );
};
