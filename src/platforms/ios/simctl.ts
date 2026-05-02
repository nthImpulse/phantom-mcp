import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { readFile, unlink } from "fs/promises";
import type { DeviceInfo } from "../types.js";

const execFileAsync = promisify(execFile);

// Regex to validate bundle IDs / UDIDs — blocks shell injection
const BUNDLE_ID_REGEX = /^[a-zA-Z0-9._-]+$/;
const UDID_REGEX = /^[a-zA-Z0-9-]+$/;

function validateBundleId(id: string): void {
  if (!BUNDLE_ID_REGEX.test(id)) {
    throw new Error(`Bundle ID invalide : "${id}". Seuls les caractères alphanumériques, points, tirets et underscores sont autorisés.`);
  }
}

function validateUdid(id: string): void {
  if (!UDID_REGEX.test(id)) {
    throw new Error(`UDID invalide : "${id}".`);
  }
}

/**
 * Execute xcrun simctl with safe argument passing (no shell injection).
 */
async function simctl(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("xcrun", ["simctl", ...args]);
  return stdout.trim();
}

async function simctlJson(args: string[]): Promise<unknown> {
  const output = await simctl(args);
  return JSON.parse(output);
}

interface SimDevice {
  udid: string;
  name: string;
  state: string;
  isAvailable?: boolean;
}

/**
 * List all iOS simulators in DeviceInfo format.
 */
export async function listIosDevices(): Promise<DeviceInfo[]> {
  try {
    const result = await simctlJson(["list", "devices", "available", "--json"]) as {
      devices: Record<string, SimDevice[]>;
    };

    const devices: DeviceInfo[] = [];
    for (const sims of Object.values(result.devices)) {
      for (const sim of sims) {
        devices.push({
          id: sim.udid,
          name: sim.name,
          platform: "ios",
          type: "simulator",
          state: sim.state === "Booted" ? "booted" : "shutdown",
        });
      }
    }
    return devices;
  } catch (err) {
    console.error(`[phantom] Erreur listIosDevices: ${err instanceof Error ? err.message : err}`);
    return [];
  }
}

/**
 * Detect real iOS devices connected via USB.
 * Uses xcrun devicectl (Xcode 15+) with JSON output, fallback to xctrace.
 */
export async function listIosRealDevices(): Promise<DeviceInfo[]> {
  // Try devicectl first (more reliable JSON output)
  try {
    const { stdout } = await execFileAsync("xcrun", ["devicectl", "list", "devices", "--json-output", "/dev/stdout"]);
    const data = JSON.parse(stdout) as {
      result?: { devices?: Array<{ identifier: string; deviceProperties?: { name: string }; connectionProperties?: { transportType: string } }> };
    };
    const devices: DeviceInfo[] = [];
    for (const d of data.result?.devices ?? []) {
      if (d.connectionProperties?.transportType === "localNetwork" || d.connectionProperties?.transportType === "wired") {
        devices.push({
          id: d.identifier,
          name: d.deviceProperties?.name ?? "iPhone",
          platform: "ios",
          type: "device",
          state: "booted",
        });
      }
    }
    if (devices.length > 0) return devices;
  } catch (err) {
    console.error(`[phantom] devicectl failed, falling back to xctrace: ${err instanceof Error ? err.message : err}`);
  }

  // Fallback: xctrace
  try {
    const { stdout } = await execFileAsync("xcrun", ["xctrace", "list", "devices"]);
    const devices: DeviceInfo[] = [];
    for (const line of stdout.split("\n")) {
      const match = line.match(/^(.+?)\s+\([\d.]+\)\s+\(([A-Fa-f0-9-]+)\)/);
      if (match && !line.toLowerCase().includes("simulator")) {
        devices.push({
          id: match[2],
          name: match[1].trim(),
          platform: "ios",
          type: "device",
          state: "booted",
        });
      }
    }
    return devices;
  } catch (err) {
    console.error(`[phantom] Erreur listIosRealDevices: ${err instanceof Error ? err.message : err}`);
    return [];
  }
}

/**
 * Boot a specific simulator by UDID. Only called from set_device.
 */
export async function bootSimulator(udid: string): Promise<void> {
  validateUdid(udid);
  await simctl(["boot", udid]);
  await execFileAsync("open", ["-a", "Simulator"]);
  await new Promise((r) => setTimeout(r, 3000));
}

