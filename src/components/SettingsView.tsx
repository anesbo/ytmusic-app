import React, { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  CheckCircle2,
  Copy,
  Crown,
  Download,
  FileText,
  FolderOpen,
  HardDrive,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  Palette,
  RefreshCw,
  RotateCcw,
  Sliders,
  Sparkles,
  Trash2,
  User,
} from "lucide-react";
import { api, formatBytes } from "../api";
import {
  DEFAULT_SETTINGS,
  EQ_LABELS,
  EQ_PRESETS,
  type AccountInfo,
  type AppSettings,
  type AudioDeviceInfo,
  type BinaryStatus,
  type CacheStats,
  type LogEntry,
} from "../types";

interface SettingsViewProps {
  initialTab?: "appearance" | "audio" | "downloads" | "account" | "logs";
  settings: AppSettings;
  account: AccountInfo;
  onUpdateSettings: (next: AppSettings) => void;
  onAccountChanged: (acc: AccountInfo) => void;
  onToast: (msg: string) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  initialTab,
  settings,
  account,
  onUpdateSettings,
  onAccountChanged,
  onToast,
}) => {
  const [tab, setTab] = useState<"appearance" | "audio" | "downloads" | "account" | "logs">(
    initialTab || "appearance"
  );
  const [devices, setDevices] = useState<AudioDeviceInfo[]>([]);
  const [binaries, setBinaries] = useState<BinaryStatus | null>(null);
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [updatingYtdlp, setUpdatingYtdlp] = useState(false);
  const [loginWindowOpened, setLoginWindowOpened] = useState(false);
  const [cookiesInput, setCookiesInput] = useState("");
  const [showCookieImport, setShowCookieImport] = useState(false);

  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    api.listAudioDevices().then(setDevices).catch(() => {});
    api.getBinaryStatus().then(setBinaries).catch(() => {});
    api.getCacheStats().then(setCacheStats).catch(() => {});
  }, []);

  useEffect(() => {
    if (tab === "logs") {
      api.getLogs().then(setLogs).catch(() => {});
    }
  }, [tab]);

  const updateGlass = (patch: Partial<AppSettings["glass"]>) => {
    onUpdateSettings({ ...settings, glass: { ...settings.glass, ...patch } });
  };

  const updateAudio = (patch: Partial<AppSettings["audio"]>) => {
    onUpdateSettings({ ...settings, audio: { ...settings.audio, ...patch } });
  };

  const updateEq = (patch: Partial<AppSettings["audio"]["eq"]>) => {
    onUpdateSettings({
      ...settings,
      audio: { ...settings.audio, eq: { ...settings.audio.eq, ...patch } },
    });
  };

  const updateDownloads = (patch: Partial<AppSettings["downloads"]>) => {
    onUpdateSettings({
      ...settings,
      downloads: { ...settings.downloads, ...patch },
    });
  };

  const pickDownloadFolder = async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected === "string" && selected) {
        updateDownloads({ directory: selected });
      }
    } catch (e) {
      onToast(`Folder picker error: ${e}`);
    }
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800 }}>Settings & Customization</h1>
          <p style={{ color: "var(--text-secondary)", fontSize: 13 }}>
            Every Liquid Glass visual parameter and pure-Rust DSP filter updates live
          </p>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        <button className={`glass-pill ${tab === "appearance" ? "active" : ""}`} onClick={() => setTab("appearance")}>
          <Palette size={14} /> Liquid Glass & UI
        </button>
        <button className={`glass-pill ${tab === "audio" ? "active" : ""}`} onClick={() => setTab("audio")}>
          <Sliders size={14} /> Audio Quality & 10-Band EQ
        </button>
        <button className={`glass-pill ${tab === "downloads" ? "active" : ""}`} onClick={() => setTab("downloads")}>
          <Download size={14} /> Downloads & Cache
        </button>
        <button className={`glass-pill ${tab === "account" ? "active" : ""}`} onClick={() => setTab("account")}>
          <User size={14} /> YT Music Account & Engine
        </button>
        <button className={`glass-pill ${tab === "logs" ? "active" : ""}`} onClick={() => setTab("logs")}>
          <FileText size={14} /> Diagnostics & Logs
        </button>
      </div>

      {/* ====================================================================
          TAB 1: LIQUID GLASS & APPEARANCE
         ==================================================================== */}
      {tab === "appearance" && (
        <div className="settings-grid">
          <div className="glass-panel setting-card">
            <h3 style={{ fontSize: 16, display: "flex", alignItems: "center", gap: 8 }}>
              <Sparkles size={16} style={{ color: "var(--accent)" }} /> Glass Material & Theme
            </h3>

            <div className="setting-row">
              <div>
                <div style={{ fontWeight: 600 }}>Enable Liquid Glass Effects</div>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                  Turn OFF for zero-blur solid Performance Mode (eliminates GPU lag)
                </div>
              </div>
              <button
                className={`toggle-switch ${settings.glass.liquidGlassEnabled ? "on" : ""}`}
                onClick={() =>
                  updateGlass({ liquidGlassEnabled: !settings.glass.liquidGlassEnabled })
                }
              >
                <span className="toggle-knob" />
              </button>
            </div>

            <div className="setting-row">
              <span>Theme Preset</span>
              <select
                className="glass-select"
                value={settings.glass.themeMode}
                onChange={(e) => updateGlass({ themeMode: e.target.value })}
              >
                <option value="adaptive">Adaptive Album Art Glass</option>
                <option value="obsidian">Obsidian Dark Glass</option>
                <option value="frosted_light">Frosted Light Glass</option>
                <option value="oled">OLED Pitch Black</option>
                <option value="aurora">Midnight Aurora</option>
              </select>
            </div>

            <div className="setting-row">
              <span>Glass Blur Radius ({settings.glass.blurPx}px)</span>
              <input
                type="range"
                className="range-input"
                min={0}
                max={60}
                value={settings.glass.blurPx}
                onChange={(e) => updateGlass({ blurPx: Number(e.target.value) })}
              />
            </div>

            <div className="setting-row">
              <span>Glass Frost Opacity ({Math.round(settings.glass.opacity * 100)}%)</span>
              <input
                type="range"
                className="range-input"
                min={0.1}
                max={0.95}
                step={0.02}
                value={settings.glass.opacity}
                onChange={(e) => updateGlass({ opacity: Number(e.target.value) })}
              />
            </div>

            <div className="setting-row">
              <span>Color Saturation ({settings.glass.saturation}%)</span>
              <input
                type="range"
                className="range-input"
                min={100}
                max={220}
                value={settings.glass.saturation}
                onChange={(e) => updateGlass({ saturation: Number(e.target.value) })}
              />
            </div>

            <div className="setting-row">
              <span>Specular Rim Highlight ({Math.round(settings.glass.specularStrength * 100)}%)</span>
              <input
                type="range"
                className="range-input"
                min={0}
                max={1}
                step={0.04}
                value={settings.glass.specularStrength}
                onChange={(e) => updateGlass({ specularStrength: Number(e.target.value) })}
              />
            </div>

            <div className="setting-row">
              <span>Corner Roundness ({settings.glass.borderRadius}px)</span>
              <input
                type="range"
                className="range-input"
                min={6}
                max={28}
                value={settings.glass.borderRadius}
                onChange={(e) => updateGlass({ borderRadius: Number(e.target.value) })}
              />
            </div>

            <div className="setting-row">
              <span>Ambient Mesh Speed ({settings.glass.meshSpeed.toFixed(1)}x)</span>
              <input
                type="range"
                className="range-input"
                min={0}
                max={2}
                step={0.1}
                value={settings.glass.meshSpeed}
                onChange={(e) => updateGlass({ meshSpeed: Number(e.target.value) })}
              />
            </div>
          </div>

          <div className="glass-panel setting-card">
            <h3 style={{ fontSize: 16 }}>Accent, Layout & Custom CSS</h3>

            <div className="setting-row">
              <span>Auto Accent from Album Art</span>
              <button
                className={`toggle-switch ${settings.glass.accentAuto ? "on" : ""}`}
                onClick={() => updateGlass({ accentAuto: !settings.glass.accentAuto })}
              >
                <span className="toggle-knob" />
              </button>
            </div>

            {!settings.glass.accentAuto && (
              <div className="setting-row">
                <span>Manual Accent Color</span>
                <input
                  type="color"
                  value={settings.glass.accentColor}
                  onChange={(e) => updateGlass({ accentColor: e.target.value })}
                  style={{ width: 44, height: 30, border: "none", background: "transparent", cursor: "pointer" }}
                />
              </div>
            )}

            <div className="setting-row">
              <span>Cursor Light Refraction</span>
              <button
                className={`toggle-switch ${settings.glass.cursorRefraction ? "on" : ""}`}
                onClick={() => updateGlass({ cursorRefraction: !settings.glass.cursorRefraction })}
              >
                <span className="toggle-knob" />
              </button>
            </div>

            <div className="setting-row">
              <span>Layout Density</span>
              <select
                className="glass-select"
                value={settings.glass.density}
                onChange={(e) => updateGlass({ density: e.target.value })}
              >
                <option value="compact">Compact</option>
                <option value="default">Default</option>
                <option value="cozy">Cozy</option>
              </select>
            </div>

            <div className="setting-row">
              <span>Sidebar Style</span>
              <select
                className="glass-select"
                value={settings.glass.sidebarMode}
                onChange={(e) => updateGlass({ sidebarMode: e.target.value })}
              >
                <option value="expanded">Expanded</option>
                <option value="rail">Compact Icon Rail</option>
              </select>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 13 }}>Custom CSS (Power Users)</span>
              <textarea
                className="glass-textarea"
                rows={4}
                placeholder="/* Override any CSS variables or glass styles */"
                value={settings.glass.customCss}
                onChange={(e) => updateGlass({ customCss: e.target.value })}
              />
            </div>

            <button
              className="glass-pill"
              style={{ alignSelf: "flex-start" }}
              onClick={() => updateGlass(DEFAULT_SETTINGS.glass)}
            >
              <RotateCcw size={14} /> Reset Liquid Glass Defaults
            </button>
          </div>
        </div>
      )}

      {/* ====================================================================
          TAB 2: AUDIO QUALITY & 10-BAND EQUALIZER
         ==================================================================== */}
      {tab === "audio" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="settings-grid">
            <div className="glass-panel setting-card">
              <h3 style={{ fontSize: 16 }}>Pure-Rust Audio Pipeline</h3>

              <div className="setting-row">
                <span>Output Device</span>
                <select
                  className="glass-select"
                  style={{ maxWidth: 220 }}
                  value={settings.audio.outputDevice || ""}
                  onChange={(e) =>
                    updateAudio({ outputDevice: e.target.value || null })
                  }
                >
                  <option value="">System Default</option>
                  {devices.map((d) => (
                    <option key={d.name} value={d.name}>
                      {d.name} {d.isDefault ? "(Default)" : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="setting-row">
                <div>
                  <div>Streaming Audio Quality</div>
                  <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                    Maximum unlocks Premium 256kbps Opus (#774) & AAC (#141)
                  </div>
                </div>
                <select
                  className="glass-select"
                  value={settings.audio.streamingQuality}
                  onChange={(e) => updateAudio({ streamingQuality: e.target.value })}
                >
                  <option value="maximum">Maximum (Premium 256k / Opus)</option>
                  <option value="high">High (Opus ~160k / AAC 128k)</option>
                  <option value="normal">Normal (~70–128k)</option>
                  <option value="saver">Data Saver (~48k)</option>
                </select>
              </div>

              <div className="setting-row">
                <div>
                  <div>Prefer Bit-Exact / Exclusive Path</div>
                  <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                    Matches source sample rate via CPAL when hardware supports it
                  </div>
                </div>
                <button
                  className={`toggle-switch ${settings.audio.exclusiveMode ? "on" : ""}`}
                  onClick={() => updateAudio({ exclusiveMode: !settings.audio.exclusiveMode })}
                >
                  <span className="toggle-knob" />
                </button>
              </div>

              <div className="setting-row">
                <span>Gapless Pre-Buffering</span>
                <button
                  className={`toggle-switch ${settings.audio.gapless ? "on" : ""}`}
                  onClick={() => updateAudio({ gapless: !settings.audio.gapless })}
                >
                  <span className="toggle-knob" />
                </button>
              </div>
            </div>

            <div className="glass-panel setting-card">
              <h3 style={{ fontSize: 16 }}>Loudness & Dynamics</h3>

              <div className="setting-row">
                <div>
                  <div>ReplayGain / LUFS Normalization</div>
                  <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                    Uses YouTube loudnessDb to eliminate track volume jumps
                  </div>
                </div>
                <button
                  className={`toggle-switch ${settings.audio.normalizeLoudness ? "on" : ""}`}
                  onClick={() =>
                    updateAudio({ normalizeLoudness: !settings.audio.normalizeLoudness })
                  }
                >
                  <span className="toggle-knob" />
                </button>
              </div>

              <div className="setting-row">
                <span>Target Loudness ({settings.audio.targetLufs.toFixed(1)} LUFS)</span>
                <input
                  type="range"
                  className="range-input"
                  min={-23}
                  max={-9}
                  step={0.5}
                  value={settings.audio.targetLufs}
                  onChange={(e) => updateAudio({ targetLufs: Number(e.target.value) })}
                />
              </div>

              <div className="setting-row">
                <div>
                  <div>Soft-Knee True-Peak Limiter</div>
                  <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                    Prevents digital clipping when boosting EQ bands
                  </div>
                </div>
                <button
                  className={`toggle-switch ${settings.audio.limiterEnabled ? "on" : ""}`}
                  onClick={() => updateAudio({ limiterEnabled: !settings.audio.limiterEnabled })}
                >
                  <span className="toggle-knob" />
                </button>
              </div>

              <div className="setting-row">
                <span>Crossfade ({settings.audio.crossfadeSecs.toFixed(1)}s)</span>
                <input
                  type="range"
                  className="range-input"
                  min={0}
                  max={12}
                  step={0.5}
                  value={settings.audio.crossfadeSecs}
                  onChange={(e) => updateAudio({ crossfadeSecs: Number(e.target.value) })}
                />
              </div>
            </div>
          </div>

          {/* 10-Band Visual Equalizer */}
          <div className="glass-panel setting-card">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <h3 style={{ fontSize: 16 }}>10-Band Real-Time Parametric Equalizer (Biquad DSP)</h3>
                <button
                  className={`toggle-switch ${settings.audio.eq.enabled ? "on" : ""}`}
                  onClick={() => updateEq({ enabled: !settings.audio.eq.enabled })}
                >
                  <span className="toggle-knob" />
                </button>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <select
                  className="glass-select"
                  value={settings.audio.eq.preset}
                  onChange={(e) => {
                    const name = e.target.value;
                    const bands = EQ_PRESETS[name];
                    if (bands) {
                      updateEq({ preset: name, bands: [...bands], enabled: true });
                    }
                  }}
                >
                  {Object.keys(EQ_PRESETS).map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                  {settings.audio.eq.preset === "Custom" && (
                    <option value="Custom">Custom</option>
                  )}
                </select>
                <button
                  className="glass-pill"
                  style={{ padding: "6px 12px", fontSize: 12 }}
                  onClick={() =>
                    updateEq({
                      preset: "Flat",
                      preampDb: 0,
                      balance: 0,
                      bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                    })
                  }
                >
                  Flatten
                </button>
              </div>
            </div>

            <div className="eq-grid" style={{ opacity: settings.audio.eq.enabled ? 1 : 0.45 }}>
              {EQ_LABELS.map((label, idx) => (
                <div key={label} className="eq-band">
                  <span style={{ fontSize: 11, color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>
                    {settings.audio.eq.bands[idx] > 0 ? "+" : ""}
                    {settings.audio.eq.bands[idx].toFixed(1)}
                  </span>
                  <input
                    type="range"
                    className="eq-slider-vertical"
                    min={-12}
                    max={12}
                    step={0.5}
                    value={settings.audio.eq.bands[idx]}
                    onChange={(e) => {
                      const next = [...settings.audio.eq.bands];
                      next[idx] = Number(e.target.value);
                      updateEq({ bands: next, preset: "Custom", enabled: true });
                    }}
                  />
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{label}Hz</span>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 28, marginTop: 4 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 13 }}>Preamp ({settings.audio.eq.preampDb.toFixed(1)} dB)</span>
                <input
                  type="range"
                  className="range-input"
                  min={-12}
                  max={12}
                  step={0.5}
                  value={settings.audio.eq.preampDb}
                  onChange={(e) => updateEq({ preampDb: Number(e.target.value) })}
                />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 13 }}>
                  Stereo Balance ({settings.audio.eq.balance === 0 ? "Center" : settings.audio.eq.balance < 0 ? `L ${Math.round(-settings.audio.eq.balance * 100)}%` : `R ${Math.round(settings.audio.eq.balance * 100)}%`})
                </span>
                <input
                  type="range"
                  className="range-input"
                  min={-1}
                  max={1}
                  step={0.05}
                  value={settings.audio.eq.balance}
                  onChange={(e) => updateEq({ balance: Number(e.target.value) })}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          TAB 3: DOWNLOADS & CACHE
         ==================================================================== */}
      {tab === "downloads" && (
        <div className="settings-grid">
          <div className="glass-panel setting-card">
            <h3 style={{ fontSize: 16 }}>Download Preferences</h3>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 13 }}>Download Directory</span>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  className="glass-input"
                  style={{ flex: 1 }}
                  value={settings.downloads.directory}
                  onChange={(e) => updateDownloads({ directory: e.target.value })}
                />
                <button className="glass-pill" onClick={pickDownloadFolder}>
                  <FolderOpen size={14} /> Browse
                </button>
              </div>
            </div>

            <div className="setting-row">
              <span>Audio File Format</span>
              <select
                className="glass-select"
                value={settings.downloads.format}
                onChange={(e) => updateDownloads({ format: e.target.value })}
              >
                <option value="original">Original Best (Zero Re-encoding)</option>
                <option value="opus">Opus (.opus)</option>
                <option value="m4a">AAC (.m4a)</option>
                <option value="mp3">MP3 (320 kbps)</option>
                <option value="flac">FLAC (Lossless Container)</option>
              </select>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 13 }}>Filename Template</span>
              <input
                className="glass-input"
                value={settings.downloads.filenameTemplate}
                onChange={(e) => updateDownloads({ filenameTemplate: e.target.value })}
              />
              <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                Variables: {"{artist}"}, {"{album}"}, {"{title}"}, {"{id}"}
              </span>
            </div>

            <div className="setting-row">
              <span>Embed High-Res Album Art</span>
              <button
                className={`toggle-switch ${settings.downloads.embedThumbnail ? "on" : ""}`}
                onClick={() => updateDownloads({ embedThumbnail: !settings.downloads.embedThumbnail })}
              >
                <span className="toggle-knob" />
              </button>
            </div>

            <div className="setting-row">
              <span>Offline Mode</span>
              <button
                className={`toggle-switch ${settings.downloads.offlineMode ? "on" : ""}`}
                onClick={() => updateDownloads({ offlineMode: !settings.downloads.offlineMode })}
              >
                <span className="toggle-knob" />
              </button>
            </div>
          </div>

          <div className="glass-panel setting-card">
            <h3 style={{ fontSize: 16, display: "flex", alignItems: "center", gap: 8 }}>
              <HardDrive size={16} /> LRU Audio Stream Cache
            </h3>
            <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              Streamed tracks are progressively cached locally for instant seeking, zero re-buffering, and seamless replays.
            </p>

            {cacheStats && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 6 }}>
                  <span>
                    Used: <strong>{formatBytes(cacheStats.usedBytes)}</strong> ({cacheStats.fileCount} tracks)
                  </span>
                  <span>Limit: {formatBytes(cacheStats.maxBytes)}</span>
                </div>
                <div className="seek-track" style={{ height: 6 }}>
                  <div
                    className="seek-fill"
                    style={{
                      width: `${Math.min(100, (cacheStats.usedBytes / Math.max(1, cacheStats.maxBytes)) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            )}

            <div className="setting-row">
              <span>Max Cache Size ({(settings.downloads.maxCacheMb / 1024).toFixed(1)} GB)</span>
              <input
                type="range"
                className="range-input"
                min={512}
                max={20480}
                step={512}
                value={settings.downloads.maxCacheMb}
                onChange={(e) => updateDownloads({ maxCacheMb: Number(e.target.value) })}
              />
            </div>

            <button
              className="glass-pill"
              style={{ alignSelf: "flex-start" }}
              onClick={async () => {
                const stats = await api.clearAudioCache();
                setCacheStats(stats);
                onToast("Audio stream cache cleared.");
              }}
            >
              <Trash2 size={14} /> Clear Audio Cache
            </button>
          </div>
        </div>
      )}

      {/* ====================================================================
          TAB 4: YOUTUBE MUSIC ACCOUNT & BINARIES
         ==================================================================== */}
      {tab === "account" && (
        <div className="settings-grid">
          <div className="glass-panel setting-card">
            <h3 style={{ fontSize: 16 }}>YouTube Music Account Sync</h3>
            <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              Sign in with your Google / YouTube Music account to sync your Home feed, Liked Music, Library Playlists, Subscriptions, and unlock <strong>256kbps Premium Opus/AAC</strong> streams.
            </p>

            {account.loggedIn ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: 14,
                  borderRadius: 14,
                  background: "rgba(255,255,255,0.06)",
                }}
              >
                {account.avatarUrl ? (
                  <img
                    src={account.avatarUrl}
                    alt=""
                    style={{ width: 48, height: 48, borderRadius: "50%", objectFit: "cover" }}
                  />
                ) : (
                  <div className="brand-orb" style={{ width: 48, height: 48, borderRadius: "50%" }}>
                    <User size={22} />
                  </div>
                )}
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                    {account.name || "YouTube Music Account"}
                    {account.isPremium && (
                      <span className="badge hires">
                        <Crown size={11} /> Premium 256k
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>
                    {account.handle || "Authenticated via " + account.authSource}
                  </div>
                </div>
                <button
                  className="glass-pill"
                  onClick={async () => {
                    const next = await api.logoutAccount();
                    onAccountChanged(next);
                    onToast("Signed out of YouTube Music.");
                  }}
                >
                  <LogOut size={14} /> Sign Out
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  <button
                    className="glass-pill active"
                    onClick={async () => {
                      await api.openYtMusicLogin();
                      setLoginWindowOpened(true);
                      onToast("Log in inside the YouTube Music window, then click 'Complete Sign-In'.");
                    }}
                  >
                    <LogIn size={15} /> Sign In with YouTube Music
                  </button>

                  {loginWindowOpened && (
                    <button
                      className="glass-pill"
                      style={{ borderColor: "#4ade80", color: "#86efac" }}
                      onClick={async () => {
                        try {
                          const acc = await api.finishYtMusicLogin();
                          onAccountChanged(acc);
                          setLoginWindowOpened(false);
                          onToast("Signed in to YouTube Music successfully!");
                        } catch (e) {
                          onToast(String(e));
                        }
                      }}
                    >
                      <CheckCircle2 size={15} /> Complete Sign-In
                    </button>
                  )}
                </div>

                <button
                  className="glass-pill"
                  style={{ alignSelf: "flex-start", fontSize: 12 }}
                  onClick={() => setShowCookieImport(!showCookieImport)}
                >
                  <KeyRound size={14} /> {showCookieImport ? "Hide" : "Or Import cookies.txt / Cookie Header"}
                </button>

                {showCookieImport && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <textarea
                      className="glass-textarea"
                      rows={4}
                      placeholder="Paste Netscape cookies.txt content or raw Cookie header from music.youtube.com..."
                      value={cookiesInput}
                      onChange={(e) => setCookiesInput(e.target.value)}
                    />
                    <button
                      className="glass-pill active"
                      style={{ alignSelf: "flex-start" }}
                      onClick={async () => {
                        try {
                          const acc = await api.importCookiesText(cookiesInput);
                          onAccountChanged(acc);
                          setCookiesInput("");
                          setShowCookieImport(false);
                          onToast("Account cookies imported & stored securely in OS keyring!");
                        } catch (e) {
                          onToast(String(e));
                        }
                      }}
                    >
                      Save & Connect Account
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="glass-panel setting-card">
            <h3 style={{ fontSize: 16 }}>Extraction Engine (yt-dlp & FFmpeg)</h3>

            <div className="setting-row">
              <div>
                <div style={{ fontWeight: 600 }}>yt-dlp</div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                  {binaries?.ytdlpInstalled
                    ? `Installed (${binaries.ytdlpVersion || "ready"})`
                    : "Not installed yet — click button below to auto-install"}
                </div>
              </div>
              <button
                className="glass-pill active"
                disabled={updatingYtdlp}
                onClick={async () => {
                  setUpdatingYtdlp(true);
                  try {
                    const msg = await api.installOrUpdateYtdlp();
                    const st = await api.getBinaryStatus();
                    setBinaries(st);
                    onToast(msg || "yt-dlp is up to date!");
                  } catch (e) {
                    onToast(`yt-dlp update failed: ${e}`);
                  } finally {
                    setUpdatingYtdlp(false);
                  }
                }}
              >
                {updatingYtdlp ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
                {binaries?.ytdlpInstalled ? "Update yt-dlp" : "Download yt-dlp"}
              </button>
            </div>

            <div className="setting-row">
              <div>
                <div style={{ fontWeight: 600 }}>FFmpeg</div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                  {binaries?.ffmpegInstalled
                    ? `Detected (${binaries.ffmpegVersion || "ready"})`
                    : "Optional for Original streams; required for MP3/FLAC conversion"}
                </div>
              </div>
              <span className="badge">
                {binaries?.ffmpegInstalled ? "Ready" : "Missing"}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          TAB 5: DIAGNOSTICS & LOG EXPORT
         ==================================================================== */}
      {tab === "logs" && (
        <div className="glass-panel setting-card">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
            <div>
              <h3 style={{ fontSize: 16 }}>Diagnostic Log Viewer & Exporter</h3>
              <p style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>
                Captures playback, yt-dlp, InnerTube, auth, and UI errors so you can export and share them in one click.
              </p>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                className="glass-pill active"
                onClick={async () => {
                  try {
                    const [savedPath] = await api.exportLogs();
                    onToast(`Exported diagnostic log to: ${savedPath}`);
                  } catch (e) {
                    onToast(`Export failed: ${e}`);
                  }
                }}
              >
                <Download size={14} /> Export Log to Desktop (.txt)
              </button>
              <button
                className="glass-pill"
                onClick={async () => {
                  try {
                    const [, fullText] = await api.exportLogs();
                    await navigator.clipboard.writeText(fullText);
                    onToast("Full diagnostic log copied to clipboard!");
                  } catch (e) {
                    onToast(`Copy failed: ${e}`);
                  }
                }}
              >
                <Copy size={14} /> Copy Full Log
              </button>
              <button
                className="glass-pill"
                onClick={() => api.getLogs().then(setLogs).catch(() => {})}
              >
                <RefreshCw size={14} /> Refresh
              </button>
              <button
                className="glass-pill"
                onClick={async () => {
                  await api.clearLogs();
                  setLogs([]);
                  onToast("Logs cleared.");
                }}
              >
                <Trash2 size={14} /> Clear
              </button>
            </div>
          </div>

          <div
            style={{
              background: "rgba(0,0,0,0.45)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 12,
              padding: 12,
              maxHeight: 420,
              overflowY: "auto",
              fontFamily: "Consolas, monospace",
              fontSize: 12,
              lineHeight: 1.55,
              userSelect: "text",
            }}
          >
            {logs.length === 0 ? (
              <div style={{ color: "var(--text-muted)" }}>No log entries recorded yet.</div>
            ) : (
              logs.map((entry, idx) => (
                <div
                  key={idx}
                  style={{
                    color:
                      entry.level === "ERROR"
                        ? "#ff7a8a"
                        : entry.level === "WARN"
                        ? "#ffd978"
                        : "var(--text-secondary)",
                    wordBreak: "break-word",
                  }}
                >
                  <span style={{ opacity: 0.55 }}>[{entry.timestamp}]</span>{" "}
                  <strong>[{entry.level}]</strong>{" "}
                  <span style={{ color: "#7dd3fc" }}>[{entry.scope}]</span> {entry.message}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
