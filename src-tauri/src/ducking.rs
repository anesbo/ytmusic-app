//! Pure-Rust Windows WASAPI Audio Session & Device Watcher (zero extra crate dependencies).
//! Handles:
//! 1. Smart Auto-Ducking (`IAudioSessionManager2` + `IAudioMeterInformation`)
//! 2. Auto-Pause on Headphones Disconnect / Default Output Device Change (`IMMDevice::GetId`)

use tauri::{AppHandle, Emitter};

#[cfg(target_os = "windows")]
mod win {
    use std::ffi::c_void;
    use std::ptr;

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct Guid {
        data1: u32,
        data2: u16,
        data3: u16,
        data4: [u8; 8],
    }

    const CLSID_MM_DEVICE_ENUMERATOR: Guid = Guid {
        data1: 0xBCDE0395,
        data2: 0xE52F,
        data3: 0x467C,
        data4: [0x8E, 0x3D, 0xC4, 0x57, 0x92, 0x91, 0x69, 0x2E],
    };

    const IID_IMM_DEVICE_ENUMERATOR: Guid = Guid {
        data1: 0xA95664D2,
        data2: 0x9614,
        data3: 0x4F35,
        data4: [0xA7, 0x46, 0xDE, 0x8D, 0xB6, 0x36, 0x17, 0xE6],
    };

    const IID_IAUDIO_SESSION_MANAGER2: Guid = Guid {
        data1: 0x77AA99A0,
        data2: 0x1BD6,
        data3: 0x484F,
        data4: [0x8B, 0xC7, 0x2C, 0x65, 0x4C, 0x9A, 0x9B, 0x6F],
    };

    const IID_IAUDIO_SESSION_CONTROL2: Guid = Guid {
        data1: 0xBFB7FF88,
        data2: 0x7239,
        data3: 0x4FC9,
        data4: [0x8F, 0xA2, 0x07, 0xC9, 0x50, 0xBE, 0x9C, 0x6D],
    };

    const IID_IAUDIO_METER_INFORMATION: Guid = Guid {
        data1: 0xC02216F6,
        data2: 0x8C67,
        data3: 0x4B5B,
        data4: [0x9D, 0x00, 0xD0, 0x08, 0xE7, 0x3E, 0x00, 0x64],
    };

    const COINIT_MULTITHREADED: u32 = 0x0;
    const CLSCTX_ALL: u32 = 23;
    const E_RENDER: u32 = 0;
    const E_MULTIMEDIA: u32 = 1;
    const AUDIO_SESSION_STATE_ACTIVE: u32 = 1;

    #[link(name = "ole32")]
    extern "system" {
        fn CoInitializeEx(pv_reserved: *mut c_void, dw_co_init: u32) -> i32;
        fn CoTaskMemFree(pv: *mut c_void);
        fn CoCreateInstance(
            rclsid: *const Guid,
            p_unk_outer: *mut c_void,
            dw_cls_context: u32,
            riid: *const Guid,
            ppv: *mut *mut c_void,
        ) -> i32;
    }

    #[inline]
    unsafe fn vtbl(obj: *mut c_void) -> *const *const c_void {
        *(obj as *const *const *const c_void)
    }

    #[inline]
    unsafe fn com_release(obj: *mut c_void) {
        if !obj.is_null() {
            let release: extern "system" fn(*mut c_void) -> u32 =
                std::mem::transmute(*vtbl(obj).add(2));
            release(obj);
        }
    }

    #[inline]
    unsafe fn com_qi(obj: *mut c_void, iid: &Guid) -> *mut c_void {
        let mut out: *mut c_void = ptr::null_mut();
        let qi: extern "system" fn(*mut c_void, *const Guid, *mut *mut c_void) -> i32 =
            std::mem::transmute(*vtbl(obj).add(0));
        if qi(obj, iid, &mut out) >= 0 {
            out
        } else {
            ptr::null_mut()
        }
    }

    pub fn init_com_for_thread() {
        unsafe {
            let _ = CoInitializeEx(ptr::null_mut(), COINIT_MULTITHREADED);
        }
    }

