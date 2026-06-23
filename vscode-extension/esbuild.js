// Bundles the extension (including @pingo/shared and ws) into a single
// self-contained out/extension.js so the packaged .vsix works without
// node_modules. `vscode` is provided by the host and must stay external.
const esbuild = require("esbuild");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const watch = process.argv.includes("--watch");

// Wipe stale artifacts so the package only contains the current bundle.
fs.rmSync(path.join(__dirname, "out"), { recursive: true, force: true });

const options = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "out/extension.js",
  platform: "node",
  format: "cjs",
  target: "node18",
  external: ["vscode"],
  sourcemap: true,
  // ws pulls in optional native acceleration addons; they're not required.
  loader: { ".node": "file" },
};

async function main() {
  // Type-check separately (esbuild only transpiles).
  try {
    execSync("tsc --noEmit -p ./", { stdio: "inherit" });
  } catch {
    process.exit(1);
  }

  if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    console.log("esbuild: watching…");
  } else {
    await esbuild.build(options);
    console.log("esbuild: bundled out/extension.js");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
