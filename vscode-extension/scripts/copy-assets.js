// Copies the shared WAV assets into the extension's media/ so the packaged
// .vsix is self-contained (vsce does not follow workspace symlinks reliably).
// Run automatically after `tsc` via the "compile" script.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const src = path.join(root, "..", "packages", "shared", "sounds");
const dest = path.join(root, "media", "sounds");

fs.mkdirSync(dest, { recursive: true });

let copied = 0;
for (const file of fs.readdirSync(src)) {
  if (!file.endsWith(".wav")) continue;
  fs.copyFileSync(path.join(src, file), path.join(dest, file));
  copied++;
}
console.log(`copy-assets: synced ${copied} sound(s) into media/sounds`);
