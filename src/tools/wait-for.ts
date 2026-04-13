import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveDevice } from "../utils/device-manager.js";
import { ensureWdaRunning, iosGetUiTree } from "../platforms/ios/wda.js";
import { androidGetUiTree } from "../platforms/android/adb.js";
import { matchElementByText } from "./ui-tree.js";
import { logAction } from "../utils/tool-wrapper.js";

export function registerWaitForElement(server: McpServer): void {
  server.tool(
    "wait_for_element",
    "Attend qu'un élément apparaisse à l'écran (utile après navigation ou chargement). Retourne l'élément trouvé ou une erreur après timeout.",
    {
      text: z.string().describe("Texte, label ou nom de l'élément à attendre"),
      timeout: z.number().min(1).max(120).optional().default(10).describe("Timeout en secondes (défaut: 10, max: 120)"),
      interval: z.number().min(0.5).max(30).optional().default(1).describe("Intervalle en secondes (défaut: 1, max: 30)"),
    },
    async ({ text, timeout, interval }) => {
      const result = await resolveDevice();
      if ("error" in result) return { content: [{ type: "text", text: result.error }], isError: true };
      const dev = result.device;

      if (dev.platform === "ios") {
        const wda = await ensureWdaRunning(dev);
        if (!wda.ready) return { content: [{ type: "text", text: wda.message ?? "WDA indisponible." }], isError: true };
      }

      const start = Date.now();
      const timeoutMs = timeout * 1000;
      const intervalMs = interval * 1000;

      while (Date.now() - start < timeoutMs) {
        try {
          const elements = dev.platform === "ios"
            ? await iosGetUiTree()
            : await androidGetUiTree();

          const found = matchElementByText(elements, text);

          if (found) {
            const elapsed = ((Date.now() - start) / 1000).toFixed(1);
            const displayText = found.label || found.name || found.value || "";
            const msg = `Élément trouvé après ${elapsed}s : ${found.type} "${displayText}" à (${found.x},${found.y} ${found.width}x${found.height})`;
            logAction("wait_for_element", msg, false, dev.platform, dev.id, dev.name);
            return { content: [{ type: "text", text: msg }] };
          }
        } catch (err) {
          console.error(`[phantom] wait_for: UI tree fetch failed, retrying: ${err instanceof Error ? err.message : err}`);
        }

        await new Promise((r) => setTimeout(r, intervalMs));
      }

      // Timeout — show what's visible
      try {
        const elements = dev.platform === "ios"
          ? await iosGetUiTree()
          : await androidGetUiTree();

        const visibleLabels = elements
          .map((el) => el.label || el.value || el.name || "")
          .filter((l) => l.length > 0)
          .slice(0, 15);

        return {
          content: [{
            type: "text",
            text: `Timeout (${timeout}s) — "${text}" non trouvé.\n\nÉléments visibles :\n${visibleLabels.map((l) => `• ${l}`).join("\n")}`,
          }],
          isError: true,
        };
      } catch (err) {
        console.error(`[phantom] wait_for: final UI tree fetch failed: ${err instanceof Error ? err.message : err}`);
        return {
          content: [{ type: "text", text: `Timeout (${timeout}s) — "${text}" non trouvé.` }],
          isError: true,
        };
      }
    }
  );
}
