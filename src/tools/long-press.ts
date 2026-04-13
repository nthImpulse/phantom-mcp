import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveDevice } from "../utils/device-manager.js";
import { ensureWdaRunning, iosLongPress } from "../platforms/ios/wda.js";
import { androidLongPress } from "../platforms/android/adb.js";
import { getElementByIndex, findElementByText } from "./ui-tree.js";
import { logAction } from "../utils/tool-wrapper.js";

export function registerLongPress(server: McpServer): void {
  server.tool(
    "long_press",
    "Appui long sur un élément de l'écran. Utile pour les menus contextuels, drag & drop, ou actions secondaires.",
    {
      index: z.number().optional().describe("Index de l'élément depuis get_ui_tree"),
      x: z.number().optional().describe("Coordonnée X"),
      y: z.number().optional().describe("Coordonnée Y"),
      text: z.string().optional().describe("Texte/label de l'élément"),
      duration: z.number().min(0.1).max(10).optional().default(1).describe("Durée de l'appui en secondes (défaut: 1, min: 0.1, max: 10)"),
    },
    async ({ index, x, y, text, duration }) => {
      const result = await resolveDevice();
      if ("error" in result) return { content: [{ type: "text", text: result.error }], isError: true };
      const dev = result.device;

      if (dev.platform === "ios") {
        const wda = await ensureWdaRunning(dev);
        if (!wda.ready) return { content: [{ type: "text", text: wda.message ?? "WDA indisponible." }], isError: true };
      }

      try {
        let tapX: number, tapY: number;
        let label = "";

        if (index !== undefined) {
          const cached = getElementByIndex(index, dev.id);
          if (!cached) return { content: [{ type: "text", text: `Index [${index}] non trouvé.` }], isError: true };
          tapX = cached.x + cached.width / 2;
          tapY = cached.y + cached.height / 2;
          label = cached.label || cached.name || "";
        } else if (x !== undefined && y !== undefined) {
          tapX = x;
          tapY = y;
        } else if (text) {
          const el = findElementByText(text, dev.id);
          if (!el) return { content: [{ type: "text", text: `Élément "${text}" non trouvé.` }], isError: true };
          tapX = el.x + el.width / 2;
          tapY = el.y + el.height / 2;
          label = text;
        } else {
          return { content: [{ type: "text", text: "Fournis index, x+y, ou text." }], isError: true };
        }

        if (dev.platform === "ios") {
          await iosLongPress(tapX, tapY, duration);
        } else {
          await androidLongPress(tapX, tapY, duration * 1000);
        }

        const successMsg = `Long press ${duration}s sur ${label ? `"${label}"` : `(${Math.round(tapX)}, ${Math.round(tapY)})`}`;
        logAction("long_press", successMsg, false, dev.platform, dev.id, dev.name);
        return { content: [{ type: "text", text: successMsg }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logAction("long_press", `Erreur: ${msg}`, true, dev.platform, dev.id, dev.name);
        return { content: [{ type: "text", text: `Erreur long_press: ${msg}` }], isError: true };
      }
    }
  );
}
