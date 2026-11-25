use biquad::{Biquad, Coefficients, DirectForm2Transposed, ToHertz, Type};

use crate::models::{AudioSettings, EqSettings};

pub const EQ_BAND_FREQUENCIES: [f32; 10] = [
    31.0, 62.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0,
];

/// Pure-Rust real-time stereo DSP processor:
/// Input (f32 stereo) -> Preamp + Loudness Normalization -> 10-band PeakingEQ -> Balance -> Volume -> Soft-Knee True-Peak Limiter
pub struct DspPipeline {
    sample_rate: f32,
    eq_settings: EqSettings,
    filters_l: Vec<DirectForm2Transposed<f32>>,
    filters_r: Vec<DirectForm2Transposed<f32>>,
    normalize_enabled: bool,
    target_lufs: f32,
    track_loudness_db: Option<f32>,
    limiter_enabled: bool,
    volume: f32,
    muted: bool,
}

impl DspPipeline {
    pub fn new(sample_rate: u32, settings: &AudioSettings) -> Self {
        let mut pipe = Self {
            sample_rate: sample_rate.max(8000) as f32,
            eq_settings: settings.eq.clone(),
            filters_l: Vec::with_capacity(10),
            filters_r: Vec::with_capacity(10),
            normalize_enabled: settings.normalize_loudness,
            target_lufs: settings.target_lufs,
            track_loudness_db: None,
            limiter_enabled: settings.limiter_enabled,
            volume: 1.0,
            muted: false,
        };
        pipe.rebuild_filters();
        pipe
    }

    pub fn set_sample_rate(&mut self, sample_rate: u32) {
        let sr = sample_rate.max(8000) as f32;
        if (sr - self.sample_rate).abs() > 1.0 {
            self.sample_rate = sr;
            self.rebuild_filters();
        }
    }

    pub fn update_settings(&mut self, settings: &AudioSettings) {
        self.normalize_enabled = settings.normalize_loudness;
        self.target_lufs = settings.target_lufs;
        self.limiter_enabled = settings.limiter_enabled;
        self.set_eq(settings.eq.clone());
    }

    pub fn set_eq(&mut self, eq: EqSettings) {
        self.eq_settings = eq;
        self.rebuild_filters();
    }

    pub fn set_track_loudness_db(&mut self, loudness_db: Option<f32>) {
        self.track_loudness_db = loudness_db;
    }

    pub fn set_volume(&mut self, volume: f32, muted: bool) {
        self.volume = volume.clamp(0.0, 1.5);
        self.muted = muted;
    }

    /// Computes effective loudness gain in dB from YouTube's `loudnessDb` (relative to -14 LUFS)
    /// and the user's target LUFS setting.
    pub fn loudness_gain_db(&self) -> f32 {
        if !self.normalize_enabled {
            return 0.0;
        }
        let Some(yt_loudness_db) = self.track_loudness_db else {
            return 0.0;
        };
        // YouTube's loudnessDb is measured relative to -14 LUFS:
        // e.g. loudnessDb = +3.0 means the track is at -11 LUFS (3 dB louder than -14 LUFS).
        let estimated_track_lufs = -14.0 + yt_loudness_db;
        let gain = self.target_lufs - estimated_track_lufs;
        // Clamp to safe audiophile range to avoid boosting quiet noise floors excessively
        gain.clamp(-14.0, 6.0)
    }

    fn rebuild_filters(&mut self) {
        self.filters_l.clear();
        self.filters_r.clear();
        let nyquist = self.sample_rate * 0.48;
        for (i, &freq) in EQ_BAND_FREQUENCIES.iter().enumerate() {
            let safe_freq = freq.min(nyquist).max(20.0);
            let gain_db = self.eq_settings.bands[i].clamp(-12.0, 12.0);
            let coeffs = Coefficients::<f32>::from_params(
                Type::PeakingEQ(gain_db),
                self.sample_rate.hz(),
                safe_freq.hz(),
                1.414,
            )
            .unwrap_or_else(|_| {
                Coefficients::<f32>::from_params(
                    Type::PeakingEQ(0.0),
                    self.sample_rate.hz(),
                    1000.0.hz(),
                    1.414,
                )
                .unwrap()
            });
            self.filters_l.push(DirectForm2Transposed::<f32>::new(coeffs));
            self.filters_r.push(DirectForm2Transposed::<f32>::new(coeffs));
        }
    }

