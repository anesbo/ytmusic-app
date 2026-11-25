pub mod dsp;
pub mod source;

use std::fs::File;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
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

use crate::audio::dsp::{DspPipeline, SincResampler};
use crate::audio::source::{DownloadProgress, ProgressiveMediaSource};
use crate::models::{AudioDeviceInfo, AudioSettings, AudioTelemetry, PlaybackSnapshot, Track};

/// Information required to start playing a resolved audio source.
#[derive(Clone)]
pub struct PlayRequest {
    pub track: Track,
    pub file_path: PathBuf,
    pub ext_hint: Option<String>,
    pub codec_label: String,
    pub bitrate_kbps: u32,
    pub format_id: Option<String>,
    pub is_local_file: bool,
    pub progress: Option<Arc<DownloadProgress>>,
}

struct ActivePlayback {
    cancel: Arc<AtomicBool>,
    paused: Arc<AtomicBool>,
    seek_target_ms: Arc<AtomicU64>, // u64::MAX = no pending seek
    position_ms: Arc<AtomicU64>,
    duration_ms: Arc<AtomicU64>,
    progress: Option<Arc<DownloadProgress>>,
    dsp: Arc<Mutex<DspPipeline>>,
}

pub struct AudioEngine {
    settings: Arc<RwLock<AudioSettings>>,
    active: Arc<Mutex<Option<ActivePlayback>>>,
    current_track: Arc<RwLock<Option<Track>>>,
    telemetry: Arc<RwLock<Option<AudioTelemetry>>>,
    last_error: Arc<RwLock<Option<String>>>,
    is_loading: Arc<AtomicBool>,
    volume: Arc<RwLock<f32>>,
    muted: Arc<AtomicBool>,
    on_track_ended: Arc<RwLock<Option<Arc<dyn Fn() + Send + Sync>>>>,
}

impl AudioEngine {
    pub fn new(initial_settings: AudioSettings) -> Self {
        Self {
            settings: Arc::new(RwLock::new(initial_settings)),
            active: Arc::new(Mutex::new(None)),
            current_track: Arc::new(RwLock::new(None)),
            telemetry: Arc::new(RwLock::new(None)),
            last_error: Arc::new(RwLock::new(None)),
            is_loading: Arc::new(AtomicBool::new(false)),
            volume: Arc::new(RwLock::new(0.85)),
            muted: Arc::new(AtomicBool::new(false)),
            on_track_ended: Arc::new(RwLock::new(None)),
        }
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
        let default_name = host
            .default_output_device()
            .and_then(|d| d.name().ok());

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
        *self.settings.write().unwrap() = new_settings.clone();
        if let Some(active) = self.active.lock().unwrap().as_ref() {
            let mut dsp = active.dsp.lock().unwrap();
            dsp.update_settings(&new_settings);
            let gain = dsp.loudness_gain_db();
            if let Some(t) = self.telemetry.write().unwrap().as_mut() {
                t.loudness_gain_db = gain;
            }
        }
    }

    pub fn set_volume(&self, volume: f32) {
        let clamped = volume.clamp(0.0, 1.5);
        *self.volume.write().unwrap() = clamped;
        let muted = self.muted.load(Ordering::Relaxed);
        if let Some(active) = self.active.lock().unwrap().as_ref() {
            active.dsp.lock().unwrap().set_volume(clamped, muted);
        }
    }

