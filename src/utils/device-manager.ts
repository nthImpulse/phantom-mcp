import type { DeviceInfo } from "../platforms/types.js";
import { listIosDevices, listIosRealDevices } from "../platforms/ios/simctl.js";
import { listAndroidDevices, listAvds } from "../platforms/android/adb.js";

/**
 * Resolve the device to use, or return an error message asking the user to choose.
 * Use this in every tool to avoid duplicating device detection logic.
 */
export async function resolveDevice(): Promise<{ device: DeviceInfo } | { error: string }> {
  const device = await getActiveDevice();
  if (device) return { device };

  const booted = await getBootedDevices();
  if (booted.length === 1) return { device: booted[0] };

  // No device or multiple — ask the user
  const all = await getAllDevicesIncludingShutdown();
  return { error: buildDeviceSelectionPrompt(all) };
}

let selectedDeviceId: string | null = null;

// Cache for device list — avoid 3 system calls per tool invocation
let deviceListCache: DeviceInfo[] | null = null;
let deviceListCacheTime = 0;
const CACHE_TTL_MS = 3000; // 3s cache — devices don't change that fast

/**
 * Set the active device for this session.
 */
export function setActiveDevice(deviceId: string): void {
  selectedDeviceId = deviceId;
  deviceListCache = null; // Invalidate cache on device change
}

/**
 * Get all connected/available devices across platforms.
 * Caches results for 3s to avoid repeated system calls.
 */
export async function getAllDevices(): Promise<DeviceInfo[]> {
  if (deviceListCache && Date.now() - deviceListCacheTime < CACHE_TTL_MS) {
    return deviceListCache;
  }

  const [iosSims, iosReal, android] = await Promise.all([
    listIosDevices(),
    listIosRealDevices(),
    listAndroidDevices(),
  ]);
  deviceListCache = [...iosReal, ...android, ...iosSims];
  deviceListCacheTime = Date.now();
  return deviceListCache;
}

/**
 * Get only booted/connected devices.
 */
export async function getBootedDevices(): Promise<DeviceInfo[]> {
  const all = await getAllDevices();
  return all.filter((d) => d.state === "booted");
}

/**
 * Get the active device. Priority:
 * 1. Manually selected device (via set_device)
 * 2. Only booted device (if exactly one)
 * 3. null — caller should prompt user to choose
 */
export async function getActiveDevice(): Promise<DeviceInfo | null> {
  const booted = await getBootedDevices();

  // If a device was manually selected, find it
  if (selectedDeviceId) {
    const found = booted.find((d) => d.id === selectedDeviceId);
    if (found) return found;
    // Selected device no longer available — clear selection
    selectedDeviceId = null;
  }

  // Only one device booted — use it
  if (booted.length === 1) return booted[0];

  // Multiple or none — return null to trigger device selection
  return null;
}

/**
 * Find a device by ID from all available devices.
 */
export async function getDeviceById(id: string): Promise<DeviceInfo | null> {
  const all = await getAllDevices();
  return all.find((d) => d.id === id) ?? null;
}



/**
 * Format device list for display.
 */
export function formatDeviceList(devices: DeviceInfo[]): string {
  if (devices.length === 0) return "Aucun device disponible.";

  const lines: string[] = [];

  // Group by platform
  const ios = devices.filter((d) => d.platform === "ios");
  const android = devices.filter((d) => d.platform === "android");

  if (ios.length > 0) {
    lines.push("\n## iOS");
    for (const d of ios) {
      const icon = d.state === "booted" ? "🟢" : "⚪";
      const typeLabel = d.type === "device" ? " [real device]" : "";
      lines.push(`${icon} ${d.name}${typeLabel} — ${d.state} (${d.id})`);
    }
  }

  if (android.length > 0) {
    lines.push("\n## Android");
    for (const d of android) {
      const icon = "🟢"; // Android devices from ADB are always connected
      const typeLabel = d.type === "device" ? " [real device]" : " [emulator]";
      lines.push(`${icon} ${d.name}${typeLabel} (${d.id})`);
    }
  }

  return lines.join("\n");
}

/**
 * Build the "choose a device" prompt.
 * Works for both booted and available-but-shutdown devices.
 */
export function buildDeviceSelectionPrompt(devices: DeviceInfo[]): string {
  if (devices.length === 0) {
    return "Aucun device disponible. Installe un simulateur iOS (Xcode) ou un émulateur Android (Android Studio).";
  }

  const lines = [
    "Sur quel device veux-tu tester ? Utilise `set_device` avec l'ID :",
    "",
  ];

  const booted = devices.filter((d) => d.state === "booted");
  const shutdown = devices.filter((d) => d.state === "shutdown");

  if (booted.length > 0) {
    lines.push("**Actifs :**");
    for (const d of booted) {
      const platform = d.platform === "ios" ? "🍎" : "🤖";
      const typeLabel = d.type === "device" ? "real" : d.type;
      lines.push(`${platform} 🟢 **${d.name}** (${typeLabel}) → \`${d.id}\``);
    }
    lines.push("");
  }

  if (shutdown.length > 0) {
    // Show only iPhones (not iPads) to keep it clean
    const relevantShutdown = shutdown.filter((d) =>
      d.platform === "android" || d.name.includes("iPhone")
    );
    if (relevantShutdown.length > 0) {
      lines.push("**Disponibles (seront démarrés automatiquement) :**");
      for (const d of relevantShutdown) {
        const platform = d.platform === "ios" ? "🍎" : "🤖";
        const typeLabel = d.type === "device" ? "real" : d.type;
        lines.push(`${platform} ⚪ ${d.name} (${typeLabel}) → \`${d.id}\``);
      }
    }
  }

  return lines.join("\n");
}

/**
 * Get available Android AVDs (not yet booted).
 */
export async function getAvailableAvds(): Promise<DeviceInfo[]> {
  try {
    const avdNames = await listAvds();
    const running = await listAndroidDevices();
    const runningNames = new Set(running.map((d) => d.name.replace(/ /g, "_")));

    return avdNames
      .filter((name) => !runningNames.has(name))
      .map((name) => ({
        id: `avd:${name}`,
        name: name.replace(/_/g, " "),
        platform: "android" as const,
        type: "emulator" as const,
        state: "shutdown" as const,
      }));
  } catch (err) {
    console.error(`[phantom] Erreur listAvds: ${err instanceof Error ? err.message : err}`);
    return [];
  }
}

/**
 * Get all devices including shutdown ones — for the selection prompt.
 */
export async function getAllDevicesIncludingShutdown(): Promise<DeviceInfo[]> {
  const [all, avds] = await Promise.all([
    getAllDevices(),
    getAvailableAvds(),
  ]);
  return [...all, ...avds];
}
