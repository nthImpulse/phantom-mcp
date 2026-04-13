import { autoLogStep, isAutoReportActive, autoStartIfNeeded, getAutoReportSession } from "./auto-report.js";

/**
 * Auto-log a tool action to the active test report.
 * Auto-starts a report on the first interaction tool call.
 * Fire-and-forget — never blocks, never throws.
 */
export function logAction(tool: string, description: string, isError: boolean, platform: "ios" | "android", deviceId: string, deviceName?: string): void {
  if (!isAutoReportActive()) {
    autoStartIfNeeded(deviceName ?? deviceId, platform, deviceId);
  }

  autoLogStep(tool, description, isError, platform, deviceId).catch((err) => {
    console.error(`[phantom] auto-report log failed: ${err instanceof Error ? err.message : err}`);
  });
}

/**
 * Returns a suffix to append to tool responses when a report is active.
 * This reminds Claude to call test_report(end) when testing is done.
 */
export function getReportSuffix(): string {
  const session = getAutoReportSession();
  if (!session) return "";
  return `\n\n📋 Rapport "${session.name}" en cours (${session.steps.length} étape(s)). Appelle test_report(end) quand tu as fini de tester.`;
}