    pub fn set_muted(&self, muted: bool) {
        self.muted.store(muted, Ordering::Relaxed);
        let vol = *self.volume.read().unwrap();
        if let Some(active) = self.active.lock().unwrap().as_ref() {
            active.dsp.lock().unwrap().set_volume(vol, muted);
        }
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
            return was_paused; // returns true if now playing
        }
        false
    }

    pub fn seek(&self, position_ms: u64) {
        if let Some(active) = self.active.lock().unwrap().as_ref() {
            active.seek_target_ms.store(position_ms, Ordering::SeqCst);
        }
    }

    pub fn stop(&self) {
        if let Some(prev) = self.active.lock().unwrap().take() {
            prev.cancel.store(true, Ordering::SeqCst);
            if let Some(p) = prev.progress {
                p.cancelled.store(true, Ordering::SeqCst);
            }
        }
        self.is_loading.store(false, Ordering::SeqCst);
    }

    pub fn snapshot(&self) -> PlaybackSnapshot {
        let active_guard = self.active.lock().unwrap();
        let (is_playing, position_ms, duration_ms, buffered_ratio) = match active_guard.as_ref() {
            Some(a) => {
                let playing = !a.paused.load(Ordering::Relaxed)
                    && !a.cancel.load(Ordering::Relaxed);
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
            volume: *self.volume.read().unwrap(),
            muted: self.muted.load(Ordering::Relaxed),
            current_track: self.current_track.read().unwrap().clone(),
            telemetry: self.telemetry.read().unwrap().clone(),
            error: self.last_error.read().unwrap().clone(),
        }
    }

    /// Starts decoding and playing the requested audio source on dedicated real-time threads.
    pub fn play(&self, req: PlayRequest) -> Result<()> {
        self.stop();

        let settings = self.settings.read().unwrap().clone();
        let vol = *self.volume.read().unwrap();
        let muted = self.muted.load(Ordering::Relaxed);

        let cancel = Arc::new(AtomicBool::new(false));
        let paused = Arc::new(AtomicBool::new(false));
        let seek_target_ms = Arc::new(AtomicU64::new(u64::MAX));
        let position_ms = Arc::new(AtomicU64::new(0));
        let duration_ms = Arc::new(AtomicU64::new(req.track.duration_secs * 1000));

        let mut dsp_inner = DspPipeline::new(48_000, &settings);
        dsp_inner.set_track_loudness_db(req.track.loudness_db);
        dsp_inner.set_volume(vol, muted);
        let dsp = Arc::new(Mutex::new(dsp_inner));

        *self.current_track.write().unwrap() = Some(req.track.clone());
        *self.last_error.write().unwrap() = None;

        *self.active.lock().unwrap() = Some(ActivePlayback {
            cancel: cancel.clone(),
            paused: paused.clone(),
            seek_target_ms: seek_target_ms.clone(),
            position_ms: position_ms.clone(),
            duration_ms: duration_ms.clone(),
            progress: req.progress.clone(),
            dsp: dsp.clone(),
        });

        let telemetry_slot = self.telemetry.clone();
        let last_error = self.last_error.clone();
        let is_loading = self.is_loading.clone();
        let on_track_ended = self.on_track_ended.clone();

        std::thread::Builder::new()
            .name("liquidytm-audio-decoder".to_string())
            .spawn(move || {
                let res = run_playback_loop(
                    req,
                    settings,
                    cancel.clone(),
                    paused,
                    seek_target_ms,
                    position_ms,
                    duration_ms,
                    dsp,
                    telemetry_slot,
                    is_loading.clone(),
                );
                is_loading.store(false, Ordering::SeqCst);
                match res {
                    Ok(completed_naturally) => {
                        if completed_naturally && !cancel.load(Ordering::Acquire) {
                            if let Some(cb) = on_track_ended.read().unwrap().clone() {
                                cb();
                            }
                        }
                    }
                    Err(e) => {
                        if !cancel.load(Ordering::Acquire) {
                            *last_error.write().unwrap() = Some(e.to_string());
                        }
                    }
                }
            })
            .context("Failed to spawn audio decoder thread")?;

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
    position_ms: Arc<AtomicU64>,
    duration_ms: Arc<AtomicU64>,
    dsp: Arc<Mutex<DspPipeline>>,
    telemetry_slot: Arc<RwLock<Option<AudioTelemetry>>>,
    is_loading: Arc<AtomicBool>,
) -> Result<bool> {
    // 1. Open MediaSource (Progressive stream or local file)
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

    if let (Some(num_frames), Some(tb)) = (track.num_frames, time_base) {
        let dur = tb.calc_time(num_frames);
        let ms = dur.seconds * 1000 + (dur.frac * 1000.0) as u64;
        if ms > 0 {
            duration_ms.store(ms, Ordering::Relaxed);
        }
    }

    let codec_registry = build_codec_registry();
    let mut decoder = codec_registry
        .make_audio_decoder(&audio_params, &AudioDecoderOptions::default())
        .context("Failed to initialize pure-Rust Symphonia audio decoder")?;

    // 2. Initialize CPAL Output Device (matching source sample rate when supported!)
    let host = cpal::default_host();
    let device = select_output_device(&host, settings.output_device.as_deref())?;
    let device_name = device.name().unwrap_or_else(|_| "Default Output".to_string());

    let (stream_config, sample_format) = select_best_config(&device, source_rate)?;
    let out_rate = stream_config.sample_rate.0;
    let out_channels = stream_config.channels as usize;

    // Configure DSP sample rate & report live audiophile telemetry
    let loudness_gain_db = {
        let mut d = dsp.lock().unwrap();
        d.set_sample_rate(out_rate);
        d.loudness_gain_db()
    };

    *telemetry_slot.write().unwrap() = Some(AudioTelemetry {
        codec: req.codec_label.clone(),
        bitrate_kbps: req.bitrate_kbps,
        source_sample_rate: source_rate,
        output_sample_rate: out_rate,
        channels: out_channels as u16,
        output_device: device_name,
        exclusive_mode: settings.exclusive_mode,
        loudness_gain_db,
        is_local_file: req.is_local_file,
        format_id: req.format_id.clone(),
    });

    // Lock-free SPSC ring buffer (~1.5 seconds of stereo audio at output rate)
    let rb_capacity = (out_rate as usize) * 2 * 3 / 2;
    let rb = HeapRb::<f32>::new(rb_capacity);
    let (mut producer, mut consumer) = rb.split();

    let paused_cb = paused.clone();
    let cancel_cb = cancel.clone();
    let played_frames = Arc::new(AtomicU64::new(0));
    let played_frames_cb = played_frames.clone();
    let position_ms_cb = position_ms.clone();
    let seek_base_ms = Arc::new(AtomicU64::new(0));
    let seek_base_cb = seek_base_ms.clone();
    let out_rate_u64 = out_rate as u64;

    let stream: Stream = match sample_format {
        SampleFormat::F32 => device.build_output_stream(
            &stream_config,
            move |data: &mut [f32], _| {
                fill_output_f32(
                    data,
                    out_channels,
                    &mut consumer,
                    &paused_cb,
                    &cancel_cb,
                    &played_frames_cb,
                    &seek_base_cb,
                    &position_ms_cb,
                    out_rate_u64,
                );
            },
            |err| eprintln!("Audio stream error: {err}"),
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
                    &played_frames_cb,
                    &seek_base_cb,
                    &position_ms_cb,
                    out_rate_u64,
                );
            },
            |err| eprintln!("Audio stream error: {err}"),
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
                    &played_frames_cb,
                    &seek_base_cb,
                    &position_ms_cb,
                    out_rate_u64,
                );
            },
            |err| eprintln!("Audio stream error: {err}"),
            None,
        )?,
        other => return Err(anyhow!("Unsupported CPAL sample format: {other:?}")),
    };

    stream.play()?;
    is_loading.store(false, Ordering::SeqCst);

    // 3. Decode -> Mix to Stereo -> High-Quality Sinc Resample -> Pure-Rust DSP -> RingBuffer
    let mut resampler = SincResampler::new(source_rate, out_rate);
    let mut raw_samples: Vec<f32> = Vec::with_capacity(8192);
    let mut stereo_in: Vec<f32> = Vec::with_capacity(8192);
    let mut resampled: Vec<f32> = Vec::with_capacity(16384);

    loop {
        if cancel.load(Ordering::Acquire) {
            return Ok(false);
        }

        // Handle seek requests cleanly
        let seek_req = seek_target_ms.swap(u64::MAX, Ordering::SeqCst);
        if seek_req != u64::MAX {
            let secs = seek_req / 1000;
            let frac = (seek_req % 1000) as f64 / 1000.0;
            let seek_to = SeekTo::Time {
                time: Time::new(secs, frac),
                track_id: Some(track_id),
            };
            if let Ok(seeked) = format.seek(SeekMode::Coarse, seek_to) {
                decoder.reset();
                resampler.reset();
                let actual_ms = if let Some(tb) = time_base {
                    let t = tb.calc_time(seeked.actual_ts);
                    t.seconds * 1000 + (t.frac * 1000.0) as u64
                } else {
                    seek_req
                };
                seek_base_ms.store(actual_ms, Ordering::Release);
                played_frames.store(0, Ordering::Release);
                position_ms.store(actual_ms, Ordering::Release);
            }
        }

        // Backpressure when ring buffer is nearly full
        if producer.vacant_len() < 8192 {
            std::thread::sleep(Duration::from_millis(6));
            continue;
        }

        let packet = match format.next_packet() {
            Ok(Some(p)) => p,
            Ok(None) => break, // EOF
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

                // Normalize channel count to stereo f32
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

                // High-quality Sinc Resampling (passthrough when source_rate == out_rate!)
                resampled.clear();
                resampler.process_stereo(&stereo_in, &mut resampled);

                // Pure-Rust DSP Chain (Preamp, Loudness Norm, 10-band EQ, Balance, Volume, Limiter)
                {
                    let mut d = dsp.lock().unwrap();
                    d.process_stereo_interleaved(&mut resampled);
                }

                // Push to lock-free ring buffer
                let mut offset = 0;
                while offset < resampled.len() && !cancel.load(Ordering::Acquire) {
                    let pushed = producer.push_slice(&resampled[offset..]);
                    offset += pushed;
                    if offset < resampled.len() {
                        if seek_target_ms.load(Ordering::Relaxed) != u64::MAX {
                            break;
                        }
                        std::thread::sleep(Duration::from_millis(4));
                    }
                }
            }
            Err(SymphoniaError::DecodeError(_)) => continue,
            Err(e) => return Err(anyhow!("Audio decode error: {e}")),
        }
    }

    // Drain remaining ring buffer cleanly so end of song isn't cut off
    while !cancel.load(Ordering::Acquire) && producer.occupied_len() > 0 {
        std::thread::sleep(Duration::from_millis(15));
    }

    drop(stream);
    Ok(!cancel.load(Ordering::Acquire))
}

