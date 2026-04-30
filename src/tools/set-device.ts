import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { setActiveDevice, getDeviceById, getAllDevicesIncludingShutdown, buildDeviceSelectionPrompt } from "../utils/device-manager.js";
import { bootSimulator, iosClearClipboard, iosClearStatusBar, iosForceKeyboardQwerty } from "../platforms/ios/simctl.js";
import { bootEmulator, setAdbSerial, androidClearClipboard, androidDismissKeyboard } from "../platforms/android/adb.js";
import { ensureWdaRunning, resetWdaForDeviceSwitch, iosDismissKeyboard, iosIsKeyboardVisible } from "../platforms/ios/wda.js";
import type { DeviceInfo } from "../platforms/types.js";
import { clearElementCache } from "./ui-tree.js";

/**
 * Configure platform-specific state when a device is selected.
 * - Android: set ADB serial for `-s` targeting
 * - iOS: reset WDA session (may point to old device)
 * - Both: clear UI element cache (coordinates are device-specific)
 */
function configureForDevice(deviceId: string, platform: "ios" | "android"): void {
  if (platform === "android") {
    setAdbSerial(deviceId);
  } else {
    setAdbSerial(null); // Clear Android serial
    resetWdaForDeviceSwitch(); // Reset WDA session for new iOS device
  }
  clearElementCache(); // Cache has coordinates from old device
}

/**
 * Auto-prepare a freshly selected device into a clean state.
 * Same logic as the `prepare_device` tool but called inline so users get
 * predictable test sessions without an extra tool call.
 *
 * Best-effort: any individual step failure is non-fatal. The device is
 * still selected even if prepare partially fails.
 *
 * Returns a list of human-readable steps performed (for the response message).
 */
async function autoPrepareDevice(dev: DeviceInfo): Promise<string[]> {
  const steps: string[] = [];

  if (dev.platform === "ios") {
    try {
      await iosClearClipboard(dev.id);
      steps.push("clipboard cleared");
    } catch { /* non-fatal */ }

    try {
      await iosClearStatusBar(dev.id);
      steps.push("status bar cleared");
    } catch { /* non-fatal */ }

    try {
      await iosForceKeyboardQwerty(dev.id);
      steps.push("keyboard QWERTY enforced");
    } catch { /* non-fatal */ }

    // WDA-dependent step. If WDA isn't ready yet, we silently skip
    // (the user can call dismiss_keyboard later if needed).
    try {
      const wda = await ensureWdaRunning(dev);
      if (wda.ready && (await iosIsKeyboardVisible())) {
        await iosDismissKeyboard();
        steps.push("keyboard dismissed");
      }
    } catch { /* non-fatal */ }
  } else {
    try {
      await androidClearClipboard();
      steps.push("clipboard cleared");
    } catch { /* non-fatal */ }

    try {
      const dismissed = await androidDismissKeyboard();
      if (dismissed) steps.push("keyboard dismissed");
    } catch { /* non-fatal */ }
  }

  return steps;
}

export function registerSetDevice(server: McpServer): void {
  server.tool(
    "set_device",
    "Sélectionne le device à utiliser pour cette session de test. Si le device est éteint, il sera démarré automatiquement. Appelle list_devices d'abord pour voir les IDs. Auto-prépare le device (clear clipboard/status bar, dismiss keyboard, force QWERTY iOS) — opt-out via skip_setup=true.",
    {
      device_id: z.string().describe("L'ID du device (UDID iOS, serial Android, ou avd:NomAVD)"),
      skip_setup: z.boolean().optional().default(false).describe("Si true, ne pas auto-préparer le device (clipboard/status bar/keyboard). Default: false."),
    },
    async ({ device_id, skip_setup }) => {
      // Android AVD boot
      if (device_id.startsWith("avd:")) {
        const avdName = device_id.replace("avd:", "");
        try {
          const newDev = await bootEmulator(avdName);
          if (!newDev) {
            return { content: [{ type: "text", text: `Timeout — l'émulateur "${avdName}" n'a pas démarré en 60s.` }], isError: true };
          }
          setActiveDevice(newDev.id);
          configureForDevice(newDev.id, "android");

          let prepNote = "";
          if (!skip_setup) {
            const steps = await autoPrepareDevice(newDev);
            prepNote = steps.length > 0 ? `\nAuto-prepare : ${steps.join(", ")}.` : "";
          }

          return {
            content: [{ type: "text", text: `Émulateur "${avdName}" démarré et sélectionné (${newDev.id}).\nTous les tools utiliseront ce device.${prepNote}` }],
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { content: [{ type: "text", text: `Erreur démarrage émulateur: ${msg}` }], isError: true };
        }
      }

      // Find device in all available (booted + shutdown)
      const device = await getDeviceById(device_id);
      if (!device) {
        const all = await getAllDevicesIncludingShutdown();
        return {
          content: [{ type: "text", text: `Device "${device_id}" non trouvé.\n\n${buildDeviceSelectionPrompt(all)}` }],
          isError: true,
        };
      }

      // Boot shutdown iOS simulator
      if (device.state === "shutdown" && device.platform === "ios") {
        console.error(`[phantom] Booting simulator: ${device.name}`);
        try {
          await bootSimulator(device.id);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { content: [{ type: "text", text: `Erreur boot simulateur: ${msg}` }], isError: true };
        }
      }

      setActiveDevice(device.id);
      configureForDevice(device.id, device.platform);

      let prepNote = "";
      if (!skip_setup) {
        const steps = await autoPrepareDevice(device);
        prepNote = steps.length > 0 ? `\nAuto-prepare : ${steps.join(", ")}.` : "";
      }

      const platform = device.platform === "ios" ? "🍎" : "🤖";
      const bootMsg = device.state === "shutdown" ? " (démarré automatiquement)" : "";
      return {
        content: [{ type: "text", text: `${platform} Device sélectionné : **${device.name}**${bootMsg}\nTous les tools utiliseront ce device.${prepNote}` }],
      };
    }
  );
}
