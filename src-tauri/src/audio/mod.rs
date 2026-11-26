pub mod dsp;
pub mod source;

use std::fs::File;
use std::io::Read;
use std::path::PathBuf;
use std::process::{Command as StdCommand, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, Stream, StreamConfig};
use ringbuf::traits::{Consumer, Observer, Producer, Split};
use ringbuf::HeapRb;
use symphonia::core::audio::sample::Sample;
use symphonia::core::codecs::audio::AudioDecoderOptions;
use symphonia::core::codecs::registry::CodecRegistry;
use symphonia::core::common::Tier;
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, SeekMode, SeekTo, TrackType};
use symphonia::core::io::{MediaSource, MediaSourceStream};
use symphonia::core::meta::MetadataOptions;
use symphonia::core::units::Time;
use symphonia_opus::OpusDecoder;

use crate::audio::dsp::{AmbientSynthesizer, DspPipeline, SincResampler};
use crate::audio::source::{DownloadProgress, ProgressiveMediaSource};
use crate::models::{
    AmbienceSettings, AudioDeviceInfo, AudioSettings, AudioTelemetry, PlaybackSnapshot, Track,
};

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Information required to start playing a resolved audio source.
#[derive(Clone)]
pub struct PlayRequest {
    pub track: Track,
    pub file_path: PathBuf,
    pub live_url: Option<String>,
    pub ext_hint: Option<String>,
    pub codec_label: String,
    pub bitrate_kbps: u32,
    pub format_id: Option<String>,
    pub is_local_file: bool,
    pub progress: Option<Arc<DownloadProgress>>,
    pub ffmpeg_path: Option<PathBuf>,
    pub initial_seek_ms: u64,
}

struct ActivePlayback {
    cancel: Arc<AtomicBool>,
    paused: Arc<AtomicBool>,
    seek_target_ms: Arc<AtomicU64>, // u64::MAX = no pending seek
    flush_ring: Arc<AtomicBool>,
    position_ms: Arc<AtomicU64>,
    duration_ms: Arc<AtomicU64>,
    ffmpeg_pid: Arc<AtomicU32>,
    progress: Option<Arc<DownloadProgress>>,
    dsp: Arc<Mutex<DspPipeline>>,
    thread_handle: Option<std::thread::JoinHandle<()>>,
}

pub struct AudioEngine {
    settings: Arc<RwLock<AudioSettings>>,
    active: Arc<Mutex<Option<ActivePlayback>>>,
    current_track: Arc<RwLock<Option<Track>>>,
    telemetry: Arc<RwLock<Option<AudioTelemetry>>>,
    last_error: Arc<RwLock<Option<String>>>,
    is_loading: Arc<AtomicBool>,
    /// Real-time lock-free volume (f32 stored as u32 bits) read directly inside CPAL callback -> 0ms delay!
    volume_bits: Arc<AtomicU32>,
    muted: Arc<AtomicBool>,
    speed_bits: Arc<AtomicU32>,
    preserve_pitch: Arc<AtomicBool>,
    pitch_semitones_bits: Arc<AtomicU32>,
    duck_gain_bits: Arc<AtomicU32>,
    crossfade_ms: Arc<AtomicU64>,
    /// Dual-deck crossfade tail: holds remaining stereo PCM frames from the outgoing track
    /// so Track B mixes seamlessly over Track A's tail with equal-power sin/cos curves!
    crossfade_tail: Arc<Mutex<std::collections::VecDeque<(f32, f32)>>>,
    ambience: Arc<RwLock<AmbienceSettings>>,
    fade_on_pause: Arc<AtomicBool>,
    trim_silence: Arc<AtomicBool>,
    waveform_cache: Arc<RwLock<std::collections::HashMap<String, Vec<f32>>>>,
    visualizer_enabled: Arc<AtomicBool>,
    spectrum: Arc<Mutex<[f32; 32]>>,
    on_track_ended: Arc<RwLock<Option<Arc<dyn Fn() + Send + Sync>>>>,
}

impl AudioEngine {
    pub fn new(initial_settings: AudioSettings) -> Self {
        let speed = initial_settings.playback_speed.clamp(0.5, 2.0);
        let preserve_pitch = initial_settings.preserve_pitch;
        let pitch_semitones = initial_settings.pitch_semitones.clamp(-6.0, 6.0);
        let cf_ms = (initial_settings.crossfade_secs.clamp(0.0, 8.0) * 1000.0) as u64;
        let viz = initial_settings.visualizer_enabled;
        let fade_pause = initial_settings.fade_on_pause;
        let trim_sil = initial_settings.trim_silence;
        let amb = initial_settings.ambience.clone();
        Self {
            settings: Arc::new(RwLock::new(initial_settings)),
            active: Arc::new(Mutex::new(None)),
            current_track: Arc::new(RwLock::new(None)),
            telemetry: Arc::new(RwLock::new(None)),
            last_error: Arc::new(RwLock::new(None)),
            is_loading: Arc::new(AtomicBool::new(false)),
            volume_bits: Arc::new(AtomicU32::new(0.85_f32.to_bits())),
            muted: Arc::new(AtomicBool::new(false)),
            speed_bits: Arc::new(AtomicU32::new(speed.to_bits())),
            preserve_pitch: Arc::new(AtomicBool::new(preserve_pitch)),
            pitch_semitones_bits: Arc::new(AtomicU32::new(pitch_semitones.to_bits())),
            duck_gain_bits: Arc::new(AtomicU32::new(1.0_f32.to_bits())),
            crossfade_ms: Arc::new(AtomicU64::new(cf_ms)),
            crossfade_tail: Arc::new(Mutex::new(std::collections::VecDeque::new())),
            ambience: Arc::new(RwLock::new(amb)),
            fade_on_pause: Arc::new(AtomicBool::new(fade_pause)),
            trim_silence: Arc::new(AtomicBool::new(trim_sil)),
            waveform_cache: Arc::new(RwLock::new(std::collections::HashMap::new())),
            visualizer_enabled: Arc::new(AtomicBool::new(viz)),
            spectrum: Arc::new(Mutex::new([0.0; 32])),
            on_track_ended: Arc::new(RwLock::new(None)),
        }
    }

    /// Computes and caches a 120-bar normalized amplitude waveform peak profile via fast 8kHz mono FFmpeg decode (~120ms).
    pub fn compute_waveform_peaks(
        &self,
        video_id: &str,
        file_path: &std::path::Path,
        ffmpeg: &std::path::Path,
    ) -> Result<Vec<f32>> {
        if let Some(hit) = self.waveform_cache.read().unwrap().get(video_id) {
            return Ok(hit.clone());
        }
        let mut cmd = StdCommand::new(ffmpeg);
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        cmd.args(["-hide_banner", "-loglevel", "error", "-i"])
            .arg(file_path)
            .args([
                "-vn",
                "-ac",
                "1",
                "-ar",
                "4000",
                "-f",
                "f32le",
                "-acodec",
                "pcm_f32le",
                "pipe:1",
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::null());

        let output = cmd.output().context("Failed to compute audio waveform")?;
        if !output.status.success() || output.stdout.len() < 32 {
            return Err(anyhow!("Waveform decode returned no audio data"));
        }

        let total_samples = output.stdout.len() / 4;
        const BARS: usize = 120;
        let bucket = (total_samples / BARS).max(1);
        let mut peaks = Vec::with_capacity(BARS);
        let mut max_peak = 0.001_f32;

        for b in 0..BARS {
            let start = b * bucket;
            let end = ((b + 1) * bucket).min(total_samples);
            if start >= total_samples {
                peaks.push(0.08);
                continue;
            }
            let mut sum_sq = 0.0_f32;
            let mut count = 0usize;
            for idx in (start..end).step_by(2) {
                let off = idx * 4;
                if off + 4 <= output.stdout.len() {
                    let s = f32::from_le_bytes([
                        output.stdout[off],
                        output.stdout[off + 1],
                        output.stdout[off + 2],
                        output.stdout[off + 3],
                    ]);
                    sum_sq += s * s;
                    count += 1;
                }
            }
            let rms = if count > 0 {
                (sum_sq / count as f32).sqrt()
            } else {
                0.0
            };
            if rms > max_peak {
                max_peak = rms;
            }
            peaks.push(rms);
        }

        for p in &mut peaks {
            *p = ((*p / max_peak).powf(0.75)).clamp(0.08, 1.0);
        }

        self.waveform_cache
            .write()
            .unwrap()
            .insert(video_id.to_string(), peaks.clone());
        Ok(peaks)
    }

    pub fn visualizer_enabled(&self) -> bool {
        self.visualizer_enabled.load(Ordering::Relaxed)
    }

    pub fn spectrum_bars(&self) -> Vec<f32> {
        self.spectrum.lock().unwrap().to_vec()
    }

    pub fn set_playback_speed(&self, speed: f32, preserve_pitch: bool) {
        let clamped = speed.clamp(0.5, 2.0);
        let prev_speed = f32::from_bits(self.speed_bits.swap(clamped.to_bits(), Ordering::SeqCst));
        let prev_pitch = self.preserve_pitch.swap(preserve_pitch, Ordering::SeqCst);
        {
            let mut s = self.settings.write().unwrap();
            s.playback_speed = clamped;
            s.preserve_pitch = preserve_pitch;
        }
        if (prev_speed - clamped).abs() > 0.005 || prev_pitch != preserve_pitch {
            if let Some(active) = self.active.lock().unwrap().as_ref() {
                let cur_pos = active.position_ms.load(Ordering::Relaxed);
                active.seek_target_ms.store(cur_pos, Ordering::SeqCst);
                active.flush_ring.store(true, Ordering::SeqCst);
            }
        }
    }

    pub fn set_pitch_semitones(&self, semitones: f32) {
        let clamped = semitones.clamp(-6.0, 6.0);
        let prev = f32::from_bits(self.pitch_semitones_bits.swap(clamped.to_bits(), Ordering::SeqCst));
        {
            let mut s = self.settings.write().unwrap();
            s.pitch_semitones = clamped;
        }
        if (prev - clamped).abs() > 0.05 {
            if let Some(active) = self.active.lock().unwrap().as_ref() {
                let cur_pos = active.position_ms.load(Ordering::Relaxed);
                active.seek_target_ms.store(cur_pos, Ordering::SeqCst);
                active.flush_ring.store(true, Ordering::SeqCst);
            }
        }
    }

    pub fn set_duck_gain(&self, gain: f32) {
        let clamped = gain.clamp(0.05, 1.0);
        self.duck_gain_bits.store(clamped.to_bits(), Ordering::Relaxed);
    }

    pub fn auto_ducking_config(&self) -> (bool, f32) {
        let s = self.settings.read().unwrap();
        (s.auto_ducking, s.duck_level)
    }

    pub fn set_on_track_ended<F: Fn() + Send + Sync + 'static>(&self, cb: F) {
        *self.on_track_ended.write().unwrap() = Some(Arc::new(cb));
    }

