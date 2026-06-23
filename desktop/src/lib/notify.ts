import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { EventLog, CATEGORY_LABELS } from "./types";

// NOTE: Alert sounds are played natively by the Rust backend (see
// src-tauri/src/audio.rs). The WebView cannot reliably play audio for
// event-driven (non-gesture) playback or while the window is hidden, so this
// module is responsible only for the OS notification.

let permissionGranted = false;

export async function ensureNotificationPermission(): Promise<boolean> {
  try {
    permissionGranted = await isPermissionGranted();
    if (!permissionGranted) {
      const result = await requestPermission();
      permissionGranted = result === "granted";
    }
  } catch {
    permissionGranted = false;
  }
  return permissionGranted;
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export async function notify(event: EventLog): Promise<void> {
  const title = CATEGORY_LABELS[event.event_type] ?? "Pingo";
  const body = `${capitalize(event.agent)} — ${event.message}`;
  try {
    if (permissionGranted || (await isPermissionGranted())) {
      sendNotification({ title, body });
    }
  } catch {
    /* notification plugin unavailable */
  }
}
