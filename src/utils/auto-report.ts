import { mkdir, writeFile } from "fs/promises";
import { takeScreenshot } from "./screenshot.js";

interface ReportStep {
  index: number;
  tool: string;
  description: string;
  status: "pass" | "fail";
  screenshotPath: string;
  timestamp: number;
}

interface ReportSession {
  name: string;
  startedAt: number;
  deviceName: string;
  platform: "ios" | "android";
  deviceId: string;
  steps: ReportStep[];
  reportDir: string;
}

const MAX_AUTO_STEPS = 50;
let session: ReportSession | null = null;

export function isAutoReportActive(): boolean {
  return session !== null;
}

export function startAutoReport(name: string, deviceName: string, platform: "ios" | "android", deviceId: string): string {
  const timestamp = Date.now();
  const reportDir = `/tmp/phantom-report-${timestamp}`;
  session = { name, startedAt: timestamp, deviceName, platform, deviceId, steps: [], reportDir };
  return reportDir;
}

/**
 * Auto-start a report if none is active. Called by logAction on first interaction.
 * This makes the report 100% automatic — no need to call test_report(start).
 */
export function autoStartIfNeeded(deviceName: string, platform: "ios" | "android", deviceId: string): void {
  if (session) return; // Already active
  const timestamp = Date.now();
  const reportDir = `/tmp/phantom-report-${timestamp}`;
  session = {
    name: "Test automatique",
    startedAt: timestamp,
    deviceName,
    platform,
    deviceId,
    steps: [],
    reportDir,
  };
  console.error(`[phantom] Rapport de test démarré automatiquement → ${reportDir}`);
}

/**
 * Auto-log a step from any tool. Fire-and-forget — never throws, never blocks the caller on failure.
 * Auto-starts a report if none is active.
 */
export async function autoLogStep(tool: string, description: string, isError: boolean, platform: "ios" | "android", deviceId: string): Promise<void> {
  if (session && session.steps.length >= MAX_AUTO_STEPS) return;

  // Auto-start if no session — makes testing fully automatic
  if (!session) return; // Only log if explicitly started or auto-started via logAction

  const stepIndex = session.steps.length + 1;

  try {
    await mkdir(session.reportDir, { recursive: true });
    const screenshotPath = `${session.reportDir}/step-${stepIndex}.png`;

    try {
      const buffer = await takeScreenshot(platform, deviceId);
      await writeFile(screenshotPath, buffer);
    } catch (err) {
      console.error(`[phantom] auto-report: screenshot failed for step ${stepIndex}: ${err instanceof Error ? err.message : err}`);
    }

    session.steps.push({
      index: stepIndex,
      tool,
      description,
      status: isError ? "fail" : "pass",
      screenshotPath,
      timestamp: Date.now(),
    });
  } catch (err) {
    console.error(`[phantom] auto-report: failed to log step: ${err instanceof Error ? err.message : err}`);
  }
}

export async function endAutoReport(): Promise<{ reportPath: string; markdown: string } | null> {
  if (!session) return null;

  const s = session;
  const duration = ((Date.now() - s.startedAt) / 1000).toFixed(1);
  const passed = s.steps.filter((st) => st.status === "pass").length;
  const failed = s.steps.filter((st) => st.status === "fail").length;
  const overall = failed === 0 ? "PASS" : "FAIL";

  const md: string[] = [
    `# Test Report: ${s.name}`,
    "",
    `| | |`,
    `|---|---|`,
    `| **Device** | ${s.deviceName} (${s.platform}) |`,
    `| **Date** | ${new Date(s.startedAt).toISOString()} |`,
    `| **Durée** | ${duration}s |`,
    `| **Résultat** | ${overall} |`,
    "",
    `## Résumé`,
    "",
    `- Total : ${s.steps.length} étape(s)`,
    `- Pass : ${passed}`,
    `- Fail : ${failed}`,
    "",
    `## Étapes`,
    "",
  ];

  for (const step of s.steps) {
    const icon = step.status === "pass" ? "PASS" : "FAIL";
    md.push(`### Étape ${step.index} — [${icon}] ${step.tool}: ${step.description}`);
    md.push("");
    md.push(`![Step ${step.index}](step-${step.index}.png)`);
    md.push("");
  }

  md.push("---");
  md.push("*Généré automatiquement par Phantom MCP*");

  const markdown = md.join("\n");
  await mkdir(s.reportDir, { recursive: true });
  const reportPath = `${s.reportDir}/report.md`;
  await writeFile(reportPath, markdown);

  session = null;

  return { reportPath, markdown: `${overall} — ${passed} pass, ${failed} fail en ${duration}s\n\nRapport : ${reportPath}\nOuvre le dossier : open "${s.reportDir}"` };
}

export function getAutoReportSession(): ReportSession | null {
  return session;
}