    pub fn set_loading(&self, loading: bool, track: Option<Track>) {
        self.is_loading.store(loading, Ordering::SeqCst);
        if let Some(t) = track {
            *self.current_track.write().unwrap() = Some(t);
            *self.last_error.write().unwrap() = None;
        }
    }

    pub fn set_error(&self, err: String) {
        self.is_loading.store(false, Ordering::SeqCst);
        *self.last_error.write().unwrap() = Some(err);
    }

    pub fn list_output_devices() -> Vec<AudioDeviceInfo> {
        let host = cpal::default_host();
        let default_name = host.default_output_device().and_then(|d| d.name().ok());

        let mut devices = Vec::new();
        if let Ok(iter) = host.output_devices() {
            for dev in iter {
                if let Ok(name) = dev.name() {
                    let is_default = default_name.as_deref() == Some(name.as_str());
                    let mut rates = Vec::new();
                    if let Ok(configs) = dev.supported_output_configs() {
                        for cfg in configs {
                            for candidate in [44_100u32, 48_000, 88_200, 96_000, 192_000] {
                                if candidate >= cfg.min_sample_rate().0
                                    && candidate <= cfg.max_sample_rate().0
                                    && !rates.contains(&candidate)
                                {
                                    rates.push(candidate);
                                }
                            }
                        }
                    }
                    rates.sort();
                    devices.push(AudioDeviceInfo {
                        name,
                        is_default,
                        sample_rates: rates,
                    });
                }
            }
        }
        devices
    }

    pub fn update_audio_settings(&self, new_settings: AudioSettings) {
        let clamped_speed = new_settings.playback_speed.clamp(0.5, 2.0);
        let clamped_pitch = new_settings.pitch_semitones.clamp(-6.0, 6.0);
        let prev_speed = f32::from_bits(self.speed_bits.swap(clamped_speed.to_bits(), Ordering::SeqCst));
        let prev_pitch = self.preserve_pitch.swap(new_settings.preserve_pitch, Ordering::SeqCst);
        let prev_semi = f32::from_bits(
            self.pitch_semitones_bits
                .swap(clamped_pitch.to_bits(), Ordering::SeqCst),
        );
        let cf_ms = (new_settings.crossfade_secs.clamp(0.0, 8.0) * 1000.0) as u64;
        self.crossfade_ms.store(cf_ms, Ordering::Relaxed);
        self.fade_on_pause
            .store(new_settings.fade_on_pause, Ordering::Relaxed);
        self.trim_silence
            .store(new_settings.trim_silence, Ordering::Relaxed);
        *self.ambience.write().unwrap() = new_settings.ambience.clone();
        self.visualizer_enabled
            .store(new_settings.visualizer_enabled, Ordering::Relaxed);
        if !new_settings.visualizer_enabled {
            *self.spectrum.lock().unwrap() = [0.0; 32];
        }

        *self.settings.write().unwrap() = new_settings.clone();
        if let Some(active) = self.active.lock().unwrap().as_ref() {
            let mut dsp = active.dsp.lock().unwrap();
            dsp.update_settings(&new_settings);
            let gain = dsp.loudness_gain_db();
            if let Some(t) = self.telemetry.write().unwrap().as_mut() {
                t.loudness_gain_db = gain;
            }
            if (prev_speed - clamped_speed).abs() > 0.005
                || prev_pitch != new_settings.preserve_pitch
                || (prev_semi - clamped_pitch).abs() > 0.05
            {
                let cur_pos = active.position_ms.load(Ordering::Relaxed);
                active.seek_target_ms.store(cur_pos, Ordering::SeqCst);
                active.flush_ring.store(true, Ordering::SeqCst);
            }
        }
    }

    pub fn set_volume(&self, volume: f32) {
        let clamped = volume.clamp(0.0, 1.5);
        self.volume_bits.store(clamped.to_bits(), Ordering::Relaxed);
    }

    pub fn set_muted(&self, muted: bool) {
        self.muted.store(muted, Ordering::Relaxed);
    }

    pub fn pause(&self) {
        if let Some(active) = self.active.lock().unwrap().as_ref() {
            active.paused.store(true, Ordering::SeqCst);
        }
    }

    pub fn resume(&self) {
        if let Some(active) = self.active.lock().unwrap().as_ref() {
            active.paused.store(false, Ordering::SeqCst);
        }
    }

    pub fn toggle_play_pause(&self) -> bool {
        if let Some(active) = self.active.lock().unwrap().as_ref() {
            let was_paused = active.paused.load(Ordering::SeqCst);
            active.paused.store(!was_paused, Ordering::SeqCst);
            return was_paused;
        }
        false
    }

    pub fn seek(&self, position_ms: u64) {
        if let Some(active) = self.active.lock().unwrap().as_ref() {
            active.seek_target_ms.store(position_ms, Ordering::SeqCst);
            // Immediately signal CPAL output callback to flush old buffered samples -> instant seek!
            active.flush_ring.store(true, Ordering::SeqCst);
            active.position_ms.store(position_ms, Ordering::Relaxed);
        }
    }

    pub fn is_loading_now(&self) -> bool {
        self.is_loading.load(Ordering::Acquire)
    }

    pub fn stop(&self) {
        self.stop_inner(false);
    }

    pub fn stop_for_crossfade(&self) {
        let keep_tail = self.crossfade_ms.load(Ordering::Relaxed) > 0;
        self.stop_inner(keep_tail);
    }

    fn stop_inner(&self, keep_crossfade_tail: bool) {
        if !keep_crossfade_tail {
            self.crossfade_tail.lock().unwrap().clear();
        }
        let prev = self.active.lock().unwrap().take();
        if let Some(mut prev) = prev {
            prev.cancel.store(true, Ordering::SeqCst);
            if !keep_crossfade_tail {
                prev.flush_ring.store(true, Ordering::SeqCst);
            }
            if let Some(p) = prev.progress {
                p.cancelled.store(true, Ordering::SeqCst);
            }
            // Immediately kill ffmpeg child so blocking stdout.read() unblocks in <1ms!
            let pid = prev.ffmpeg_pid.swap(0, Ordering::SeqCst);
            if pid != 0 {
                crate::binaries::kill_process_tree(pid);
            }
            // Wait for the old audio thread to cleanly drop its CPAL stream
            // so two hardware audio streams NEVER overlap on Windows WASAPI!
            if let Some(handle) = prev.thread_handle.take() {
                let _ = handle.join();
            }
        }
        self.is_loading.store(false, Ordering::SeqCst);
    }

    pub fn snapshot(&self) -> PlaybackSnapshot {
        let active_guard = self.active.lock().unwrap();
        let (is_playing, position_ms, duration_ms, buffered_ratio) = match active_guard.as_ref() {
            Some(a) => {
                let playing =
                    !a.paused.load(Ordering::Relaxed) && !a.cancel.load(Ordering::Relaxed);
                let pos = a.position_ms.load(Ordering::Relaxed);
                let dur = a.duration_ms.load(Ordering::Relaxed);
                let buf = a
                    .progress
                    .as_ref()
                    .map(|p| p.buffered_ratio())
                    .unwrap_or(1.0);
                (playing, pos, dur, buf)
            }
            None => (false, 0, 0, 0.0),
        };
        drop(active_guard);

        PlaybackSnapshot {
            is_playing,
            is_loading: self.is_loading.load(Ordering::Relaxed),
            position_ms,
            duration_ms,
            buffered_ratio,
            volume: f32::from_bits(self.volume_bits.load(Ordering::Relaxed)),
            muted: self.muted.load(Ordering::Relaxed),
            current_track: self.current_track.read().unwrap().clone(),
            telemetry: self.telemetry.read().unwrap().clone(),
            error: self.last_error.read().unwrap().clone(),
        }
    }

