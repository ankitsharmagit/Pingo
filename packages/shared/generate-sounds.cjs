// Generates Pingo's default alert sounds as 16-bit PCM mono WAV files
// into public/sounds/. Run once with: node generate-sounds.cjs
const fs = require("fs");
const path = require("path");

const SAMPLE_RATE = 44100;

function writeWav(filePath, samples) {
  const numSamples = samples.length;
  const buffer = Buffer.alloc(44 + numSamples * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + numSamples * 2, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16); // PCM chunk size
  buffer.writeUInt16LE(1, 20); // PCM format
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write("data", 36);
  buffer.writeUInt32LE(numSamples * 2, 40);
  for (let i = 0; i < numSamples; i++) {
    let s = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  fs.writeFileSync(filePath, buffer);
  console.log("wrote", filePath, `(${(buffer.length / 1024).toFixed(1)} KB)`);
}

// Append a tone (with attack/decay envelope) to a sample array.
function tone(samples, freq, durationSec, opts = {}) {
  const { amp = 0.5, wave = "sine", attack = 0.01, decay = 0.06, detune = 0 } = opts;
  const n = Math.floor(durationSec * SAMPLE_RATE);
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    let env = 1;
    if (t < attack) env = t / attack;
    const remaining = durationSec - t;
    if (remaining < decay) env *= remaining / decay;
    let v;
    const phase = 2 * Math.PI * freq * t;
    if (wave === "square") v = Math.sign(Math.sin(phase));
    else if (wave === "triangle") v = (2 / Math.PI) * Math.asin(Math.sin(phase));
    else v = Math.sin(phase) + (detune ? 0.4 * Math.sin(2 * Math.PI * (freq + detune) * t) : 0);
    samples.push(v * amp * env);
  }
}

function silence(samples, durationSec) {
  const n = Math.floor(durationSec * SAMPLE_RATE);
  for (let i = 0; i < n; i++) samples.push(0);
}

// A struck-bell timbre: fundamental + inharmonic partials with exponential decay.
function bell(samples, freq, durationSec, amp = 0.6) {
  const n = Math.floor(durationSec * SAMPLE_RATE);
  const partials = [
    [1, 1.0],
    [2.0, 0.5],
    [2.8, 0.35],
    [4.1, 0.2],
  ];
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    let env = Math.exp(-4 * t);
    if (t < 0.005) env *= t / 0.005;
    let v = 0;
    for (const [mult, a] of partials) v += a * Math.sin(2 * Math.PI * freq * mult * t);
    samples.push((v / 2.05) * amp * env);
  }
}

const outDir = path.join(__dirname, "sounds");
fs.mkdirSync(outDir, { recursive: true });

// success — soft, pleasant ascending chime (C5 -> E5 -> G5).
{
  const s = [];
  tone(s, 523.25, 0.11, { amp: 0.4, decay: 0.05 });
  tone(s, 659.25, 0.11, { amp: 0.4, decay: 0.05 });
  tone(s, 783.99, 0.18, { amp: 0.42, decay: 0.12 });
  writeWav(path.join(outDir, "success.wav"), s);
}

// permission — loud, attention-grabbing double bell strike.
{
  const s = [];
  bell(s, 880, 0.5, 0.75);
  silence(s, 0.05);
  bell(s, 880, 0.55, 0.7);
  writeWav(path.join(outDir, "permission.wav"), s);
}

// error — low, dissonant warning buzz (descending square tones).
{
  const s = [];
  tone(s, 233.08, 0.18, { amp: 0.5, wave: "square", decay: 0.04 });
  tone(s, 196.0, 0.28, { amp: 0.5, wave: "square", decay: 0.08 });
  writeWav(path.join(outDir, "error.wav"), s);
}

// authentication — urgent alternating attention tone.
{
  const s = [];
  for (let i = 0; i < 3; i++) {
    tone(s, 988, 0.09, { amp: 0.5, decay: 0.03 });
    tone(s, 659, 0.09, { amp: 0.5, decay: 0.03 });
  }
  writeWav(path.join(outDir, "authentication.wav"), s);
}

console.log("All sounds generated in", outDir);
