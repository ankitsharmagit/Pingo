// Cross-platform sound + voice notifier shared by the CLI (standalone local
// audio) and the VS Code extension (presentation layer).
//
// Playback shells out to OS-native players so it works in any Node context
// (CLI process or VS Code extension host) without a browser/webview:
//   - sound: Windows SoundPlayer.PlaySync (blocking, avoids clipping) / afplay / paplay|aplay
//   - voice: Windows System.Speech / `say` / `spd-say`|`espeak`
//
// Both channels are serialized through queues so overlapping events don't
// talk over each other.

import { exec, type ChildProcess } from "child_process";
import * as path from "path";
import * as fs from "fs";
import type { EventType } from "./types";

// Resolve the bundled WAV directory. At runtime this file lives in dist/, and
// the sounds ship at <package>/sounds, i.e. one level up from dist/.
export function soundsDir(): string {
  return path.join(__dirname, "..", "sounds");
}

const SOUND_FILES: Record<EventType, string> = {
  permission: "permission.wav",
  success: "success.wav",
  error: "error.wav",
  authentication: "authentication.wav",
  ratelimit: "error.wav",
  input: "input.wav",
};

function soundPath(type: EventType, dir: string): string {
  return path.join(dir, SOUND_FILES[type] ?? "success.wav");
}

// PowerShell single-quoted strings escape an embedded quote by doubling it.
function psQuote(s: string): string {
  return s.replace(/'/g, "''");
}

function playSoundCommand(file: string): string | null {
  switch (process.platform) {
    case "win32":
      return `powershell -NoProfile -c "(New-Object Media.SoundPlayer '${psQuote(file)}').PlaySync()"`;
    case "darwin":
      return `afplay "${file}"`;
    default:
      // Try paplay (PulseAudio/PipeWire), fall back to aplay (ALSA).
      return `paplay "${file}" || aplay -q "${file}"`;
  }
}

function speakCommand(phrase: string): string | null {
  switch (process.platform) {
    case "win32":
      return `powershell -NoProfile -c "Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak('${psQuote(phrase)}')"`;
    case "darwin":
      return `say "${phrase.replace(/"/g, '\\"')}"`;
    default:
      return `spd-say "${phrase.replace(/"/g, '\\"')}" || espeak "${phrase.replace(/"/g, '\\"')}"`;
  }
}

const MAX_QUEUE = 16;

class Channel {
  private queue: string[] = [];
  private busy = false;
  private child: ChildProcess | null = null;

  push(command: string | null): void {
    if (!command) return;
    if (this.queue.length >= MAX_QUEUE) this.queue.shift();
    this.queue.push(command);
    this.run();
  }

  // Drop everything queued and kill the currently-playing sound/voice so the
  // user gets true, instant silence — not "silent after the next few queued
  // clips finish." This is what makes Toggle Mute a real killswitch.
  flush(): void {
    this.queue.length = 0;
    if (this.child) {
      try {
        this.child.kill();
      } catch {
        /* ignore */
      }
      this.child = null;
    }
    this.busy = false;
  }

  private run(): void {
    if (this.busy || this.queue.length === 0) return;
    this.busy = true;
    const command = this.queue.shift()!;
    // Keep the child handle so flush() can kill a sound that's mid-play —
    // without it, muting would only stop *future* enqueues, not the clip
    // already playing (and a queued series would keep ringing out).
    const child = exec(command, () => {
      this.child = null;
      this.busy = false;
      this.run();
    });
    this.child = child;
  }
}

export class Notifier {
  private sound = new Channel();
  private voice = new Channel();
  private dir: string;

  // `customSoundsDir` lets a host (e.g. the VS Code extension) point at its own
  // bundled copy of the WAV assets instead of the shared package's sounds/.
  constructor(customSoundsDir?: string) {
    this.dir = customSoundsDir ?? soundsDir();
  }

  playSound(type: EventType): void {
    const file = soundPath(type, this.dir);
    if (!fs.existsSync(file)) return;
    this.sound.push(playSoundCommand(file));
  }

  speak(phrase: string): void {
    if (!phrase.trim()) return;
    this.voice.push(speakCommand(phrase));
  }

  // Stop all sound/voice immediately, including the clip currently playing and
  // anything queued behind it. Used by the mute toggle / disable paths.
  flush(): void {
    this.sound.flush();
    this.voice.flush();
  }
}

// Shared default instance for simple call sites.
export const notifier = new Notifier();
