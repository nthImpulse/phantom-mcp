import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveDevice } from "../utils/device-manager.js";
import { ensureWdaRunning, iosGetUiTree } from "../platforms/ios/wda.js";
import { androidGetUiTree } from "../platforms/android/adb.js";
import { matchElementByText } from "./ui-tree.js";
import { logAction, getReportSuffix } from "../utils/tool-wrapper.js";

export function registerAssertVisible(server: McpServer): void {
  server.tool(
    "assert_visible",
    "Vérifie qu'un élément contenant le texte donné est visible à l'écran. Retourne OK ou FAIL avec les éléments actuellement visibles.",
    {
      text: z.string().describe("Texte attendu à l'écran"),
    },
    async ({ text }) => {
      const result = await resolveDevice();
      if ("error" in result) return { content: [{ type: "text", text: result.error }], isError: true };
      const dev = result.device;

      if (dev.platform === "ios") {
        const wda = await ensureWdaRunning(dev);
        if (!wda.ready) return { content: [{ type: "text", text: wda.message ?? "WDA indisponible." }], isError: true };
      }

      try {
        const elements = dev.platform === "ios"
          ? await iosGetUiTree()
          : await androidGetUiTree();

        const found = matchElementByText(elements, text);

        if (found) {
          const displayText = found.label || found.name || found.value || "";
          const msg = `PASS — "${text}" trouvé : ${found.type} "${displayText}" à (${found.x},${found.y})`;
          logAction("assert_visible", msg, false, dev.platform, dev.id, dev.name);
          return { content: [{ type: "text", text: msg + getReportSuffix() }] };
        }

        const visibleLabels = elements
          .map((el) => el.label || el.value || el.name || "")
          .filter((l) => l.length > 0)
          .slice(0, 15);

        const failMsg = `FAIL — "${text}" non trouvé.`;
        logAction("assert_visible", failMsg, true, dev.platform, dev.id, dev.name);
        return {
          content: [{
            type: "text",
            text: `${failMsg}\n\nÉléments visibles :\n${visibleLabels.map((l) => `• ${l}`).join("\n")}`,
          }],
          isError: true,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Erreur assert: ${msg}` }], isError: true };
      }
    }
  );
}

export function registerAssertNotVisible(server: McpServer): void {
  server.tool(
    "assert_not_visible",
    "Vérifie qu'un élément contenant le texte donné n'est PAS visible à l'écran.",
    {
      text: z.string().describe("Texte qui ne doit PAS être à l'écran"),
    },
    async ({ text }) => {
      const result = await resolveDevice();
      if ("error" in result) return { content: [{ type: "text", text: result.error }], isError: true };
      const dev = result.device;

      if (dev.platform === "ios") {
        const wda = await ensureWdaRunning(dev);
        if (!wda.ready) return { content: [{ type: "text", text: wda.message ?? "WDA indisponible." }], isError: true };
      }

      try {
        const elements = dev.platform === "ios"
          ? await iosGetUiTree()
          : await androidGetUiTree();

        const found = matchElementByText(elements, text);

        if (!found) {
          const passMsg = `PASS — "${text}" n'est pas visible (attendu).`;
          logAction("assert_not_visible", passMsg, false, dev.platform, dev.id, dev.name);
          return { content: [{ type: "text", text: passMsg }] };
        }

        const displayText = found.label || found.name || found.value || "";
        const failMsg = `FAIL — "${text}" est visible : ${found.type} "${displayText}" à (${found.x},${found.y}). Il ne devrait pas l'être.`;
        logAction("assert_not_visible", failMsg, true, dev.platform, dev.id, dev.name);
        return {
          content: [{ type: "text", text: failMsg }],
          isError: true,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Erreur assert: ${msg}` }], isError: true };
      }
    }
  );
}