#[allow(clippy::too_many_arguments)]
fn fill_output_f32(
    data: &mut [f32],
    out_channels: usize,
    consumer: &mut ringbuf::HeapCons<f32>,
    paused: &AtomicBool,
    cancel: &AtomicBool,
    played_frames: &AtomicU64,
    seek_base_ms: &AtomicU64,
    position_ms: &AtomicU64,
    out_rate: u64,
) {
    if paused.load(Ordering::Relaxed) || cancel.load(Ordering::Relaxed) {
        data.fill(0.0);
        return;
    }
    let mut frames_written = 0u64;
    for frame in data.chunks_exact_mut(out_channels) {
        let l = consumer.try_pop().unwrap_or(0.0);
        let r = consumer.try_pop().unwrap_or(0.0);
        if out_channels == 1 {
            frame[0] = (l + r) * 0.5;
        } else {
            frame[0] = l;
            frame[1] = r;
            for ch in frame.iter_mut().skip(2) {
                *ch = 0.0;
            }
        }
        frames_written += 1;
    }
    let total = played_frames.fetch_add(frames_written, Ordering::Relaxed) + frames_written;
    let ms = seek_base_ms.load(Ordering::Relaxed) + (total * 1000) / out_rate;
    position_ms.store(ms, Ordering::Relaxed);
}

