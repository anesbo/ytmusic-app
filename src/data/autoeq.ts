import type { AmbienceSettings, AudioFxSettings } from "../types";

export interface AutoEqProfile {
  name: string;
  brand: string;
  category: "Over-Ear" | "In-Ear" | "Gaming";
  preampDb: number;
  bands: number[]; // 31, 62, 125, 250, 500, 1k, 2k, 4k, 8k, 16k Hz
}

/**
 * Curated Harman-target AutoEQ 10-band headphone correction profiles.
 */
export const AUTOEQ_PROFILES: AutoEqProfile[] = [
  { name: "AirPods Pro (2nd Gen)", brand: "Apple", category: "In-Ear", preampDb: -2.5, bands: [1.5, 0.5, -1.0, -1.5, 0.0, 1.0, 2.0, 1.5, -1.0, 0.5] },
  { name: "AirPods Max", brand: "Apple", category: "Over-Ear", preampDb: -3.5, bands: [1.0, 0.5, -1.5, -1.0, 0.5, 1.5, 3.0, 3.5, -1.5, 1.0] },
  { name: "WH-1000XM5", brand: "Sony", category: "Over-Ear", preampDb: -4.0, bands: [-2.5, -3.5, -4.0, -2.5, 0.5, 1.5, 3.5, 3.0, 1.0, 2.0] },
  { name: "WH-1000XM4", brand: "Sony", category: "Over-Ear", preampDb: -4.5, bands: [-3.5, -4.5, -4.5, -3.0, 0.5, 2.0, 4.0, 3.5, 0.5, 2.5] },
  { name: "WF-1000XM5", brand: "Sony", category: "In-Ear", preampDb: -3.0, bands: [-1.5, -2.0, -2.5, -1.5, 0.5, 1.0, 2.5, 2.5, 1.0, 1.5] },
  { name: "MDR-7506", brand: "Sony", category: "Over-Ear", preampDb: -3.5, bands: [3.5, 2.0, -1.0, -2.5, -1.5, 0.0, 1.5, -3.0, -2.5, 1.5] },
  { name: "HD 600", brand: "Sennheiser", category: "Over-Ear", preampDb: -5.5, bands: [5.5, 4.0, 1.0, -1.5, -1.0, -0.5, 0.0, -1.0, 1.0, 2.0] },
  { name: "HD 650 / HD 6XX", brand: "Sennheiser", category: "Over-Ear", preampDb: -5.5, bands: [5.5, 3.5, 0.5, -2.0, -1.0, 0.0, 1.0, 1.5, 1.5, 2.5] },
  { name: "HD 560S", brand: "Sennheiser", category: "Over-Ear", preampDb: -4.0, bands: [4.0, 2.5, 0.5, -0.5, 0.0, 0.0, -0.5, -2.0, 0.5, 1.0] },
  { name: "Momentum 4 Wireless", brand: "Sennheiser", category: "Over-Ear", preampDb: -3.5, bands: [-2.0, -2.5, -3.0, -1.5, 1.0, 1.5, 2.5, 2.0, 0.5, 1.5] },
  { name: "ATH-M50x", brand: "Audio-Technica", category: "Over-Ear", preampDb: -3.5, bands: [-1.0, -2.0, -2.5, -1.5, 1.0, 1.0, 2.5, -1.5, -1.0, 2.0] },
  { name: "ATH-M40x", brand: "Audio-Technica", category: "Over-Ear", preampDb: -3.0, bands: [1.0, -0.5, -1.5, -1.0, 1.0, 1.0, 2.0, -1.0, -1.5, 1.5] },
  { name: "DT 770 Pro (80/250 Ohm)", brand: "Beyerdynamic", category: "Over-Ear", preampDb: -4.0, bands: [2.5, 1.0, -1.0, 1.5, 1.0, 0.0, 2.5, 3.5, -4.5, -1.0] },
  { name: "DT 990 Pro (250 Ohm)", brand: "Beyerdynamic", category: "Over-Ear", preampDb: -5.0, bands: [5.0, 2.5, -2.0, -3.0, 0.0, 1.0, 2.0, 1.5, -5.5, -2.0] },
  { name: "QuietComfort 45 / Ultra", brand: "Bose", category: "Over-Ear", preampDb: -3.0, bands: [0.5, -0.5, -2.0, -1.5, 0.5, 1.5, 2.5, 1.0, -2.0, 1.0] },
  { name: "Cloud II / Alpha", brand: "HyperX", category: "Gaming", preampDb: -4.0, bands: [2.0, 0.5, -1.5, -2.0, 1.0, 1.5, 3.5, 2.0, -2.5, 1.5] },
  { name: "Arctis Nova Pro", brand: "SteelSeries", category: "Gaming", preampDb: -3.0, bands: [1.5, 0.5, -1.0, -1.5, 0.5, 1.0, 2.0, 2.5, -1.0, 1.0] },
  { name: "G Pro X", brand: "Logitech", category: "Gaming", preampDb: -3.5, bands: [1.0, -1.0, -2.5, -2.0, 1.0, 1.5, 3.0, 3.5, -1.0, 2.0] },
  { name: "BlackShark V2", brand: "Razer", category: "Gaming", preampDb: -4.0, bands: [-1.5, -2.5, -3.5, -2.5, 1.0, 2.0, 3.5, 2.5, 1.0, 2.0] },
  { name: "Galaxy Buds2 Pro", brand: "Samsung", category: "In-Ear", preampDb: -2.0, bands: [0.5, 0.0, -1.0, -1.0, 0.5, 0.5, 1.0, -1.5, -2.0, 0.5] },
  { name: "Aria / Chu II", brand: "Moondrop", category: "In-Ear", preampDb: -2.0, bands: [1.0, 0.5, -0.5, -0.5, 0.5, 0.5, 0.0, -1.0, 1.5, 1.0] },
  { name: "ZSN Pro / ZS10 Pro", brand: "KZ", category: "In-Ear", preampDb: -3.5, bands: [-1.0, -1.5, -2.0, -1.0, 1.5, 1.5, -2.5, -3.5, -2.5, 1.0] },
  { name: "SHP9500", brand: "Philips", category: "Over-Ear", preampDb: -5.5, bands: [5.5, 4.0, 1.5, -0.5, -0.5, 0.0, 1.0, -2.5, -1.5, 1.0] },
  { name: "Sundara", brand: "HiFiMAN", category: "Over-Ear", preampDb: -4.5, bands: [4.5, 2.5, 0.5, 0.0, 0.0, -0.5, 2.5, 0.5, -1.5, 0.5] },
  { name: "Studio Pro", brand: "Beats", category: "Over-Ear", preampDb: -3.0, bands: [-1.0, -1.5, -2.0, -1.5, 1.0, 1.5, 2.5, 2.0, 0.5, 1.5] },
  { name: "Tune 760NC / 770NC", brand: "JBL", category: "Over-Ear", preampDb: -2.5, bands: [-0.5, -1.0, -1.5, -1.0, 0.5, 1.0, 2.0, 1.5, -0.5, 1.0] },
  { name: "Major IV", brand: "Marshall", category: "Over-Ear", preampDb: -3.5, bands: [-2.0, -3.0, -3.0, -1.5, 1.5, 2.0, 3.0, 2.5, -1.0, 1.5] },
  { name: "Clear / Utopia", brand: "Focal", category: "Over-Ear", preampDb: -3.5, bands: [3.5, 2.0, 0.0, -1.0, -0.5, -1.0, 1.5, 1.0, -1.0, 1.0] },
];

