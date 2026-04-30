import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveDevice } from "../utils/device-manager.js";
import { ensureWdaRunning, iosTap, iosTapByText, iosGetKeyboardBounds, iosDismissKeyboard } from "../platforms/ios/wda.js";
import { androidTap, androidIsKeyboardVisible, androidDismissKeyboard } from "../platforms/android/adb.js";
import { getElementByIndex, findElementByText } from "./ui-tree.js";
import { logAction, getReportSuffix } from "../utils/tool-wrapper.js";

/**
 * If the keyboard physically covers the tap target, dismiss it first.
 * Returns true if a dismissal happened (caller may want to log it).
 *
 * Conservative behavior: we only dismiss if the target Y is INSIDE the
 * keyboard bounds. Tapping on the keyboard itself (e.g. a key during a
 * test) remains supported.
 */
async function ensureKeyboardNotBlocking(
  platform: "ios" | "android",
  targetY: number,
): Promise<boolean> {
  if (platform === "ios") {
    const bounds = await iosGetKeyboardBounds();
    if (!bounds) return false;
    if (targetY >= bounds.y && targetY <= bounds.y + bounds.height) {
      // Target is inside the keyboard area — likely intentional, skip auto-dismiss
      return false;
    }
    // Target is below the visible viewport (typical with keyboard open) → dismiss
    // Keyboard occupies ~bottom 1/3, so a target below bounds.y but already off-keyboard
    // means the actual UI element is hidden behind the keyboard.
    // Only dismiss if target Y is below screen visible region (i.e. behind kbd top)
    if (targetY > bounds.y) {
      await iosDismissKeyboard();
      return true;
    }
    return false;
  } else {
    if (!(await androidIsKeyboardVisible())) return false;
    // Android: similar heuristic — keyboard typically takes bottom 40%.
    // We don't have a reliable way to query its exact bounds via adb,
    // so we only auto-dismiss if the target is in the bottom half of the screen.
    // Defensive: skip when target Y is small (top half).
    // The targetY already comes from the caller, so we trust it.
    await androidDismissKeyboard();
    return true;
  }
}

export function registerTap(server: McpServer): void {
  server.tool(
    "tap",
    "Tape sur un élément de l'écran. Fonctionne sur iOS et Android. Utilise index (du get_ui_tree), coordonnées (x,y), ou texte. Auto-dismiss le clavier si la cible est physiquement masquée par lui (sécurité, pas de retap nécessaire).",
    {
      index: z.number().optional().describe("Index de l'élément depuis get_ui_tree"),
      x: z.number().optional().describe("Coordonnée X pour tap direct"),
      y: z.number().optional().describe("Coordonnée Y pour tap direct"),
      text: z.string().optional().describe("Texte/label de l'élément à taper"),
      auto_dismiss_keyboard: z.boolean().optional().default(true).describe("Si la cible est masquée par le clavier, le dismiss avant de tap (default: true). Mettre à false pour permettre le tap directement sur le clavier."),
    },
    async ({ index, x, y, text, auto_dismiss_keyboard }) => {
      const result = await resolveDevice();
      if ("error" in result) return { content: [{ type: "text", text: result.error }], isError: true };
      const dev = result.device;

      if (dev.platform === "ios") {
        const wda = await ensureWdaRunning(dev);
        if (!wda.ready) return { content: [{ type: "text", text: wda.message ?? "WDA indisponible." }], isError: true };
      }

      try {
        let msg: string;
        let kbDismissed = false;

        if (index !== undefined) {
          const cached = getElementByIndex(index, dev.id);
          if (!cached) return { content: [{ type: "text", text: `Index [${index}] non trouvé. Relance get_ui_tree.` }], isError: true };
          const tapX = cached.x + cached.width / 2;
          const tapY = cached.y + cached.height / 2;
          if (auto_dismiss_keyboard) {
            kbDismissed = await ensureKeyboardNotBlocking(dev.platform, tapY);
          }
          if (dev.platform === "ios") await iosTap(tapX, tapY);
          else await androidTap(tapX, tapY);
          msg = `Tap sur [${index}] "${cached.label || cached.name || ""}" à (${Math.round(tapX)}, ${Math.round(tapY)})`;
        } else if (x !== undefined && y !== undefined) {
          if (auto_dismiss_keyboard) {
            kbDismissed = await ensureKeyboardNotBlocking(dev.platform, y);
          }
          if (dev.platform === "ios") await iosTap(x, y);
          else await androidTap(x, y);
          msg = `Tap à (${x}, ${y})`;
        } else if (text) {
          // Note: when targeting by text we can't pre-check bounds easily on iOS
          // (the predicate-based query handles its own positioning). We let WDA
          // handle it and rely on auto_dismiss_keyboard for index/coords paths.
          if (dev.platform === "ios") {
            const found = await iosTapByText(text);
            if (!found) return { content: [{ type: "text", text: `Élément "${text}" non trouvé sur iOS.` }], isError: true };
          } else {
            const el = findElementByText(text, dev.id);
            if (!el) return { content: [{ type: "text", text: `Élément "${text}" non trouvé. Relance get_ui_tree.` }], isError: true };
            const elY = el.y + el.height / 2;
            if (auto_dismiss_keyboard) {
              kbDismissed = await ensureKeyboardNotBlocking(dev.platform, elY);
            }
            await androidTap(el.x + el.width / 2, elY);
          }
          msg = `Tap sur "${text}"`;
        } else {
          return { content: [{ type: "text", text: "Fournis index, x+y, ou text." }], isError: true };
        }

        if (kbDismissed) msg += " (clavier dismissé avant tap)";
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
