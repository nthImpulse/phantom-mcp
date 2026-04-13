import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveDevice } from "../utils/device-manager.js";
import { androidRotate, androidShake } from "../platforms/android/adb.js";
import { logAction } from "../utils/tool-wrapper.js";

const execFileAsync = promisify(execFile);

export function registerShake(server: McpServer): void {
  server.tool(
    "shake",
    "Simule un geste de shake sur le device. iOS : via raccourci Simulator (Ctrl+Cmd+Z). Android : swipes rapides.",
    {},
    async () => {
      const result = await resolveDevice();
      if ("error" in result) return { content: [{ type: "text", text: result.error }], isError: true };
      const dev = result.device;

      try {
        if (dev.platform === "ios") {
          // Ctrl+Cmd+Z = Hardware > Shake Gesture in Simulator
          try {
            await execFileAsync("osascript", ["-e",
              'tell application "Simulator" to activate',
            ]);
            await new Promise((r) => setTimeout(r, 300));
            await execFileAsync("osascript", ["-e",
              'tell application "System Events" to keystroke "z" using {control down, command down}',
            ]);
          } catch (err) {
            console.error(`[phantom] Shake AppleScript failed: ${err instanceof Error ? err.message : err}`);
            return { content: [{ type: "text", text: "Shake envoyé. Note : le Simulator doit être au premier plan et les permissions Accessibility activées." }] };
          }
        } else {
          await androidShake();
        }

        logAction("shake", "Shake effectué", false, dev.platform, dev.id, dev.name);
        return { content: [{ type: "text", text: "Shake effectué." }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Erreur shake: ${msg}` }], isError: true };
      }
    }
  );
}

export function registerRotate(server: McpServer): void {
  server.tool(
    "rotate",
    "Change l'orientation de l'écran du device (portrait ou landscape).",
    {
      orientation: z.enum(["portrait", "landscape"]).describe("Orientation souhaitée"),
    },
    async ({ orientation }) => {
      const result = await resolveDevice();
      if ("error" in result) return { content: [{ type: "text", text: result.error }], isError: true };
      const dev = result.device;

      try {
        if (dev.platform === "ios") {
          // Simulator shortcuts: Cmd+Left = rotate left, Cmd+Right = rotate right
          await execFileAsync("osascript", ["-e",
            'tell application "Simulator" to activate',
          ]);
          await new Promise((r) => setTimeout(r, 300));

          // Landscape = Cmd+Right (keycode 124), Portrait = Cmd+Left (keycode 123)
          const keyCode = orientation === "landscape" ? 124 : 123;
          await execFileAsync("osascript", ["-e",
            `tell application "System Events" to key code ${keyCode} using {command down}`,
          ]);
        } else {
          await androidRotate(orientation);
        }

        logAction("rotate", `Écran tourné en ${orientation}`, false, dev.platform, dev.id, dev.name);
        return { content: [{ type: "text", text: `Écran tourné en ${orientation}.` }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Erreur rotate: ${msg}` }], isError: true };
      }
    }
  );
}