    /// Process interleaved stereo `[L, R, L, R, ...]` samples in-place.
    pub fn process_stereo_interleaved(&mut self, samples: &mut [f32]) {
        if self.muted || self.volume <= 0.0001 {
            samples.fill(0.0);
            return;
        }

        let norm_gain = db_to_linear(self.loudness_gain_db());
        let preamp_gain = if self.eq_settings.enabled {
            db_to_linear(self.eq_settings.preamp_db.clamp(-12.0, 12.0))
        } else {
            1.0
        };
        let total_input_gain = norm_gain * preamp_gain;

        // Perceptual volume curve (quadratic/cubic blend for smooth low-volume control)
        let vol = if self.volume <= 1.0 {
            self.volume * self.volume
        } else {
            self.volume
        };

        let bal = self.eq_settings.balance.clamp(-1.0, 1.0);
        let gain_l = if bal > 0.0 { 1.0 - bal } else { 1.0 } * vol;
        let gain_r = if bal < 0.0 { 1.0 + bal } else { 1.0 } * vol;

        let eq_on = self.eq_settings.enabled;
        let limiter_on = self.limiter_enabled;

        for frame in samples.chunks_exact_mut(2) {
            let mut l = frame[0] * total_input_gain;
            let mut r = frame[1] * total_input_gain;

            if eq_on {
                for (fl, fr) in self.filters_l.iter_mut().zip(self.filters_r.iter_mut()) {
                    l = fl.run(l);
                    r = fr.run(r);
                }
            }

            l *= gain_l;
            r *= gain_r;

            if limiter_on {
                l = soft_knee_limit(l);
                r = soft_knee_limit(r);
            } else {
                l = l.clamp(-1.0, 1.0);
                r = r.clamp(-1.0, 1.0);
            }

            frame[0] = l;
            frame[1] = r;
        }
    }
}

#[inline]
pub fn db_to_linear(db: f32) -> f32 {
    10.0_f32.powf(db / 20.0)
}

/// Transparent soft-knee true-peak limiter above -1.0 dBFS (~0.891) preventing hard digital clipping.
#[inline]
pub fn soft_knee_limit(x: f32) -> f32 {
    const THRESHOLD: f32 = 0.891_25;
    let abs = x.abs();
    if abs <= THRESHOLD {
        x
    } else {
        let excess = abs - THRESHOLD;
        let range = 1.0 - THRESHOLD;
        let compressed = THRESHOLD + range * (excess / range).tanh();
        x.signum() * compressed.min(0.999)
    }
}

/// High-quality 8-tap Blackman-windowed sinc stereo resampler supporting arbitrary packet sizes.
pub struct SincResampler {
    in_rate: u32,
    out_rate: u32,
    phase: f64,
    history_l: [f32; 8],
    history_r: [f32; 8],
}

impl SincResampler {
    pub fn new(in_rate: u32, out_rate: u32) -> Self {
        Self {
            in_rate: in_rate.max(8000),
            out_rate: out_rate.max(8000),
            phase: 0.0,
            history_l: [0.0; 8],
            history_r: [0.0; 8],
        }
    }

    pub fn is_passthrough(&self) -> bool {
        self.in_rate == self.out_rate
    }

    pub fn reset(&mut self) {
        self.phase = 0.0;
        self.history_l = [0.0; 8];
        self.history_r = [0.0; 8];
    }