#[allow(clippy::too_many_arguments)]
fn fill_output_i16(
    data: &mut [i16],
    out_channels: usize,
    consumer: &mut ringbuf::HeapCons<f32>,
    paused: &AtomicBool,
    cancel: &AtomicBool,
    played_frames: &AtomicU64,
    seek_base_ms: &AtomicU64,
    position_ms: &AtomicU64,
    out_rate: u64,
) {
    if paused.load(Ordering::Relaxed) || cancel.load(Ordering::Relaxed) {
        data.fill(0);
        return;
    }
    let mut frames_written = 0u64;
    for frame in data.chunks_exact_mut(out_channels) {
        let l = (consumer.try_pop().unwrap_or(0.0).clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
        let r = (consumer.try_pop().unwrap_or(0.0).clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
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
    let ms = seek_base_ms.load(Ordering::Relaxed) + (total * 1000) / out_rate;
    position_ms.store(ms, Ordering::Relaxed);
}

#[allow(clippy::too_many_arguments)]
fn fill_output_u16(
    data: &mut [u16],
    out_channels: usize,
    consumer: &mut ringbuf::HeapCons<f32>,
    paused: &AtomicBool,
    cancel: &AtomicBool,
    played_frames: &AtomicU64,
    seek_base_ms: &AtomicU64,
    position_ms: &AtomicU64,
    out_rate: u64,
) {
    if paused.load(Ordering::Relaxed) || cancel.load(Ordering::Relaxed) {
        data.fill(u16::MAX / 2);
        return;
    }
    let mut frames_written = 0u64;
    for frame in data.chunks_exact_mut(out_channels) {
        let l = (((consumer.try_pop().unwrap_or(0.0).clamp(-1.0, 1.0)) * 0.5 + 0.5) * u16::MAX as f32) as u16;
        let r = (((consumer.try_pop().unwrap_or(0.0).clamp(-1.0, 1.0)) * 0.5 + 0.5) * u16::MAX as f32) as u16;
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
    let ms = seek_base_ms.load(Ordering::Relaxed) + (total * 1000) / out_rate;
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

fn select_best_config(device: &cpal::Device, target_rate: u32) -> Result<(StreamConfig, SampleFormat)> {
    // Try matching the source track's exact sample rate (bit-transparent!) with F32 stereo first
    if let Ok(configs) = device.supported_output_configs() {
        let mut best: Option<(StreamConfig, SampleFormat, i32)> = None;
        for range in configs {
            let channels = range.channels();
            if channels < 1 {
                continue;
            }
            let fmt = range.sample_format();
            let fmt_score = match fmt {
                SampleFormat::F32 => 30,
                SampleFormat::I16 => 20,
                SampleFormat::U16 => 10,
                _ => continue,
            };
            let ch_score = if channels == 2 { 20 } else { 5 };
            let rate = if target_rate >= range.min_sample_rate().0
                && target_rate <= range.max_sample_rate().0
            {
                target_rate
            } else if 48_000 >= range.min_sample_rate().0 && 48_000 <= range.max_sample_rate().0 {
                48_000
            } else {
                range.max_sample_rate().0
            };
            let rate_score = if rate == target_rate { 50 } else { 15 };
            let total_score = fmt_score + ch_score + rate_score;

            if best.as_ref().map(|b| total_score > b.2).unwrap_or(true) {
                let cfg = range.with_sample_rate(cpal::SampleRate(rate)).config();
                best = Some((cfg, fmt, total_score));
            }
        }
        if let Some((cfg, fmt, _)) = best {
            return Ok((cfg, fmt));
        }
    }

    let def = device.default_output_config()?;
    Ok((def.config(), def.sample_format()))
}
