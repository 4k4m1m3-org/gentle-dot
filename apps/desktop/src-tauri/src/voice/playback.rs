//! Bounded WAV playback on PipeWire. Only the rose has these commands.
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};

#[derive(Debug, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields, rename_all = "camelCase")]
pub struct Config {
    pub enabled: bool,
    pub spoken_replies: bool,
    pub silence_ms: u64,
    pub max_capture_ms: u64,
    pub initial_wait_ms: u64,
    pub level_threshold: f32,
    pub response_timeout_ms: u64,
    pub engine: String,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            enabled: true,
            spoken_replies: true,
            silence_ms: 1500,
            max_capture_ms: 30000,
            initial_wait_ms: 10000,
            level_threshold: 0.32,
            response_timeout_ms: 180000,
            engine: "piper".into(),
        }
    }
}
pub fn load_config(dir: &Path) -> Result<Config, String> {
    let config: Config = match fs::read(dir.join("voice-mode.json")) {
        Ok(data) => serde_json::from_slice(&data).map_err(|e| format!("voice-mode.json: {e}"))?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Config::default(),
        Err(e) => return Err(e.to_string()),
    };
    if !(500..=5000).contains(&config.silence_ms)
        || !(3000..=30000).contains(&config.max_capture_ms)
        || !(1000..=30000).contains(&config.initial_wait_ms)
        || config.initial_wait_ms > config.max_capture_ms
        || !config.level_threshold.is_finite()
        || !(0.001..=0.5).contains(&config.level_threshold)
        || !(10000..=600000).contains(&config.response_timeout_ms)
        || config.engine != "piper"
    {
        return Err("Invalid voice-mode.json limits or engine (must be piper)".into());
    }
    Ok(config)
}
struct Playing {
    child: Child,
    path: PathBuf,
}
impl Drop for Playing {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = fs::remove_file(&self.path);
    }
}
#[derive(Default)]
pub struct Playback(Mutex<Option<Playing>>, AtomicU64);
impl Playback {
    pub fn cancel(&self) {
        let mut slot = self.0.lock().unwrap();
        self.1.fetch_add(1, Ordering::SeqCst);
        slot.take();
    }
}
#[tauri::command]
pub fn voice_play_cancel(app: AppHandle) {
    app.state::<Playback>().cancel();
}
#[tauri::command]
pub async fn voice_play(app: AppHandle, data: String) -> Result<(), String> {
    let generation = app.state::<Playback>().1.load(Ordering::SeqCst);
    tauri::async_runtime::spawn_blocking(move || {
        if data.len() > 48_000_000 {
            return Err("Voice WAV too large".into());
        }
        let bytes = STANDARD.decode(data).map_err(|e| e.to_string())?;
        if bytes.len() < 44 || &bytes[..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
            return Err("Invalid WAV".into());
        }
        let player = app.state::<Playback>();
        let mut slot = player.0.lock().unwrap();
        if player.1.load(Ordering::SeqCst) != generation {
            return Err("Playback cancelled".into());
        }
        if slot.is_some() {
            return Err("Voice playback already active".into());
        }
        let mut random = [0u8; 16];
        getrandom::fill(&mut random).map_err(|e| e.to_string())?;
        let path = std::env::temp_dir().join(format!(
            "gentle-dot-voice-{:032x}.wav",
            u128::from_le_bytes(random)
        ));
        use std::os::unix::fs::OpenOptionsExt;
        let result = (|| {
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(&path)
                .map_err(|e| e.to_string())?;
            file.write_all(&bytes).map_err(|e| e.to_string())?;
            Command::new("pw-play")
                .arg(&path)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::inherit())
                .spawn()
                .map_err(|e| format!("pw-play: {e}"))
        })();
        let child = match result {
            Ok(child) => child,
            Err(e) => {
                let _ = fs::remove_file(&path);
                return Err(e);
            }
        };
        *slot = Some(Playing {
            child,
            path: path.clone(),
        });
        drop(slot);
        let started = Instant::now();
        loop {
            std::thread::sleep(Duration::from_millis(50));
            let mut slot = player.0.lock().unwrap();
            let Some(playing) = slot.as_mut().filter(|p| p.path == path) else {
                return Err("Playback cancelled".into());
            };
            let result = playing.child.try_wait().map_err(|e| e.to_string());
            match result {
                Ok(Some(status)) => {
                    slot.take();
                    return if status.success() {
                        Ok(())
                    } else {
                        Err(format!("pw-play exited: {status}"))
                    };
                }
                Err(e) => {
                    slot.take();
                    return Err(e);
                }
                _ if started.elapsed() > Duration::from_secs(600) => {
                    slot.take();
                    return Err("Playback timeout".into());
                }
                _ => {}
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn defaults_are_bounded_and_do_not_enable_continuous_listening() {
        let c = Config::default();
        assert_eq!(c.silence_ms, 1500);
        assert_eq!(c.max_capture_ms, 30000);
        assert_eq!(c.engine, "piper");
        assert!(serde_json::from_str::<Config>(r#"{"unknown":1}"#).is_err());
    }
}