export interface FxPresetDef {
  id: AudioFxSettings["preset"];
  label: string;
  desc: string;
  fx: AudioFxSettings;
  suggestedSpeed?: number;
  suggestedPreservePitch?: boolean;
}

export const FX_PRESETS: FxPresetDef[] = [
  {
    id: "off",
    label: "Studio Clean",
    desc: "Bit-transparent dry signal",
    fx: { preset: "off", reverbMix: 0, spatial8d: false, lofiWarmth: false, monoDownmix: false, subBassBoost: 0, vocalRemover: false, vocalRemoverStrength: 0.85 },
    suggestedSpeed: 1.0,
    suggestedPreservePitch: true,
  },
  {
    id: "slowed_reverb",
    label: "Slowed + Reverb",
    desc: "0.85x tape pitch + lush hall reverb",
    fx: { preset: "slowed_reverb", reverbMix: 0.42, spatial8d: false, lofiWarmth: false, monoDownmix: false, subBassBoost: 0.25, vocalRemover: false, vocalRemoverStrength: 0.85 },
    suggestedSpeed: 0.85,
    suggestedPreservePitch: false,
  },
  {
    id: "concert_hall",
    label: "Concert Hall",
    desc: "Spacious stereo room reflections",
    fx: { preset: "concert_hall", reverbMix: 0.34, spatial8d: false, lofiWarmth: false, monoDownmix: false, subBassBoost: 0.1, vocalRemover: false, vocalRemoverStrength: 0.85 },
  },
  {
    id: "lofi_vinyl",
    label: "Lo-Fi Vinyl",
    desc: "Warm tape rolloff + subtle vinyl texture",
    fx: { preset: "lofi_vinyl", reverbMix: 0.16, spatial8d: false, lofiWarmth: true, monoDownmix: false, subBassBoost: 0.2, vocalRemover: false, vocalRemoverStrength: 0.85 },
  },
  {
    id: "8d_spatial",
    label: "8D Spatial",
    desc: "Slow 360° binaural panning + ambience",
    fx: { preset: "8d_spatial", reverbMix: 0.28, spatial8d: true, lofiWarmth: false, monoDownmix: false, subBassBoost: 0.15, vocalRemover: false, vocalRemoverStrength: 0.85 },
  },
  {
    id: "sub_bass",
    label: "Sub-Bass Club",
    desc: "Deep 55 Hz low-shelf sub enhancement",
    fx: { preset: "sub_bass", reverbMix: 0.08, spatial8d: false, lofiWarmth: false, monoDownmix: false, subBassBoost: 0.75, vocalRemover: false, vocalRemoverStrength: 0.85 },
  },
];

