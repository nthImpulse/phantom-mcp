import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveDevice } from "../utils/device-manager.js";
import { ensureWdaRunning, iosDismissKeyboard, iosIsKeyboardVisible } from "../platforms/ios/wda.js";
import { androidDismissKeyboard, androidIsKeyboardVisible } from "../platforms/android/adb.js";
import { logAction, getReportSuffix } from "../utils/tool-wrapper.js";

/**
 * `dismiss_keyboard` — Force-dismiss the soft keyboard on the active device.
 *
 * iOS: detects if a keyboard is visible (XCUIElementTypeKeyboard), then taps
 * outside it to dismiss. No-op if no keyboard is visible.
 *
 * Android: uses `dumpsys input_method` to check `mInputShown`, then sends
 * KEYCODE_ESCAPE first (cleaner than BACK), with KEYCODE_BACK as a fallback.
 *
 * Use this when:
 *   • A textfield was just typed into and the keyboard is now blocking buttons
 *   • Before a tap that should land below the keyboard region
 *   • As a defensive call before screenshots so the keyboard doesn't pollute
 */
export function registerDismissKeyboard(server: McpServer): void {
  server.tool(
    "dismiss_keyboard",
    "Ferme le clavier sur le device actif (iOS et Android). No-op si pas de clavier visible. À utiliser après un type_text quand le clavier bloque les boutons en bas.",
    {},
    async () => {
      const result = await resolveDevice();
      if ("error" in result) return { content: [{ type: "text", text: result.error }], isError: true };
      const dev = result.device;

      try {
        if (dev.platform === "ios") {
          const wda = await ensureWdaRunning(dev);
          if (!wda.ready) {
            return { content: [{ type: "text", text: wda.message ?? "WDA indisponible." }], isError: true };
          }

          if (!(await iosIsKeyboardVisible())) {
            const msg = "🍎 Aucun clavier visible — no-op.";
            logAction("dismiss_keyboard", msg, false, dev.platform, dev.id, dev.name);
            return { content: [{ type: "text", text: msg + getReportSuffix() }] };
          }

          const dismissed = await iosDismissKeyboard();
          const msg = dismissed
            ? "🍎 Clavier fermé."
            : "🍎 Tentative de dismiss faite, mais le clavier est encore visible. Retry manuel possible.";
          logAction("dismiss_keyboard", msg, false, dev.platform, dev.id, dev.name);
          return { content: [{ type: "text", text: msg + getReportSuffix() }] };
        } else {
          if (!(await androidIsKeyboardVisible())) {
            const msg = "🤖 Aucun clavier visible — no-op.";
            logAction("dismiss_keyboard", msg, false, dev.platform, dev.id, dev.name);
            return { content: [{ type: "text", text: msg + getReportSuffix() }] };
          }

          const dismissed = await androidDismissKeyboard();
          const msg = dismissed
            ? "🤖 Clavier fermé."
            : "🤖 Tentative faite (ESCAPE puis BACK), mais le clavier est encore visible.";
          logAction("dismiss_keyboard", msg, false, dev.platform, dev.id, dev.name);
          return { content: [{ type: "text", text: msg + getReportSuffix() }] };
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logAction("dismiss_keyboard", `Erreur: ${msg}`, true, dev.platform, dev.id, dev.name);
        return { content: [{ type: "text", text: `Erreur dismiss_keyboard: ${msg}` }], isError: true };
      }
    }
  );
}
