import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveDevice } from "../utils/device-manager.js";
import { prepareDevice } from "../utils/device-prepare.js";
import { logAction, getReportSuffix } from "../utils/tool-wrapper.js";

/**
 * `prepare_device` — Brings the active device into a clean, predictable state
 * before running tests. Aimed at making test sessions more reproducible and
 * less prone to false negatives caused by leftover state.
 *
 * What it does (all opt-out via flags):
 *   • dismiss the soft keyboard if it's visible (no-op otherwise)
 *   • clear the device clipboard (avoids stale text being pasted)
 *   • clear status bar overrides (avoids stale time/network spoofing) — iOS only
 *   • force keyboard layout to QWERTY on iOS (safety net for AZERTY locales)
 *
 * Each step is best-effort: a failure on one step doesn't prevent the others.
 *
 * This tool is also auto-called by `set_device` on the first selection of a
 * device in the session, unless `skip_setup: true` is passed.
 */
export function registerPrepareDevice(server: McpServer): void {
  server.tool(
    "prepare_device",
    "Prépare le device actif pour une session de test propre : dismiss keyboard, clear clipboard, reset status bar overrides, force keyboard QWERTY (iOS). Tout est opt-out via flags. Auto-appelé par set_device sauf si skip_setup=true.",
    {
      dismiss_keyboard: z.boolean().optional().default(true).describe("Dismiss le clavier s'il est visible (default: true)"),
      clear_clipboard: z.boolean().optional().default(true).describe("Vide le clipboard du device (default: true)"),
      clear_status_bar: z.boolean().optional().default(true).describe("Reset les overrides de status bar iOS (default: true)"),
      force_qwerty: z.boolean().optional().default(true).describe("Force keyboard QWERTY sur iOS, sécurité contre AZERTY (default: true)"),
    },
    async ({ dismiss_keyboard, clear_clipboard, clear_status_bar, force_qwerty }) => {
      const result = await resolveDevice();
      if ("error" in result) return { content: [{ type: "text", text: result.error }], isError: true };
      const dev = result.device;

      try {
        const { steps, failures } = await prepareDevice(dev, {
          dismissKeyboard: dismiss_keyboard,
          clearClipboard: clear_clipboard,
          clearStatusBar: clear_status_bar,
          forceQwerty: force_qwerty,
          // Explicit prepare_device call: do the full job, including waking WDA
          skipKeyboardIfWdaNotReady: false,
        });

        const platform = dev.platform === "ios" ? "🍎" : "🤖";
        const summary = steps.length > 0 ? `\n  • ${steps.join("\n  • ")}` : " (no actions)";
        const failureSummary = failures.length > 0 ? `\n\n⚠️ Non-fatal failures:\n  • ${failures.join("\n  • ")}` : "";
        const msg = `${platform} Device prepared : **${dev.name}**${summary}${failureSummary}`;
        logAction("prepare_device", msg, false, dev.platform, dev.id, dev.name);
        return { content: [{ type: "text", text: msg + getReportSuffix() }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logAction("prepare_device", `Erreur: ${msg}`, true, dev.platform, dev.id, dev.name);
        return { content: [{ type: "text", text: `Erreur prepare_device: ${msg}` }], isError: true };
      }
    }
  );
}