    /// Starts decoding and playing the requested audio source on dedicated real-time threads.
    pub fn play(&self, req: PlayRequest) -> Result<()> {
        let keep_tail = self.crossfade_ms.load(Ordering::Relaxed) > 0 && req.initial_seek_ms == 0;
        self.stop_inner(keep_tail);

        let settings = self.settings.read().unwrap().clone();
        let cancel = Arc::new(AtomicBool::new(false));
        let paused = Arc::new(AtomicBool::new(false));
        let seek_target_ms = Arc::new(AtomicU64::new(u64::MAX));
        let flush_ring = Arc::new(AtomicBool::new(false));
        let position_ms = Arc::new(AtomicU64::new(0));
        let duration_ms = Arc::new(AtomicU64::new(req.track.duration_secs * 1000));
        let ffmpeg_pid = Arc::new(AtomicU32::new(0));

        // Keep DspPipeline at unity volume (1.0) because real-time volume/mute runs in the CPAL callback with 0ms lag!
        let mut dsp_inner = DspPipeline::new(48_000, &settings);
        dsp_inner.set_track_loudness_db(req.track.loudness_db);
        dsp_inner.set_volume(1.0, false);
        let dsp = Arc::new(Mutex::new(dsp_inner));

        *self.current_track.write().unwrap() = Some(req.track.clone());
        *self.last_error.write().unwrap() = None;

        let telemetry_slot = self.telemetry.clone();
        let last_error = self.last_error.clone();
        let is_loading = self.is_loading.clone();
        let on_track_ended = self.on_track_ended.clone();
        let volume_bits = self.volume_bits.clone();
        let muted = self.muted.clone();
        let speed_bits = self.speed_bits.clone();
        let preserve_pitch = self.preserve_pitch.clone();
        let pitch_semitones_bits = self.pitch_semitones_bits.clone();
        let duck_gain_bits = self.duck_gain_bits.clone();
        let crossfade_ms = self.crossfade_ms.clone();
        let crossfade_tail = self.crossfade_tail.clone();
        let ambience = self.ambience.clone();
        let fade_on_pause = self.fade_on_pause.clone();
        let trim_silence = self.trim_silence.clone();
        let visualizer_enabled = self.visualizer_enabled.clone();
        let spectrum = self.spectrum.clone();

        let cancel_bg = cancel.clone();
        let paused_bg = paused.clone();
        let seek_bg = seek_target_ms.clone();
        let flush_bg = flush_ring.clone();
        let pos_bg = position_ms.clone();
        let dur_bg = duration_ms.clone();
        let ffmpeg_pid_bg = ffmpeg_pid.clone();
        let dsp_bg = dsp.clone();
        let progress_opt = req.progress.clone();

        let thread_handle = std::thread::Builder::new()
            .name("liquidytm-audio-decoder".to_string())
            .spawn(move || {
                let res = run_playback_loop(
                    req,
                    settings,
                    cancel_bg.clone(),
                    paused_bg,
                    seek_bg,
                    flush_bg,
                    pos_bg,
                    dur_bg,
                    ffmpeg_pid_bg,
                    dsp_bg,
                    telemetry_slot,
                    is_loading.clone(),
                    volume_bits,
                    muted,
                    speed_bits,
                    preserve_pitch,
                    pitch_semitones_bits,
                    duck_gain_bits,
                    crossfade_ms,
                    crossfade_tail,
                    ambience,
                    fade_on_pause,
                    trim_silence,
                    visualizer_enabled,
                    spectrum,
                );
                is_loading.store(false, Ordering::SeqCst);
                match res {
                    Ok(completed_naturally) => {
                        if completed_naturally && !cancel_bg.load(Ordering::Acquire) {
                            if let Some(cb) = on_track_ended.read().unwrap().clone() {
                                cb();
                            }
                        }
                    }
                    Err(e) => {
                        if !cancel_bg.load(Ordering::Acquire) {
                            crate::logger::error("audio", format!("Playback thread error: {e:#}"));
                            *last_error.write().unwrap() = Some(e.to_string());
                        }
                    }
                }
            })
            .context("Failed to spawn audio decoder thread")?;

        *self.active.lock().unwrap() = Some(ActivePlayback {
            cancel,
            paused,
            seek_target_ms,
            flush_ring,
            position_ms,
            duration_ms,
            ffmpeg_pid,
            progress: progress_opt,
            dsp,
            thread_handle: Some(thread_handle),
        });

        Ok(())
    }
}

fn build_codec_registry() -> CodecRegistry {
    let mut registry = CodecRegistry::new();
    symphonia::default::register_enabled_codecs(&mut registry);
    registry.register_audio_decoder_at_tier::<OpusDecoder>(Tier::Standard);
    registry
}

