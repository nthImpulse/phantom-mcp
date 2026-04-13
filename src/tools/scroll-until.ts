import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveDevice } from "../utils/device-manager.js";
import { ensureWdaRunning, iosGetUiTree, iosSwipe, iosGetScreenSize } from "../platforms/ios/wda.js";
import { androidGetUiTree, androidSwipe, androidGetScreenSize } from "../platforms/android/adb.js";
import { matchElementByText } from "./ui-tree.js";
import { logAction } from "../utils/tool-wrapper.js";

export function registerScrollUntilVisible(server: McpServer): void {
  server.tool(
    "scroll_until_visible",
    "Scroll vers le bas (ou la direction choisie) jusqu'à trouver un élément contenant le texte donné. Retourne l'élément trouvé ou une erreur après max_scrolls.",
    {
      text: z.string().describe("Texte de l'élément à trouver"),
      direction: z.enum(["up", "down"]).optional().default("down").describe("Direction du scroll (défaut: down)"),
      max_scrolls: z.number().min(1).max(100).optional().default(10).describe("Nombre max de scrolls (défaut: 10, max: 100)"),
    },
    async ({ text, direction, max_scrolls }) => {
      const result = await resolveDevice();
      if ("error" in result) return { content: [{ type: "text", text: result.error }], isError: true };
      const dev = result.device;

      if (dev.platform === "ios") {
        const wda = await ensureWdaRunning(dev);
        if (!wda.ready) return { content: [{ type: "text", text: wda.message ?? "WDA indisponible." }], isError: true };
      }

      for (let i = 0; i < max_scrolls; i++) {
        const elements = dev.platform === "ios"
          ? await iosGetUiTree()
          : await androidGetUiTree();

        const found = matchElementByText(elements, text);

        if (found) {
          const displayText = found.label || found.name || found.value || "";
          const msg = `Élément trouvé après ${i} scroll(s) : ${found.type} "${displayText}" à (${found.x},${found.y} ${found.width}x${found.height})`;
          logAction("scroll_until_visible", msg, false, dev.platform, dev.id, dev.name);
          return { content: [{ type: "text", text: msg }] };
        }

        // Scroll
        let w: number, h: number;
        if (dev.platform === "ios") {
          ({ width: w, height: h } = await iosGetScreenSize());
        } else {
          ({ width: w, height: h } = await androidGetScreenSize());
        }

        const cx = w / 2;
        const fromY = direction === "down" ? h * 0.75 : h * 0.25;
        const toY = direction === "down" ? h * 0.25 : h * 0.75;

        if (dev.platform === "ios") await iosSwipe(cx, fromY, cx, toY);
        else await androidSwipe(cx, fromY, cx, toY);

        await new Promise((r) => setTimeout(r, 500));
      }

      const failMsg = `"${text}" non trouvé après ${max_scrolls} scrolls.`;
      logAction("scroll_until_visible", failMsg, true, dev.platform, dev.id, dev.name);
      return { content: [{ type: "text", text: failMsg }], isError: true };
    }
  );
}
