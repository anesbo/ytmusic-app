use biquad::{Biquad, Coefficients, DirectForm2Transposed, ToHertz, Type};

use crate::models::{AmbienceSettings, AudioFxSettings, AudioSettings, EqSettings};

pub const EQ_BAND_FREQUENCIES: [f32; 10] = [
    31.0, 62.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0,
];

/// Lightweight Schroeder / Freeverb-style stereo reverb (4 combs + 2 allpass per channel).
struct CombFilter {
    buf: Vec<f32>,
    idx: usize,
    filter_store: f32,
}

impl CombFilter {
    fn new(len: usize) -> Self {
        Self {
            buf: vec![0.0; len.max(16)],
            idx: 0,
            filter_store: 0.0,
        }
    }

    #[inline]
    fn process(&mut self, input: f32, feedback: f32, damp: f32) -> f32 {
        let output = self.buf[self.idx];
        self.filter_store = output * (1.0 - damp) + self.filter_store * damp;
        self.buf[self.idx] = input + self.filter_store * feedback;
        self.idx += 1;
        if self.idx >= self.buf.len() {
            self.idx = 0;
        }
        output
    }
}

struct AllpassFilter {
    buf: Vec<f32>,
    idx: usize,
}

impl AllpassFilter {
    fn new(len: usize) -> Self {
        Self {
            buf: vec![0.0; len.max(8)],
            idx: 0,
        }
    }

    #[inline]
    fn process(&mut self, input: f32) -> f32 {
        let bufout = self.buf[self.idx];
        let output = -input + bufout;
        self.buf[self.idx] = input + bufout * 0.5;
        self.idx += 1;
        if self.idx >= self.buf.len() {
            self.idx = 0;
        }
        output
    }
}

struct StereoReverb {
    combs_l: [CombFilter; 4],
    combs_r: [CombFilter; 4],
    allpass_l: [AllpassFilter; 2],
    allpass_r: [AllpassFilter; 2],
}

impl StereoReverb {
    fn new(sample_rate: f32) -> Self {
        let scale = (sample_rate / 44_100.0).max(0.5);
        let s = |n: usize| ((n as f32) * scale).round() as usize;
        Self {
            combs_l: [
                CombFilter::new(s(1116)),
                CombFilter::new(s(1188)),
                CombFilter::new(s(1277)),
                CombFilter::new(s(1356)),
            ],
            combs_r: [
                CombFilter::new(s(1116 + 23)),
                CombFilter::new(s(1188 + 23)),
                CombFilter::new(s(1277 + 23)),
                CombFilter::new(s(1356 + 23)),
            ],
            allpass_l: [AllpassFilter::new(s(556)), AllpassFilter::new(s(441))],
            allpass_r: [AllpassFilter::new(s(556 + 23)), AllpassFilter::new(s(441 + 23))],
        }
    }

    #[inline]
    fn process(&mut self, l: f32, r: f32, mix: f32) -> (f32, f32) {
        let input = (l + r) * 0.14;
        let feedback = 0.80;
        let damp = 0.28;
        let mut out_l = 0.0_f32;
        let mut out_r = 0.0_f32;
        for c in &mut self.combs_l {
            out_l += c.process(input, feedback, damp);
        }
        for c in &mut self.combs_r {
            out_r += c.process(input, feedback, damp);
        }
        for a in &mut self.allpass_l {
            out_l = a.process(out_l);
        }
        for a in &mut self.allpass_r {
            out_r = a.process(out_r);
        }
        let dry = 1.0 - mix * 0.45;
        (l * dry + out_l * mix, r * dry + out_r * mix)
    }
}

