import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveDevice } from "../utils/device-manager.js";
import { iosStartVideoRecord } from "../platforms/ios/simctl.js";
import { androidStartScreenRecord, androidStopScreenRecord } from "../platforms/android/adb.js";

let iosRecordPid: number | null = null;
let isRecording: "ios" | "android" | null = null;

/**
 * Check if a previous recording PID is still alive.
 * If not, reset state (recovery after crash/restart).
 */
function recoverStaleState(): void {
  if (isRecording === "ios" && iosRecordPid) {
    try {
      process.kill(iosRecordPid, 0); // signal 0 = check if alive
    } catch {
      // Process is dead — reset state
      console.error(`[phantom] Stale recording state detected (PID ${iosRecordPid} dead). Resetting.`);
      iosRecordPid = null;
      isRecording = null;
    }
  }
}

export function registerVideoRecord(server: McpServer): void {
  server.tool(
    "video_record",
    "Enregistre une vidéo de l'écran du device. Utilise action='start' pour commencer et action='stop' pour arrêter et récupérer le fichier.",
    {
      action: z.enum(["start", "stop"]).describe("'start' pour commencer l'enregistrement, 'stop' pour arrêter"),
    },
    async ({ action }) => {
      const result = await resolveDevice();
      if ("error" in result) return { content: [{ type: "text", text: result.error }], isError: true };
      const dev = result.device;

      // Recover from stale state if process died
      recoverStaleState();

      try {
        if (action === "start") {
          if (isRecording) {
            return { content: [{ type: "text", text: `Enregistrement déjà en cours (${isRecording}). Arrête-le d'abord avec action='stop'.` }], isError: true };
          }

          if (dev.platform === "ios") {
            iosRecordPid = await iosStartVideoRecord(dev.id, "/tmp/phantom-ios-record.mp4");
            isRecording = "ios";
          } else {
            await androidStartScreenRecord();
            isRecording = "android";
          }

          return { content: [{ type: "text", text: `Enregistrement vidéo démarré sur ${dev.name}. Utilise video_record(action='stop') pour arrêter.` }] };
        }

        // Stop
        if (!isRecording) {
          return { content: [{ type: "text", text: "Aucun enregistrement en cours. Lance d'abord video_record(action='start')." }], isError: true };
        }

        let filePath: string;

        if (isRecording === "ios") {
          if (iosRecordPid) {
            try { process.kill(iosRecordPid, "SIGINT"); } catch (err) {
              console.error(`[phantom] Failed to stop iOS recording (PID ${iosRecordPid}): ${err instanceof Error ? err.message : err}`);
            }
            iosRecordPid = null;
          }
          await new Promise((r) => setTimeout(r, 1500));
          filePath = "/tmp/phantom-ios-record.mp4";
        } else {
          filePath = await androidStopScreenRecord();
        }

        isRecording = null;

        return {
          content: [{ type: "text", text: `Vidéo enregistrée : ${filePath}\nTu peux la lire avec : open "${filePath}"` }],
        };
      } catch (err) {
        isRecording = null;
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Erreur video_record: ${msg}` }], isError: true };
      }
    }
  );
}
