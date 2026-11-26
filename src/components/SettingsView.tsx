import React, { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Check,
  CheckCircle2,
  CloudRain,
  Copy,
  Crown,
  Download,
  FileText,
  FolderOpen,
  HardDrive,
  Headphones,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  MicOff,
  Monitor,
  Palette,
  PictureInPicture2,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Share2,
  ShieldBan,
  Sliders,
  Sparkles,
  Trash2,
  User,
  Volume1,
  Wand2,
  X,
} from "lucide-react";
import { api, formatBytes } from "../api";
import { AMBIENCE_PRESETS, AUTOEQ_PROFILES, FX_PRESETS } from "../data/autoeq";
import {
  COLOR_PRESETS,
  DEFAULT_SETTINGS,
  EQ_LABELS,
  EQ_PRESETS,
  type AccountInfo,
  type AppSettings,
  type AppUpdateInfo,
  type AudioDeviceInfo,
  type BinaryStatus,
  type CacheStats,
  type ColorPreset,
  type LogEntry,
} from "../types";

interface SettingsViewProps {
  initialTab?: "appearance" | "audio" | "desktop" | "downloads" | "account" | "logs";
  settings: AppSettings;
  account: AccountInfo;
  onUpdateSettings: (next: AppSettings) => void;
  onAccountChanged: (acc: AccountInfo) => void;
  onToast: (msg: string) => void;
}

type SettingsTab = "appearance" | "audio" | "desktop" | "downloads" | "account" | "logs";