#[allow(clippy::too_many_arguments)]
fn run_playback_loop(
    req: PlayRequest,
    settings: AudioSettings,
    cancel: Arc<AtomicBool>,
    paused: Arc<AtomicBool>,
    seek_target_ms: Arc<AtomicU64>,
    flush_ring: Arc<AtomicBool>,
    position_ms: Arc<AtomicU64>,
    duration_ms: Arc<AtomicU64>,
    ffmpeg_pid: Arc<AtomicU32>,
    dsp: Arc<Mutex<DspPipeline>>,
    telemetry_slot: Arc<RwLock<Option<AudioTelemetry>>>,
    is_loading: Arc<AtomicBool>,
    volume_bits: Arc<AtomicU32>,
    muted: Arc<AtomicBool>,
    speed_bits: Arc<AtomicU32>,
    preserve_pitch: Arc<AtomicBool>,
    pitch_semitones_bits: Arc<AtomicU32>,
    duck_gain_bits: Arc<AtomicU32>,
    crossfade_ms: Arc<AtomicU64>,
    crossfade_tail: Arc<Mutex<std::collections::VecDeque<(f32, f32)>>>,
    ambience: Arc<RwLock<AmbienceSettings>>,
    fade_on_pause: Arc<AtomicBool>,
    trim_silence: Arc<AtomicBool>,
    visualizer_enabled: Arc<AtomicBool>,
    spectrum: Arc<Mutex<[f32; 32]>>,
) -> Result<bool> {
    // 1. Open CPAL Output Device using native WASAPI/CoreAudio default config (or highest native DAC rate in Exclusive mode)
    let host = cpal::default_host();
    let device = select_output_device(&host, settings.output_device.as_deref())?;
    let device_name = device.name().unwrap_or_else(|_| "Default Output".to_string());
    let (stream_config, sample_format) = select_best_config(&device, settings.exclusive_mode)?;
    let out_rate = stream_config.sample_rate.0;
    let out_channels = stream_config.channels as usize;

    let loudness_gain_db = {
        let mut d = dsp.lock().unwrap();
        d.set_sample_rate(out_rate);
        d.loudness_gain_db()
    };

    *telemetry_slot.write().unwrap() = Some(AudioTelemetry {
        codec: req.codec_label.clone(),
        bitrate_kbps: req.bitrate_kbps,
        source_sample_rate: out_rate,
        output_sample_rate: out_rate,
        channels: out_channels as u16,
        output_device: device_name.clone(),
        exclusive_mode: settings.exclusive_mode,
        loudness_gain_db,
        is_local_file: req.is_local_file,
        format_id: req.format_id.clone(),
    });

    // Lock-free 2.0s stereo-frame ring buffer (plenty of cushion against underruns, flushed instantly on seek/stop!)
    let rb_capacity = (out_rate as usize) * 2;
    let rb = HeapRb::<(f32, f32)>::new(rb_capacity);
    let (mut producer, mut consumer) = rb.split();

    let paused_cb = paused.clone();
    let cancel_cb = cancel.clone();
    let flush_cb = flush_ring.clone();
    let vol_cb = volume_bits.clone();
    let muted_cb = muted.clone();
    let speed_cb = speed_bits.clone();
    let duck_cb = duck_gain_bits.clone();
    let crossfade_cb = crossfade_ms.clone();
    let duration_cb = duration_ms.clone();
    let ambience_cb = ambience.clone();
    let fade_pause_cb = fade_on_pause.clone();
    let mut ambient_synth = AmbientSynthesizer::new(out_rate);
    let mut pause_fade = 1.0_f32;
    let mut current_duck = f32::from_bits(duck_gain_bits.load(Ordering::Relaxed)).clamp(0.05, 1.0);
    let tail_save_cb = crossfade_tail.clone();
    let mut incoming_tail: std::collections::VecDeque<(f32, f32)> = {
        let mut g = crossfade_tail.lock().unwrap();
        std::mem::take(&mut *g)
    };
    let incoming_tail_total = incoming_tail.len().max(1);
    let mut tail_saved = false;
    let played_frames = Arc::new(AtomicU64::new(0));
    let played_frames_cb = played_frames.clone();
    let position_ms_cb = position_ms.clone();
    let seek_base_ms = Arc::new(AtomicU64::new(req.initial_seek_ms));
    let seek_base_cb = seek_base_ms.clone();
    let out_rate_u64 = out_rate as u64;

    if req.initial_seek_ms > 0 {
        position_ms.store(req.initial_seek_ms, Ordering::Relaxed);
    }

    // Smooth per-sample gain state inside the CPAL hardware callback -> 0ms volume lag & ZERO clicks!
    let mut current_gain = if muted.load(Ordering::Relaxed) {
        0.0_f32
    } else {
        perceptual_gain(f32::from_bits(volume_bits.load(Ordering::Relaxed)))
    };

    let stream: Stream = match sample_format {
        SampleFormat::F32 => device.build_output_stream(
            &stream_config,
            move |data: &mut [f32], _| {
                if cancel_cb.load(Ordering::Relaxed)
                    && !flush_cb.load(Ordering::Relaxed)
                    && !tail_saved
                    && crossfade_cb.load(Ordering::Relaxed) > 0
                {
                    tail_saved = true;
                    if let Ok(mut g) = tail_save_cb.try_lock() {
                        g.clear();
                        let max_frames = (out_rate_u64 as usize) * 2;
                        while g.len() < max_frames {
                            match consumer.try_pop() {
                                Some(f) => g.push_back(f),
                                None => break,
                            }
                        }
                    }
                }
                fill_output_f32(
                    data,
                    out_channels,
                    &mut consumer,
                    &mut incoming_tail,
                    incoming_tail_total,
                    &paused_cb,
                    &cancel_cb,
                    &flush_cb,
                    &vol_cb,
                    &muted_cb,
                    &speed_cb,
                    &duck_cb,
                    &mut current_duck,
                    &crossfade_cb,
                    &duration_cb,
                    &ambience_cb,
                    &mut ambient_synth,
                    &fade_pause_cb,
                    &mut pause_fade,
                    &mut current_gain,
                    &played_frames_cb,
                    &seek_base_cb,
                    &position_ms_cb,
                    out_rate_u64,
                );
            },
            |err| crate::logger::error("audio", format!("CPAL stream error: {err}")),
            None,
        )?,
        SampleFormat::I16 => device.build_output_stream(
            &stream_config,
            move |data: &mut [i16], _| {
                fill_output_i16(
                    data,
                    out_channels,
                    &mut consumer,
                    &paused_cb,
                    &cancel_cb,
                    &flush_cb,
                    &vol_cb,
                    &muted_cb,
                    &speed_cb,
                    &duck_cb,
                    &mut current_duck,
                    &crossfade_cb,
                    &duration_cb,
                    &mut current_gain,
                    &played_frames_cb,
                    &seek_base_cb,
                    &position_ms_cb,
                    out_rate_u64,
                );
            },
            |err| crate::logger::error("audio", format!("CPAL stream error: {err}")),
            None,
        )?,
        SampleFormat::U16 => device.build_output_stream(
            &stream_config,
            move |data: &mut [u16], _| {
                fill_output_u16(
                    data,
                    out_channels,
                    &mut consumer,
                    &paused_cb,
                    &cancel_cb,
                    &flush_cb,
                    &vol_cb,
                    &muted_cb,
                    &speed_cb,
                    &duck_cb,
                    &mut current_duck,
                    &crossfade_cb,
                    &duration_cb,
                    &mut current_gain,
                    &played_frames_cb,
                    &seek_base_cb,
                    &position_ms_cb,
                    out_rate_u64,
                );
            },
            |err| crate::logger::error("audio", format!("CPAL stream error: {err}")),
            None,
        )?,
        other => return Err(anyhow!("Unsupported CPAL sample format: {other:?}")),
    };

    // Prefer reference FFmpeg (official libopus / AAC-LC / SoXR / atempo / live HLS & Icecast)
    // whenever the file is completely cached/local OR playing a live radio stream
    let use_ffmpeg = req.ffmpeg_path.as_ref().map(|p| p.is_file()).unwrap_or(false)
        && (req.progress.is_none() || req.live_url.is_some());

    let completed = if use_ffmpeg {
        decode_via_ffmpeg(
            req.ffmpeg_path.as_ref().unwrap(),
            &req,
            out_rate,
            out_channels,
            &device_name,
            &stream,
            &mut producer,
            &cancel,
            &seek_target_ms,
            &flush_ring,
            &played_frames,
            &seek_base_ms,
            &position_ms,
            &duration_ms,
            &ffmpeg_pid,
            &speed_bits,
            &preserve_pitch,
            &pitch_semitones_bits,
            &trim_silence,
            &visualizer_enabled,
            &spectrum,
            &dsp,
            &is_loading,
        )?
    } else {
        decode_via_symphonia(
            &req,
            out_rate,
            out_channels,
            &device_name,
            &stream,
            &mut producer,
            &cancel,
            &seek_target_ms,
            &flush_ring,
            &played_frames,
            &seek_base_ms,
            &position_ms,
            &duration_ms,
            &visualizer_enabled,
            &spectrum,
            &dsp,
            &telemetry_slot,
            &is_loading,
        )?
    };

    // Drain remaining ring buffer cleanly at natural end of track
    while !cancel.load(Ordering::Acquire) && producer.occupied_len() > 0 {
        std::thread::sleep(Duration::from_millis(12));
    }

    drop(stream);
    Ok(completed && !cancel.load(Ordering::Acquire))
}

/// Chains FFmpeg `atempo` filters (each stage must be in `[0.5, 2.0]`) for arbitrary tempo factors.
pub fn build_atempo_chain(factor: f32) -> String {
    let mut rem = factor.clamp(0.25, 4.0);
    let mut parts = Vec::new();
    while rem < 0.5 {
        parts.push("atempo=0.5".to_string());
        rem /= 0.5;
    }
    while rem > 2.0 {
        parts.push("atempo=2.0".to_string());
        rem /= 2.0;
    }
    if (rem - 1.0).abs() > 0.003 {
        parts.push(format!("atempo={rem:.4}"));
    }
    parts.join(",")
}

/// Builds the FFmpeg `-af` filter string combining playback speed, pitch-lock, and semitone pitch shift.
pub fn build_speed_pitch_filter(
    out_rate: u32,
    speed: f32,
    preserve_pitch: bool,
    pitch_semitones: f32,
) -> String {
    let sp = speed.clamp(0.5, 2.0);
    let semi = pitch_semitones.clamp(-6.0, 6.0);
    let has_pitch = semi.abs() > 0.05;
    let has_speed = (sp - 1.0).abs() > 0.005;

    if !has_pitch && !has_speed {
        return "aresample=resampler=soxr".to_string();
    }

    let pitch_ratio = if has_pitch {
        2.0_f32.powf(semi / 12.0)
    } else {
        1.0
    };

    let (rate_ratio, tempo_factor) = if preserve_pitch {
        (pitch_ratio, sp / pitch_ratio)
    } else {
        (pitch_ratio * sp, 1.0)
    };

    let mut filters = Vec::new();
    if (rate_ratio - 1.0).abs() > 0.002 {
        let shifted = ((out_rate as f32) * rate_ratio)
            .round()
            .clamp(16000.0, 192000.0) as u32;
        filters.push(format!("asetrate={shifted}"));
        filters.push(format!("aresample={out_rate}:resampler=soxr"));
    } else {
        filters.push("aresample=resampler=soxr".to_string());
    }

    if (tempo_factor - 1.0).abs() > 0.004 {
        let chain = build_atempo_chain(tempo_factor);
        if !chain.is_empty() {
            filters.push(chain);
        }
    }
    filters.join(",")
}

