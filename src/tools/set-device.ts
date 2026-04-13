import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { setActiveDevice, getDeviceById, getAllDevicesIncludingShutdown, buildDeviceSelectionPrompt } from "../utils/device-manager.js";
import { bootSimulator } from "../platforms/ios/simctl.js";
import { bootEmulator, setAdbSerial } from "../platforms/android/adb.js";
import { resetWdaForDeviceSwitch } from "../platforms/ios/wda.js";
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

export function registerSetDevice(server: McpServer): void {
  server.tool(
    "set_device",
    "Sélectionne le device à utiliser pour cette session de test. Si le device est éteint, il sera démarré automatiquement. Appelle list_devices d'abord pour voir les IDs.",
    {
      device_id: z.string().describe("L'ID du device (UDID iOS, serial Android, ou avd:NomAVD)"),
    },
    async ({ device_id }) => {
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
          return {
            content: [{ type: "text", text: `Émulateur "${avdName}" démarré et sélectionné (${newDev.id}).\nTous les tools utiliseront ce device.` }],
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

      const platform = device.platform === "ios" ? "🍎" : "🤖";
      const bootMsg = device.state === "shutdown" ? " (démarré automatiquement)" : "";
      return {
        content: [{ type: "text", text: `${platform} Device sélectionné : **${device.name}**${bootMsg}\nTous les tools utiliseront ce device.` }],
      };
    }
  );
}
