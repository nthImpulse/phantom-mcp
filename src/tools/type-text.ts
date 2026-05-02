import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveDevice } from "../utils/device-manager.js";
import { ensureWdaRunning, iosTypeText, iosReadElementValue } from "../platforms/ios/wda.js";
import { androidTypeText, androidTap, androidClearTextField } from "../platforms/android/adb.js";
import { findElementByText } from "./ui-tree.js";
import { logAction, getReportSuffix } from "../utils/tool-wrapper.js";

/**
 * Result of a typed-value verification.
 *
 * - `ok: true` means we have a confirmed match (or we couldn't verify and
 *   chose not to flag — `skipped` will be true in that case).
 * - `ok: false` means we have evidence the typed text is NOT in the field.
 *
 * `actual` carries the live value when we got one and it didn't match.
 * `skipped` indicates verification was not actually performed (no element
 * text was provided, platform unsupported, or the field couldn't be re-read).
 */
async function verifyTypedValue(
  expected: string,
  elementText: string | undefined,
  platform: "ios" | "android",
  deviceId: string,
): Promise<{ ok: boolean; actual?: string; skipped?: boolean; reason?: string }> {
  // Verification needs an element selector to re-read after typing
  if (!elementText) return { ok: true, skipped: true, reason: "no element_text provided" };

  if (platform === "ios") {
    // Live re-read via WDA — fetches the actual `value` attribute, not cache.
    const liveValue = await iosReadElementValue(elementText);
    if (liveValue === null) {
      return { ok: true, skipped: true, reason: "element not found or no value attribute" };
    }
    // Substring check — an autocomplete picker may APPEND text (e.g. user typed
    // "Par", picker filled "Paris, France"). The typed text should still be
    // present as a substring. We also accept the inverse (live value is shorter
    // than expected, meaning the picker truncated — also a flagging case if it
    // diverges, so we strictly check inclusion of expected in live).
    const ok = liveValue.includes(expected);
    return ok ? { ok: true, actual: liveValue } : { ok: false, actual: liveValue };
  }

  // Android: best-effort fallback via the cached UI tree. The value is rarely
  // populated for EditText elements in dumpsys (it lives in the IME), so most
  // calls will return skipped. A future iteration could use
  // `adb shell uiautomator dump` then re-parse to fetch live state.
  const el = findElementByText(elementText, deviceId);
  if (!el) return { ok: true, skipped: true, reason: "element not found in cache" };
  const cached = (el as { value?: string }).value;
  if (cached === undefined) return { ok: true, skipped: true, reason: "android live value unavailable" };
  const ok = cached.includes(expected);
  return ok ? { ok: true, actual: cached } : { ok: false, actual: cached };
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
            verificationNote = ` ⚠️ verify: la valeur du champ est "${check.actual}", attendu "${text}". Possible autocomplete picker actif ou focus perdu.`;
          } else if (check.skipped) {
            verificationNote = ` ℹ️ verify: skippé (${check.reason}).`;
          } else {
            verificationNote = ` ✓ verify: "${check.actual}" contient "${text}".`;
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
