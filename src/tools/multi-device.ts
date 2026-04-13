import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getDeviceById } from "../utils/device-manager.js";
import { setAdbSerial, getCurrentAdbSerial, androidScreenshot, androidGetUiTree, androidLaunchApp, androidKillApp } from "../platforms/android/adb.js";
import { iosScreenshot, iosLaunchApp, iosKillApp } from "../platforms/ios/simctl.js";
import { ensureWdaRunning, iosGetUiTree } from "../platforms/ios/wda.js";
import type { DeviceInfo } from "../platforms/types.js";

export function registerMultiDevice(server: McpServer): void {
  server.tool(
    "multi_device",
    "Execute la meme action sur plusieurs devices et retourne les resultats combines. Utile pour tester sur iOS + Android en une seule commande.",
    {
      device_ids: z.array(z.string()).min(1).describe("Liste des device IDs a cibler"),
      action: z.enum(["screenshot", "get_ui_tree", "launch_app", "kill_app"]).describe("Action a executer sur chaque device"),
      bundle_id: z.string().optional().describe("Bundle ID / package name (requis pour launch_app/kill_app)"),
    },
    async ({ device_ids, action, bundle_id }) => {
      // Validate bundle_id for app actions
      if ((action === "launch_app" || action === "kill_app") && !bundle_id) {
        return { content: [{ type: "text", text: `Le parametre bundle_id est requis pour ${action}.` }], isError: true };
      }

      // Save current state to restore later
      const savedSerial = getCurrentAdbSerial();

      // Resolve all devices
      const devices: Array<{ device: DeviceInfo; error?: string }> = [];
      for (const id of device_ids) {
        const dev = await getDeviceById(id);
        if (!dev) {
          devices.push({ device: { id, name: id, platform: "ios", type: "simulator", state: "shutdown" }, error: `Device "${id}" non trouve` });
        } else if (dev.state !== "booted") {
          devices.push({ device: dev, error: `Device "${dev.name}" n'est pas demarre` });
        } else {
          devices.push({ device: dev });
        }
      }

      const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [];
      let hasError = false;

      try {
        // Execute sequentially (ADB serial and WDA are singletons)
        for (let i = 0; i < devices.length; i++) {
          const { device: dev, error } = devices[i];
          const platform = dev.platform === "ios" ? "🍎" : "🤖";
          const header = `[${i + 1}/${devices.length}] ${platform} ${dev.name}`;

          if (error) {
            content.push({ type: "text", text: `${header}\n  ERREUR : ${error}\n` });
            hasError = true;
            continue;
          }

          try {
            if (dev.platform === "android") setAdbSerial(dev.id);

            switch (action) {
              case "screenshot": {
                const buffer = dev.platform === "ios"
                  ? await iosScreenshot(dev.id)
                  : await androidScreenshot();
                content.push({ type: "text", text: `${header} — screenshot :` });
                content.push({ type: "image", data: buffer.toString("base64"), mimeType: "image/png" });
                break;
              }

              case "get_ui_tree": {
                let elements;
                if (dev.platform === "ios") {
                  const wda = await ensureWdaRunning(dev);
                  if (!wda.ready) throw new Error(wda.message ?? "WDA indisponible");
                  elements = await iosGetUiTree();
                } else {
                  elements = await androidGetUiTree();
                }
                const lines = elements.map((el, idx) => {
                  const text = el.label || el.name || "";
                  return `  [${idx}] ${el.type} "${text}" (${el.x},${el.y} ${el.width}x${el.height})`;
                });
                content.push({ type: "text", text: `${header} — ${elements.length} elements :\n${lines.join("\n")}\n` });
                break;
              }

              case "launch_app": {
                if (dev.platform === "ios") await iosLaunchApp(dev.id, bundle_id!);
                else await androidLaunchApp(bundle_id!);
                content.push({ type: "text", text: `${header} — ${bundle_id} lance\n` });
                break;
              }

              case "kill_app": {
                if (dev.platform === "ios") await iosKillApp(dev.id, bundle_id!);
                else await androidKillApp(bundle_id!);
                content.push({ type: "text", text: `${header} — ${bundle_id} ferme\n` });
                break;
              }
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            content.push({ type: "text", text: `${header}\n  ERREUR : ${msg}\n` });
            hasError = true;
          }
        }
      } finally {
        // Always restore original ADB serial, even on unexpected errors
        setAdbSerial(savedSerial);
      }

      return { content, isError: hasError };
    }
  );
}