    /// Queries the default Windows render audio endpoint ID and optionally checks if another app is outputting sound.
    pub fn poll_default_endpoint(self_pid: u32, check_ducking: bool) -> (Option<String>, bool) {
        unsafe {
            let mut enumerator: *mut c_void = ptr::null_mut();
            let hr = CoCreateInstance(
                &CLSID_MM_DEVICE_ENUMERATOR,
                ptr::null_mut(),
                CLSCTX_ALL,
                &IID_IMM_DEVICE_ENUMERATOR,
                &mut enumerator,
            );
            if hr < 0 || enumerator.is_null() {
                return (None, false);
            }

            let mut device: *mut c_void = ptr::null_mut();
            let get_default: extern "system" fn(*mut c_void, u32, u32, *mut *mut c_void) -> i32 =
                std::mem::transmute(*vtbl(enumerator).add(4));
            let hr_dev = get_default(enumerator, E_RENDER, E_MULTIMEDIA, &mut device);
            com_release(enumerator);
            if hr_dev < 0 || device.is_null() {
                return (None, false);
            }

            // Read IMMDevice::GetId (vtable slot 5) to detect headphone unplug / output device switch
            let mut id_ptr: *mut u16 = ptr::null_mut();
            let get_id: extern "system" fn(*mut c_void, *mut *mut u16) -> i32 =
                std::mem::transmute(*vtbl(device).add(5));
            let device_id = if get_id(device, &mut id_ptr) >= 0 && !id_ptr.is_null() {
                let mut len = 0usize;
                while *id_ptr.add(len) != 0 && len < 512 {
                    len += 1;
                }
                let slice = std::slice::from_raw_parts(id_ptr, len);
                let s = String::from_utf16_lossy(slice);
                CoTaskMemFree(id_ptr as *mut c_void);
                Some(s)
            } else {
                None
            };

            if !check_ducking {
                com_release(device);
                return (device_id, false);
            }

            let mut mgr2: *mut c_void = ptr::null_mut();
            let activate: extern "system" fn(
                *mut c_void,
                *const Guid,
                u32,
                *mut c_void,
                *mut *mut c_void,
            ) -> i32 = std::mem::transmute(*vtbl(device).add(3));
            let hr_act = activate(
                device,
                &IID_IAUDIO_SESSION_MANAGER2,
                CLSCTX_ALL,
                ptr::null_mut(),
                &mut mgr2,
            );
            com_release(device);
            if hr_act < 0 || mgr2.is_null() {
                return (device_id, false);
            }

            let mut sess_enum: *mut c_void = ptr::null_mut();
            let get_enum: extern "system" fn(*mut c_void, *mut *mut c_void) -> i32 =
                std::mem::transmute(*vtbl(mgr2).add(5));
            let hr_en = get_enum(mgr2, &mut sess_enum);
            com_release(mgr2);
            if hr_en < 0 || sess_enum.is_null() {
                return (device_id, false);
            }

            let mut count: i32 = 0;
            let get_count: extern "system" fn(*mut c_void, *mut i32) -> i32 =
                std::mem::transmute(*vtbl(sess_enum).add(3));
            if get_count(sess_enum, &mut count) < 0 || count <= 0 {
                com_release(sess_enum);
                return (device_id, false);
            }

            let get_session: extern "system" fn(*mut c_void, i32, *mut *mut c_void) -> i32 =
                std::mem::transmute(*vtbl(sess_enum).add(4));

            let mut detected = false;
            for idx in 0..count {
                let mut ctrl: *mut c_void = ptr::null_mut();
                if get_session(sess_enum, idx, &mut ctrl) < 0 || ctrl.is_null() {
                    continue;
                }

                let mut state: u32 = 0;
                let get_state: extern "system" fn(*mut c_void, *mut u32) -> i32 =
                    std::mem::transmute(*vtbl(ctrl).add(3));
                let active = get_state(ctrl, &mut state) >= 0 && state == AUDIO_SESSION_STATE_ACTIVE;

                if active {
                    let ctrl2 = com_qi(ctrl, &IID_IAUDIO_SESSION_CONTROL2);
                    let mut pid: u32 = 0;
                    let mut is_other = false;
                    if !ctrl2.is_null() {
                        let get_pid: extern "system" fn(*mut c_void, *mut u32) -> i32 =
                            std::mem::transmute(*vtbl(ctrl2).add(14));
                        if get_pid(ctrl2, &mut pid) >= 0 && pid != 0 && pid != self_pid {
                            is_other = true;
                        }
                        com_release(ctrl2);
                    }

                    if is_other {
                        let meter = com_qi(ctrl, &IID_IAUDIO_METER_INFORMATION);
                        if !meter.is_null() {
                            let mut peak: f32 = 0.0;
                            let get_peak: extern "system" fn(*mut c_void, *mut f32) -> i32 =
                                std::mem::transmute(*vtbl(meter).add(3));
                            if get_peak(meter, &mut peak) >= 0 && peak > 0.008 {
                                detected = true;
                            }
                            com_release(meter);
                        }
                    }
                }

                com_release(ctrl);
                if detected {
                    break;
                }
            }

            com_release(sess_enum);
            (device_id, detected)
        }
    }
}

