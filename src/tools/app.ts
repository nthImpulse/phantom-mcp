import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveDevice } from "../utils/device-manager.js";
import { iosLaunchApp, iosKillApp } from "../platforms/ios/simctl.js";
import { androidLaunchApp, androidKillApp } from "../platforms/android/adb.js";
import { logAction } from "../utils/tool-wrapper.js";

export function registerLaunchApp(server: McpServer): void {
  server.tool(
    "launch_app",
    "Lance une app sur le device actif. iOS : bundle ID (ex: com.monapp.ios). Android : package name (ex: com.monapp.android).",
    {
      bundle_id: z.string().describe("Bundle ID (iOS) ou package name (Android)"),
    },
    async ({ bundle_id }) => {
      const result = await resolveDevice();
      if ("error" in result) return { content: [{ type: "text", text: result.error }], isError: true };
      const dev = result.device;

      try {
        if (dev.platform === "ios") await iosLaunchApp(dev.id, bundle_id);
        else await androidLaunchApp(bundle_id);

        const platform = dev.platform === "ios" ? "🍎" : "🤖";
        const successMsg = `${platform} App lancée : ${bundle_id} sur ${dev.name}`;
        logAction("launch_app", successMsg, false, dev.platform, dev.id, dev.name);
        return { content: [{ type: "text", text: successMsg }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logAction("launch_app", `Erreur: ${msg}`, true, dev.platform, dev.id, dev.name);
        return { content: [{ type: "text", text: `Erreur launch_app: ${msg}` }], isError: true };
      }
    }
  );
}

export function registerKillApp(server: McpServer): void {
  server.tool(
    "kill_app",
    "Ferme une app sur le device actif.",
    {
      bundle_id: z.string().describe("Bundle ID (iOS) ou package name (Android)"),
    },
    async ({ bundle_id }) => {
      const killResult = await resolveDevice();
      if ("error" in killResult) return { content: [{ type: "text", text: killResult.error }], isError: true };
      const dev = killResult.device;

      try {
        if (dev.platform === "ios") await iosKillApp(dev.id, bundle_id);
        else await androidKillApp(bundle_id);

        logAction("kill_app", `App fermée : ${bundle_id}`, false, dev.platform, dev.id, dev.name);
        return { content: [{ type: "text", text: `App fermée : ${bundle_id}` }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Erreur kill_app: ${msg}` }], isError: true };
      }
    }
  );
}
