mod audio;
mod db;
mod ws_server;

use db::{EventLog, Rule};
use std::sync::Mutex;
use tauri::{menu::{Menu, MenuItem}, tray::{TrayIconBuilder, TrayIconEvent}, Emitter, Manager};

pub struct DbState {
    pub conn: Mutex<rusqlite::Connection>,
}

#[tauri::command]
fn get_rules(db_state: tauri::State<DbState>) -> Result<Vec<Rule>, String> {
    let conn = db_state.conn.lock().unwrap();
    db::get_all_rules(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_rule(db_state: tauri::State<DbState>, rule: Rule) -> Result<(), String> {
    let conn = db_state.conn.lock().unwrap();
    db::save_rule(&conn, &rule).map_err(|e| e.to_string())
}

#[tauri::command]
fn toggle_rule(db_state: tauri::State<DbState>, id: String, enabled: bool) -> Result<(), String> {
    let conn = db_state.conn.lock().unwrap();
    db::toggle_rule(&conn, &id, enabled).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_rule(db_state: tauri::State<DbState>, id: String) -> Result<(), String> {
    let conn = db_state.conn.lock().unwrap();
    db::delete_rule(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_events(db_state: tauri::State<DbState>) -> Result<Vec<EventLog>, String> {
    let conn = db_state.conn.lock().unwrap();
    db::get_all_events(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn clear_events(db_state: tauri::State<DbState>) -> Result<(), String> {
    let conn = db_state.conn.lock().unwrap();
    db::clear_all_events(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_prefs(db_state: tauri::State<DbState>) -> Result<std::collections::HashMap<String, String>, String> {
    let conn = db_state.conn.lock().unwrap();
    let keys = vec![
        "monitoring_paused",
        "mute_sounds",
        "sound_success",
        "sound_permission",
        "sound_error",
        "sound_authentication",
        "sound_input",
    ];
    let mut prefs = std::collections::HashMap::new();
    for key in keys {
        if let Ok(Some(val)) = db::get_preference(&conn, key) {
            prefs.insert(key.to_string(), val);
        }
    }
    Ok(prefs)
}

#[tauri::command]
fn save_pref(db_state: tauri::State<DbState>, key: String, value: String) -> Result<(), String> {
    let conn = db_state.conn.lock().unwrap();
    db::set_preference(&conn, &key, &value).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_tray_status(app_handle: tauri::AppHandle, status: String) -> Result<(), String> {
    // status: "active" | "waiting" | "error" | "attention"
    ws_server::update_tray_icon(&app_handle, &status);
    Ok(())
}

// Returns the preferences key holding the custom sound for a category, if any.
pub fn sound_pref_key(category: &str) -> Option<&'static str> {
    match category {
        "permission" => Some("sound_permission"),
        "success" => Some("sound_success"),
        "error" => Some("sound_error"),
        "authentication" => Some("sound_authentication"),
        "ratelimit" => Some("sound_error"),
        "input" => Some("sound_input"),
        _ => None,
    }
}

#[tauri::command]
fn test_sound(db_state: tauri::State<DbState>, category: String) -> Result<(), String> {
    // Explicit user test: always plays (ignores the global mute toggle).
    let custom = sound_pref_key(&category).and_then(|key| {
        let conn = db_state.conn.lock().unwrap();
        db::get_preference(&conn, key)
            .unwrap_or(None)
            .filter(|s| !s.is_empty())
    });
    audio::play(&category, custom);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // 1. Initialize SQLite Database in App Data Directory
            let app_data_dir = app.path().app_local_data_dir().expect("Failed to get app local data dir");
            std::fs::create_dir_all(&app_data_dir).expect("Failed to create app data directory");
            let db_path = app_data_dir.join("pingo.db");
            let conn = db::init_db(&db_path).expect("Failed to initialize SQLite database");
            app.manage(DbState { conn: Mutex::new(conn) });

            // 2. Start WebSocket Server on port 4001
            let app_handle = app.handle().clone();
            ws_server::start_ws_server(app_handle, 4001);

            // 3. Build System Tray Menu
            let tray_menu = Menu::with_items(app, &[
                &MenuItem::with_id(app, "open", "Open Dashboard", true, None::<&str>)?,
                &MenuItem::with_id(app, "pause", "Pause Monitoring", true, None::<&str>)?,
                &MenuItem::with_id(app, "resume", "Resume Monitoring", true, None::<&str>)?,
                &MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?,
            ])?;

            let active_bytes = include_bytes!("../icons/tray-active.bin");
            let active_image = tauri::image::Image::new(active_bytes, 32, 32);

            let _tray = TrayIconBuilder::with_id("main")
                .icon(active_image)
                .menu(&tray_menu)
                .tooltip("Pingo - Active")
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "open" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "pause" => {
                            let db_state = app.state::<DbState>();
                            let conn = db_state.conn.lock().unwrap();
                            let _ = db::set_preference(&conn, "monitoring_paused", "true");
                            let _ = app.emit("monitoring-status-changed", true);
                            if let Some(tray) = app.tray_by_id("main") {
                                let _ = tray.set_tooltip(Some("Pingo - Paused"));
                            }
                        }
                        "resume" => {
                            let db_state = app.state::<DbState>();
                            let conn = db_state.conn.lock().unwrap();
                            let _ = db::set_preference(&conn, "monitoring_paused", "false");
                            let _ = app.emit("monitoring-status-changed", false);
                            if let Some(tray) = app.tray_by_id("main") {
                                let _ = tray.set_tooltip(Some("Pingo - Active"));
                                let active_bytes = include_bytes!("../icons/tray-active.bin");
                                let img = tauri::image::Image::new(active_bytes, 32, 32);
                                let _ = tray.set_icon(Some(img));
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: tauri::tray::MouseButton::Left, .. } = event {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_rules,
            save_rule,
            toggle_rule,
            delete_rule,
            get_events,
            clear_events,
            get_prefs,
            save_pref,
            set_tray_status,
            test_sound
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
