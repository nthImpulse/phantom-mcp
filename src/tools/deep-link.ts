import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveDevice } from "../utils/device-manager.js";
import { iosOpenUrl } from "../platforms/ios/simctl.js";
import { androidOpenUrl } from "../platforms/android/adb.js";
import { logAction } from "../utils/tool-wrapper.js";

const URL_REGEX = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/\S+$/;

function validateUrl(url: string): void {
  if (url.length > 2048) throw new Error("URL trop longue (max 2048 caractères).");
  if (/[\x00-\x1F\x7F]/.test(url)) throw new Error("URL contient des caractères de contrôle invalides.");
  if (!URL_REGEX.test(url)) throw new Error(`URL invalide : "${url}". Format attendu : scheme://path (ex: https://example.com, myapp://home)`);
}

export function registerDeepLink(server: McpServer): void {
  server.tool(
    "deep_link",
    "Ouvre une URL ou un deep link dans l'app (ex: myapp://profile, https://example.com). Fonctionne sur iOS et Android.",
    {
      url: z.string().describe("URL ou deep link à ouvrir (ex: myapp://home, https://example.com/page)"),
    },
    async ({ url }) => {
      const result = await resolveDevice();
      if ("error" in result) return { content: [{ type: "text", text: result.error }], isError: true };
      const dev = result.device;

      try {
        validateUrl(url);

        if (dev.platform === "ios") {
          await iosOpenUrl(dev.id, url);
        } else {
          await androidOpenUrl(url);
        }

        const platform = dev.platform === "ios" ? "🍎" : "🤖";
        const successMsg = `${platform} URL ouverte : ${url}`;
        logAction("deep_link", successMsg, false, dev.platform, dev.id, dev.name);
        return { content: [{ type: "text", text: successMsg }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logAction("deep_link", `Erreur: ${msg}`, true, dev.platform, dev.id, dev.name);
        return { content: [{ type: "text", text: `Erreur deep_link: ${msg}` }], isError: true };
      }
    }
  );
}