/// Pure-Rust real-time stereo DSP processor:
/// Input (f32 stereo) -> Preamp + Loudness Normalization -> 10-band PeakingEQ -> Studio FX Rack (Sub-Bass, Lo-Fi, 8D Spatial, Reverb, Mono) -> Balance -> Volume -> Soft-Knee True-Peak Limiter
pub struct DspPipeline {
    sample_rate: f32,
    eq_settings: EqSettings,
    fx_settings: AudioFxSettings,
    filters_l: Vec<DirectForm2Transposed<f32>>,
    filters_r: Vec<DirectForm2Transposed<f32>>,
    sub_bass_l: DirectForm2Transposed<f32>,
    sub_bass_r: DirectForm2Transposed<f32>,
    vocal_lp_l: DirectForm2Transposed<f32>,
    vocal_lp_r: DirectForm2Transposed<f32>,
    reverb: StereoReverb,
    spatial_phase: f32,
    lofi_lp_l: f32,
    lofi_lp_r: f32,
    vinyl_seed: u32,
    normalize_enabled: bool,
    target_lufs: f32,
    track_loudness_db: Option<f32>,
    limiter_enabled: bool,
    volume: f32,
    muted: bool,
}

impl DspPipeline {
    pub fn new(sample_rate: u32, settings: &AudioSettings) -> Self {
        let sr = sample_rate.max(8000) as f32;
        let sub_coeffs = Self::make_sub_bass_coeffs(sr, settings.fx.sub_bass_boost);
        let vocal_lp_coeffs = Self::make_vocal_crossover_coeffs(sr);
        let mut pipe = Self {
            sample_rate: sr,
            eq_settings: settings.eq.clone(),
            fx_settings: settings.fx.clone(),
            filters_l: Vec::with_capacity(10),
            filters_r: Vec::with_capacity(10),
            sub_bass_l: DirectForm2Transposed::<f32>::new(sub_coeffs),
            sub_bass_r: DirectForm2Transposed::<f32>::new(sub_coeffs),
            vocal_lp_l: DirectForm2Transposed::<f32>::new(vocal_lp_coeffs),
            vocal_lp_r: DirectForm2Transposed::<f32>::new(vocal_lp_coeffs),
            reverb: StereoReverb::new(sr),
            spatial_phase: 0.0,
            lofi_lp_l: 0.0,
            lofi_lp_r: 0.0,
            vinyl_seed: 0x1337_beef,
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

    fn make_sub_bass_coeffs(sr: f32, boost: f32) -> Coefficients<f32> {
        let gain_db = (boost.clamp(0.0, 1.0) * 8.0).clamp(0.0, 9.0);
        Coefficients::<f32>::from_params(Type::LowShelf(gain_db), sr.hz(), 55.0.hz(), 0.707)
            .unwrap_or_else(|_| {
                Coefficients::<f32>::from_params(Type::PeakingEQ(0.0), sr.hz(), 60.0.hz(), 1.0)
                    .unwrap()
            })
    }

    pub fn set_sample_rate(&mut self, sample_rate: u32) {
        let sr = sample_rate.max(8000) as f32;
        if (sr - self.sample_rate).abs() > 1.0 {
            self.sample_rate = sr;
            self.reverb = StereoReverb::new(sr);
            self.rebuild_filters();
        }
    }

    pub fn update_settings(&mut self, settings: &AudioSettings) {
        self.normalize_enabled = settings.normalize_loudness;
        self.target_lufs = settings.target_lufs;
        self.limiter_enabled = settings.limiter_enabled;
        self.fx_settings = settings.fx.clone();
        self.set_eq(settings.eq.clone());
    }

    pub fn set_eq(&mut self, eq: EqSettings) {
        self.eq_settings = eq;
        self.rebuild_filters();
    }

    fn make_vocal_crossover_coeffs(sr: f32) -> Coefficients<f32> {
        Coefficients::<f32>::from_params(Type::LowPass, sr.hz(), 180.0.hz(), 0.707)
            .unwrap_or_else(|_| {
                Coefficients::<f32>::from_params(Type::PeakingEQ(0.0), sr.hz(), 180.0.hz(), 1.0)
                    .unwrap()
            })
    }

    fn fx_active(&self) -> bool {
        self.fx_settings.reverb_mix > 0.01
            || self.fx_settings.spatial_8d
            || self.fx_settings.lofi_warmth
            || self.fx_settings.mono_downmix
            || self.fx_settings.sub_bass_boost > 0.01
            || self.fx_settings.vocal_remover
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
        let sub_coeffs = Self::make_sub_bass_coeffs(self.sample_rate, self.fx_settings.sub_bass_boost);
        self.sub_bass_l = DirectForm2Transposed::<f32>::new(sub_coeffs);
        self.sub_bass_r = DirectForm2Transposed::<f32>::new(sub_coeffs);
        let vocal_coeffs = Self::make_vocal_crossover_coeffs(self.sample_rate);
        self.vocal_lp_l = DirectForm2Transposed::<f32>::new(vocal_coeffs);
        self.vocal_lp_r = DirectForm2Transposed::<f32>::new(vocal_coeffs);
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
        let fx_on = self.fx_active();
        let limiter_on = self.limiter_enabled;
        let needs_gain = (total_input_gain - 1.0).abs() > 1e-4;
        let needs_balance = bal.abs() > 1e-4 || (vol - 1.0).abs() > 1e-4;

        // Bit-transparent fast path: when EQ, FX, normalization gain, and balance are neutral,
        // pass clean decoded studio PCM straight through with ZERO coloration or soft-clipping!
        if !eq_on && !fx_on && !needs_gain && !needs_balance {
            for s in samples.iter_mut() {
                if *s > 1.0 {
                    *s = 1.0;
                } else if *s < -1.0 {
                    *s = -1.0;
                }
            }
            return;
        }

        let sub_on = self.fx_settings.sub_bass_boost > 0.01;
        let vocal_rm_on = self.fx_settings.vocal_remover;
        let vocal_rm_str = self.fx_settings.vocal_remover_strength.clamp(0.0, 1.0);
        let lofi_on = self.fx_settings.lofi_warmth;
        let spatial_on = self.fx_settings.spatial_8d;
        let reverb_mix = self.fx_settings.reverb_mix.clamp(0.0, 0.85);
        let mono_on = self.fx_settings.mono_downmix;
        let spatial_step = std::f32::consts::TAU * 0.14 / self.sample_rate;
        let lofi_alpha = (2.0 * std::f32::consts::PI * 5200.0 / self.sample_rate).min(0.85);

        for frame in samples.chunks_exact_mut(2) {
            let mut l = frame[0] * total_input_gain;
            let mut r = frame[1] * total_input_gain;

            if eq_on {
                for (fl, fr) in self.filters_l.iter_mut().zip(self.filters_r.iter_mut()) {
                    l = fl.run(l);
                    r = fr.run(r);
                }
            }

            if vocal_rm_on {
                // Mid-Side Center-Channel Vocal Reducer with 180 Hz bass preservation crossover!
                // Keeps kick drums & bass guitar punchy while stripping center-panned lead vocals.
                let low_l = self.vocal_lp_l.run(l);
                let low_r = self.vocal_lp_r.run(r);
                let hi_l = l - low_l;
                let hi_r = r - low_r;
                let mid = 0.5 * (hi_l + hi_r);
                let side = 0.5 * (hi_l - hi_r);
                let keep_mid = 1.0 - vocal_rm_str;
                let side_boost = 1.0 + vocal_rm_str * 0.35;
                l = low_l + mid * keep_mid + side * side_boost;
                r = low_r + mid * keep_mid - side * side_boost;
            }

            if sub_on {
                l = self.sub_bass_l.run(l);
                r = self.sub_bass_r.run(r);
            }

            if lofi_on {
                // Warm vintage lowpass + soft tape saturation + ultra-subtle vinyl dust
                self.lofi_lp_l += lofi_alpha * (l - self.lofi_lp_l);
                self.lofi_lp_r += lofi_alpha * (r - self.lofi_lp_r);
                l = (self.lofi_lp_l * 1.18).tanh() * 0.92;
                r = (self.lofi_lp_r * 1.18).tanh() * 0.92;
                self.vinyl_seed = self.vinyl_seed.wrapping_mul(1664525).wrapping_add(1013904223);
                let rnd = (self.vinyl_seed >> 8) as f32 / (u32::MAX >> 8) as f32;
                if rnd > 0.9996 {
                    let pop = (rnd - 0.9996) * 28.0;
                    l += pop;
                    r += pop * 0.85;
                }
            }

            if spatial_on {
                // Smooth 8D binaural panner around head with subtle stereo crossfeed
                self.spatial_phase += spatial_step;
                if self.spatial_phase >= std::f32::consts::TAU {
                    self.spatial_phase -= std::f32::consts::TAU;
                }
                let pan = self.spatial_phase.sin(); // -1..+1
                let pan_l = (0.5 * (1.0 - pan * 0.72)).sqrt();
                let pan_r = (0.5 * (1.0 + pan * 0.72)).sqrt();
                let mid = (l + r) * 0.5;
                let side = (l - r) * 0.5;
                l = (mid + side * 0.75) * pan_l * 1.25;
                r = (mid - side * 0.75) * pan_r * 1.25;
            }

            if reverb_mix > 0.01 {
                let (rl, rr) = self.reverb.process(l, r, reverb_mix);
                l = rl;
                r = rr;
            }

            if mono_on {
                let m = (l + r) * 0.5;
                l = m;
                r = m;
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

/// Lock-free, zero-allocation Copy snapshot of ambient soundscape levels for the real-time audio callback.
#[derive(Debug, Clone, Copy, Default)]
pub struct AmbientParams {
    pub enabled: bool,
    pub rain: f32,
    pub fireplace: f32,
    pub ocean: f32,
    pub brown_noise: f32,
    pub thunder: f32,
}

/// Zero-file procedural real-time ambient soundscape synthesizer (Rain, Fireplace, Ocean, Brown Noise, Thunder).
/// Runs cleanly inside the CPAL hardware callback with ZERO locks and ZERO heap allocations.
pub struct AmbientSynthesizer {
    sample_rate: f32,
    rng: u64,
    rain_lp_l: f32,
    rain_lp_r: f32,
    rain_hp_l: f32,
    rain_hp_r: f32,
    fire_lp: f32,
    fire_crackle_env: f32,
    fire_crackle_pan: f32,
    ocean_phase: f32,
    ocean_lp_l: f32,
    ocean_lp_r: f32,
    brown_l: f32,
    brown_r: f32,
    thunder_env: f32,
    thunder_lp: f32,
}

impl AmbientSynthesizer {
    pub fn new(sample_rate: u32) -> Self {
        Self {
            sample_rate: sample_rate.max(8000) as f32,
            rng: 0x9e37_79b9_7f4a_7c15,
            rain_lp_l: 0.0,
            rain_lp_r: 0.0,
            rain_hp_l: 0.0,
            rain_hp_r: 0.0,
            fire_lp: 0.0,
            fire_crackle_env: 0.0,
            fire_crackle_pan: 0.5,
            ocean_phase: 0.0,
            ocean_lp_l: 0.0,
            ocean_lp_r: 0.0,
            brown_l: 0.0,
            brown_r: 0.0,
            thunder_env: 0.0,
            thunder_lp: 0.0,
        }
    }

    #[inline]
    fn next_white(&mut self) -> f32 {
        // Fast xorshift64* PRNG -> [-1.0, 1.0]
        let mut x = self.rng;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.rng = x;
        let bits = (x.wrapping_mul(0x2545_f491_4f6c_dd1d) >> 40) as u32;
        (bits as f32 / 8_388_608.0) - 1.0
    }

    #[inline]
    pub fn next_frame(&mut self, cfg: AmbientParams) -> (f32, f32) {
        if !cfg.enabled {
            return (0.0, 0.0);
        }
        let mut out_l = 0.0_f32;
        let mut out_r = 0.0_f32;

        // 1. Rain on glass (stereo band-shaped drizzle + subtle random raindrop hits)
        if cfg.rain > 0.005 {
            let w_l = self.next_white();
            let w_r = self.next_white();
            self.rain_lp_l += 0.24 * (w_l - self.rain_lp_l);
            self.rain_lp_r += 0.24 * (w_r - self.rain_lp_r);
            self.rain_hp_l += 0.03 * (self.rain_lp_l - self.rain_hp_l);
            self.rain_hp_r += 0.03 * (self.rain_lp_r - self.rain_hp_r);
            let mut r_l = self.rain_lp_l - self.rain_hp_l;
            let mut r_r = self.rain_lp_r - self.rain_hp_r;
            // Subtle raindrop impulse
            let drop_r = self.next_white();
            if drop_r > 0.9992 {
                r_l += drop_r * 0.45;
            } else if drop_r < -0.9992 {
                r_r -= drop_r * 0.45;
            }
            let lvl = cfg.rain.clamp(0.0, 1.0) * 0.22;
            out_l += r_l * lvl;
            out_r += r_r * lvl;
        }

        // 2. Cozy fireplace (warm low hearth rumble + bright sparse wood pops)
        if cfg.fireplace > 0.005 {
            let w = self.next_white();
            self.fire_lp += 0.018 * (w - self.fire_lp);
            let trigger = self.next_white();
            if trigger > 0.99955 {
                self.fire_crackle_env = 0.5 + (trigger - 0.99955) * 900.0;
                self.fire_crackle_pan = 0.2 + 0.6 * (self.next_white() * 0.5 + 0.5);
            }
            self.fire_crackle_env *= 0.965;
            let crackle = self.next_white() * self.fire_crackle_env.min(1.0) * 0.45;
            let hearth = self.fire_lp * 1.1;
            let lvl = cfg.fireplace.clamp(0.0, 1.0) * 0.28;
            out_l += (hearth + crackle * (1.0 - self.fire_crackle_pan)) * lvl;
            out_r += (hearth + crackle * self.fire_crackle_pan) * lvl;
        }

        // 3. Ocean waves (slow rolling surf swell across stereo field)
        if cfg.ocean > 0.005 {
            self.ocean_phase += std::f32::consts::TAU * 0.11 / self.sample_rate;
            if self.ocean_phase >= std::f32::consts::TAU {
                self.ocean_phase -= std::f32::consts::TAU;
            }
            let swell = 0.28 + 0.72 * (0.5 + 0.5 * self.ocean_phase.sin()).powf(1.6);
            let pan = 0.5 + 0.22 * (self.ocean_phase * 0.5).cos();
            let w_l = self.next_white();
            let w_r = self.next_white();
            let cutoff = 0.025 + 0.095 * swell;
            self.ocean_lp_l += cutoff * (w_l - self.ocean_lp_l);
            self.ocean_lp_r += cutoff * (w_r - self.ocean_lp_r);
            let lvl = cfg.ocean.clamp(0.0, 1.0) * 0.34 * swell;
            out_l += self.ocean_lp_l * lvl * (1.2 - pan * 0.4);
            out_r += self.ocean_lp_r * lvl * (0.8 + pan * 0.4);
        }

        // 4. Silky brown focus noise
        if cfg.brown_noise > 0.005 {
            self.brown_l = (self.brown_l * 0.992 + self.next_white() * 0.028).clamp(-1.0, 1.0);
            self.brown_r = (self.brown_r * 0.992 + self.next_white() * 0.028).clamp(-1.0, 1.0);
            let lvl = cfg.brown_noise.clamp(0.0, 1.0) * 0.32;
            out_l += self.brown_l * lvl;
            out_r += self.brown_r * lvl;
        }

        // 5. Distant rolling thunder
        if cfg.thunder > 0.005 {
            if self.thunder_env < 0.002 && self.next_white() > 0.999993 {
                self.thunder_env = 1.0;
            }
            if self.thunder_env > 0.0005 {
                let w = self.next_white();
                self.thunder_lp += 0.009 * (w - self.thunder_lp);
                self.thunder_env *= 0.999975;
                let rumble = self.thunder_lp * self.thunder_env * cfg.thunder.clamp(0.0, 1.0) * 1.4;
                out_l += rumble;
                out_r += rumble * 0.94;
            }
        }

        (out_l, out_r)
    }
}

#[inline]
pub fn db_to_linear(db: f32) -> f32 {
    10.0_f32.powf(db / 20.0)
}

/// Transparent soft-knee peak protector ONLY above -0.15 dBFS (~0.983) so mastered music
/// transients are NEVER squashed or distorted, while EQ boosts still never hard-clip!
#[inline]
pub fn soft_knee_limit(x: f32) -> f32 {
    const THRESHOLD: f32 = 0.983;
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

        // Soft knee limiter keeps hot peaks strictly below 1.0 without touching normal audio
        assert!(soft_knee_limit(2.5) < 1.0);
        assert!(soft_knee_limit(2.5) > 0.98);
        assert!((soft_knee_limit(0.95) - 0.95).abs() < 1e-6);
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
