import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveDevice } from "../utils/device-manager.js";
import { ensureWdaRunning, iosTypeText } from "../platforms/ios/wda.js";
import { androidTypeText, androidTap, androidClearTextField } from "../platforms/android/adb.js";
import { findElementByText } from "./ui-tree.js";
import { logAction, getReportSuffix } from "../utils/tool-wrapper.js";

export function registerTypeText(server: McpServer): void {
  server.tool(
    "type_text",
    "Écrit du texte dans un champ. Fonctionne sur iOS et Android. Peut cibler un champ par son label/texte.",
    {
      text: z.string().describe("Le texte à taper"),
      element_text: z.string().optional().describe("Label ou texte du champ à cibler"),
      clear_first: z.boolean().optional().default(false).describe("Effacer le champ avant de taper"),
    },
    async ({ text, element_text, clear_first }) => {
      const result = await resolveDevice();
      if ("error" in result) return { content: [{ type: "text", text: result.error }], isError: true };
      const dev = result.device;

      try {
        if (dev.platform === "ios") {
          const wda = await ensureWdaRunning(dev);
          if (!wda.ready) return { content: [{ type: "text", text: wda.message ?? "WDA indisponible." }], isError: true };

          const success = await iosTypeText(text, element_text, clear_first, dev.id);
          if (!success) {
            return { content: [{ type: "text", text: `Champ "${element_text ?? "actif"}" non trouvé.` }], isError: true };
          }
        } else {
          // Android
          if (element_text) {
            const el = findElementByText(element_text, dev.id);
            if (!el) return { content: [{ type: "text", text: `Champ "${element_text}" non trouvé. Relance get_ui_tree.` }], isError: true };
            await androidTap(el.x + el.width / 2, el.y + el.height / 2);
            await new Promise((r) => setTimeout(r, 300));
          }

          if (clear_first) {
            await androidClearTextField();
            await new Promise((r) => setTimeout(r, 200));
          }

          const { warning } = await androidTypeText(text);
          if (warning) {
            return {
              content: [{ type: "text", text: `Texte tapé${element_text ? ` dans "${element_text}"` : ""}. ${warning}` }],
            };
          }
        }

        const successMsg = `Texte "${text}" tapé${element_text ? ` dans "${element_text}"` : ""}${clear_first ? " (effacé avant)" : ""}`;
        logAction("type_text", successMsg, false, dev.platform, dev.id, dev.name);
        return { content: [{ type: "text", text: successMsg + getReportSuffix() }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logAction("type_text", `Erreur: ${msg}`, true, dev.platform, dev.id, dev.name);
        return { content: [{ type: "text", text: `Erreur type_text: ${msg}` }], isError: true };
      }
    }
  );
}
