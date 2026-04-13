import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ParsedElement } from "../platforms/types.js";
import { resolveDevice } from "../utils/device-manager.js";
import { ensureWdaRunning, iosGetUiTree } from "../platforms/ios/wda.js";
import { androidGetUiTree } from "../platforms/android/adb.js";
import { logAction } from "../utils/tool-wrapper.js";

// Interactive element types per platform
const IOS_INTERACTIVE = new Set(["Button", "TextField", "SecureTextField", "Switch", "Slider", "Stepper", "Link", "SearchField", "SegmentedControl"]);
const ANDROID_INTERACTIVE = new Set(["Button", "EditText", "CheckBox", "RadioButton", "Switch", "SeekBar", "ImageButton", "ToggleButton", "FloatingActionButton"]);

// Image types per platform
const IOS_IMAGE = new Set(["Image"]);
const ANDROID_IMAGE = new Set(["ImageView", "ImageButton"]);

// Minimum tap target sizes
const IOS_MIN_TAP = 44;
const ANDROID_MIN_TAP = 48;

interface Violation {
  severity: "error" | "warning";
  check: string;
  message: string;
  element: string;
  position: string;
}

function isInteractive(type: string, platform: "ios" | "android"): boolean {
  return platform === "ios" ? IOS_INTERACTIVE.has(type) : ANDROID_INTERACTIVE.has(type);
}

function isImage(type: string, platform: "ios" | "android"): boolean {
  return platform === "ios" ? IOS_IMAGE.has(type) : ANDROID_IMAGE.has(type);
}

function auditElements(elements: ParsedElement[], platform: "ios" | "android"): Violation[] {
  const violations: Violation[] = [];
  const minTap = platform === "ios" ? IOS_MIN_TAP : ANDROID_MIN_TAP;

  for (const el of elements) {
    const displayText = el.label || el.name || el.value || "";
    const pos = `(${el.x},${el.y} ${el.width}x${el.height})`;

    // Check A — Interactive elements without labels
    if (isInteractive(el.type, platform)) {
      if (!el.label && !el.name && !el.value) {
        violations.push({
          severity: "error",
          check: "missing-label",
          message: `${el.type} sans texte accessible`,
          element: `${el.type} ${pos}`,
          position: pos,
        });
      }

      // Check B — Tap target too small
      if (el.width < minTap || el.height < minTap) {
        const severity = el.width < minTap * 0.75 || el.height < minTap * 0.75 ? "error" : "warning";
        violations.push({
          severity,
          check: "tap-target-small",
          message: `${el.type} "${displayText}" trop petit : ${el.width}x${el.height} (min ${minTap}x${minTap})`,
          element: `${el.type} "${displayText}" ${pos}`,
          position: pos,
        });
      }
    }

    // Check C — Images without alt text
    if (isImage(el.type, platform)) {
      if (!el.label && !el.name && !el.value) {
        violations.push({
          severity: "warning",
          check: "image-no-alt",
          message: `Image sans texte alternatif`,
          element: `${el.type} ${pos}`,
          position: pos,
        });
      }
    }
  }

  return violations;
}

export function registerAccessibilityAudit(server: McpServer): void {
  server.tool(
    "accessibility_audit",
    "Verifie l'accessibilite de l'ecran actuel : labels manquants, tap targets trop petits, images sans alt text. Retourne un rapport de violations.",
    {},
    async () => {
      const result = await resolveDevice();
      if ("error" in result) return { content: [{ type: "text", text: result.error }], isError: true };
      const dev = result.device;

      try {
        let elements: ParsedElement[];

        if (dev.platform === "ios") {
          const wda = await ensureWdaRunning(dev);
          if (!wda.ready) return { content: [{ type: "text", text: wda.message ?? "WDA indisponible." }], isError: true };
          elements = await iosGetUiTree();
        } else {
          elements = await androidGetUiTree();
        }

        if (elements.length === 0) {
          return {
            content: [{ type: "text", text: `Accessibility Audit — ${dev.name} (${dev.platform})\n\nWARNING — Aucun élément détecté. L'écran semble vide ou en transition. Réessaie après le chargement.` }],
            isError: true,
          };
        }

        const violations = auditElements(elements, dev.platform);
        const errors = violations.filter((v) => v.severity === "error");
        const warnings = violations.filter((v) => v.severity === "warning");

        const lines: string[] = [
          `Accessibility Audit — ${dev.name} (${dev.platform})`,
          `Éléments analysés : ${elements.length}`,
          "",
        ];

        if (violations.length === 0) {
          lines.push("PASS — Aucune violation détectée.");
        } else {
          lines.push(`VIOLATIONS (${violations.length}) :`);
          lines.push("");

          for (const v of violations) {
            const icon = v.severity === "error" ? "[ERROR]" : "[WARNING]";
            lines.push(`${icon} ${v.check} : ${v.message} — ${v.element}`);
          }

          lines.push("");
          lines.push(`Resume : ${errors.length} erreur(s), ${warnings.length} avertissement(s), ${elements.length - violations.length} element(s) OK`);
        }

        logAction("accessibility_audit", `${violations.length} violation(s) trouvée(s)`, errors.length > 0, dev.platform, dev.id, dev.name);
        return {
          content: [{ type: "text", text: lines.join("\n") }],
          isError: errors.length > 0,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Erreur accessibility_audit: ${msg}` }], isError: true };
      }
    }
  );
}