/**
 * Take a screenshot of a specific device by UDID.
 * Uses a unique tmp filename to avoid race conditions on concurrent calls.
 */
export async function iosScreenshot(deviceUdid: string): Promise<Buffer> {
  validateUdid(deviceUdid);
  const tmpPath = `/tmp/phantom-ios-${Date.now()}-${Math.random().toString(36).slice(2)}.png`;
  await simctl(["io", deviceUdid, "screenshot", tmpPath]);
  const buffer = await readFile(tmpPath);
  await unlink(tmpPath).catch(() => {});
  return buffer;
}

/**
 * Launch an app on a specific device by UDID.
 */
export async function iosLaunchApp(deviceUdid: string, bundleId: string): Promise<void> {
  validateUdid(deviceUdid);
  validateBundleId(bundleId);
  await simctl(["launch", deviceUdid, bundleId]);
}

/**
 * Kill an app on a specific device by UDID.
 */
export async function iosKillApp(deviceUdid: string, bundleId: string): Promise<void> {
  validateUdid(deviceUdid);
  validateBundleId(bundleId);
  await simctl(["terminate", deviceUdid, bundleId]);
}

export async function iosOpenUrl(deviceUdid: string, url: string): Promise<void> {
  validateUdid(deviceUdid);
  if (/[\x00-\x1F\x7F]/.test(url)) throw new Error("URL contient des caractères de contrôle.");
  if (url.startsWith("-")) throw new Error("URL invalide : ne peut pas commencer par \"-\".");
  await simctl(["openurl", deviceUdid, url]);
}

export async function iosStartVideoRecord(deviceUdid: string, outputPath: string): Promise<number | null> {
  validateUdid(deviceUdid);
  if (!outputPath.startsWith("/tmp/phantom-")) throw new Error("outputPath doit commencer par /tmp/phantom-");
  const proc = spawn("xcrun", ["simctl", "io", deviceUdid, "recordVideo", outputPath], {
    detached: true,
    stdio: "ignore",
  });
  proc.unref();
  console.error(`[phantom] iOS video recording started (PID: ${proc.pid})`);
  return proc.pid ?? null;
}

/**
 * Clear the simulator pasteboard (clipboard).
 * Useful at session start to avoid leftover text from previous sessions
 * being pasted accidentally during type_text fallbacks.
 */
export async function iosClearClipboard(deviceUdid: string): Promise<void> {
  validateUdid(deviceUdid);
  await new Promise<void>((resolve, reject) => {
    const proc = spawn("xcrun", ["simctl", "pbcopy", deviceUdid]);
    proc.stdin.end(); // empty stdin → empty clipboard
    proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`pbcopy clear exit ${code}`)));
    proc.on("error", reject);
  });
}

/**
 * Clear all status bar overrides (data network, time, battery, etc.).
 * Useful at session start to ensure a clean device state.
 */
export async function iosClearStatusBar(deviceUdid: string): Promise<void> {
  validateUdid(deviceUdid);
  try {
    await simctl(["status_bar", deviceUdid, "clear"]);
  } catch {
    // status_bar clear can fail on shutdown devices — non-fatal
  }
}

/**
 * Force the simulator's hardware keyboard layout to QWERTY (en_US).
 * Mitigates AZERTY/system-locale issues for fallback typing paths.
 *
 * Note: pbcopy+Cmd+V (default in iosTypeText) is already keyboard-layout
 * agnostic, but this helps when WDA falls back to direct keystroke typing
 * or for tests that rely on hardware keyboard simulation.
 *
 * Requires the simulator to pick up the new defaults — applied immediately
 * for new keyboard sessions, but a fresh app launch may be needed for
 * already-running apps to fully respect the new layout.
 */
export async function iosForceKeyboardQwerty(deviceUdid: string): Promise<void> {
  validateUdid(deviceUdid);
  try {
    await simctl([
      "spawn",
      deviceUdid,
      "defaults",
      "write",
      "-g",
      "AppleKeyboards",
      "-array",
      "en_US@hw=US;sw=QWERTY",
    ]);
  } catch (err) {
    // Non-fatal — log and continue. The pbcopy+paste path doesn't depend on this.
    console.error(`[phantom] iosForceKeyboardQwerty failed (non-fatal): ${err instanceof Error ? err.message : err}`);
  }
}
