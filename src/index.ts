#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerListDevices } from "./tools/devices.js";
import { registerSetDevice } from "./tools/set-device.js";
import { registerScreenshot } from "./tools/screenshot.js";
import { registerGetUiTree } from "./tools/ui-tree.js";
import { registerTap } from "./tools/tap.js";
import { registerTypeText } from "./tools/type-text.js";
import { registerSwipe } from "./tools/swipe.js";
import { registerLaunchApp, registerKillApp } from "./tools/app.js";
import { registerWaitForElement } from "./tools/wait-for.js";
import { registerScrollUntilVisible } from "./tools/scroll-until.js";
import { registerLongPress } from "./tools/long-press.js";
import { registerAssertVisible, registerAssertNotVisible } from "./tools/assert.js";
import { registerDeepLink } from "./tools/deep-link.js";
import { registerVideoRecord } from "./tools/video-record.js";
import { registerShake, registerRotate } from "./tools/device-actions.js";
import { registerAccessibilityAudit } from "./tools/accessibility-audit.js";
import { registerTestReport } from "./tools/test-report.js";
import { registerVisualDiff } from "./tools/visual-diff.js";
import { registerMultiDevice } from "./tools/multi-device.js";

const server = new McpServer({
  name: "phantom",
  version: "2.2.0",
});

// Device management
registerListDevices(server);
registerSetDevice(server);

// Observation
registerScreenshot(server);
registerGetUiTree(server);
registerWaitForElement(server);
registerScrollUntilVisible(server);

// Assertions
registerAssertVisible(server);
registerAssertNotVisible(server);

// Interaction
registerTap(server);
registerLongPress(server);
registerTypeText(server);
registerSwipe(server);

// Navigation
registerDeepLink(server);

// Device actions
registerShake(server);
registerRotate(server);
registerVideoRecord(server);

// App lifecycle
registerLaunchApp(server);
registerKillApp(server);

// Tier 3 — Analysis & Automation
registerAccessibilityAudit(server);
registerTestReport(server);
registerVisualDiff(server);
registerMultiDevice(server);

// Connect via stdio
try {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[phantom] Server v2.2.0 started — 22 tools — iOS + Android");
} catch (err) {
  console.error(`[phantom] Failed to start: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