/// Exports an A-B loop segment `[a_ms..b_ms]` to `.mp3`, `.flac`, or `.wav` with 150ms fades
/// and active speed/pitch/vocal-remover FX baked in.
#[allow(clippy::too_many_arguments)]
pub fn export_ab_clip(
    ffmpeg: &std::path::Path,
    input_path: &std::path::Path,
    output_path: &std::path::Path,
    a_ms: u64,
    b_ms: u64,
    format: &str,
    speed: f32,
    preserve_pitch: bool,
    pitch_semitones: f32,
    vocal_remover: bool,
) -> Result<String> {
    if b_ms <= a_ms + 250 {
        return Err(anyhow!("A-B clip must be at least 0.25 seconds long."));
    }
    let start_s = a_ms as f64 / 1000.0;
    let raw_dur_s = (b_ms - a_ms) as f64 / 1000.0;
    let effective_dur_s = (raw_dur_s / speed.clamp(0.5, 2.0) as f64).max(0.3);
    let fade_d = (effective_dur_s * 0.15).min(0.15);
    let fade_out_st = (effective_dur_s - fade_d).max(0.0);

    let mut filters = Vec::new();
    let sp_filter = build_speed_pitch_filter(48_000, speed, preserve_pitch, pitch_semitones);
    if !sp_filter.is_empty() {
        filters.push(sp_filter);
    }
    if vocal_remover {
        filters.push("stereotools=mlev=0.08".to_string());
    }
    filters.push(format!("afade=t=in:st=0:d={fade_d:.3}"));
    filters.push(format!("afade=t=out:st={fade_out_st:.3}:d={fade_d:.3}"));
    let af_chain = filters.join(",");

    let mut cmd = StdCommand::new(ffmpeg);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.args([
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        &format!("{start_s:.3}"),
        "-t",
        &format!("{raw_dur_s:.3}"),
        "-i",
    ])
    .arg(input_path)
    .args(["-vn", "-ar", "48000", "-ac", "2", "-af", &af_chain]);

    match format.to_lowercase().as_str() {
        "flac" => {
            cmd.args(["-c:a", "flac"]);
        }
        "wav" => {
            cmd.args(["-c:a", "pcm_s16le"]);
        }
        _ => {
            cmd.args(["-c:a", "libmp3lame", "-b:a", "320k"]);
        }
    }
    cmd.arg(output_path);

    let out = cmd.output().context("Failed to execute FFmpeg for clip export")?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(anyhow!("Clip export failed: {}", stderr.trim()));
    }
    Ok(output_path.to_string_lossy().to_string())
}

