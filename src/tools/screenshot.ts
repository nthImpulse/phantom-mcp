import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveDevice } from "../utils/device-manager.js";
import { takeScreenshot } from "../utils/screenshot.js";
import { logAction } from "../utils/tool-wrapper.js";

export function registerScreenshot(server: McpServer): void {
  server.tool(
    "screenshot",
    "Prend un screenshot du device actif (iOS ou Android) et le retourne comme image.",
    {},
    async () => {
      const result = await resolveDevice();
      if ("error" in result) return { content: [{ type: "text", text: result.error }], isError: true };
      const dev = result.device;

      try {
        const buffer = await takeScreenshot(dev.platform, dev.id);

        logAction("screenshot", "Screenshot pris", false, dev.platform, dev.id, dev.name);
        return {
          content: [{ type: "image", data: buffer.toString("base64"), mimeType: "image/png" }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Erreur screenshot: ${msg}` }], isError: true };
      }
    }
  );
}
