import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveDevice } from "../utils/device-manager.js";
import { startAutoReport, endAutoReport, isAutoReportActive, getAutoReportSession } from "../utils/auto-report.js";

export function registerTestReport(server: McpServer): void {
  server.tool(
    "test_report",
    "Gère le rapport de test automatique. Le rapport démarre AUTOMATIQUEMENT dès la première interaction (tap, type_text, etc.) — tu n'as PAS besoin d'appeler 'start'. Appelle UNIQUEMENT action='end' quand tu as fini de tester pour générer le rapport markdown. Si tu veux nommer le rapport, appelle action='start' avec un nom AVANT de commencer.",
    {
      action: z.enum(["start", "end"]).describe("'start' pour commencer le suivi automatique, 'end' pour générer le rapport"),
      name: z.string().optional().describe("Nom du test (requis pour 'start')"),
    },
    async ({ action, name }) => {
      if (action === "start") {
        if (isAutoReportActive()) {
          return { content: [{ type: "text", text: "Rapport déjà en cours. Termine-le avec action='end' d'abord." }], isError: true };
        }
        if (!name) {
          return { content: [{ type: "text", text: "Le paramètre 'name' est requis pour démarrer un rapport." }], isError: true };
        }

        const result = await resolveDevice();
        if ("error" in result) return { content: [{ type: "text", text: result.error }], isError: true };
        const dev = result.device;

        const reportDir = startAutoReport(name, dev.name, dev.platform, dev.id);

        return {
          content: [{ type: "text", text: `Rapport "${name}" démarré sur ${dev.name} (${dev.platform}).\n\nToutes les actions suivantes seront enregistrées automatiquement avec un screenshot à chaque étape.\n\nQuand tu as terminé, appelle test_report(action='end') pour générer le rapport.\n\nDossier : ${reportDir}` }],
        };
      }

      // --- END ---
      const report = await endAutoReport();
      if (!report) {
        return { content: [{ type: "text", text: "Aucun rapport en cours. Lance action='start' d'abord." }], isError: true };
      }

      return {
        content: [{ type: "text", text: report.markdown }],
      };
    }
  );
}
