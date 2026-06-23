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

import { exec } from "child_process";
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

  push(command: string | null): void {
    if (!command) return;
    if (this.queue.length >= MAX_QUEUE) this.queue.shift();
    this.queue.push(command);
    this.run();
  }

  private run(): void {
    if (this.busy || this.queue.length === 0) return;
    this.busy = true;
    const command = this.queue.shift()!;
    exec(command, () => {
      this.busy = false;
      this.run();
    });
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
}

// Shared default instance for simple call sites.
export const notifier = new Notifier();
