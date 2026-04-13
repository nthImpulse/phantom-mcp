import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ParsedElement } from "../platforms/types.js";
import { resolveDevice } from "../utils/device-manager.js";
import { ensureWdaRunning, iosGetUiTree } from "../platforms/ios/wda.js";
import { androidGetUiTree } from "../platforms/android/adb.js";

// Cache for tap-by-index — tracks which device the cache belongs to
let elementCacheList: ParsedElement[] = [];
let cacheDeviceId: string | null = null;

function formatElement(index: number, el: ParsedElement): string {
  const displayText = el.label || el.name || "";
  const valueStr = el.value ? ` value="${el.value}"` : "";
  const placeholder = el.placeholderValue ? ` placeholder="${el.placeholderValue}"` : "";
  const rect = `(${el.x},${el.y} ${el.width}x${el.height})`;
  const en = el.enabled ? "enabled" : "disabled";
  return `[${index}] ${el.type} "${displayText}"${valueStr}${placeholder} ${rect} ${en}`;
}

export function registerGetUiTree(server: McpServer): void {
  server.tool(
    "get_ui_tree",
    "Retourne l'arbre d'accessibilité de l'écran — tous les éléments visibles avec type, texte, position. Fonctionne sur iOS et Android. Chaque élément a un index [N] utilisable avec tap.",
    {},
    async () => {
      const result = await resolveDevice();
      if ("error" in result) return { content: [{ type: "text", text: result.error }], isError: true };
      const dev = result.device;

      try {
        let elements: ParsedElement[];

        if (dev.platform === "ios") {
          const wda = await ensureWdaRunning(dev);
          if (!wda.ready) {
            return { content: [{ type: "text", text: wda.message ?? "WDA n'a pas pu démarrer." }], isError: true };
          }
          elements = await iosGetUiTree();
        } else {
          elements = await androidGetUiTree();
        }

        // Update cache atomically (no mutation, prevents race conditions)
        elementCacheList = [...elements];
        cacheDeviceId = dev.id;

        const lines = elements.map((el, i) => formatElement(i, el));
        const platform = dev.platform === "ios" ? "🍎" : "🤖";

        return {
          content: [{ type: "text", text: `${platform} ${dev.name}\n\n${lines.join("\n") || "Aucun élément visible"}` }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Erreur UI tree: ${msg}` }], isError: true };
      }
    }
  );
}

/**
 * Get element by index. Returns null if index out of bounds
 * or if the cache belongs to a different device than the one currently active.
 */
export function getElementByIndex(index: number, currentDeviceId?: string): ParsedElement | null {
  if (currentDeviceId && cacheDeviceId && currentDeviceId !== cacheDeviceId) {
    return null; // Cache is from a different device — stale
  }
  return elementCacheList[index] ?? null;
}

export function getElementCache(currentDeviceId?: string): ParsedElement[] {
  if (currentDeviceId && cacheDeviceId && currentDeviceId !== cacheDeviceId) {
    return []; // Cache is from a different device — stale
  }
  return elementCacheList;
}

/**
 * Find an element in the cache by text (label, value, or name).
 * Case-insensitive partial match. Shared by tap, long-press, type-text, etc.
 */
export function findElementByText(text: string, currentDeviceId?: string): ParsedElement | null {
  return matchElementByText(getElementCache(currentDeviceId), text);
}

/**
 * Match an element by text in any array of ParsedElements.
 * Used by findElementByText (cache), wait-for (fresh), scroll-until (fresh), assert (fresh).
 */
export function matchElementByText(elements: ParsedElement[], text: string): ParsedElement | null {
  const lower = text.toLowerCase();
  return elements.find((e) =>
    e.label?.toLowerCase().includes(lower) ||
    e.value?.toLowerCase().includes(lower) ||
    e.name?.toLowerCase().includes(lower)
  ) ?? null;
}

export function clearElementCache(): void {
  elementCacheList = [];
  cacheDeviceId = null;
}
