import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveDevice } from "../utils/device-manager.js";
import { ensureWdaRunning, iosSwipe, iosGetScreenSize } from "../platforms/ios/wda.js";
import { androidSwipe, androidGetScreenSize } from "../platforms/android/adb.js";
import { logAction } from "../utils/tool-wrapper.js";

export function registerSwipe(server: McpServer): void {
  server.tool(
    "swipe",
    "Fait un geste de swipe sur l'écran. Fonctionne sur iOS et Android.",
    {
      direction: z.enum(["up", "down", "left", "right"]).describe("Direction du swipe"),
      distance: z.enum(["short", "medium", "long"]).optional().default("medium").describe("Distance du swipe"),
    },
    async ({ direction, distance }) => {
      const result = await resolveDevice();
      if ("error" in result) return { content: [{ type: "text", text: result.error }], isError: true };
      const dev = result.device;

      try {
        let screenWidth: number, screenHeight: number;

        if (dev.platform === "ios") {
          const wda = await ensureWdaRunning(dev);
          if (!wda.ready) return { content: [{ type: "text", text: wda.message ?? "WDA indisponible." }], isError: true };
          const size = await iosGetScreenSize();
          screenWidth = size.width;
          screenHeight = size.height;
        } else {
          const size = await androidGetScreenSize();
          screenWidth = size.width;
          screenHeight = size.height;
        }

        const multiplier = distance === "short" ? 0.25 : distance === "long" ? 0.75 : 0.5;
        const centerX = screenWidth / 2;
        const centerY = screenHeight / 2;
        let fromX: number, fromY: number, toX: number, toY: number;

        switch (direction) {
          case "up":
            fromX = centerX; fromY = centerY + (screenHeight * multiplier) / 2;
            toX = centerX; toY = centerY - (screenHeight * multiplier) / 2;
            break;
          case "down":
            fromX = centerX; fromY = centerY - (screenHeight * multiplier) / 2;
            toX = centerX; toY = centerY + (screenHeight * multiplier) / 2;
            break;
          case "left":
            fromX = centerX + (screenWidth * multiplier) / 2; fromY = centerY;
            toX = centerX - (screenWidth * multiplier) / 2; toY = centerY;
            break;
          case "right":
            fromX = centerX - (screenWidth * multiplier) / 2; fromY = centerY;
            toX = centerX + (screenWidth * multiplier) / 2; toY = centerY;
            break;
        }

        if (dev.platform === "ios") {
          await iosSwipe(fromX, fromY, toX, toY);
        } else {
          await androidSwipe(fromX, fromY, toX, toY);
        }

        const successMsg = `Swipe ${direction} (${distance}) — de (${Math.round(fromX)},${Math.round(fromY)}) à (${Math.round(toX)},${Math.round(toY)})`;
        logAction("swipe", successMsg, false, dev.platform, dev.id, dev.name);
        return { content: [{ type: "text", text: successMsg }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logAction("swipe", `Erreur: ${msg}`, true, dev.platform, dev.id, dev.name);
        return { content: [{ type: "text", text: `Erreur swipe: ${msg}` }], isError: true };
      }
    }
  );
}
