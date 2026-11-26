import React, { useEffect, useState } from "react";
import { Loader2, Pause, Play, Plus, Radio, Trash2, Waves } from "lucide-react";
import { api } from "../api";
import type { RadioStation } from "../types";

const CURATED_STATIONS: RadioStation[] = [
  {
    id: "somafm_groovesalad",
    name: "Groove Salad",
    genre: "Ambient / Downtempo",
    url: "https://ice2.somafm.com/groovesalad-256-mp3",
    thumbnail: "https://somafm.com/img3/groovesalad-400.jpg",
  },
  {
    id: "somafm_vaporwaves",
    name: "Vaporwaves",
    genre: "Synthwave / Retro",
    url: "https://ice2.somafm.com/vaporwaves-128-mp3",
    thumbnail: "https://somafm.com/img3/vaporwaves-400.jpg",
  },
  {
    id: "somafm_dronezone",
    name: "Drone Zone",
    genre: "Deep Space Ambient",
    url: "https://ice2.somafm.com/dronezone-256-mp3",
    thumbnail: "https://somafm.com/img3/dronezone-400.jpg",
  },
  {
    id: "somafm_sonicuniverse",
    name: "Sonic Universe",
    genre: "Nu-Jazz / Avant-Garde",
    url: "https://ice2.somafm.com/sonicuniverse-256-mp3",
    thumbnail: "https://somafm.com/img3/sonicuniverse-400.jpg",
  },
  {
    id: "somafm_defcon",
    name: "DEF CON Radio",
    genre: "Cyberpunk / Electronic",
    url: "https://ice2.somafm.com/defcon-256-mp3",
    thumbnail: "https://somafm.com/img3/defcon-400.jpg",
  },
  {
    id: "somafm_lush",
    name: "Lush",
    genre: "Dream Pop / Chill Vocals",
    url: "https://ice2.somafm.com/lush-128-mp3",
    thumbnail: "https://somafm.com/img3/lush-400.jpg",
  },
  {
    id: "yt_lofigirl",
    name: "Lofi Girl — beats to relax/study to",
    genre: "24/7 YouTube Lo-Fi",
    url: "https://www.youtube.com/watch?v=jfKfPfyJRdk",
    thumbnail: "https://i.ytimg.com/vi/jfKfPfyJRdk/hqdefault.jpg",
  },
  {
    id: "yt_synthwaveboy",
    name: "Lofi Girl — Synthwave Radio",
    genre: "24/7 YouTube Synthwave",
    url: "https://www.youtube.com/watch?v=4xDzrJKXOOY",
    thumbnail: "https://i.ytimg.com/vi/4xDzrJKXOOY/hqdefault.jpg",
  },
];

interface RadioViewProps {
  currentTrackId?: string;
  isPlaying: boolean;
  isLoading: boolean;
  onPlayStation: (station: RadioStation) => void;
  onTogglePlay: () => void;
  onToast: (msg: string) => void;
}

