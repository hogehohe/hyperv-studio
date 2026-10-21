import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants, copyFileSync, existsSync, readFileSync, renameSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32" || process.arch !== "x64") {
  throw new Error("The offline installer must be bundled on Windows x64.");
}

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(readFileSync(join(appRoot, "src-tauri", "tauri.conf.json"), "utf8"));
const outputDirectory = join(appRoot, "src-tauri", "target", "release", "bundle", "nsis");
const generatedInstaller = join(outputDirectory, `${config.productName}_${config.version}_x64-setup.exe`);
const offlineInstaller = join(outputDirectory, `Hyper-V-Studio_${config.version}_x64-offline-setup.exe`);
const backup = join(outputDirectory, `.online-backup-${randomUUID()}.exe`);
const hadOnlineInstaller = existsSync(generatedInstaller);

if (process.env.CARGO_TARGET_DIR) {
  throw new Error("Use the default Cargo target directory for this packaging command.");
}
if (!existsSync(join(appRoot, "src-tauri", "target", "release", "hyperv-studio.exe"))) {
  throw new Error("Build the release application first with npm run tauri build.");
}
if (hadOnlineInstaller) {
  copyFileSync(generatedInstaller, backup, constants.COPYFILE_EXCL);
}

try {
  execFileSync(process.execPath, [
    join(appRoot, "node_modules", "@tauri-apps", "cli", "tauri.js"),
    "bundle", "--bundles", "nsis", "--ci",
    "--config", "src-tauri/tauri.offline.conf.json",
  ], { cwd: appRoot, stdio: "inherit" });
  renameSync(generatedInstaller, offlineInstaller);
} finally {
  if (hadOnlineInstaller) {
    // Restore the online bundle even if downloading or packaging fails.
    // Keep the backup if restoration fails, so it can be recovered manually.
    copyFileSync(backup, generatedInstaller);
    unlinkSync(backup);
  }
}

console.log(`Offline installer: ${offlineInstaller}`);
