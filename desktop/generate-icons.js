import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function createRaw(width, height, colorFn) {
  const buf = Buffer.alloc(width * height * 4);
  let offset = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const color = colorFn(x, y, width, height);
      buf[offset++] = color[0]; // R
      buf[offset++] = color[1]; // G
      buf[offset++] = color[2]; // B
      buf[offset++] = color[3]; // A
    }
  }
  return buf;
}

function drawCircle(x, y, w, h, r, color) {
  const cx = w / 2;
  const cy = h / 2;
  const dx = x - cx + 0.5;
  const dy = y - cy + 0.5;
  const dist = Math.sqrt(dx*dx + dy*dy);
  
  if (dist < r - 1) {
    return color;
  } else if (dist < r) {
    // anti-aliasing
    const alpha = Math.round((r - dist) * color[3]);
    return [color[0], color[1], color[2], alpha];
  }
  return [0, 0, 0, 0];
}

// Generate green raw pixels (active)
const activeRaw = createRaw(32, 32, (x, y, w, h) => {
  return drawCircle(x, y, w, h, 12, [34, 197, 94, 255]); // Green-500
});

// Generate yellow raw pixels (waiting)
const waitingRaw = createRaw(32, 32, (x, y, w, h) => {
  return drawCircle(x, y, w, h, 12, [234, 179, 8, 255]); // Yellow-500
});

// Generate red raw pixels (error)
const errorRaw = createRaw(32, 32, (x, y, w, h) => {
  return drawCircle(x, y, w, h, 12, [239, 68, 68, 255]); // Red-500
});

// Generate blue raw pixels (attention)
const attentionRaw = createRaw(32, 32, (x, y, w, h) => {
  const cx = w / 2;
  const cy = h / 2;
  const dx = x - cx + 0.5;
  const dy = y - cy + 0.5;
  const dist = Math.sqrt(dx*dx + dy*dy);
  if (dist < 10) {
    return [59, 130, 246, 255]; // Blue-500
  }
  // outer glow ring
  if (dist >= 11 && dist < 14) {
    return [59, 130, 246, 120];
  }
  return [0, 0, 0, 0];
});

const iconsDir = path.join(__dirname, 'src-tauri', 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

fs.writeFileSync(path.join(iconsDir, 'tray-active.bin'), activeRaw);
fs.writeFileSync(path.join(iconsDir, 'tray-waiting.bin'), waitingRaw);
fs.writeFileSync(path.join(iconsDir, 'tray-error.bin'), errorRaw);
fs.writeFileSync(path.join(iconsDir, 'tray-attention.bin'), attentionRaw);

console.log('Raw tray icons generated successfully.');