export const RadioView: React.FC<RadioViewProps> = ({
  currentTrackId,
  isPlaying,
  isLoading,
  onPlayStation,
  onTogglePlay,
  onToast,
}) => {
  const [customStations, setCustomStations] = useState<RadioStation[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [genre, setGenre] = useState("");
  const [url, setUrl] = useState("");

  useEffect(() => {
    api.getCustomRadioStations().then(setCustomStations).catch(() => {});
  }, []);

  const handleAddStation = async () => {
    const cleanName = name.trim();
    const cleanUrl = url.trim();
    if (!cleanName || !cleanUrl) {
      onToast("Enter both a station name and stream URL");
      return;
    }
    if (!cleanUrl.startsWith("http://") && !cleanUrl.startsWith("https://")) {
      onToast("Stream URL must start with http:// or https://");
      return;
    }
    const nextStation: RadioStation = {
      id: `custom_${Date.now()}`,
      name: cleanName,
      genre: genre.trim() || "Custom Stream",
      url: cleanUrl,
      thumbnail: "",
      isCustom: true,
    };
    const nextList = [nextStation, ...customStations];
    setCustomStations(nextList);
    await api.saveCustomRadioStations(nextList).catch(() => {});
    setName("");
    setGenre("");
    setUrl("");
    setShowAdd(false);
    onToast(`Added radio station "${cleanName}"`);
  };

  const handleDeleteCustom = async (id: string) => {
    const nextList = customStations.filter((s) => s.id !== id);
    setCustomStations(nextList);
    await api.saveCustomRadioStations(nextList).catch(() => {});
    onToast("Removed custom station");
  };

  const renderCard = (st: RadioStation) => {
    const active = currentTrackId === `live_${st.id}`;
    return (
      <div
        key={st.id}
        className={`glass-card radio-card ${active ? "active" : ""}`}
        onClick={() => (active ? onTogglePlay() : onPlayStation(st))}
      >
        <div className="radio-card-art">
          {st.thumbnail ? (
            <img src={st.thumbnail} alt="" loading="lazy" />
          ) : (
            <div className="radio-card-art-fallback">
              <Waves size={26} style={{ opacity: 0.6 }} />
            </div>
          )}
          <div className="card-play-fab" style={{ opacity: active ? 1 : undefined }}>
            {active && isLoading ? (
              <Loader2 size={16} className="spin" />
            ) : active && isPlaying ? (
              <Pause size={16} />
            ) : (
              <Play size={16} style={{ marginLeft: 2 }} />
            )}
          </div>
          {active && (
            <span className="live-pill-badge radio-live-corner">
              <span className="live-dot" /> LIVE
            </span>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 6, minWidth: 0 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="media-title" style={{ fontSize: 13.5 }}>{st.name}</div>
            <div className="media-subtitle" style={{ fontSize: 12 }}>{st.genre}</div>
          </div>
          {st.isCustom && (
            <button
              className="icon-btn"
              style={{ width: 24, height: 24, flexShrink: 0 }}
              title="Delete custom station"
              onClick={(e) => {
                e.stopPropagation();
                handleDeleteCustom(st.id);
              }}
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div style={{ paddingBottom: 40 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 20 }}>
        <div>
          <div className="shelf-strapline" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Radio size={12} /> 24/7 AUDIO STREAMS
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-0.02em" }}>Live Radio Tuner</h1>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 2 }}>
            Stream curated 24/7 radio or custom Icecast, HLS (.m3u8), MP3, and YouTube Live URLs through your EQ & DSP.
          </p>
        </div>
        <button
          className={`glass-pill ${showAdd ? "active" : ""}`}
          onClick={() => setShowAdd((s) => !s)}
        >
          <Plus size={14} /> Add custom stream
        </button>
      </div>

      {showAdd && (
        <div className="glass-panel" style={{ padding: 16, marginBottom: 20, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>Add custom radio or YouTube Live URL</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <input
              className="glass-input"
              placeholder="Station name (e.g. Late Night Jazz)"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              className="glass-input"
              placeholder="Genre / tag (optional)"
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
            />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              className="glass-input"
              style={{ flex: 1 }}
              placeholder="https://... (.mp3, .aac, .m3u8, Icecast, or YouTube Live URL)"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddStation()}
            />
            <button className="glass-pill active" onClick={handleAddStation}>
              Save station
            </button>
          </div>
        </div>
      )}

      {customStations.length > 0 && (
        <section className="shelf">
          <div className="shelf-header">
            <h2 className="shelf-title">Your Custom Streams</h2>
          </div>
          <div className="radio-grid">
            {customStations.map(renderCard)}
          </div>
        </section>
      )}

      <section className="shelf">
        <div className="shelf-header">
          <h2 className="shelf-title">Curated 24/7 Stations</h2>
        </div>
        <div className="radio-grid">
          {CURATED_STATIONS.map(renderCard)}
        </div>
      </section>
    </div>
  );
};