/// Decodes audio using bundled reference FFmpeg (libopus / AAC-LC / FLAC / SoXR / Live Radio) into 32-bit float
/// stereo PCM, then runs pure-Rust DSP (10-band EQ + LUFS norm + limiter) into the lock-free ring buffer.
#[allow(clippy::too_many_arguments)]
fn decode_via_ffmpeg(
    ffmpeg: &PathBuf,
    req: &PlayRequest,
    out_rate: u32,
    out_channels: usize,
    device_name: &str,
    stream: &Stream,
    producer: &mut ringbuf::HeapProd<(f32, f32)>,
    cancel: &Arc<AtomicBool>,
    seek_target_ms: &Arc<AtomicU64>,
    flush_ring: &Arc<AtomicBool>,
    played_frames: &Arc<AtomicU64>,
    seek_base_ms: &Arc<AtomicU64>,
    position_ms: &Arc<AtomicU64>,
    duration_ms: &Arc<AtomicU64>,
    ffmpeg_pid: &Arc<AtomicU32>,
    speed_bits: &Arc<AtomicU32>,
    preserve_pitch: &Arc<AtomicBool>,
    pitch_semitones_bits: &Arc<AtomicU32>,
    trim_silence: &Arc<AtomicBool>,
    visualizer_enabled: &Arc<AtomicBool>,
    spectrum: &Arc<Mutex<[f32; 32]>>,
    dsp: &Arc<Mutex<DspPipeline>>,
    is_loading: &Arc<AtomicBool>,
) -> Result<bool> {
    let is_live = req.live_url.is_some();
    let mut start_ms: u64 = if is_live { 0 } else { req.initial_seek_ms };
    let mut stream_started = false;
    let mut heard_audio = is_live || req.initial_seek_ms > 0;
    let mut trailing_silent_frames: u64 = 0;
    let prebuffer_frames = (out_rate as usize) / 4; // ~250ms pre-buffer eliminates startup/mid-track clicks

    let mut byte_buf = vec![0u8; 16384]; // 2048 stereo f32 frames per read
    let mut leftover = Vec::<u8>::with_capacity(8);
    let mut interleaved = Vec::<f32>::with_capacity(4096);
    let mut frames_batch = Vec::<(f32, f32)>::with_capacity(2048);

    loop {
        if cancel.load(Ordering::Acquire) {
            return Ok(false);
        }

        let speed = if is_live {
            1.0
        } else {
            f32::from_bits(speed_bits.load(Ordering::Relaxed)).clamp(0.5, 2.0)
        };
        let keep_pitch = preserve_pitch.load(Ordering::Relaxed);
        let pitch_semi = f32::from_bits(pitch_semitones_bits.load(Ordering::Relaxed)).clamp(-6.0, 6.0);
        let af_filter = build_speed_pitch_filter(out_rate, speed, keep_pitch, pitch_semi);

        let mut cmd = StdCommand::new(ffmpeg);
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        cmd.args(["-hide_banner", "-loglevel", "error"]);
        if let Some(ref live_url) = req.live_url {
            cmd.args([
                "-reconnect",
                "1",
                "-reconnect_streamed",
                "1",
                "-reconnect_delay_max",
                "5",
                "-i",
                live_url,
            ]);
        } else {
            if start_ms > 0 {
                cmd.args(["-ss", &format!("{:.3}", start_ms as f64 / 1000.0)]);
            }
            cmd.arg("-i").arg(&req.file_path);
        }
        cmd.args([
            "-vn",
            "-f",
            "f32le",
            "-acodec",
            "pcm_f32le",
            "-ac",
            "2",
            "-ar",
            &out_rate.to_string(),
            "-af",
            &af_filter,
            "pipe:1",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null());

        let mut child = cmd.spawn().context("Failed to spawn reference ffmpeg decoder")?;
        ffmpeg_pid.store(child.id(), Ordering::SeqCst);
        let mut stdout = child
            .stdout
            .take()
            .ok_or_else(|| anyhow!("Missing ffmpeg stdout"))?;

        leftover.clear();
        let mut seek_requested = false;

        loop {
            if cancel.load(Ordering::Acquire) {
                ffmpeg_pid.store(0, Ordering::SeqCst);
                let _ = child.kill();
                let _ = child.wait();
                return Ok(false);
            }

            let pending_seek = seek_target_ms.swap(u64::MAX, Ordering::SeqCst);
            if pending_seek != u64::MAX {
                ffmpeg_pid.store(0, Ordering::SeqCst);
                let _ = child.kill();
                let _ = child.wait();
                start_ms = pending_seek;
                seek_base_ms.store(pending_seek, Ordering::Release);
                played_frames.store(0, Ordering::Release);
                position_ms.store(pending_seek, Ordering::Release);
                flush_ring.store(true, Ordering::SeqCst);
                seek_requested = true;
                break;
            }

            if producer.vacant_len() < 4096 {
                std::thread::sleep(Duration::from_millis(3));
                continue;
            }

            let n = stdout.read(&mut byte_buf)?;
            if n == 0 {
                break;
            }

            // Combine any leftover bytes (< 8 bytes per stereo f32 frame)
            let total_bytes = leftover.len() + n;
            let usable = (total_bytes / 8) * 8;
            interleaved.clear();

            if leftover.is_empty() {
                for chunk in byte_buf[..usable].chunks_exact(4) {
                    interleaved.push(f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
                }
                if usable < n {
                    leftover.extend_from_slice(&byte_buf[usable..n]);
                }
            } else {
                let mut combined = Vec::with_capacity(total_bytes);
                combined.extend_from_slice(&leftover);
                combined.extend_from_slice(&byte_buf[..n]);
                leftover.clear();
                for chunk in combined[..usable].chunks_exact(4) {
                    interleaved.push(f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
                }
                if usable < combined.len() {
                    leftover.extend_from_slice(&combined[usable..]);
                }
            }

            if interleaved.is_empty() {
                continue;
            }

            // Smart Silence Trimmer: skip dead leading silence (<-49 dBFS) and trailing silence > 1.8s
            if !is_live && trim_silence.load(Ordering::Relaxed) {
                let block_peak = interleaved.iter().fold(0.0_f32, |m, &s| m.max(s.abs()));
                let block_frames = (interleaved.len() / 2) as u64;
                if !heard_audio {
                    if block_peak < 0.0035 {
                        let skipped_ms = (block_frames * 1000) / (out_rate as u64);
                        seek_base_ms.fetch_add(skipped_ms, Ordering::Relaxed);
                        continue;
                    } else {
                        heard_audio = true;
                    }
                } else {
                    let pos_now = position_ms.load(Ordering::Relaxed);
                    let dur_now = duration_ms.load(Ordering::Relaxed);
                    if dur_now > 30_000 && pos_now > dur_now.saturating_sub(18_000) {
                        if block_peak < 0.003 {
                            trailing_silent_frames += block_frames;
                            if trailing_silent_frames >= (out_rate as u64) * 18 / 10 {
                                ffmpeg_pid.store(0, Ordering::SeqCst);
                                let _ = child.kill();
                                let _ = child.wait();
                                break;
                            }
                        } else {
                            trailing_silent_frames = 0;
                        }
                    }
                }
            }

            // Pure-Rust DSP: Loudness Normalization + 10-band Biquad EQ + Balance + Soft-Knee Limiter
            {
                let mut d = dsp.lock().unwrap();
                d.process_stereo_interleaved(&mut interleaved);
            }

            if visualizer_enabled.load(Ordering::Relaxed) {
                update_spectrum_bars(&interleaved, spectrum);
            }

            frames_batch.clear();
            for pair in interleaved.chunks_exact(2) {
                frames_batch.push((pair[0], pair[1]));
            }

            let mut offset = 0;
            while offset < frames_batch.len() && !cancel.load(Ordering::Acquire) {
                if seek_target_ms.load(Ordering::Relaxed) != u64::MAX {
                    break;
                }
                let pushed = producer.push_slice(&frames_batch[offset..]);
                offset += pushed;
                if !stream_started && producer.occupied_len() >= prebuffer_frames {
                    stream.play()?;
                    stream_started = true;
                    is_loading.store(false, Ordering::SeqCst);
                    crate::logger::info(
                        "audio",
                        format!(
                            "Reference FFmpeg + Rust DSP playback started: {} {}kbps ({}Hz, {}ch) on {}",
                            req.codec_label, req.bitrate_kbps, out_rate, out_channels, device_name
                        ),
                    );
                }
                if offset < frames_batch.len() {
                    std::thread::sleep(Duration::from_millis(2));
                }
            }
        }

        ffmpeg_pid.store(0, Ordering::SeqCst);
        let _ = child.wait();
        if seek_requested {
            continue;
        }
        break;
    }

    if !stream_started && !cancel.load(Ordering::Acquire) {
        stream.play()?;
        is_loading.store(false, Ordering::SeqCst);
    }

    Ok(true)
}

#[allow(clippy::too_many_arguments)]
fn decode_via_symphonia(
    req: &PlayRequest,
    out_rate: u32,
    out_channels: usize,
    device_name: &str,
    stream: &Stream,
    producer: &mut ringbuf::HeapProd<(f32, f32)>,
    cancel: &Arc<AtomicBool>,
    seek_target_ms: &Arc<AtomicU64>,
    flush_ring: &Arc<AtomicBool>,
    played_frames: &Arc<AtomicU64>,
    seek_base_ms: &Arc<AtomicU64>,
    position_ms: &Arc<AtomicU64>,
    duration_ms: &Arc<AtomicU64>,
    visualizer_enabled: &Arc<AtomicBool>,
    spectrum: &Arc<Mutex<[f32; 32]>>,
    dsp: &Arc<Mutex<DspPipeline>>,
    telemetry_slot: &Arc<RwLock<Option<AudioTelemetry>>>,
    is_loading: &Arc<AtomicBool>,
) -> Result<bool> {
    let media_source: Box<dyn MediaSource> = match &req.progress {
        Some(prog) => Box::new(
            ProgressiveMediaSource::open(&req.file_path, prog.clone())
                .context("Failed to open progressive stream cache")?,
        ),
        None => Box::new(File::open(&req.file_path).context("Failed to open audio file")?),
    };

    let mss = MediaSourceStream::new(media_source, Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = &req.ext_hint {
        hint.with_extension(ext);
    } else if let Some(ext) = req.file_path.extension().and_then(|s| s.to_str()) {
        hint.with_extension(ext);
    }

    let mut format = symphonia::default::get_probe()
        .probe(&hint, mss, FormatOptions::default(), MetadataOptions::default())
        .context("Failed to probe audio container format")?;

    let track = format
        .default_track(TrackType::Audio)
        .ok_or_else(|| anyhow!("No audio track found in media stream"))?;
    let track_id = track.id;
    let time_base = track.time_base;

    let audio_params = track
        .codec_params
        .as_ref()
        .and_then(|p| p.audio())
        .ok_or_else(|| anyhow!("Track has no audio codec parameters"))?
        .clone();

    let source_rate = audio_params.sample_rate.unwrap_or(48_000);
    let source_channels = audio_params
        .channels
        .as_ref()
        .map(|c| c.count())
        .unwrap_or(2);

    if let Some(t) = telemetry_slot.write().unwrap().as_mut() {
        t.source_sample_rate = source_rate;
    }

    if let (Some(num_frames), Some(tb)) = (track.num_frames, time_base) {
        if let Some(dur) = tb.calc_duration(num_frames.into()) {
            let ms = (dur.as_nanos() / 1_000_000).max(0) as u64;
            if ms > 0 {
                duration_ms.store(ms, Ordering::Relaxed);
            }
        }
    }

    let codec_registry = build_codec_registry();
    let mut decoder = codec_registry
        .make_audio_decoder(&audio_params, &AudioDecoderOptions::default())
        .context("Failed to initialize pure-Rust Symphonia audio decoder")?;

    let prebuffer_frames = (out_rate as usize) / 8;
    let mut stream_started = false;
    let mut resampler = SincResampler::new(source_rate, out_rate);
    let mut raw_samples: Vec<f32> = Vec::with_capacity(8192);
    let mut stereo_in: Vec<f32> = Vec::with_capacity(8192);
    let mut resampled: Vec<f32> = Vec::with_capacity(16384);
    let mut frames_batch: Vec<(f32, f32)> = Vec::with_capacity(8192);

    loop {
        if cancel.load(Ordering::Acquire) {
            return Ok(false);
        }

        let seek_req = seek_target_ms.swap(u64::MAX, Ordering::SeqCst);
        if seek_req != u64::MAX {
            let seek_to = SeekTo::Time {
                time: Time::from_millis_u64(seek_req),
                track_id: Some(track_id),
            };
            let mut seek_result = format.seek(SeekMode::Coarse, seek_to);
            if seek_result.is_err()
                && req
                    .progress
                    .as_ref()
                    .map(|p| p.finished.load(Ordering::Acquire))
                    .unwrap_or(true)
            {
                if let Ok(f) = File::open(&req.file_path) {
                    let mss_seek = MediaSourceStream::new(Box::new(f), Default::default());
                    if let Ok(mut new_fmt) = symphonia::default::get_probe().probe(
                        &hint,
                        mss_seek,
                        FormatOptions::default(),
                        MetadataOptions::default(),
                    ) {
                        seek_result = new_fmt.seek(
                            SeekMode::Coarse,
                            SeekTo::Time {
                                time: Time::from_millis_u64(seek_req),
                                track_id: Some(track_id),
                            },
                        );
                        if seek_result.is_ok() {
                            format = new_fmt;
                        }
                    }
                }
            }
            if let Ok(seeked) = seek_result {
                decoder.reset();
                resampler.reset();
                flush_ring.store(true, Ordering::SeqCst);
                let actual_ms = time_base
                    .and_then(|tb| tb.calc_time(seeked.actual_ts))
                    .map(|t| (t.as_nanos() / 1_000_000).max(0) as u64)
                    .unwrap_or(seek_req);
                seek_base_ms.store(actual_ms, Ordering::Release);
                played_frames.store(0, Ordering::Release);
                position_ms.store(actual_ms, Ordering::Release);
            }
        }

        if producer.vacant_len() < 4096 {
            std::thread::sleep(Duration::from_millis(3));
            continue;
        }

        let packet = match format.next_packet() {
            Ok(Some(p)) => p,
            Ok(None) => break,
            Err(SymphoniaError::IoError(ref e))
                if e.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(SymphoniaError::ResetRequired) => {
                decoder.reset();
                continue;
            }
            Err(e) => return Err(anyhow!("Demuxer error: {e}")),
        };

        if packet.track_id != track_id {
            continue;
        }

        match decoder.decode(&packet) {
            Ok(audio_buf) => {
                let total_samples = audio_buf.samples_interleaved();
                if total_samples == 0 {
                    continue;
                }
                raw_samples.resize(total_samples, f32::MID);
                audio_buf.copy_to_slice_interleaved(&mut raw_samples);

                stereo_in.clear();
                let ch = audio_buf.spec().channels().count().max(source_channels).max(1);
                if ch == 2 {
                    stereo_in.extend_from_slice(&raw_samples);
                } else if ch == 1 {
                    stereo_in.reserve(raw_samples.len() * 2);
                    for &s in &raw_samples {
                        stereo_in.push(s);
                        stereo_in.push(s);
                    }
                } else {
                    for frame in raw_samples.chunks_exact(ch) {
                        stereo_in.push(frame[0]);
                        stereo_in.push(frame[1]);
                    }
                }

                resampled.clear();
                resampler.process_stereo(&stereo_in, &mut resampled);

                {
                    let mut d = dsp.lock().unwrap();
                    d.process_stereo_interleaved(&mut resampled);
                }

                if visualizer_enabled.load(Ordering::Relaxed) {
                    update_spectrum_bars(&resampled, spectrum);
                }

                frames_batch.clear();
                for pair in resampled.chunks_exact(2) {
                    frames_batch.push((pair[0], pair[1]));
                }
                let mut offset = 0;
                while offset < frames_batch.len() && !cancel.load(Ordering::Acquire) {
                    if seek_target_ms.load(Ordering::Relaxed) != u64::MAX {
                        break;
                    }
                    let pushed = producer.push_slice(&frames_batch[offset..]);
                    offset += pushed;
                    if !stream_started && producer.occupied_len() >= prebuffer_frames {
                        stream.play()?;
                        stream_started = true;
                        is_loading.store(false, Ordering::SeqCst);
                        crate::logger::info(
                            "audio",
                            format!(
                                "Symphonia playback started: {} {}kbps ({}Hz -> {}Hz, {}ch) on {}",
                                req.codec_label,
                                req.bitrate_kbps,
                                source_rate,
                                out_rate,
                                out_channels,
                                device_name
                            ),
                        );
                    }
                    if offset < frames_batch.len() {
                        std::thread::sleep(Duration::from_millis(2));
                    }
                }
            }
            Err(SymphoniaError::DecodeError(_)) => continue,
            Err(e) => return Err(anyhow!("Audio decode error: {e}")),
        }
    }

    if !stream_started && !cancel.load(Ordering::Acquire) {
        stream.play()?;
        is_loading.store(false, Ordering::SeqCst);
    }

    Ok(true)
}

#[inline]
fn perceptual_gain(vol: f32) -> f32 {
    let v = vol.clamp(0.0, 1.5);
    if v <= 1.0 {
        v * v
    } else {
        v
    }
}

#[inline]
fn crossfade_envelope(pos_ms: u64, dur_ms: u64, cf_ms: u64) -> f32 {
    if cf_ms == 0 {
        return 1.0;
    }
    let mut env = 1.0_f32;
    if pos_ms < cf_ms {
        let t = (pos_ms as f32 / cf_ms as f32).clamp(0.0, 1.0);
        env = env.min(t);
    }
    if dur_ms > cf_ms * 2 && pos_ms + cf_ms > dur_ms {
        let rem = dur_ms.saturating_sub(pos_ms);
        let t = (rem as f32 / cf_ms as f32).clamp(0.0, 1.0);
        env = env.min(t);
    }
    env
}

/// Lightweight zero-dependency 256-point Radix-2 Hann-windowed FFT into 32 logarithmic bars.
fn update_spectrum_bars(stereo: &[f32], target: &Arc<Mutex<[f32; 32]>>) {
    const N: usize = 256;
    if stereo.len() < N * 2 {
        return;
    }
    let mut re = [0.0_f32; N];
    let mut im = [0.0_f32; N];
    for i in 0..N {
        let mono = 0.5 * (stereo[i * 2] + stereo[i * 2 + 1]);
        let w = 0.5 * (1.0 - (std::f32::consts::TAU * i as f32 / (N - 1) as f32).cos());
        re[i] = mono * w;
    }

    // Bit-reversal permutation
    let mut j = 0usize;
    for i in 1..N {
        let mut bit = N >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j ^= bit;
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }

    // Iterative Cooley-Tukey Radix-2 FFT
    let mut len = 2;
    while len <= N {
        let ang = -std::f32::consts::TAU / len as f32;
        let wlen_re = ang.cos();
        let wlen_im = ang.sin();
        let mut i = 0;
        while i < N {
            let mut w_re = 1.0_f32;
            let mut w_im = 0.0_f32;
            for k in 0..(len / 2) {
                let u_re = re[i + k];
                let u_im = im[i + k];
                let v_re = re[i + k + len / 2] * w_re - im[i + k + len / 2] * w_im;
                let v_im = re[i + k + len / 2] * w_im + im[i + k + len / 2] * w_re;
                re[i + k] = u_re + v_re;
                im[i + k] = u_im + v_im;
                re[i + k + len / 2] = u_re - v_re;
                im[i + k + len / 2] = u_im - v_im;
                let next_re = w_re * wlen_re - w_im * wlen_im;
                let next_im = w_re * wlen_im + w_im * wlen_re;
                w_re = next_re;
                w_im = next_im;
            }
            i += len;
        }
        len <<= 1;
    }

    // Map 128 frequency bins logarithmically into 32 smooth bars
    let mut bars = [0.0_f32; 32];
    let half = N / 2;
    for b in 0..32 {
        let f0 = ((half as f32).powf(b as f32 / 32.0)).floor() as usize;
        let f1 = ((half as f32).powf((b + 1) as f32 / 32.0)).ceil() as usize;
        let lo = f0.clamp(1, half - 1);
        let hi = f1.max(lo + 1).min(half);
        let mut sum = 0.0_f32;
        for bin in lo..hi {
            sum += (re[bin] * re[bin] + im[bin] * im[bin]).sqrt();
        }
        let avg = sum / ((hi - lo) as f32);
        // Gentle perceptual compression into 0..1
        let norm = (avg / 14.0).powf(0.55).clamp(0.0, 1.0);
        bars[b] = norm;
    }

    if let Ok(mut guard) = target.try_lock() {
        for i in 0..32 {
            // Fast attack, smooth decay
            guard[i] = if bars[i] > guard[i] {
                guard[i] * 0.35 + bars[i] * 0.65
            } else {
                guard[i] * 0.72 + bars[i] * 0.28
            };
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn fill_output_f32(
    data: &mut [f32],
    out_channels: usize,
    consumer: &mut ringbuf::HeapCons<(f32, f32)>,
    incoming_tail: &mut std::collections::VecDeque<(f32, f32)>,
    incoming_tail_total: usize,
    paused: &AtomicBool,
    cancel: &AtomicBool,
    flush_ring: &AtomicBool,
    volume_bits: &AtomicU32,
    muted: &AtomicBool,
    speed_bits: &AtomicU32,
    duck_gain_bits: &AtomicU32,
    current_duck: &mut f32,
    crossfade_ms: &AtomicU64,
    duration_ms: &AtomicU64,
    ambience: &RwLock<AmbienceSettings>,
    ambient_synth: &mut AmbientSynthesizer,
    fade_on_pause: &AtomicBool,
    pause_fade: &mut f32,
    current_gain: &mut f32,
    played_frames: &AtomicU64,
    seek_base_ms: &AtomicU64,
    position_ms: &AtomicU64,
    out_rate: u64,
) {
    if flush_ring.swap(false, Ordering::Acquire) {
        consumer.clear();
        incoming_tail.clear();
    }
    if cancel.load(Ordering::Relaxed) {
        data.fill(0.0);
        return;
    }

    let is_paused = paused.load(Ordering::Relaxed);
    let smooth_pause = fade_on_pause.load(Ordering::Relaxed);
    let fade_step = 1.0_f32 / ((out_rate as f32) * 0.18).max(1.0); // ~180ms silky fade-on-pause/resume
    let target_duck = f32::from_bits(duck_gain_bits.load(Ordering::Relaxed)).clamp(0.05, 1.0);

    let amb_cfg = ambience
        .try_read()
        .map(|g| g.clone())
        .unwrap_or_default();
    let is_muted = muted.load(Ordering::Relaxed);
    let master_vol = if is_muted {
        0.0
    } else {
        perceptual_gain(f32::from_bits(volume_bits.load(Ordering::Relaxed)))
    };

    // Fast path when fully paused & faded out
    if is_paused && (!smooth_pause || *pause_fade <= 0.0005) {
        *pause_fade = 0.0;
        if amb_cfg.enabled && !is_muted {
            for frame in data.chunks_exact_mut(out_channels) {
                *current_duck += (target_duck - *current_duck) * 0.0004;
                let (al, ar) = ambient_synth.next_frame(&amb_cfg);
                let g_amb = master_vol * *current_duck;
                if out_channels == 1 {
                    frame[0] = (al + ar) * 0.5 * g_amb;
                } else {
                    frame[0] = al * g_amb;
                    frame[1] = ar * g_amb;
                    for ch in frame.iter_mut().skip(2) {
                        *ch = 0.0;
                    }
                }
            }
        } else {
            data.fill(0.0);
        }
        return;
    }

    let pos_now = position_ms.load(Ordering::Relaxed);
    let dur_now = duration_ms.load(Ordering::Relaxed);
    let cf_now = crossfade_ms.load(Ordering::Relaxed);
    let env = if !incoming_tail.is_empty() {
        1.0
    } else {
        crossfade_envelope(pos_now, dur_now, cf_now)
    };

    let target_gain = master_vol * env;

    let mut frames_written = 0u64;
    for frame in data.chunks_exact_mut(out_channels) {
        if smooth_pause {
            if is_paused {
                *pause_fade = (*pause_fade - fade_step).max(0.0);
            } else {
                *pause_fade = (*pause_fade + fade_step).min(1.0);
            }
        } else {
            *pause_fade = if is_paused { 0.0 } else { 1.0 };
        }

        // Smooth per-sample gain + auto-ducking ramping eliminates zipper noise and sudden jumps
        *current_gain += (target_gain - *current_gain) * 0.004;
        *current_duck += (target_duck - *current_duck) * 0.0004;
        let g = *current_gain * *pause_fade * *current_duck;

        let (mut l, mut r) = if *pause_fade > 0.0005 {
            let (in_l, in_r) = consumer.try_pop().unwrap_or((0.0, 0.0));
            frames_written += 1;
            if let Some((old_l, old_r)) = incoming_tail.pop_front() {
                let p = 1.0 - (incoming_tail.len() as f32 / incoming_tail_total as f32);
                let angle = p * std::f32::consts::FRAC_PI_2;
                let fade_out = angle.cos();
                let fade_in = angle.sin();
                (
                    (old_l * fade_out + in_l * fade_in) * g,
                    (old_r * fade_out + in_r * fade_in) * g,
                )
            } else {
                (in_l * g, in_r * g)
            }
        } else {
            (0.0, 0.0)
        };

        if amb_cfg.enabled && !is_muted {
            let (al, ar) = ambient_synth.next_frame(&amb_cfg);
            l = (l + al * master_vol).clamp(-1.0, 1.0);
            r = (r + ar * master_vol).clamp(-1.0, 1.0);
        }

        if out_channels == 1 {
            frame[0] = (l + r) * 0.5;
        } else {
            frame[0] = l;
            frame[1] = r;
            for ch in frame.iter_mut().skip(2) {
                *ch = 0.0;
            }
        }
    }
    if frames_written > 0 {
        let total = played_frames.fetch_add(frames_written, Ordering::Relaxed) + frames_written;
        let speed = f32::from_bits(speed_bits.load(Ordering::Relaxed)).clamp(0.5, 2.0) as f64;
        let ms = seek_base_ms.load(Ordering::Relaxed)
            + (((total as f64) * 1000.0 * speed) / (out_rate as f64)) as u64;
        position_ms.store(ms, Ordering::Relaxed);
    }
}

#[allow(clippy::too_many_arguments)]
fn fill_output_i16(
    data: &mut [i16],
    out_channels: usize,
    consumer: &mut ringbuf::HeapCons<(f32, f32)>,
    paused: &AtomicBool,
    cancel: &AtomicBool,
    flush_ring: &AtomicBool,
    volume_bits: &AtomicU32,
    muted: &AtomicBool,
    speed_bits: &AtomicU32,
    duck_gain_bits: &AtomicU32,
    current_duck: &mut f32,
    crossfade_ms: &AtomicU64,
    duration_ms: &AtomicU64,
    current_gain: &mut f32,
    played_frames: &AtomicU64,
    seek_base_ms: &AtomicU64,
    position_ms: &AtomicU64,
    out_rate: u64,
) {
    if flush_ring.swap(false, Ordering::Acquire) {
        consumer.clear();
    }
    if paused.load(Ordering::Relaxed) || cancel.load(Ordering::Relaxed) {
        data.fill(0);
        return;
    }
    let env = crossfade_envelope(
        position_ms.load(Ordering::Relaxed),
        duration_ms.load(Ordering::Relaxed),
        crossfade_ms.load(Ordering::Relaxed),
    );
    let target_duck = f32::from_bits(duck_gain_bits.load(Ordering::Relaxed)).clamp(0.05, 1.0);
    let target_gain = if muted.load(Ordering::Relaxed) {
        0.0
    } else {
        perceptual_gain(f32::from_bits(volume_bits.load(Ordering::Relaxed))) * env
    };

    let mut frames_written = 0u64;
    for frame in data.chunks_exact_mut(out_channels) {
        *current_gain += (target_gain - *current_gain) * 0.004;
        *current_duck += (target_duck - *current_duck) * 0.0004;
        let g = *current_gain * *current_duck;
        let (lf, rf) = match consumer.try_pop() {
            Some((ls, rs)) => (ls * g, rs * g),
            None => (0.0, 0.0),
        };
        let l = (lf.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
        let r = (rf.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
        if out_channels == 1 {
            frame[0] = ((l as i32 + r as i32) / 2) as i16;
        } else {
            frame[0] = l;
            frame[1] = r;
            for ch in frame.iter_mut().skip(2) {
                *ch = 0;
            }
        }
        frames_written += 1;
    }
    let total = played_frames.fetch_add(frames_written, Ordering::Relaxed) + frames_written;
    let speed = f32::from_bits(speed_bits.load(Ordering::Relaxed)).clamp(0.5, 2.0) as f64;
    let ms = seek_base_ms.load(Ordering::Relaxed)
        + (((total as f64) * 1000.0 * speed) / (out_rate as f64)) as u64;
    position_ms.store(ms, Ordering::Relaxed);
}

#[allow(clippy::too_many_arguments)]
fn fill_output_u16(
    data: &mut [u16],
    out_channels: usize,
    consumer: &mut ringbuf::HeapCons<(f32, f32)>,
    paused: &AtomicBool,
    cancel: &AtomicBool,
    flush_ring: &AtomicBool,
    volume_bits: &AtomicU32,
    muted: &AtomicBool,
    speed_bits: &AtomicU32,
    duck_gain_bits: &AtomicU32,
    current_duck: &mut f32,
    crossfade_ms: &AtomicU64,
    duration_ms: &AtomicU64,
    current_gain: &mut f32,
    played_frames: &AtomicU64,
    seek_base_ms: &AtomicU64,
    position_ms: &AtomicU64,
    out_rate: u64,
) {
    if flush_ring.swap(false, Ordering::Acquire) {
        consumer.clear();
    }
    if paused.load(Ordering::Relaxed) || cancel.load(Ordering::Relaxed) {
        data.fill(u16::MAX / 2);
        return;
    }
    let env = crossfade_envelope(
        position_ms.load(Ordering::Relaxed),
        duration_ms.load(Ordering::Relaxed),
        crossfade_ms.load(Ordering::Relaxed),
    );
    let target_duck = f32::from_bits(duck_gain_bits.load(Ordering::Relaxed)).clamp(0.05, 1.0);
    let target_gain = if muted.load(Ordering::Relaxed) {
        0.0
    } else {
        perceptual_gain(f32::from_bits(volume_bits.load(Ordering::Relaxed))) * env
    };

    let mut frames_written = 0u64;
    for frame in data.chunks_exact_mut(out_channels) {
        *current_gain += (target_gain - *current_gain) * 0.004;
        *current_duck += (target_duck - *current_duck) * 0.0004;
        let g = *current_gain * *current_duck;
        let (lf, rf) = match consumer.try_pop() {
            Some((ls, rs)) => (ls * g, rs * g),
            None => (0.0, 0.0),
        };
        let l = ((lf.clamp(-1.0, 1.0) * 0.5 + 0.5) * u16::MAX as f32) as u16;
        let r = ((rf.clamp(-1.0, 1.0) * 0.5 + 0.5) * u16::MAX as f32) as u16;
        if out_channels == 1 {
            frame[0] = ((l as u32 + r as u32) / 2) as u16;
        } else {
            frame[0] = l;
            frame[1] = r;
            for ch in frame.iter_mut().skip(2) {
                *ch = u16::MAX / 2;
            }
        }
        frames_written += 1;
    }
    let total = played_frames.fetch_add(frames_written, Ordering::Relaxed) + frames_written;
    let speed = f32::from_bits(speed_bits.load(Ordering::Relaxed)).clamp(0.5, 2.0) as f64;
    let ms = seek_base_ms.load(Ordering::Relaxed)
        + (((total as f64) * 1000.0 * speed) / (out_rate as f64)) as u64;
    position_ms.store(ms, Ordering::Relaxed);
}

fn select_output_device(host: &cpal::Host, desired: Option<&str>) -> Result<cpal::Device> {
    if let Some(name) = desired.filter(|s| !s.is_empty()) {
        if let Ok(iter) = host.output_devices() {
            for dev in iter {
                if dev.name().ok().as_deref() == Some(name) {
                    return Ok(dev);
                }
            }
        }
    }
    host.default_output_device()
        .ok_or_else(|| anyhow!("No audio output device available on this system"))
}

fn select_best_config(
    device: &cpal::Device,
    exclusive_mode: bool,
) -> Result<(StreamConfig, SampleFormat)> {
    if exclusive_mode {
        if let Ok(configs) = device.supported_output_configs() {
            let mut best: Option<(StreamConfig, SampleFormat, u32)> = None;
            for range in configs {
                if range.channels() != 2 {
                    continue;
                }
                let fmt = range.sample_format();
                let preferred_rate = [96_000u32, 48_000, 44_100]
                    .into_iter()
                    .find(|&r| r >= range.min_sample_rate().0 && r <= range.max_sample_rate().0)
                    .unwrap_or(range.max_sample_rate().0);
                let score = preferred_rate + if matches!(fmt, SampleFormat::F32) { 1000 } else { 0 };
                if best.as_ref().map(|b| score > b.2).unwrap_or(true) {
                    best = Some((
                        range.with_sample_rate(cpal::SampleRate(preferred_rate)).config(),
                        fmt,
                        score,
                    ));
                }
            }
            if let Some((cfg, fmt, _)) = best {
                return Ok((cfg, fmt));
            }
        }
    }
    if let Ok(def) = device.default_output_config() {
        return Ok((def.config(), def.sample_format()));
    }
    if let Ok(mut configs) = device.supported_output_configs() {
        if let Some(range) = configs.next() {
            let fmt = range.sample_format();
            let rate =
                if 48_000 >= range.min_sample_rate().0 && 48_000 <= range.max_sample_rate().0 {
                    48_000
                } else {
                    range.max_sample_rate().0
                };
            return Ok((range.with_sample_rate(cpal::SampleRate(rate)).config(), fmt));
        }
    }
    Err(anyhow!("No supported audio output configuration found"))
}
