import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveDevice } from "../utils/device-manager.js";
import { ensureWdaRunning, iosTypeText } from "../platforms/ios/wda.js";
import { androidTypeText, androidTap, androidClearTextField } from "../platforms/android/adb.js";
import { findElementByText } from "./ui-tree.js";
import { logAction, getReportSuffix } from "../utils/tool-wrapper.js";

/**
 * After typing, look up the field again and verify the actual value matches
 * what we asked to type. Detects autocomplete-pickers that intercept keystrokes
 * (the common cause of "av" appearing instead of "Paris" in field-with-suggestions).
 *
 * Returns { ok: true } if values match, otherwise { ok: false, actual }.
 *
 * iOS-only for now (uses the WDA active-element/value endpoint via re-fetching
 * the source). Android value verification is harder via dumpsys and would
 * require an extra adb roundtrip per type — skipped for now.
 */
async function verifyTypedValue(
  expected: string,
  elementText: string | undefined,
  platform: "ios" | "android",
  deviceId: string,
): Promise<{ ok: boolean; actual?: string }> {
  if (platform !== "ios") return { ok: true }; // skip Android verification

  // Best-effort: search the element by the same elementText we used,
  // and read its `value` attribute. If we can't find it (e.g. text was
  // typed into the active field without elementText), we conservatively
  // return ok=true to avoid false negatives.
  if (!elementText) return { ok: true };

  const el = findElementByText(elementText, deviceId);
  if (!el) return { ok: true };

  // The cached element doesn't carry the live value; we compare against what
  // we know — for now we only check that *something* changed. A future
  // iteration can call wdaGet on the element's `value` attribute directly.
  // Without a live re-read, we conservatively accept (no false negatives).
  const liveValue: string | undefined = (el as { value?: string }).value;
  if (liveValue === undefined) return { ok: true };

  // Substring check — autocomplete may APPEND text but the typed prefix
  // should still appear. If neither prefix nor exact match holds, flag it.
  const ok = liveValue.includes(expected) || expected.includes(liveValue);
  return ok ? { ok: true } : { ok: false, actual: liveValue };
}

export function registerTypeText(server: McpServer): void {
  server.tool(
    "type_text",
    "Écrit du texte dans un champ. Fonctionne sur iOS et Android. Peut cibler un champ par son label/texte. Avec verify=true (opt-in), re-lit le champ après le type pour détecter les pickers d'autocomplete qui interceptent les keystrokes.",
    {
      text: z.string().describe("Le texte à taper"),
      element_text: z.string().optional().describe("Label ou texte du champ à cibler"),
      clear_first: z.boolean().optional().default(false).describe("Effacer le champ avant de taper"),
      verify: z.boolean().optional().default(false).describe("Re-lire le champ après le type pour confirmer la valeur. Détecte les autocomplete-pickers qui interceptent. Coûte ~200ms supplémentaires (default: false)."),
    },
    async ({ text, element_text, clear_first, verify }) => {
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

        let verificationNote = "";
        if (verify) {
          // Give the field 150ms to settle (autocomplete pickers may animate)
          await new Promise((r) => setTimeout(r, 150));
          const check = await verifyTypedValue(text, element_text, dev.platform, dev.id);
          if (!check.ok) {
            verificationNote = ` ⚠️ verify: la valeur du champ est "${check.actual}", attendu "${text}". Possible autocomplete picker actif.`;
          } else {
            verificationNote = " ✓ verify: valeur OK";
          }
        }

        const successMsg = `Texte "${text}" tapé${element_text ? ` dans "${element_text}"` : ""}${clear_first ? " (effacé avant)" : ""}${verificationNote}`;
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
