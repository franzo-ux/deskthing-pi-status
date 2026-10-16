// Install the built app (dist/<id>) into DeskThing and register it.
// Close DeskThing first (tray icon -> Quit): it rewrites apps.json on exit.
//
//   npm run deploy            copy files + register the app
//   npm run deploy -- --files only copy files (app already registered;
//                             DeskThing may stay open, restart it after)
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "app", "manifest.json"), "utf8"));
const id = manifest.id;
const built = join(root, "dist", id);
if (!existsSync(built)) {
  console.error("dist/" + id + " not found: run `npm run build` first");
  process.exit(1);
}

const base =
  process.env.DESKTHING_DIR ||
  (platform() === "win32"
    ? join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "deskthing")
    : platform() === "darwin"
      ? join(homedir(), "Library", "Application Support", "deskthing")
      : join(homedir(), ".config", "deskthing"));
const appsDir = join(base, "apps");
if (!existsSync(appsDir)) {
  console.error("DeskThing apps folder not found at " + appsDir + " (set DESKTHING_DIR)");
  process.exit(1);
}

// keep files written at runtime (e.g. alert.json) when replacing the app
const target = join(appsDir, id);
for (const sub of ["server", "client", "icons"]) rmSync(join(target, sub), { recursive: true, force: true });
cpSync(built, target, { recursive: true });
console.log("copied to " + target);

if (process.argv.includes("--files")) process.exit(0);

const appsJson = join(base, "apps.json");
const apps = existsSync(appsJson) ? JSON.parse(readFileSync(appsJson, "utf8")) : {};
if (existsSync(appsJson)) cpSync(appsJson, appsJson + ".bak-" + id);
apps[id] = {
  name: id,
  enabled: true,
  running: false,
  timeStarted: 0,
  prefIndex: apps[id]?.prefIndex ?? 10,
  meta: { version: "0.11.0", verified: true, verifiedManifest: true, updateAvailable: false, updateChecked: false },
  manifest,
};
writeFileSync(appsJson, JSON.stringify(apps, null, 2));
console.log("registered '" + id + "' in " + appsJson + " (backup: apps.json.bak-" + id + ")");
console.log("Now start DeskThing.");
