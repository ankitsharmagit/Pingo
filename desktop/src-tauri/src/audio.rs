// Native audio playback.
//
// Sounds are played from the Rust backend rather than the WebView so that
// playback is immune to browser autoplay/user-gesture policies and works
// regardless of whether the window is visible, minimized, or hidden in the
// system tray. The default alert sounds are embedded into the binary so there
// is no runtime path/bundling dependency.

use std::io::Cursor;
use std::thread;

use base64::Engine;

const SND_PERMISSION: &[u8] = include_bytes!("../../public/sounds/permission.wav");
const SND_SUCCESS: &[u8] = include_bytes!("../../public/sounds/success.wav");
const SND_ERROR: &[u8] = include_bytes!("../../public/sounds/error.wav");
const SND_AUTHENTICATION: &[u8] = include_bytes!("../../public/sounds/authentication.wav");

fn default_bytes(category: &str) -> &'static [u8] {
    match category {
        "permission" => SND_PERMISSION,
        "success" => SND_SUCCESS,
        "error" => SND_ERROR,
        "authentication" => SND_AUTHENTICATION,
        "ratelimit" => SND_ERROR,
        _ => SND_SUCCESS,
    }
}

// A user-selected custom sound is stored either as a `data:audio/...;base64,...`
// URL (set via the Settings file picker) or as a filesystem path. Returns the
// decoded audio bytes, or None to fall back to the embedded default.
fn custom_bytes(custom: &str) -> Option<Vec<u8>> {
    if custom.is_empty() {
        return None;
    }
    if let Some(idx) = custom.find("base64,") {
        let b64 = &custom[idx + "base64,".len()..];
        return base64::engine::general_purpose::STANDARD
            .decode(b64.as_bytes())
            .ok();
    }
    // Otherwise treat it as a path on disk.
    std::fs::read(custom).ok()
}

/// Play the alert sound for `category`. If `custom` holds a user-selected
/// sound it is used, otherwise the embedded default for the category plays.
/// Playback happens on a detached thread so it never blocks the caller.
pub fn play(category: &str, custom: Option<String>) {
    let bytes: Vec<u8> = custom
        .as_deref()
        .and_then(custom_bytes)
        .unwrap_or_else(|| default_bytes(category).to_vec());

    thread::spawn(move || {
        // The output stream must stay alive for the duration of playback,
        // hence everything (including sleep_until_end) lives in this thread.
        match rodio::OutputStream::try_default() {
            Ok((_stream, handle)) => {
                if let Ok(sink) = rodio::Sink::try_new(&handle) {
                    match rodio::Decoder::new(Cursor::new(bytes)) {
                        Ok(source) => {
                            sink.append(source);
                            sink.sleep_until_end();
                        }
                        Err(e) => eprintln!("audio: failed to decode sound: {e}"),
                    }
                }
            }
            Err(e) => eprintln!("audio: no output device: {e}"),
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use rodio::Source;

    // Verifies the embedded assets are present and decodable without needing
    // an audio device (decoding is independent of output).
    #[test]
    fn embedded_defaults_decode() {
        for cat in ["permission", "success", "error", "authentication"] {
            let bytes = default_bytes(cat).to_vec();
            assert!(bytes.len() > 44, "{cat}: too small to be a WAV");
            let source = rodio::Decoder::new(Cursor::new(bytes))
                .unwrap_or_else(|e| panic!("{cat}: decode failed: {e}"));
            assert_eq!(source.channels(), 1, "{cat}: expected mono");
            assert_eq!(source.sample_rate(), 44100, "{cat}: expected 44.1kHz");
        }
    }

    #[test]
    fn custom_data_url_decodes() {
        // data URL wrapping the embedded success.wav should round-trip.
        let b64 = base64::engine::general_purpose::STANDARD.encode(SND_SUCCESS);
        let url = format!("data:audio/wav;base64,{b64}");
        let bytes = custom_bytes(&url).expect("data url should decode");
        assert_eq!(bytes, SND_SUCCESS);
    }

    #[test]
    fn empty_custom_falls_back() {
        assert!(custom_bytes("").is_none());
    }
}
