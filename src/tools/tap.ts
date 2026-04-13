import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveDevice } from "../utils/device-manager.js";
import { ensureWdaRunning, iosTap, iosTapByText } from "../platforms/ios/wda.js";
import { androidTap } from "../platforms/android/adb.js";
import { getElementByIndex, findElementByText } from "./ui-tree.js";
import { logAction, getReportSuffix } from "../utils/tool-wrapper.js";

export function registerTap(server: McpServer): void {
  server.tool(
    "tap",
    "Tape sur un élément de l'écran. Fonctionne sur iOS et Android. Utilise index (du get_ui_tree), coordonnées (x,y), ou texte.",
    {
      index: z.number().optional().describe("Index de l'élément depuis get_ui_tree"),
      x: z.number().optional().describe("Coordonnée X pour tap direct"),
      y: z.number().optional().describe("Coordonnée Y pour tap direct"),
      text: z.string().optional().describe("Texte/label de l'élément à taper"),
    },
    async ({ index, x, y, text }) => {
      const result = await resolveDevice();
      if ("error" in result) return { content: [{ type: "text", text: result.error }], isError: true };
      const dev = result.device;

      if (dev.platform === "ios") {
        const wda = await ensureWdaRunning(dev);
        if (!wda.ready) return { content: [{ type: "text", text: wda.message ?? "WDA indisponible." }], isError: true };
      }

      try {
        let msg: string;

        if (index !== undefined) {
          const cached = getElementByIndex(index, dev.id);
          if (!cached) return { content: [{ type: "text", text: `Index [${index}] non trouvé. Relance get_ui_tree.` }], isError: true };
          const tapX = cached.x + cached.width / 2;
          const tapY = cached.y + cached.height / 2;
          if (dev.platform === "ios") await iosTap(tapX, tapY);
          else await androidTap(tapX, tapY);
          msg = `Tap sur [${index}] "${cached.label || cached.name || ""}" à (${Math.round(tapX)}, ${Math.round(tapY)})`;
        } else if (x !== undefined && y !== undefined) {
          if (dev.platform === "ios") await iosTap(x, y);
          else await androidTap(x, y);
          msg = `Tap à (${x}, ${y})`;
        } else if (text) {
          if (dev.platform === "ios") {
            const found = await iosTapByText(text);
            if (!found) return { content: [{ type: "text", text: `Élément "${text}" non trouvé sur iOS.` }], isError: true };
          } else {
            const el = findElementByText(text, dev.id);
            if (!el) return { content: [{ type: "text", text: `Élément "${text}" non trouvé. Relance get_ui_tree.` }], isError: true };
            await androidTap(el.x + el.width / 2, el.y + el.height / 2);
          }
          msg = `Tap sur "${text}"`;
        } else {
          return { content: [{ type: "text", text: "Fournis index, x+y, ou text." }], isError: true };
        }

        logAction("tap", msg, false, dev.platform, dev.id, dev.name);
        return { content: [{ type: "text", text: msg + getReportSuffix() }] };
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logAction("tap", `Erreur: ${errMsg}`, true, dev.platform, dev.id, dev.name);
        return { content: [{ type: "text", text: `Erreur tap: ${errMsg}` }], isError: true };
      }
    }
  );
}