    /// Resamples interleaved stereo input into `out` (appends).
    pub fn process_stereo(&mut self, input: &[f32], out: &mut Vec<f32>) {
        if self.in_rate == self.out_rate {
            out.extend_from_slice(input);
            return;
        }

        let in_frames = input.len() / 2;
        if in_frames == 0 {
            return;
        }

        let step = self.in_rate as f64 / self.out_rate as f64;
        let mut src_l = Vec::with_capacity(8 + in_frames);
        let mut src_r = Vec::with_capacity(8 + in_frames);
        src_l.extend_from_slice(&self.history_l);
        src_r.extend_from_slice(&self.history_r);
        for frame in input.chunks_exact(2) {
            src_l.push(frame[0]);
            src_r.push(frame[1]);
        }

        let limit = in_frames as f64;
        while self.phase < limit {
            let idx = self.phase.floor() as usize;
            let frac = self.phase - idx as f64;
            // Center of 8-tap window at index `idx + 4`
            let base = idx;
            let mut acc_l = 0.0_f64;
            let mut acc_r = 0.0_f64;
            let mut norm = 0.0_f64;
            for tap in 0..8 {
                let offset = (tap as f64 - 3.0) - frac;
                let w = windowed_sinc(offset, 4.0);
                let pos = (base + tap).min(src_l.len() - 1);
                acc_l += src_l[pos] as f64 * w;
                acc_r += src_r[pos] as f64 * w;
                norm += w;
            }
            if norm.abs() > 1e-9 {
                out.push((acc_l / norm) as f32);
                out.push((acc_r / norm) as f32);
            } else {
                out.push(0.0);
                out.push(0.0);
            }
            self.phase += step;
        }
        self.phase -= limit;

        // Save tail 8 frames as next history
        let tail_start = src_l.len().saturating_sub(8);
        for i in 0..8 {
            self.history_l[i] = src_l[tail_start + i];
            self.history_r[i] = src_r[tail_start + i];
        }
    }
}

#[inline]
fn windowed_sinc(x: f64, radius: f64) -> f64 {
    if x.abs() >= radius {
        return 0.0;
    }
    let sinc = if x.abs() < 1e-9 {
        1.0
    } else {
        let px = std::f64::consts::PI * x;
        px.sin() / px
    };
    // Blackman window centered at 0
    let t = (x + radius) / (2.0 * radius);
    let win = 0.42 - 0.5 * (2.0 * std::f64::consts::PI * t).cos()
        + 0.08 * (4.0 * std::f64::consts::PI * t).cos();
    sinc * win
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_loudness_normalization_and_limiter() {
        let settings = AudioSettings::default();
        let mut dsp = DspPipeline::new(48_000, &settings);
        dsp.set_track_loudness_db(Some(4.0)); // Track is +4dB louder than -14 LUFS
        assert!((dsp.loudness_gain_db() - (-4.0)).abs() < 1e-4);

        // Soft knee limiter keeps hot peaks strictly below 1.0
        assert!(soft_knee_limit(2.5) < 1.0);
        assert!(soft_knee_limit(2.5) > 0.89);
        assert!((soft_knee_limit(0.5) - 0.5).abs() < 1e-6);
    }

    #[test]
    fn test_eq_processing_finite_output() {
        let mut settings = AudioSettings::default();
        settings.eq.enabled = true;
        settings.eq.bands = [6.0, 4.0, 2.0, 0.0, -2.0, 0.0, 2.0, 3.0, 4.0, 5.0];
        let mut dsp = DspPipeline::new(48_000, &settings);
        let mut buf: Vec<f32> = (0..1024)
            .map(|i| ((i as f32) * 0.05).sin() * 0.5)
            .collect();
        dsp.process_stereo_interleaved(&mut buf);
        assert!(buf.iter().all(|s| s.is_finite() && s.abs() <= 1.0));
    }

    #[test]
    fn test_sinc_resampler_44100_to_48000() {
        let mut resampler = SincResampler::new(44_100, 48_000);
        let input: Vec<f32> = (0..4410 * 2).map(|i| ((i as f32) * 0.02).sin() * 0.4).collect();
        let mut out = Vec::new();
        resampler.process_stereo(&input, &mut out);
        // Expected ~4800 stereo frames -> ~9600 samples
        let out_frames = out.len() / 2;
        assert!((out_frames as i32 - 4800).abs() <= 4);
        assert!(out.iter().all(|s| s.is_finite()));
    }
}