export interface AmbiencePresetDef {
  id: AmbienceSettings["preset"];
  label: string;
  desc: string;
  settings: AmbienceSettings;
}

export const AMBIENCE_PRESETS: AmbiencePresetDef[] = [
  {
    id: "off",
    label: "Off",
    desc: "Music only",
    settings: { enabled: false, preset: "off", rain: 0, fireplace: 0, ocean: 0, brownNoise: 0, thunder: 0 },
  },
  {
    id: "rainy_study",
    label: "Rainy Study",
    desc: "Soft rain on glass + distant thunder",
    settings: { enabled: true, preset: "rainy_study", rain: 0.55, fireplace: 0, ocean: 0, brownNoise: 0.18, thunder: 0.25 },
  },
  {
    id: "cozy_fireplace",
    label: "Cozy Fireplace",
    desc: "Crackling hearth + light rain outside",
    settings: { enabled: true, preset: "cozy_fireplace", rain: 0.22, fireplace: 0.65, ocean: 0, brownNoise: 0, thunder: 0 },
  },
  {
    id: "ocean_breeze",
    label: "Ocean Waves",
    desc: "Slow rolling coastal surf",
    settings: { enabled: true, preset: "ocean_breeze", rain: 0, fireplace: 0, ocean: 0.6, brownNoise: 0.12, thunder: 0 },
  },
  {
    id: "focus_noise",
    label: "Deep Focus",
    desc: "Warm brown noise cushion",
    settings: { enabled: true, preset: "focus_noise", rain: 0, fireplace: 0, ocean: 0, brownNoise: 0.52, thunder: 0 },
  },
];