/// Spawns a single lightweight background watcher thread (~350ms cadence) handling both:
/// - Smart Auto-Ducking (only queries sessions when enabled)
/// - Auto-Pause on Headphones Disconnect / Output Device Change (and optional auto-resume on reconnect)
pub fn spawn_auto_ducking_watcher(
    audio: std::sync::Arc<crate::audio::AudioEngine>,
    app: AppHandle,
) {
    std::thread::Builder::new()
        .name("liquidytm-audio-watcher".to_string())
        .spawn(move || {
            #[cfg(target_os = "windows")]
            win::init_com_for_thread();

            let self_pid = std::process::id();
            let mut hold_ticks: u8 = 0;
            let mut last_device_id: Option<String> = None;
            let mut paused_for_device_id: Option<String> = None;

            loop {
                std::thread::sleep(std::time::Duration::from_millis(350));
                let (duck_enabled, duck_level) = audio.auto_ducking_config();
                let (auto_pause, auto_resume) = audio.device_watch_config();

                if !duck_enabled && !auto_pause && !auto_resume {
                    hold_ticks = 0;
                    audio.set_duck_gain(1.0);
                    continue;
                }

                #[cfg(target_os = "windows")]
                let (cur_dev_id, other_active) = win::poll_default_endpoint(self_pid, duck_enabled);
                #[cfg(not(target_os = "windows"))]
                let (cur_dev_id, other_active): (Option<String>, bool) = {
                    let _ = self_pid;
                    (None, false)
                };

                // 1. Device disconnect / reconnect detection
                if let Some(ref dev_id) = cur_dev_id {
                    if let Some(ref prev_id) = last_device_id {
                        if prev_id != dev_id {
                            if auto_resume && paused_for_device_id.as_deref() == Some(dev_id.as_str()) {
                                audio.resume();
                                paused_for_device_id = None;
                                let _ = app.emit("playback-state", audio.snapshot());
                                let _ = app.emit("audio-device-changed", "resumed");
                            } else if auto_pause && audio.is_actively_playing() {
                                audio.pause();
                                paused_for_device_id = Some(prev_id.clone());
                                let _ = app.emit("playback-state", audio.snapshot());
                                let _ = app.emit("audio-device-changed", "paused");
                            }
                        }
                    }
                    last_device_id = Some(dev_id.clone());
                } else if last_device_id.is_some() && auto_pause && audio.is_actively_playing() {
                    audio.pause();
                    paused_for_device_id = last_device_id.clone();
                    let _ = app.emit("playback-state", audio.snapshot());
                    let _ = app.emit("audio-device-changed", "paused");
                    last_device_id = None;
                }

                // 2. Smart Auto-Ducking
                if !duck_enabled {
                    hold_ticks = 0;
                    audio.set_duck_gain(1.0);
                } else if other_active {
                    hold_ticks = 4;
                    audio.set_duck_gain(duck_level.clamp(0.05, 0.85));
                } else if hold_ticks > 0 {
                    hold_ticks -= 1;
                } else {
                    audio.set_duck_gain(1.0);
                }
            }
        })
        .ok();
}
