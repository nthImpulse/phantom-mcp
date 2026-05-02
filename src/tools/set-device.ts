import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { setActiveDevice, getDeviceById, getAllDevicesIncludingShutdown, buildDeviceSelectionPrompt } from "../utils/device-manager.js";
import { bootSimulator } from "../platforms/ios/simctl.js";
import { bootEmulator, setAdbSerial } from "../platforms/android/adb.js";
import { resetWdaForDeviceSwitch } from "../platforms/ios/wda.js";
import { prepareDevice } from "../utils/device-prepare.js";
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
 * Auto-prepare on set_device. Uses the shared `prepareDevice()` helper to
 * guarantee a single source of truth with the explicit `prepare_device` tool.
 *
 * Notable difference: on iOS we set `skipKeyboardIfWdaNotReady: true` so we
 * don't block the device-selection flow waiting up to 120s for WDA to come
 * up. Users who specifically want the keyboard dismissed before WDA is ready
 * can call `prepare_device` explicitly afterwards.
 */
async function autoPrepareDevice(dev: DeviceInfo): Promise<string[]> {
  const { steps } = await prepareDevice(dev, {
    skipKeyboardIfWdaNotReady: true,
  });
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
