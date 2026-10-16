// Build the DeskThing app in ./app into ./dist/<id>
//   server/index.ts -> dist/<id>/server/index.js (ESM, Node)
//   client/main.ts  -> dist/<id>/client/main.js  (old Chromium on the Car Thing)
//   every other client file (html, images) and icons/ are copied as they are.
import { build } from "esbuild";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "app");
const { id } = JSON.parse(readFileSync(join(src, "manifest.json"), "utf8"));
const out = join(root, "dist", id);

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "server"), { recursive: true });
mkdirSync(join(out, "client"), { recursive: true });

// DeskThing runs app servers as ES modules without the CommonJS globals
const banner = [
  "import { createRequire as DeskThingCreateRequire } from 'module';",
  "import { fileURLToPath as DeskThingFileURLToPath } from 'url';",
  "import { dirname as DeskThingDirname } from 'node:path';",
  "const require = DeskThingCreateRequire(import.meta.url);",
  "const __filename = DeskThingFileURLToPath(import.meta.url);",
  "const __dirname = DeskThingDirname(__filename);",
].join("\n");

await build({
  entryPoints: [join(src, "server", "index.ts")],
  bundle: true, platform: "node", format: "esm", target: "node20",
  outfile: join(out, "server", "index.js"), banner: { js: banner },
  loader: { ".sh": "text" }, logLevel: "warning",
});
await build({
  entryPoints: [join(src, "client", "main.ts")],
  bundle: true, format: "iife", target: "chrome69",
  outfile: join(out, "client", "main.js"), logLevel: "warning",
});

// copy client assets (index.html, images, ...) but not the TypeScript sources
const copyAssets = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) copyAssets(p);
    else if (!/\.(ts|tsx)$/.test(name)) {
      const dest = join(out, "client", relative(join(src, "client"), p));
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(p, dest);
    }
  }
};
copyAssets(join(src, "client"));
if (existsSync(join(src, "icons"))) cpSync(join(src, "icons"), join(out, "icons"), { recursive: true });
cpSync(join(src, "manifest.json"), join(out, "manifest.json"));
writeFileSync(join(out, "server", "package.json"), '{"type":"module"}\n');
console.log("built", relative(root, out));