export const SettingsView: React.FC<SettingsViewProps> = ({
  initialTab,
  settings,
  account,
  onUpdateSettings,
  onAccountChanged,
  onToast,
}) => {
  const [tab, setTab] = useState<SettingsTab>(initialTab || "appearance");
  const [devices, setDevices] = useState<AudioDeviceInfo[]>([]);
  const [binaries, setBinaries] = useState<BinaryStatus | null>(null);
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [updatingYtdlp, setUpdatingYtdlp] = useState(false);
  const [scanningFolders, setScanningFolders] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<AppUpdateInfo | null>(null);
  const [autoEqQuery, setAutoEqQuery] = useState("");
  const [presetCodeInput, setPresetCodeInput] = useState("");
  const [blockedArtistInput, setBlockedArtistInput] = useState("");
  const [blockedKeywordInput, setBlockedKeywordInput] = useState("");
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

  const applyThemePreset = (preset: ColorPreset) => {
    updateGlass({
      themeMode: preset.themeMode,
      customColorsEnabled: !preset.accentAuto,
      bgColor: preset.bgColor,
      surfaceColor: preset.surfaceColor,
      accentAuto: Boolean(preset.accentAuto),
      accentColor: preset.accentColor,
      textColor: preset.textColor,
      mutedTextColor: preset.mutedTextColor,
    });
  };

  const isPresetActive = (p: ColorPreset) => {
    if (p.accentAuto) {
      return settings.glass.themeMode === "adaptive" && settings.glass.accentAuto;
    }
    return (
      settings.glass.customColorsEnabled &&
      settings.glass.bgColor.toLowerCase() === p.bgColor.toLowerCase() &&
      settings.glass.accentColor.toLowerCase() === p.accentColor.toLowerCase()
    );
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

  const navItems: Array<{ id: SettingsTab; label: string; icon: React.ReactNode }> = [
    { id: "appearance", label: "Appearance", icon: <Palette size={16} /> },
    { id: "audio", label: "Audio & EQ", icon: <Sliders size={16} /> },
    { id: "desktop", label: "Desktop & integrations", icon: <Monitor size={16} /> },
    { id: "downloads", label: "Downloads & local", icon: <Download size={16} /> },
    { id: "account", label: "Account & engine", icon: <User size={16} /> },
    { id: "logs", label: "Diagnostics & logs", icon: <FileText size={16} /> },
  ];

  return (
    <div className="settings-layout">
      {/* Left Settings Navigation Rail */}
      <nav className="settings-nav" aria-label="Settings sections">
        <div className="settings-nav-title">Settings</div>
        {navItems.map((item) => (
          <button
            key={item.id}
            className={`settings-nav-btn ${tab === item.id ? "active" : ""}`}
            onClick={() => setTab(item.id)}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      {/* Right Focused Settings Content Column */}
      <div className="settings-content">
        {/* ================================================================
            APPEARANCE (Themes + Liquid Glass + Custom Colors + Layout)
           ================================================================ */}
        {tab === "appearance" && (
          <div className="settings-stack">
            <header className="settings-page-header">
              <h2>Appearance</h2>
              <p>Choose a theme, toggle Liquid Glass translucency, or tune individual colors.</p>
            </header>

            {/* Unified Liquid Glass & Themes Section */}
            <section className="settings-section">
              <div className="settings-row">
                <div>
                  <div className="settings-label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Sparkles size={15} style={{ color: "var(--accent)" }} /> Liquid Glass
                  </div>
                  <div className="settings-desc">
                    Frosted window translucency and ambient background gradient. Turn off for solid zero-blur mode.
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

              <div className="settings-divider" />

              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div className="settings-label">Themes</div>
                  <span style={{ fontSize: 12, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
                    {COLOR_PRESETS.length} presets
                  </span>
                </div>
                <div className="settings-theme-grid">
                  {COLOR_PRESETS.map((preset) => {
                    const active = isPresetActive(preset);
                    return (
                      <button
                        key={preset.name}
                        className={`appearance-theme-btn ${active ? "active" : ""}`}
                        onClick={() => applyThemePreset(preset)}
                      >
                        <span className="color-dots">
                          <span className="color-dot" style={{ background: preset.bgColor }} />
                          <span className="color-dot" style={{ background: preset.surfaceColor }} />
                          <span className="color-dot" style={{ background: preset.accentColor }} />
                        </span>
                        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {preset.name}
                        </span>
                        {active && <Check size={14} style={{ color: "var(--accent)", flexShrink: 0 }} />}
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>

            {/* Liquid Glass Material Sliders (when enabled) */}
            {settings.glass.liquidGlassEnabled && (
              <section className="settings-section">
                <div className="settings-section-title">Glass material</div>

                <div className="settings-row">
                  <span className="settings-label">Blur radius</span>
                  <div className="settings-control">
                    <span className="settings-value">{settings.glass.blurPx}px</span>
                    <input
                      type="range"
                      className="range-input"
                      min={0}
                      max={60}
                      value={settings.glass.blurPx}
                      onChange={(e) => updateGlass({ blurPx: Number(e.target.value) })}
                    />
                  </div>
                </div>

                <div className="settings-row">
                  <span className="settings-label">Surface opacity</span>
                  <div className="settings-control">
                    <span className="settings-value">{Math.round(settings.glass.opacity * 100)}%</span>
                    <input
                      type="range"
                      className="range-input"
                      min={0.15}
                      max={0.95}
                      step={0.02}
                      value={settings.glass.opacity}
                      onChange={(e) => updateGlass({ opacity: Number(e.target.value) })}
                    />
                  </div>
                </div>

                <div className="settings-row">
                  <span className="settings-label">Color saturation</span>
                  <div className="settings-control">
                    <span className="settings-value">{settings.glass.saturation}%</span>
                    <input
                      type="range"
                      className="range-input"
                      min={100}
                      max={200}
                      value={settings.glass.saturation}
                      onChange={(e) => updateGlass({ saturation: Number(e.target.value) })}
                    />
                  </div>
                </div>

                <div className="settings-row">
                  <span className="settings-label">Border highlight</span>
                  <div className="settings-control">
                    <span className="settings-value">{Math.round(settings.glass.specularStrength * 100)}%</span>
                    <input
                      type="range"
                      className="range-input"
                      min={0}
                      max={1}
                      step={0.05}
                      value={settings.glass.specularStrength}
                      onChange={(e) => updateGlass({ specularStrength: Number(e.target.value) })}
                    />
                  </div>
                </div>

                <div className="settings-row">
                  <span className="settings-label">Ambient motion speed</span>
                  <div className="settings-control">
                    <span className="settings-value">{settings.glass.meshSpeed.toFixed(1)}x</span>
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

                <div className="settings-row">
                  <span className="settings-label">Cursor refraction</span>
                  <button
                    className={`toggle-switch ${settings.glass.cursorRefraction ? "on" : ""}`}
                    onClick={() => updateGlass({ cursorRefraction: !settings.glass.cursorRefraction })}
                  >
                    <span className="toggle-knob" />
                  </button>
                </div>
              </section>
            )}

            {/* Custom Color Studio */}
            <section className="settings-section">
              <div className="settings-section-title">Custom colors</div>

              <div className="settings-row">
                <div>
                  <div className="settings-label">Custom color palette</div>
                  <div className="settings-desc">Override background, card surfaces, and text colors manually.</div>
                </div>
                <button
                  className={`toggle-switch ${settings.glass.customColorsEnabled ? "on" : ""}`}
                  onClick={() =>
                    updateGlass({ customColorsEnabled: !settings.glass.customColorsEnabled })
                  }
                >
                  <span className="toggle-knob" />
                </button>
              </div>

              {settings.glass.customColorsEnabled && (
                <div className="settings-color-rows">
                  {(
                    [
                      ["Background", "bgColor"],
                      ["Surface & cards", "surfaceColor"],
                      ["Primary text", "textColor"],
                      ["Secondary text", "mutedTextColor"],
                    ] as const
                  ).map(([label, field]) => (
                    <div key={field} className="settings-row">
                      <span className="settings-label">{label}</span>
                      <div className="settings-control">
                        <span className="badge">{settings.glass[field]}</span>
                        <input
                          type="color"
                          value={settings.glass[field]}
                          onChange={(e) => updateGlass({ [field]: e.target.value })}
                          className="color-input-chip"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="settings-row">
                <span className="settings-label">Auto accent from album art</span>
                <button
                  className={`toggle-switch ${settings.glass.accentAuto ? "on" : ""}`}
                  onClick={() => updateGlass({ accentAuto: !settings.glass.accentAuto })}
                >
                  <span className="toggle-knob" />
                </button>
              </div>

              {!settings.glass.accentAuto && (
                <div className="settings-row">
                  <span className="settings-label">Accent color</span>
                  <div className="settings-control">
                    <span className="badge">{settings.glass.accentColor}</span>
                    <input
                      type="color"
                      value={settings.glass.accentColor}
                      onChange={(e) => updateGlass({ accentColor: e.target.value })}
                      className="color-input-chip"
                    />
                  </div>
                </div>
              )}
            </section>

            {/* Layout & Reset */}
            <section className="settings-section">
              <div className="settings-section-title">Layout</div>

              <div className="settings-row">
                <span className="settings-label">Corner radius</span>
                <div className="settings-control">
                  <span className="settings-value">{settings.glass.borderRadius}px</span>
                  <input
                    type="range"
                    className="range-input"
                    min={6}
                    max={24}
                    value={settings.glass.borderRadius}
                    onChange={(e) => updateGlass({ borderRadius: Number(e.target.value) })}
                  />
                </div>
              </div>

              <div className="settings-row">
                <span className="settings-label">Density</span>
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

              <div className="settings-row">
                <span className="settings-label">Sidebar</span>
                <select
                  className="glass-select"
                  value={settings.glass.sidebarMode}
                  onChange={(e) => updateGlass({ sidebarMode: e.target.value })}
                >
                  <option value="expanded">Expanded</option>
                  <option value="rail">Compact rail</option>
                </select>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span className="settings-label">Custom CSS</span>
                <textarea
                  className="glass-textarea"
                  rows={3}
                  placeholder="/* Optional CSS overrides */"
                  value={settings.glass.customCss}
                  onChange={(e) => updateGlass({ customCss: e.target.value })}
                />
              </div>

              <div>
                <button
                  className="glass-pill"
                  onClick={() => updateGlass(DEFAULT_SETTINGS.glass)}
                >
                  <RotateCcw size={14} /> Reset appearance
                </button>
              </div>
            </section>

            {/* Shareable Theme & EQ Preset Codes (LYTM1:...) */}
            <section className="settings-section">
              <div className="settings-section-title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Share2 size={14} /> Shareable preset codes
              </div>
              <div className="settings-desc">
                Share your entire Liquid Glass theme, 10-band EQ, and Studio FX setup as a single compact code (`LYTM1:...`).
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  className="glass-pill active"
                  onClick={async () => {
                    try {
                      const payload = {
                        v: 1,
                        glass: settings.glass,
                        eq: settings.audio.eq,
                        fx: settings.audio.fx,
                      };
                      const json = JSON.stringify(payload);
                      const bytes = new TextEncoder().encode(json);
                      let bin = "";
                      bytes.forEach((b) => (bin += String.fromCharCode(b)));
                      const code = `LYTM1:${btoa(bin)}`;
                      await navigator.clipboard.writeText(code);
                      onToast("Copied your LYTM1 preset code to clipboard");
                    } catch (e) {
                      onToast(`Copy failed: ${e}`);
                    }
                  }}
                >
                  <Copy size={14} /> Copy my preset code
                </button>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                <input
                  className="glass-input"
                  style={{ flex: 1, fontSize: 12.5 }}
                  placeholder="Paste a LYTM1:... preset code to import"
                  value={presetCodeInput}
                  onChange={(e) => setPresetCodeInput(e.target.value)}
                />
                <button
                  className="glass-pill"
                  disabled={!presetCodeInput.trim()}
                  onClick={() => {
                    try {
                      const raw = presetCodeInput.trim();
                      const b64 = raw.startsWith("LYTM1:") ? raw.slice(6) : raw;
                      const bin = atob(b64);
                      const bytes = new Uint8Array(bin.length);
                      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                      const parsed = JSON.parse(new TextDecoder().decode(bytes));
                      if (!parsed || typeof parsed !== "object") {
                        throw new Error("Invalid preset structure");
                      }
                      const next: AppSettings = {
                        ...settings,
                        glass: parsed.glass ? { ...settings.glass, ...parsed.glass } : settings.glass,
                        audio: {
                          ...settings.audio,
                          eq: parsed.eq ? { ...settings.audio.eq, ...parsed.eq } : settings.audio.eq,
                          fx: parsed.fx ? { ...settings.audio.fx, ...parsed.fx } : settings.audio.fx,
                        },
                      };
                      onUpdateSettings(next);
                      setPresetCodeInput("");
                      onToast("Imported theme & EQ preset code");
                    } catch (e) {
                      onToast(`Invalid preset code: ${e}`);
                    }
                  }}
                >
                  Import code
                </button>
              </div>
            </section>
          </div>
        )}

        {/* ================================================================
            AUDIO & 10-BAND EQUALIZER
           ================================================================ */}
        {tab === "audio" && (
          <div className="settings-stack">
            <header className="settings-page-header">
              <h2>Audio & equalizer</h2>
              <p>Configure output hardware, streaming quality, loudness normalization, and live 10-band EQ.</p>
            </header>

            <section className="settings-section">
              <div className="settings-section-title">Output & quality</div>

              <div className="settings-row">
                <div>
                  <div className="settings-label">Output device</div>
                  <div className="settings-desc">
                    {(() => {
                      const devKey = settings.audio.outputDevice || "default";
                      const bound = settings.audio.deviceEqProfiles?.[devKey];
                      return bound
                        ? `Auto-EQ bound: ${bound.preset}`
                        : "Select playback hardware; save custom EQ per device below.";
                    })()}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <select
                    className="glass-select"
                    style={{ maxWidth: 230 }}
                    value={settings.audio.outputDevice || ""}
                    onChange={(e) => {
                      const nextDev = e.target.value || null;
                      const key = nextDev || "default";
                      const savedEq = settings.audio.deviceEqProfiles?.[key];
                      updateAudio(savedEq ? { outputDevice: nextDev, eq: { ...savedEq } } : { outputDevice: nextDev });
                      if (savedEq) onToast(`Auto-loaded EQ profile "${savedEq.preset}" for this device`);
                    }}
                  >
                    <option value="">System default</option>
                    {devices.map((d) => (
                      <option key={d.name} value={d.name}>
                        {d.name} {d.isDefault ? "(Default)" : ""}
                      </option>
                    ))}
                  </select>
                  <button
                    className="glass-pill"
                    style={{ padding: "5px 9px", fontSize: 12 }}
                    title="Save current EQ settings for this output device"
                    onClick={() => {
                      const key = settings.audio.outputDevice || "default";
                      updateAudio({
                        deviceEqProfiles: {
                          ...(settings.audio.deviceEqProfiles || {}),
                          [key]: { ...settings.audio.eq },
                        },
                      });
                      onToast(`Saved EQ "${settings.audio.eq.preset}" for ${settings.audio.outputDevice || "Default Device"}`);
                    }}
                  >
                    <Save size={13} /> Save EQ
                  </button>
                </div>
              </div>

              <div className="settings-row">
                <div>
                  <div className="settings-label">Streaming quality</div>
                  <div className="settings-desc">Maximum prefers Premium 256 kbps Opus/AAC when signed in.</div>
                </div>
                <select
                  className="glass-select"
                  value={settings.audio.streamingQuality}
                  onChange={(e) => updateAudio({ streamingQuality: e.target.value })}
                >
                  <option value="maximum">Maximum (Premium 256k / Opus)</option>
                  <option value="high">High (Opus ~160k / AAC)</option>
                  <option value="normal">Normal (~70–128k)</option>
                  <option value="saver">Data saver (~48k)</option>
                </select>
              </div>

              <div className="settings-row">
                <div>
                  <div className="settings-label">Pre-cache next track</div>
                  <div className="settings-desc">Buffers upcoming songs in the background for instant transitions.</div>
                </div>
                <button
                  className={`toggle-switch ${settings.audio.gapless ? "on" : ""}`}
                  onClick={() => updateAudio({ gapless: !settings.audio.gapless })}
                >
                  <span className="toggle-knob" />
                </button>
              </div>

              <div className="settings-row">
                <div>
                  <div className="settings-label">WASAPI bit-perfect / exclusive mode</div>
                  <div className="settings-desc">Requests the highest native DAC sample rate (up to 96 kHz F32).</div>
                </div>
                <button
                  className={`toggle-switch ${settings.audio.exclusiveMode ? "on" : ""}`}
                  onClick={() => updateAudio({ exclusiveMode: !settings.audio.exclusiveMode })}
                >
                  <span className="toggle-knob" />
                </button>
              </div>

              <div className="settings-row">
                <div>
                  <div className="settings-label">Crossfade</div>
                  <div className="settings-desc">Smooth fade-in and fade-out transitions between tracks (0s = gapless).</div>
                </div>
                <div className="settings-control">
                  <span className="settings-value">
                    {settings.audio.crossfadeSecs === 0 ? "Off" : `${settings.audio.crossfadeSecs.toFixed(1)}s`}
                  </span>
                  <input
                    type="range"
                    className="range-input"
                    min={0}
                    max={8}
                    step={0.5}
                    value={settings.audio.crossfadeSecs}
                    onChange={(e) => updateAudio({ crossfadeSecs: Number(e.target.value) })}
                  />
                </div>
              </div>

              <div className="settings-row">
                <div>
                  <div className="settings-label">Playback speed</div>
                  <div className="settings-desc">Adjust tempo from 0.5x to 2.0x; disable pitch lock for slowed/nightcore.</div>
                </div>
                <div className="settings-control">
                  <span className="settings-value">{settings.audio.playbackSpeed.toFixed(2)}x</span>
                  <input
                    type="range"
                    className="range-input"
                    min={0.5}
                    max={2.0}
                    step={0.05}
                    value={settings.audio.playbackSpeed}
                    onChange={(e) => updateAudio({ playbackSpeed: Number(e.target.value) })}
                  />
                </div>
              </div>

              <div className="settings-row">
                <span className="settings-label">Preserve pitch when changing speed</span>
                <button
                  className={`toggle-switch ${settings.audio.preservePitch ? "on" : ""}`}
                  onClick={() => updateAudio({ preservePitch: !settings.audio.preservePitch })}
                >
                  <span className="toggle-knob" />
                </button>
              </div>

              <div className="settings-row">
                <div>
                  <div className="settings-label">Musical pitch shift (semitones)</div>
                  <div className="settings-desc">Transpose key from -6 to +6 semitones independently of playback speed.</div>
                </div>
                <div className="settings-control">
                  <span className="settings-value">
                    {(settings.audio.pitchSemitones ?? 0) > 0 ? "+" : ""}
                    {(settings.audio.pitchSemitones ?? 0).toFixed(1)} st
                  </span>
                  <input
                    type="range"
                    className="range-input"
                    min={-6}
                    max={6}
                    step={0.5}
                    value={settings.audio.pitchSemitones ?? 0}
                    onChange={(e) => {
                      const st = Number(e.target.value);
                      updateAudio({ pitchSemitones: st });
                      api.setPitchSemitones(st).catch(() => {});
                    }}
                  />
                </div>
              </div>

              <div className="settings-row">
                <div>
                  <div className="settings-label">Real-time audio visualizer</div>
                  <div className="settings-desc">32-band FFT spectrum in Now Playing and player bar. Off uses 0% CPU.</div>
                </div>
                <button
                  className={`toggle-switch ${settings.audio.visualizerEnabled ? "on" : ""}`}
                  onClick={() => updateAudio({ visualizerEnabled: !settings.audio.visualizerEnabled })}
                >
                  <span className="toggle-knob" />
                </button>
              </div>

              <div className="settings-row">
                <div>
                  <div className="settings-label">SponsorBlock auto-skip</div>
                  <div className="settings-desc">Automatically skips non-music intros and outros on official music videos.</div>
                </div>
                <button
                  className={`toggle-switch ${settings.audio.sponsorblockEnabled ? "on" : ""}`}
                  onClick={() => updateAudio({ sponsorblockEnabled: !settings.audio.sponsorblockEnabled })}
                >
                  <span className="toggle-knob" />
                </button>
              </div>

              <div className="settings-row">
                <div>
                  <div className="settings-label">Smooth 180ms fade on pause / resume</div>
                  <div className="settings-desc">Glides volume smoothly down and up when pressing Space instead of hard-cutting.</div>
                </div>
                <button
                  className={`toggle-switch ${settings.audio.fadeOnPause ? "on" : ""}`}
                  onClick={() => updateAudio({ fadeOnPause: !settings.audio.fadeOnPause })}
                >
                  <span className="toggle-knob" />
                </button>
              </div>

              <div className="settings-row">
                <div>
                  <div className="settings-label">Smart silence trimmer</div>
                  <div className="settings-desc">Automatically skips dead silence (&lt; -49 dBFS) at track intros and long outros.</div>
                </div>
                <button
                  className={`toggle-switch ${settings.audio.trimSilence ? "on" : ""}`}
                  onClick={() => updateAudio({ trimSilence: !settings.audio.trimSilence })}
                >
                  <span className="toggle-knob" />
                </button>
              </div>

              <div className="settings-row">
                <div>
                  <div className="settings-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Volume1 size={14} style={{ color: "var(--accent)" }} /> Smart auto-ducking (Windows audio awareness)
                  </div>
                  <div className="settings-desc">
                    Smoothly lowers music volume when Discord, browser videos, or calls play audio, then glides back up.
                  </div>
                </div>
                <button
                  className={`toggle-switch ${settings.audio.autoDucking ? "on" : ""}`}
                  onClick={() => updateAudio({ autoDucking: !settings.audio.autoDucking })}
                >
                  <span className="toggle-knob" />
                </button>
              </div>

              {settings.audio.autoDucking && (
                <div className="settings-row">
                  <span className="settings-label">Ducked volume level</span>
                  <div className="settings-control">
                    <span className="settings-value">
                      {Math.round((settings.audio.duckLevel ?? 0.25) * 100)}%
                    </span>
                    <input
                      type="range"
                      className="range-input"
                      min={0.05}
                      max={0.75}
                      step={0.05}
                      value={settings.audio.duckLevel ?? 0.25}
                      onChange={(e) => updateAudio({ duckLevel: Number(e.target.value) })}
                    />
                  </div>
                </div>
              )}
            </section>

            {/* Smart Skip Filters */}
            <section className="settings-section">
              <div className="settings-section-title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <ShieldBan size={14} /> Smart skip filters
              </div>
              <div className="settings-row">
                <div>
                  <div className="settings-label">Auto-skip disliked songs</div>
                  <div className="settings-desc">Skip tracks you marked with Thumbs Down during queue & radio playback.</div>
                </div>
                <button
                  className={`toggle-switch ${settings.skipDisliked ? "on" : ""}`}
                  onClick={() => onUpdateSettings({ ...settings, skipDisliked: !settings.skipDisliked })}
                >
                  <span className="toggle-knob" />
                </button>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span className="settings-label">Blocked artists</span>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    className="glass-input"
                    style={{ flex: 1, fontSize: 12.5 }}
                    placeholder="Artist name to always skip..."
                    value={blockedArtistInput}
                    onChange={(e) => setBlockedArtistInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && blockedArtistInput.trim()) {
                        const v = blockedArtistInput.trim();
                        if (!(settings.blockedArtists || []).some((a) => a.toLowerCase() === v.toLowerCase())) {
                          onUpdateSettings({
                            ...settings,
                            blockedArtists: [...(settings.blockedArtists || []), v],
                          });
                        }
                        setBlockedArtistInput("");
                      }
                    }}
                  />
                  <button
                    className="glass-pill"
                    onClick={() => {
                      const v = blockedArtistInput.trim();
                      if (!v) return;
                      if (!(settings.blockedArtists || []).some((a) => a.toLowerCase() === v.toLowerCase())) {
                        onUpdateSettings({
                          ...settings,
                          blockedArtists: [...(settings.blockedArtists || []), v],
                        });
                      }
                      setBlockedArtistInput("");
                    }}
                  >
                    <Plus size={13} /> Add
                  </button>
                </div>
                {(settings.blockedArtists || []).length > 0 && (
                  <div className="filter-chip-row">
                    {(settings.blockedArtists || []).map((art) => (
                      <span key={art} className="glass-pill" style={{ padding: "3px 9px", fontSize: 12 }}>
                        {art}
                        <X
                          size={12}
                          style={{ cursor: "pointer", opacity: 0.7 }}
                          onClick={() =>
                            onUpdateSettings({
                              ...settings,
                              blockedArtists: (settings.blockedArtists || []).filter((x) => x !== art),
                            })
                          }
                        />
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span className="settings-label">Blocked title keywords</span>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    className="glass-input"
                    style={{ flex: 1, fontSize: 12.5 }}
                    placeholder="e.g. (Live), (Clean), (Sped Up)..."
                    value={blockedKeywordInput}
                    onChange={(e) => setBlockedKeywordInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && blockedKeywordInput.trim()) {
                        const v = blockedKeywordInput.trim();
                        if (!(settings.blockedKeywords || []).some((k) => k.toLowerCase() === v.toLowerCase())) {
                          onUpdateSettings({
                            ...settings,
                            blockedKeywords: [...(settings.blockedKeywords || []), v],
                          });
                        }
                        setBlockedKeywordInput("");
                      }
                    }}
                  />
                  <button
                    className="glass-pill"
                    onClick={() => {
                      const v = blockedKeywordInput.trim();
                      if (!v) return;
                      if (!(settings.blockedKeywords || []).some((k) => k.toLowerCase() === v.toLowerCase())) {
                        onUpdateSettings({
                          ...settings,
                          blockedKeywords: [...(settings.blockedKeywords || []), v],
                        });
                      }
                      setBlockedKeywordInput("");
                    }}
                  >
                    <Plus size={13} /> Add
                  </button>
                </div>
                <div className="filter-chip-row">
                  {["(Live)", "(Clean)", "(Remix)", "(Sped Up)", "(Instrumental)"].map((preset) => {
                    const active = (settings.blockedKeywords || []).some(
                      (k) => k.toLowerCase() === preset.toLowerCase()
                    );
                    return (
                      <button
                        key={preset}
                        className={`glass-pill ${active ? "active" : ""}`}
                        style={{ padding: "3px 9px", fontSize: 11.5 }}
                        onClick={() => {
                          const cur = settings.blockedKeywords || [];
                          const next = active
                            ? cur.filter((k) => k.toLowerCase() !== preset.toLowerCase())
                            : [...cur, preset];
                          onUpdateSettings({ ...settings, blockedKeywords: next });
                        }}
                      >
                        {preset}
                      </button>
                    );
                  })}
                </div>
                {(settings.blockedKeywords || []).length > 0 && (
                  <div className="filter-chip-row">
                    {(settings.blockedKeywords || []).map((kw) => (
                      <span key={kw} className="glass-pill" style={{ padding: "3px 9px", fontSize: 12 }}>
                        {kw}
                        <X
                          size={12}
                          style={{ cursor: "pointer", opacity: 0.7 }}
                          onClick={() =>
                            onUpdateSettings({
                              ...settings,
                              blockedKeywords: (settings.blockedKeywords || []).filter((x) => x !== kw),
                            })
                          }
                        />
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </section>

            <section className="settings-section">
              <div className="settings-section-title">Loudness & protection</div>

              <div className="settings-row">
                <div>
                  <div className="settings-label">Loudness normalization</div>
                  <div className="settings-desc">Balances volume differences across tracks using loudness metadata.</div>
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

              <div className="settings-row">
                <span className="settings-label">Target loudness</span>
                <div className="settings-control">
                  <span className="settings-value">{settings.audio.targetLufs.toFixed(1)} LUFS</span>
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
              </div>

              <div className="settings-row">
                <div>
                  <div className="settings-label">Peak clipper protection</div>
                  <div className="settings-desc">Only engages above -0.15 dBFS when EQ boosts exceed digital full scale.</div>
                </div>
                <button
                  className={`toggle-switch ${settings.audio.limiterEnabled ? "on" : ""}`}
                  onClick={() => updateAudio({ limiterEnabled: !settings.audio.limiterEnabled })}
                >
                  <span className="toggle-knob" />
                </button>
              </div>
            </section>

            <section className="settings-section">
              <div className="settings-row">
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span className="settings-section-title" style={{ margin: 0 }}>10-band equalizer</span>
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
                      if (bands) updateEq({ preset: name, bands: [...bands], enabled: true });
                    }}
                  >
                    {Object.keys(EQ_PRESETS).map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                    {settings.audio.eq.preset === "Custom" && <option value="Custom">Custom</option>}
                  </select>
                  <button
                    className="glass-pill"
                    style={{ padding: "5px 12px", fontSize: 12 }}
                    onClick={() =>
                      updateEq({
                        preset: "Flat",
                        preampDb: 0,
                        balance: 0,
                        bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                      })
                    }
                  >
                    Reset
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

              <div className="settings-row">
                <span className="settings-label">Preamp</span>
                <div className="settings-control">
                  <span className="settings-value">{settings.audio.eq.preampDb.toFixed(1)} dB</span>
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
              </div>

              <div className="settings-row">
                <span className="settings-label">Stereo balance</span>
                <div className="settings-control">
                  <span className="settings-value">
                    {settings.audio.eq.balance === 0
                      ? "Center"
                      : settings.audio.eq.balance < 0
                      ? `L ${Math.round(-settings.audio.eq.balance * 100)}%`
                      : `R ${Math.round(settings.audio.eq.balance * 100)}%`}
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
            </section>

            {/* Studio FX Rack (Pure-Rust Reverb, 8D Spatial, Lo-Fi Vinyl, Sub-Bass, Mono) */}
            <section className="settings-section">
              <div className="settings-section-title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Wand2 size={14} /> Studio FX rack
              </div>
              <div className="settings-theme-grid">
                {FX_PRESETS.map((p) => {
                  const active = (settings.audio.fx?.preset || "off") === p.id;
                  return (
                    <button
                      key={p.id}
                      className={`appearance-theme-btn ${active ? "active" : ""}`}
                      style={{ flexDirection: "column", alignItems: "flex-start", gap: 2 }}
                      onClick={() => {
                        const patch: Partial<AppSettings["audio"]> = { fx: { ...p.fx } };
                        if (p.suggestedSpeed !== undefined) patch.playbackSpeed = p.suggestedSpeed;
                        if (p.suggestedPreservePitch !== undefined) patch.preservePitch = p.suggestedPreservePitch;
                        updateAudio(patch);
                        if (p.suggestedSpeed !== undefined) {
                          api.setPlaybackSpeed(p.suggestedSpeed, p.suggestedPreservePitch ?? true).catch(() => {});
                        }
                        onToast(`Applied FX: ${p.label}`);
                      }}
                    >
                      <span style={{ fontWeight: 500 }}>{p.label}</span>
                      <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 400 }}>{p.desc}</span>
                    </button>
                  );
                })}
              </div>

              <div className="settings-row">
                <span className="settings-label">Reverb mix</span>
                <div className="settings-control">
                  <span className="settings-value">{Math.round((settings.audio.fx?.reverbMix || 0) * 100)}%</span>
                  <input
                    type="range"
                    className="range-input"
                    min={0}
                    max={0.85}
                    step={0.05}
                    value={settings.audio.fx?.reverbMix || 0}
                    onChange={(e) =>
                      updateAudio({
                        fx: { ...(settings.audio.fx || FX_PRESETS[0].fx), preset: "custom", reverbMix: Number(e.target.value) },
                      })
                    }
                  />
                </div>
              </div>

              <div className="settings-row">
                <span className="settings-label">Sub-bass enhancer (55 Hz)</span>
                <div className="settings-control">
                  <span className="settings-value">{Math.round((settings.audio.fx?.subBassBoost || 0) * 100)}%</span>
                  <input
                    type="range"
                    className="range-input"
                    min={0}
                    max={1}
                    step={0.05}
                    value={settings.audio.fx?.subBassBoost || 0}
                    onChange={(e) =>
                      updateAudio({
                        fx: { ...(settings.audio.fx || FX_PRESETS[0].fx), preset: "custom", subBassBoost: Number(e.target.value) },
                      })
                    }
                  />
                </div>
              </div>

              <div className="settings-row">
                <span className="settings-label">8D spatial audio panning</span>
                <button
                  className={`toggle-switch ${settings.audio.fx?.spatial8d ? "on" : ""}`}
                  onClick={() =>
                    updateAudio({
                      fx: { ...(settings.audio.fx || FX_PRESETS[0].fx), preset: "custom", spatial8d: !settings.audio.fx?.spatial8d },
                    })
                  }
                >
                  <span className="toggle-knob" />
                </button>
              </div>

              <div className="settings-row">
                <span className="settings-label">Lo-Fi vinyl warmth</span>
                <button
                  className={`toggle-switch ${settings.audio.fx?.lofiWarmth ? "on" : ""}`}
                  onClick={() =>
                    updateAudio({
                      fx: { ...(settings.audio.fx || FX_PRESETS[0].fx), preset: "custom", lofiWarmth: !settings.audio.fx?.lofiWarmth },
                    })
                  }
                >
                  <span className="toggle-knob" />
                </button>
              </div>

              <div className="settings-row">
                <span className="settings-label">Mono downmix</span>
                <button
                  className={`toggle-switch ${settings.audio.fx?.monoDownmix ? "on" : ""}`}
                  onClick={() =>
                    updateAudio({
                      fx: { ...(settings.audio.fx || FX_PRESETS[0].fx), monoDownmix: !settings.audio.fx?.monoDownmix },
                    })
                  }
                >
                  <span className="toggle-knob" />
                </button>
              </div>

              <div className="settings-divider" />

              <div className="settings-row">
                <div>
                  <div className="settings-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <MicOff size={14} style={{ color: "var(--accent)" }} /> Real-time vocal remover (Karaoke)
                  </div>
                  <div className="settings-desc">
                    Mid-Side center-channel vocal reduction with 180 Hz bass crossover so kicks stay punchy.
                  </div>
                </div>
                <button
                  className={`toggle-switch ${settings.audio.fx?.vocalRemover ? "on" : ""}`}
                  onClick={() =>
                    updateAudio({
                      fx: { ...(settings.audio.fx || FX_PRESETS[0].fx), vocalRemover: !settings.audio.fx?.vocalRemover },
                    })
                  }
                >
                  <span className="toggle-knob" />
                </button>
              </div>

              {settings.audio.fx?.vocalRemover && (
                <div className="settings-row">
                  <span className="settings-label">Vocal suppression depth</span>
                  <div className="settings-control">
                    <span className="settings-value">
                      {Math.round((settings.audio.fx?.vocalRemoverStrength ?? 0.85) * 100)}%
                    </span>
                    <input
                      type="range"
                      className="range-input"
                      min={0.2}
                      max={1}
                      step={0.05}
                      value={settings.audio.fx?.vocalRemoverStrength ?? 0.85}
                      onChange={(e) =>
                        updateAudio({
                          fx: { ...(settings.audio.fx || FX_PRESETS[0].fx), vocalRemoverStrength: Number(e.target.value) },
                        })
                      }
                    />
                  </div>
                </div>
              )}
            </section>

            {/* Procedural Ambient Soundscape Mixer */}
            <section className="settings-section">
              <div className="settings-row">
                <div>
                  <div className="settings-section-title" style={{ margin: 0, display: "flex", alignItems: "center", gap: 6 }}>
                    <CloudRain size={14} /> Procedural ambient soundscape mixer
                  </div>
                  <div className="settings-desc">
                    Synthesize real-time rain, fireplace, ocean waves, thunder, or brown noise underneath your music.
                  </div>
                </div>
                <button
                  className={`toggle-switch ${settings.audio.ambience?.enabled ? "on" : ""}`}
                  onClick={() =>
                    updateAudio({
                      ambience: {
                        ...(settings.audio.ambience || AMBIENCE_PRESETS[0].settings),
                        enabled: !settings.audio.ambience?.enabled,
                      },
                    })
                  }
                >
                  <span className="toggle-knob" />
                </button>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {AMBIENCE_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    className={`glass-pill ${(settings.audio.ambience?.preset || "off") === p.id ? "active" : ""}`}
                    style={{ padding: "5px 11px", fontSize: 12 }}
                    onClick={() => updateAudio({ ambience: { ...p.settings } })}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              {(
                [
                  ["Rain on glass", "rain"],
                  ["Cozy fireplace", "fireplace"],
                  ["Ocean waves", "ocean"],
                  ["Brown focus noise", "brownNoise"],
                  ["Distant thunder", "thunder"],
                ] as const
              ).map(([label, key]) => (
                <div key={key} className="settings-row">
                  <span className="settings-label">{label}</span>
                  <div className="settings-control">
                    <span className="settings-value">
                      {Math.round(((settings.audio.ambience?.[key] ?? 0) as number) * 100)}%
                    </span>
                    <input
                      type="range"
                      className="range-input"
                      min={0}
                      max={1}
                      step={0.05}
                      value={(settings.audio.ambience?.[key] ?? 0) as number}
                      onChange={(e) =>
                        updateAudio({
                          ambience: {
                            ...(settings.audio.ambience || AMBIENCE_PRESETS[0].settings),
                            enabled: true,
                            preset: "custom",
                            [key]: Number(e.target.value),
                          },
                        })
                      }
                    />
                  </div>
                </div>
              ))}
            </section>

            {/* AutoEQ Headphone Profiles Database */}
            <section className="settings-section">
              <div className="settings-section-title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Headphones size={14} /> AutoEQ headphone profiles
              </div>
              <div className="settings-desc">
                Search {AUTOEQ_PROFILES.length} Harman-target headphone correction curves (with preamp headroom) and load them into the 10-band EQ.
              </div>
              <div style={{ position: "relative" }}>
                <Search size={14} style={{ position: "absolute", left: 10, top: 10, opacity: 0.55 }} />
                <input
                  className="glass-input"
                  style={{ width: "100%", paddingLeft: 32 }}
                  placeholder="Search headphones (AirPods, Sony XM5, HD600, DT770, HyperX...)"
                  value={autoEqQuery}
                  onChange={(e) => setAutoEqQuery(e.target.value)}
                />
              </div>
              <div className="autoeq-list">
                {AUTOEQ_PROFILES.filter((p) => {
                  const q = autoEqQuery.trim().toLowerCase();
                  if (!q) return true;
                  return (
                    p.name.toLowerCase().includes(q) ||
                    p.brand.toLowerCase().includes(q) ||
                    p.category.toLowerCase().includes(q)
                  );
                }).map((p) => {
                  const active = settings.audio.eq.preset === `${p.brand} ${p.name}`;
                  return (
                    <button
                      key={`${p.brand}-${p.name}`}
                      className={`appearance-theme-btn ${active ? "active" : ""}`}
                      onClick={() => {
                        updateEq({
                          enabled: true,
                          preset: `${p.brand} ${p.name}`,
                          preampDb: p.preampDb,
                          bands: [...p.bands],
                        });
                        onToast(`Applied AutoEQ profile: ${p.brand} ${p.name}`);
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {p.brand} {p.name}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                          {p.category} • Preamp {p.preampDb.toFixed(1)} dB
                        </div>
                      </div>
                      {active && <Check size={14} style={{ color: "var(--accent)", flexShrink: 0 }} />}
                    </button>
                  );
                })}
              </div>
            </section>
          </div>
        )}

        {/* ================================================================
            DESKTOP & INTEGRATIONS
           ================================================================ */}
        {tab === "desktop" && (
          <div className="settings-stack">
            <header className="settings-page-header">
              <h2>Desktop & integrations</h2>
              <p>Control Windows system tray, hardware media keys, global shortcuts, Discord RPC, and session restore.</p>
            </header>

            <section className="settings-section">
              <div className="settings-section-title">Windows desktop</div>

              <div className="settings-row">
                <div>
                  <div className="settings-label">Always-on-top Mini Player when closing app</div>
                  <div className="settings-desc">
                    Clicking the window close button switches to a compact always-on-top floating mini player instead of quitting.
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button
                    className="glass-pill"
                    style={{ padding: "4px 10px", fontSize: 12 }}
                    onClick={() => api.openMiniPlayer().catch((e) => onToast(String(e)))}
                  >
                    Open now
                  </button>
                  <button
                    className={`toggle-switch ${settings.miniPlayerOnClose ? "on" : ""}`}
                    onClick={() =>
                      onUpdateSettings({
                        ...settings,
                        miniPlayerOnClose: !settings.miniPlayerOnClose,
                      })
                    }
                  >
                    <span className="toggle-knob" />
                  </button>
                </div>
              </div>

              <div className="settings-row">
                <div>
                  <div className="settings-label">Minimize to system tray</div>
                  <div className="settings-desc">Keep music playing in the tray when closing the window (used when Mini Player on close is off).</div>
                </div>
                <button
                  className={`toggle-switch ${settings.minimizeToTray ? "on" : ""}`}
                  onClick={() => onUpdateSettings({ ...settings, minimizeToTray: !settings.minimizeToTray })}
                >
                  <span className="toggle-knob" />
                </button>
              </div>

              <div className="settings-row">
                <div>
                  <div className="settings-label">Windows Media Controls (SMTC)</div>
                  <div className="settings-desc">Show track art in the Windows volume flyout and support keyboard/Bluetooth media buttons.</div>
                </div>
                <button
                  className={`toggle-switch ${settings.mediaKeysEnabled ? "on" : ""}`}
                  onClick={() => onUpdateSettings({ ...settings, mediaKeysEnabled: !settings.mediaKeysEnabled })}
                >
                  <span className="toggle-knob" />
                </button>
              </div>

              <div className="settings-row">
                <div>
                  <div className="settings-label">Discord Rich Presence</div>
                  <div className="settings-desc">Show your currently playing song and artwork on your Discord profile.</div>
                </div>
                <button
                  className={`toggle-switch ${settings.discordRpcEnabled ? "on" : ""}`}
                  onClick={() => onUpdateSettings({ ...settings, discordRpcEnabled: !settings.discordRpcEnabled })}
                >
                  <span className="toggle-knob" />
                </button>
              </div>

              <div className="settings-row">
                <div>
                  <div className="settings-label">Restore last session on startup</div>
                  <div className="settings-desc">Remember your queue, current song, and playback position between launches.</div>
                </div>
                <button
                  className={`toggle-switch ${settings.restoreSession ? "on" : ""}`}
                  onClick={() => onUpdateSettings({ ...settings, restoreSession: !settings.restoreSession })}
                >
                  <span className="toggle-knob" />
                </button>
              </div>

              <div className="settings-row">
                <div>
                  <div className="settings-label">Dynamic Island top-edge pill</div>
                  <div className="settings-desc">
                    Sleek always-on-top pill at the top center of your screen that expands smoothly on hover.
                  </div>
                </div>
                <button
                  className="glass-pill"
                  onClick={() => api.openDynamicIsland().catch((e) => onToast(String(e)))}
                >
                  <Sparkles size={14} /> Open island
                </button>
              </div>

              <div className="settings-row">
                <div>
                  <div className="settings-label">Floating mini-lyrics overlay</div>
                  <div className="settings-desc">Always-on-top frosted lyrics bar with optional click-through lock.</div>
                </div>
                <button
                  className="glass-pill"
                  onClick={() => api.openLyricsOverlay().catch((e) => onToast(String(e)))}
                >
                  <PictureInPicture2 size={14} /> Open overlay
                </button>
              </div>
            </section>

            <section className="settings-section">
              <div className="settings-row">
                <div>
                  <div className="settings-section-title" style={{ margin: 0 }}>Global hotkeys</div>
                  <div className="settings-desc">Control playback even while gaming or using other apps.</div>
                </div>
                <button
                  className={`toggle-switch ${settings.globalHotkeysEnabled ? "on" : ""}`}
                  onClick={() =>
                    onUpdateSettings({ ...settings, globalHotkeysEnabled: !settings.globalHotkeysEnabled })
                  }
                >
                  <span className="toggle-knob" />
                </button>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8, opacity: settings.globalHotkeysEnabled ? 1 : 0.45 }}>
                {[
                  ["Play / Pause", "Ctrl + Alt + Space"],
                  ["Next track", "Ctrl + Alt + Right"],
                  ["Previous track", "Ctrl + Alt + Left"],
                  ["Like current song", "Ctrl + Alt + L"],
                ].map(([action, keys]) => (
                  <div key={action} className="settings-row">
                    <span className="settings-label">{action}</span>
                    <span className="search-kbd">{keys}</span>
                  </div>
                ))}
              </div>
            </section>

            {/* Last.fm & ListenBrainz Scrobbling */}
            <section className="settings-section">
              <div className="settings-row">
                <div>
                  <div className="settings-section-title" style={{ margin: 0, display: "flex", alignItems: "center", gap: 6 }}>
                    <Radio size={14} /> Last.fm & ListenBrainz scrobbling
                  </div>
                  <div className="settings-desc">
                    Automatically submit Now Playing and scrobbles (after 50% or 4 min) to your accounts.
                  </div>
                </div>
                <button
                  className={`toggle-switch ${settings.scrobbleEnabled ? "on" : ""}`}
                  onClick={() => onUpdateSettings({ ...settings, scrobbleEnabled: !settings.scrobbleEnabled })}
                >
                  <span className="toggle-knob" />
                </button>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 10, opacity: settings.scrobbleEnabled ? 1 : 0.5 }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span className="settings-label">ListenBrainz user token</span>
                  <input
                    className="glass-input"
                    type="password"
                    placeholder="Paste token from listenbrainz.org/settings"
                    value={settings.listenbrainzToken || ""}
                    onChange={(e) => onUpdateSettings({ ...settings, listenbrainzToken: e.target.value })}
                  />
                </label>

                <div className="settings-divider" />

                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span className="settings-label">Last.fm API key</span>
                  <input
                    className="glass-input"
                    placeholder="Optional Last.fm API key"
                    value={settings.lastfmApiKey || ""}
                    onChange={(e) => onUpdateSettings({ ...settings, lastfmApiKey: e.target.value })}
                  />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span className="settings-label">Last.fm API secret</span>
                  <input
                    className="glass-input"
                    type="password"
                    placeholder="Optional Last.fm shared secret"
                    value={settings.lastfmApiSecret || ""}
                    onChange={(e) => onUpdateSettings({ ...settings, lastfmApiSecret: e.target.value })}
                  />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span className="settings-label">Last.fm session key</span>
                  <input
                    className="glass-input"
                    type="password"
                    placeholder="Optional Last.fm session key (sk)"
                    value={settings.lastfmSessionKey || ""}
                    onChange={(e) => onUpdateSettings({ ...settings, lastfmSessionKey: e.target.value })}
                  />
                </label>
              </div>
            </section>
          </div>
        )}

        {/* ================================================================
            DOWNLOADS & STORAGE
           ================================================================ */}
        {tab === "downloads" && (
          <div className="settings-stack">
            <header className="settings-page-header">
              <h2>Downloads & cache</h2>
              <p>Manage offline track format, folder location, and local audio cache.</p>
            </header>

            <section className="settings-section">
              <div className="settings-section-title">Downloads</div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span className="settings-label">Download folder</span>
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

              <div className="settings-row">
                <span className="settings-label">Audio format</span>
                <select
                  className="glass-select"
                  value={settings.downloads.format}
                  onChange={(e) => updateDownloads({ format: e.target.value })}
                >
                  <option value="original">Original best (no re-encoding)</option>
                  <option value="opus">Opus (.opus)</option>
                  <option value="m4a">AAC (.m4a)</option>
                  <option value="mp3">MP3 (320 kbps)</option>
                  <option value="flac">FLAC</option>
                </select>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span className="settings-label">Filename template</span>
                <input
                  className="glass-input"
                  value={settings.downloads.filenameTemplate}
                  onChange={(e) => updateDownloads({ filenameTemplate: e.target.value })}
                />
                <span className="settings-desc">
                  Variables: {"{artist}"}, {"{album}"}, {"{title}"}, {"{id}"}
                </span>
              </div>

              <div className="settings-row">
                <span className="settings-label">Embed cover art</span>
                <button
                  className={`toggle-switch ${settings.downloads.embedThumbnail ? "on" : ""}`}
                  onClick={() => updateDownloads({ embedThumbnail: !settings.downloads.embedThumbnail })}
                >
                  <span className="toggle-knob" />
                </button>
              </div>

              <div className="settings-row">
                <span className="settings-label">Offline mode</span>
                <button
                  className={`toggle-switch ${settings.downloads.offlineMode ? "on" : ""}`}
                  onClick={() => updateDownloads({ offlineMode: !settings.downloads.offlineMode })}
                >
                  <span className="toggle-knob" />
                </button>
              </div>
            </section>

            <section className="settings-section">
              <div className="settings-section-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <HardDrive size={15} /> Audio cache
              </div>

              {cacheStats && (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 6, fontVariantNumeric: "tabular-nums" }}>
                    <span>
                      Used: {formatBytes(cacheStats.usedBytes)} ({cacheStats.fileCount} tracks)
                    </span>
                    <span style={{ color: "var(--text-muted)" }}>
                      Limit: {formatBytes(cacheStats.maxBytes)}
                    </span>
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

              <div className="settings-row">
                <span className="settings-label">Max cache size</span>
                <div className="settings-control">
                  <span className="settings-value">{(settings.downloads.maxCacheMb / 1024).toFixed(1)} GB</span>
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
              </div>

              <div>
                <button
                  className="glass-pill"
                  onClick={async () => {
                    const stats = await api.clearAudioCache();
                    setCacheStats(stats);
                    onToast("Audio cache cleared");
                  }}
                >
                  <Trash2 size={14} /> Clear cache
                </button>
              </div>
            </section>

            <section className="settings-section">
              <div className="settings-section-title">Local music folders</div>
              <div className="settings-desc">
                Index local FLAC, MP3, Opus, M4A, or WAV folders to play alongside YouTube Music in Library → Local Files.
              </div>

              {(settings.downloads.localMusicFolders || []).length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {settings.downloads.localMusicFolders.map((folder) => (
                    <div key={folder} className="settings-row">
                      <span style={{ fontSize: 12.5, wordBreak: "break-all" }}>{folder}</span>
                      <button
                        className="icon-btn"
                        title="Remove folder"
                        onClick={() =>
                          updateDownloads({
                            localMusicFolders: settings.downloads.localMusicFolders.filter((f) => f !== folder),
                          })
                        }
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  className="glass-pill"
                  onClick={async () => {
                    try {
                      const selected = await open({ directory: true, multiple: false });
                      if (typeof selected === "string" && selected) {
                        const existing = settings.downloads.localMusicFolders || [];
                        if (!existing.includes(selected)) {
                          const nextFolders = [...existing, selected];
                          updateDownloads({ localMusicFolders: nextFolders });
                          setScanningFolders(true);
                          const count = await api.scanLocalMusicFolders(nextFolders);
                          onToast(`Added folder & indexed ${count} tracks`);
                          setScanningFolders(false);
                        }
                      }
                    } catch (e) {
                      setScanningFolders(false);
                      onToast(`Folder error: ${e}`);
                    }
                  }}
                >
                  <Plus size={14} /> Add folder
                </button>
                <button
                  className="glass-pill active"
                  disabled={scanningFolders || (settings.downloads.localMusicFolders || []).length === 0}
                  onClick={async () => {
                    setScanningFolders(true);
                    try {
                      const count = await api.scanLocalMusicFolders(settings.downloads.localMusicFolders);
                      onToast(`Scanned ${count} local audio files`);
                    } catch (e) {
                      onToast(`Scan failed: ${e}`);
                    } finally {
                      setScanningFolders(false);
                    }
                  }}
                >
                  {scanningFolders ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
                  Scan folders now
                </button>
              </div>
            </section>
          </div>
        )}

        {/* ================================================================
            ACCOUNT & MEDIA ENGINE
           ================================================================ */}
        {tab === "account" && (
          <div className="settings-stack">
            <header className="settings-page-header">
              <h2>Account & engine</h2>
              <p>Connect your YouTube Music account and inspect bundled media binaries.</p>
            </header>

            <section className="settings-section">
              <div className="settings-section-title">YouTube Music account</div>

              {account.loggedIn ? (
                <div className="settings-row">
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    {account.avatarUrl ? (
                      <img
                        src={account.avatarUrl}
                        alt=""
                        style={{ width: 44, height: 44, borderRadius: "50%", objectFit: "cover" }}
                      />
                    ) : (
                      <div className="brand-orb" style={{ width: 44, height: 44, borderRadius: "50%" }}>
                        <User size={20} />
                      </div>
                    )}
                    <div>
                      <div className="settings-label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {account.name || "Signed in"}
                        {account.isPremium && (
                          <span className="badge">
                            <Crown size={11} style={{ color: "#f59e0b" }} /> Premium
                          </span>
                        )}
                      </div>
                      <div className="settings-desc">
                        {account.handle || `Authenticated via ${account.authSource}`}
                      </div>
                    </div>
                  </div>
                  <button
                    className="glass-pill"
                    onClick={async () => {
                      const next = await api.logoutAccount();
                      onAccountChanged(next);
                      onToast("Signed out");
                    }}
                  >
                    <LogOut size={14} /> Sign out
                  </button>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div className="settings-desc">
                    Sign in to sync your Home feed, Liked Music, and playlists.
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    <button
                      className="glass-pill active"
                      onClick={async () => {
                        await api.openYtMusicLogin();
                        setLoginWindowOpened(true);
                        onToast("Finish signing in, then click Complete sign-in");
                      }}
                    >
                      <LogIn size={14} /> Sign in with YouTube Music
                    </button>
                    {loginWindowOpened && (
                      <button
                        className="glass-pill"
                        onClick={async () => {
                          try {
                            const acc = await api.finishYtMusicLogin();
                            onAccountChanged(acc);
                            setLoginWindowOpened(false);
                            onToast("Account connected");
                          } catch (e) {
                            onToast(String(e));
                          }
                        }}
                      >
                        <CheckCircle2 size={14} /> Complete sign-in
                      </button>
                    )}
                    <button
                      className="glass-pill"
                      onClick={() => setShowCookieImport(!showCookieImport)}
                    >
                      <KeyRound size={14} /> {showCookieImport ? "Hide cookie import" : "Import cookies"}
                    </button>
                  </div>

                  {showCookieImport && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <textarea
                        className="glass-textarea"
                        rows={4}
                        placeholder="Paste Netscape cookies.txt or Cookie header from music.youtube.com..."
                        value={cookiesInput}
                        onChange={(e) => setCookiesInput(e.target.value)}
                      />
                      <div>
                        <button
                          className="glass-pill active"
                          onClick={async () => {
                            try {
                              const acc = await api.importCookiesText(cookiesInput);
                              onAccountChanged(acc);
                              setCookiesInput("");
                              setShowCookieImport(false);
                              onToast("Cookies imported");
                            } catch (e) {
                              onToast(String(e));
                            }
                          }}
                        >
                          Save cookies
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>

            <section className="settings-section">
              <div className="settings-section-title">Bundled media tools</div>

              <div className="settings-row">
                <div>
                  <div className="settings-label">yt-dlp</div>
                  <div className="settings-desc">
                    {binaries?.ytdlpInstalled
                      ? `Version ${binaries.ytdlpVersion || "installed"}`
                      : "Not installed"}
                  </div>
                </div>
                <button
                  className="glass-pill"
                  disabled={updatingYtdlp}
                  onClick={async () => {
                    setUpdatingYtdlp(true);
                    try {
                      const msg = await api.installOrUpdateYtdlp();
                      const st = await api.getBinaryStatus();
                      setBinaries(st);
                      onToast(msg || "yt-dlp updated");
                    } catch (e) {
                      onToast(`Update failed: ${e}`);
                    } finally {
                      setUpdatingYtdlp(false);
                    }
                  }}
                >
                  {updatingYtdlp ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
                  {binaries?.ytdlpInstalled ? "Check updates" : "Download"}
                </button>
              </div>

              <div className="settings-row">
                <div>
                  <div className="settings-label">FFmpeg</div>
                  <div className="settings-desc">
                    {binaries?.ffmpegInstalled
                      ? binaries.ffmpegVersion || "Ready"
                      : "Not detected"}
                  </div>
                </div>
                <span className="badge">{binaries?.ffmpegInstalled ? "Ready" : "Missing"}</span>
              </div>

              <div className="settings-divider" />

              <div className="settings-row">
                <div>
                  <div className="settings-label">LiquidYTM app updates</div>
                  <div className="settings-desc">
                    {updateInfo
                      ? updateInfo.updateAvailable
                        ? `Update available: v${updateInfo.latestVersion} (current v${updateInfo.currentVersion})`
                        : `Up to date (v${updateInfo.currentVersion}) — ${updateInfo.releaseNotes}`
                      : "Check GitHub Releases for newer builds and installers."}
                  </div>
                </div>
                <button
                  className="glass-pill"
                  disabled={checkingUpdate}
                  onClick={async () => {
                    setCheckingUpdate(true);
                    try {
                      const info = await api.checkAppUpdate();
                      setUpdateInfo(info);
                      onToast(
                        info.updateAvailable
                          ? `Update v${info.latestVersion} available`
                          : `LiquidYTM v${info.currentVersion} is up to date`
                      );
                    } catch (e) {
                      onToast(`Update check failed: ${e}`);
                    } finally {
                      setCheckingUpdate(false);
                    }
                  }}
                >
                  {checkingUpdate ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
                  Check updates
                </button>
              </div>
            </section>
          </div>
        )}

        {/* ================================================================
            DIAGNOSTICS & LOGS
           ================================================================ */}
        {tab === "logs" && (
          <div className="settings-stack">
            <header className="settings-page-header">
              <h2>Diagnostics & logs</h2>
              <p>Inspect recent playback, yt-dlp, and InnerTube events or export a report.</p>
            </header>

            <section className="settings-section">
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  className="glass-pill active"
                  onClick={async () => {
                    try {
                      const [savedPath] = await api.exportLogs();
                      onToast(`Saved log to ${savedPath}`);
                    } catch (e) {
                      onToast(`Export failed: ${e}`);
                    }
                  }}
                >
                  <Download size={14} /> Export to desktop
                </button>
                <button
                  className="glass-pill"
                  onClick={async () => {
                    try {
                      const [, fullText] = await api.exportLogs();
                      await navigator.clipboard.writeText(fullText);
                      onToast("Log copied to clipboard");
                    } catch (e) {
                      onToast(`Copy failed: ${e}`);
                    }
                  }}
                >
                  <Copy size={14} /> Copy log
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
                    onToast("Logs cleared");
                  }}
                >
                  <Trash2 size={14} /> Clear
                </button>
              </div>

              <div className="log-console">
                {logs.length === 0 ? (
                  <div style={{ color: "var(--text-muted)" }}>No log entries recorded yet.</div>
                ) : (
                  logs.map((entry, idx) => (
                    <div
                      key={idx}
                      style={{
                        color:
                          entry.level === "ERROR"
                            ? "#f87171"
                            : entry.level === "WARN"
                            ? "#fbbf24"
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
            </section>
          </div>
        )}
      </div>
    </div>
  );
};
