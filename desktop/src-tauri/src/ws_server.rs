use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::json;
use std::net::SocketAddr;
use tauri::{AppHandle, Emitter, Manager};
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::protocol::Message;
use uuid::Uuid;

use crate::db::{self, EventLog};
use crate::DbState;

#[derive(Debug, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum ClientMessage {
    #[serde(rename = "get_rules")]
    GetRules,
    #[serde(rename = "event")]
    Event {
        agent: String,
        event_type: String, // "permission" | "success" | "error" | "authentication" | "ratelimit"
        message: String,
        priority: String,
    },
    #[serde(rename = "status")]
    Status {
        agent: String,
        pid: u32,
        status: String, // "running" | "idle" | "error" | "waiting"
        start_time: String,
        last_activity: String,
    },
}

pub fn start_ws_server(app_handle: AppHandle, port: u16) {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    
    tokio::spawn(async move {
        let listener = match TcpListener::bind(&addr).await {
            Ok(l) => {
                println!("WebSocket server listening on ws://{}", addr);
                l
            }
            Err(e) => {
                eprintln!("Failed to bind WebSocket server to {}: {}", addr, e);
                return;
            }
        };

        while let Ok((stream, _)) = listener.accept().await {
            let app_clone = app_handle.clone();
            tokio::spawn(async move {
                if let Err(e) = handle_connection(stream, app_clone).await {
                    eprintln!("Error handling WebSocket connection: {}", e);
                }
            });
        }
    });
}

async fn handle_connection(stream: TcpStream, app_handle: AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let ws_stream = accept_async(stream).await?;
    let (mut ws_sender, mut ws_receiver) = ws_stream.split();

    while let Some(msg) = ws_receiver.next().await {
        let msg = msg?;
        if msg.is_text() {
            let text = msg.to_text()?;
            if let Ok(client_msg) = serde_json::from_str::<ClientMessage>(text) {
                match client_msg {
                    ClientMessage::GetRules => {
                        let rules = {
                            let db_state = app_handle.state::<DbState>();
                            let conn = db_state.conn.lock().unwrap();
                            db::get_all_rules(&conn).unwrap_or_default()
                        };
                        let response = json!({
                            "type": "rules",
                            "data": rules
                        });
                        ws_sender.send(Message::Text(response.to_string().into())).await.ok();
                    }
                    ClientMessage::Event { agent, event_type, message, priority } => {
                        // Check if monitoring is paused
                        let paused = {
                            let db_state = app_handle.state::<DbState>();
                            let conn = db_state.conn.lock().unwrap();
                            db::get_preference(&conn, "monitoring_paused")
                                .unwrap_or(None)
                                .map(|v| v == "true")
                                .unwrap_or(false)
                        };

                        if !paused {
                            let event = EventLog {
                                id: Uuid::new_v4().to_string(),
                                timestamp: chrono::Local::now().to_rfc3339(),
                                agent: agent.clone(),
                                event_type: event_type.clone(),
                                message: message.clone(),
                                priority: priority.clone(),
                            };

                            // Save to SQLite
                            {
                                let db_state = app_handle.state::<DbState>();
                                let conn = db_state.conn.lock().unwrap();
                                db::add_event(&conn, &event).ok();
                            }

                            // Emit event to React frontend
                            app_handle.emit("event-detected", &event).ok();

                            // Play the alert sound natively. Done in Rust (not the
                            // WebView) so it is immune to browser autoplay/gesture
                            // policies and works while the window is hidden in the tray.
                            let muted = {
                                let db_state = app_handle.state::<DbState>();
                                let conn = db_state.conn.lock().unwrap();
                                db::get_preference(&conn, "mute_sounds")
                                    .unwrap_or(None)
                                    .map(|v| v == "true")
                                    .unwrap_or(false)
                            };
                            if !muted {
                                let custom = crate::sound_pref_key(&event_type).and_then(|key| {
                                    let db_state = app_handle.state::<DbState>();
                                    let conn = db_state.conn.lock().unwrap();
                                    db::get_preference(&conn, key)
                                        .unwrap_or(None)
                                        .filter(|s| !s.is_empty())
                                });
                                crate::audio::play(&event_type, custom);
                            }

                            // Update system tray status icon based on event
                            let tray_status = match event_type.as_str() {
                                "permission" => "attention",
                                "error" => "error",
                                "authentication" => "attention",
                                "success" => "active", // Back to normal active state
                                _ => "active",
                            };
                            update_tray_icon(&app_handle, tray_status);
                        }
                    }
                    ClientMessage::Status { agent, pid, status, start_time, last_activity } => {
                        // Emit status change to React frontend
                        let status_payload = json!({
                            "agent": agent,
                            "pid": pid,
                            "status": status,
                            "start_time": start_time,
                            "last_activity": last_activity,
                        });
                        app_handle.emit("session-status", &status_payload).ok();

                        // If status is "waiting" (for approval), change tray to yellow/attention
                        // If "error", change to red
                        // If "running", change to yellow/waiting
                        // If "idle" or finished, change to green/active
                        let tray_status = match status.as_str() {
                            "waiting" => "attention",
                            "running" => "waiting",
                            "error" => "error",
                            "idle" => "active",
                            _ => "active",
                        };
                        update_tray_icon(&app_handle, tray_status);
                    }
                }
            }
        }
    }

    Ok(())
}

pub fn update_tray_icon(app_handle: &AppHandle, status: &str) {
    let active_bytes = include_bytes!("../icons/tray-active.bin");
    let waiting_bytes = include_bytes!("../icons/tray-waiting.bin");
    let error_bytes = include_bytes!("../icons/tray-error.bin");
    let attention_bytes = include_bytes!("../icons/tray-attention.bin");

    let bytes = match status {
        "active" => active_bytes.as_slice(),
        "waiting" => waiting_bytes.as_slice(),
        "error" => error_bytes.as_slice(),
        "attention" => attention_bytes.as_slice(),
        _ => active_bytes.as_slice(),
    };

    if let Some(tray) = app_handle.tray_by_id("main") {
        let image = tauri::image::Image::new(bytes, 32, 32);
        let _ = tray.set_icon(Some(image));
    }
}
