import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { EventLog, CATEGORY_LABELS, PREF_KEYS } from "./types";

const DEFAULT_SOUNDS: Record<string, string> = {
  permission: "/sounds/permission.wav",
  success: "/sounds/success.wav",
  error: "/sounds/error.wav",
  authentication: "/sounds/authentication.wav",
  ratelimit: "/sounds/error.wav",
};

// Maps a category to the pref key that may hold a user-selected custom sound.
const SOUND_PREF: Record<string, string> = {
  permission: PREF_KEYS.soundPermission,
  success: PREF_KEYS.soundSuccess,
  error: PREF_KEYS.soundError,
  authentication: PREF_KEYS.soundAuthentication,
  ratelimit: PREF_KEYS.soundError,
};

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

export function playSound(category: string, prefs: Record<string, string>): void {
  const prefKey = SOUND_PREF[category];
  const custom = prefKey ? prefs[prefKey] : undefined;
  const src = custom && custom.length > 0 ? custom : DEFAULT_SOUNDS[category];
  if (!src) return;
  try {
    const audio = new Audio(src);
    audio.volume = 1.0;
    void audio.play().catch(() => {
      /* autoplay/codec issues — ignore */
    });
  } catch {
    /* ignore */
  }
}

export async function notify(
  event: EventLog,
  prefs: Record<string, string>,
  muted: boolean
): Promise<void> {
  if (!muted) playSound(event.event_type, prefs);

  const title = CATEGORY_LABELS[event.event_type] ?? "Pingo";
  const body = `${capitalize(event.agent)} — ${event.message}`;
  try {
    if (permissionGranted || (await isPermissionGranted())) {
      sendNotification({ title, body });
    }
  } catch {
    /* notification plugin unavailable — sound still played */
  }
}
