import { spawn, ChildProcess } from "child_process";
import { access } from "fs/promises";
import type { ParsedElement, DeviceInfo } from "../types.js";
import { getAttr } from "../../utils/xml.js";

const WDA_BASE = process.env.PHANTOM_WDA_URL ?? "http://localhost:8100";
const WDA_PATH = process.env.PHANTOM_WDA_PATH ??
  `${process.env.HOME}/.appium/node_modules/appium-xcuitest-driver/node_modules/appium-webdriveragent`;

let currentSessionId: string | null = null;
let wdaProcess: ChildProcess | null = null;

// Promise-based launch lock — prevents race condition when multiple tools call ensureWdaRunning concurrently
let wdaLaunchPromise: Promise<{ ready: boolean; message?: string }> | null = null;

// --- Status & Session ---

async function checkWdaStatus(): Promise<boolean> {
  try {
    const res = await fetch(`${WDA_BASE}/status`, { signal: AbortSignal.timeout(3000) });
    const data = await res.json() as { value?: { ready?: boolean }; sessionId?: string };
    if (data.sessionId) currentSessionId = data.sessionId;
    return data.value?.ready === true;
  } catch {
    // Expected when WDA is not running — no need to log
    return false;
  }
}

/**
 * Ensures WDA is running for the given device.
 * Uses a shared Promise to prevent race conditions when called concurrently.
 */
export async function ensureWdaRunning(device?: DeviceInfo): Promise<{ ready: boolean; message?: string }> {
  if (await checkWdaStatus()) return { ready: true };

  // If already launching, wait for that same promise
  if (wdaLaunchPromise) return wdaLaunchPromise;

  if (!device) {
    return { ready: false, message: "Aucun device iOS sélectionné. Utilise set_device d'abord." };
  }

  // Check WDA path exists
  const wdaExists = await access(`${WDA_PATH}/WebDriverAgent.xcodeproj`).then(() => true).catch(() => false);
  if (!wdaExists) {
    return {
      ready: false,
      message: `WDA non trouvé à ${WDA_PATH}. Configure PHANTOM_WDA_PATH ou installe Appium + xcuitest driver.`,
    };
  }

  // Launch WDA with shared Promise (race condition fix)
  wdaLaunchPromise = launchWda(device);
  try {
    return await wdaLaunchPromise;
  } finally {
    wdaLaunchPromise = null;
  }
}

async function launchWda(device: DeviceInfo): Promise<{ ready: boolean; message?: string }> {
  let destination: string;
  if (device.type === "device") {
    destination = `platform=iOS,id=${device.id}`;
    console.error(`[phantom] Launching WDA on real device "${device.name}" (${device.id})...`);
  } else {
    destination = `platform=iOS Simulator,name=${device.name}`;
    console.error(`[phantom] Launching WDA on simulator "${device.name}"...`);
  }

  try {
    wdaProcess = spawn("xcodebuild", [
      "-project", "WebDriverAgent.xcodeproj",
      "-scheme", "WebDriverAgentRunner",
      "-destination", destination,
      "test",
    ], { cwd: WDA_PATH, detached: true, stdio: ["ignore", "pipe", "pipe"] });

    wdaProcess.stdout?.on("data", (data: Buffer) => {
      const line = data.toString();
      if (line.includes("ServerURL") || line.includes("error:")) {
        console.error(`[WDA] ${line.trim()}`);
      }
    });
    wdaProcess.stderr?.on("data", (data: Buffer) => {
      const line = data.toString();
      if (line.includes("error:") || line.includes("Error")) {
        console.error(`[WDA-err] ${line.trim()}`);
      }
    });
    wdaProcess.on("exit", (code) => {
      console.error(`[phantom] WDA exited with code ${code}`);
      wdaProcess = null;
      currentSessionId = null; // Reset session — WDA is dead
    });
    wdaProcess.unref();

    return await waitForWda(120);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ready: false, message: `Erreur WDA: ${msg}` };
  }
}

async function waitForWda(timeoutSeconds: number): Promise<{ ready: boolean; message?: string }> {
  const start = Date.now();
  while (Date.now() - start < timeoutSeconds * 1000) {
    if (await checkWdaStatus()) {
      console.error("[phantom] WDA is ready!");
      return { ready: true };
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return { ready: false, message: `WDA timeout après ${timeoutSeconds}s.` };
}

/**
 * Reset WDA state when switching iOS devices.
 * Kills the running WDA process and clears the session — next tool call will relaunch for the new device.
 */
export function resetWdaForDeviceSwitch(): void {
  currentSessionId = null;
  if (wdaProcess) {
    try { wdaProcess.kill(); } catch (err) {
      console.error(`[phantom] Failed to kill WDA on device switch: ${err instanceof Error ? err.message : err}`);
    }
    wdaProcess = null;
  }
  wdaLaunchPromise = null;
  console.error("[phantom] WDA state reset for device switch");
}

// --- Session management ---

async function getSessionId(): Promise<string> {
  if (currentSessionId) return currentSessionId;

  try {
    const statusRes = await fetch(`${WDA_BASE}/status`, { signal: AbortSignal.timeout(5000) });
    const statusData = await statusRes.json() as { sessionId?: string };
    if (statusData.sessionId) {
      currentSessionId = statusData.sessionId;
      return currentSessionId;
    }
  } catch (err) {
    console.error(`[phantom] WDA status check failed, creating new session: ${err instanceof Error ? err.message : err}`);
  }

  const res = await fetch(`${WDA_BASE}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ capabilities: { alwaysMatch: {} } }),
    signal: AbortSignal.timeout(10000),
  });
  const data = await res.json() as { sessionId?: string; value?: { sessionId?: string } };
  currentSessionId = data.sessionId ?? data.value?.sessionId ?? null;

  if (!currentSessionId) throw new Error("Impossible de créer une session WDA.");
  return currentSessionId;
}

function resetSession(): void { currentSessionId = null; }

// --- HTTP helpers with retry ---

async function fetchWithRetry(url: string, options: RequestInit, retries: number = 2): Promise<Response> {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
    } catch (err) {
      if (i === retries) throw err;
      console.error(`[phantom] WDA request failed, retry ${i + 1}/${retries}...`);
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw new Error("WDA unreachable");
}

async function wdaGet(path: string): Promise<unknown> {
  const sid = await getSessionId();
  const res = await fetchWithRetry(`${WDA_BASE}/session/${sid}${path}`, {
    headers: { Accept: "application/json" },
  });
  if (res.status === 404) {
    resetSession();
    const newSid = await getSessionId();
    return (await fetchWithRetry(`${WDA_BASE}/session/${newSid}${path}`, {
      headers: { Accept: "application/json" },
    })).json();
  }
  return res.json();
}

async function wdaPost(path: string, body: unknown): Promise<unknown> {
  const sid = await getSessionId();
  const res = await fetchWithRetry(`${WDA_BASE}/session/${sid}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 404) {
    resetSession();
    const newSid = await getSessionId();
    return (await fetchWithRetry(`${WDA_BASE}/session/${newSid}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })).json();
  }
  return res.json();
}

// --- iOS UI Tree parsing ---


function parseIosUiTree(xml: string): ParsedElement[] {
  const elements: ParsedElement[] = [];
  const seenKeys = new Set<string>();
  const tagRegex = /<(XCUIElementType\w+)\s+([^>]*?)\/?>|<(XCUIElementType\w+)\s+([^>]*?)>/g;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(xml)) !== null) {
    const attrs = match[2] || match[4];
    const type = (match[1] || match[3]).replace("XCUIElementType", "");
    const name = getAttr(attrs, "name");
    const label = getAttr(attrs, "label");
    const value = getAttr(attrs, "value");
    const x = parseFloat(getAttr(attrs, "x")) || 0;
    const y = parseFloat(getAttr(attrs, "y")) || 0;
    const width = parseFloat(getAttr(attrs, "width")) || 0;
    const height = parseFloat(getAttr(attrs, "height")) || 0;
    const visible = getAttr(attrs, "visible") === "true";
    const enabled = getAttr(attrs, "enabled") === "true";
    const placeholderValue = getAttr(attrs, "placeholderValue");

    if (!visible || width === 0 || height === 0) continue;
    const displayText = label || name || "";
    if (type === "Application" || type === "Window") continue;
    if (type === "Other" && (!displayText || displayText.length > 60)) continue;

    const key = `${type}|${displayText}|${x},${y}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    if (type === "Image" && !displayText && !value) continue;

    elements.push({ type, name, label, value, x, y, width, height, visible, enabled, placeholderValue });
  }
  return elements;
}

export async function iosGetUiTree(): Promise<ParsedElement[]> {
  const response = await wdaGet("/source") as { value: unknown };
  if (typeof response.value === "string") {
    return parseIosUiTree(response.value);
  }
  throw new Error("WDA source a retourné un format inattendu.");
}

export async function iosTap(x: number, y: number): Promise<void> {
  await wdaPost("/wda/tap", { x, y });
}

/**
 * Escape text for iOS predicate strings — prevents injection.
 */
function escapePredicateText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export async function iosTapByText(text: string): Promise<boolean> {
  const safe = escapePredicateText(text);
  const findRes = await wdaPost("/element", {
    using: "-ios predicate string",
    value: `label CONTAINS[cd] '${safe}' OR value CONTAINS[cd] '${safe}' OR name CONTAINS[cd] '${safe}'`,
  }) as { value?: { ELEMENT?: string } };

  const elementId = findRes.value?.ELEMENT;
  if (!elementId) return false;

  await wdaPost(`/element/${elementId}/click`, {});
  return true;
}

/**
 * Type text into a field on iOS.
 * Improvements:
 * - Auto-tap + 300ms delay before typing (iOS needs time to confirm focus)
 * - Searches TextField AND SecureTextField (password fields)
 * - Fallback: pbcopy + Cmd+V paste if direct typing fails
 * - clear_first uses Cmd+A then types (replaces selection)
 */
export async function iosTypeText(
  text: string,
  elementText?: string,
  clearFirst?: boolean,
  deviceUdid?: string,
): Promise<boolean> {
  let elementId: string | null = null;

  // Find element by text — search in TextField, SecureTextField, and by label/placeholder
  if (elementText) {
    const safe = escapePredicateText(elementText);
    // Include SecureTextField (password fields) in search
    const findRes = await wdaPost("/element", {
      using: "-ios predicate string",
      value: `label CONTAINS[cd] '${safe}' OR value CONTAINS[cd] '${safe}' OR name CONTAINS[cd] '${safe}' OR placeholderValue CONTAINS[cd] '${safe}'`,
    }) as { value?: { ELEMENT?: string } };
    elementId = findRes.value?.ELEMENT ?? null;
    if (!elementId) return false;

    // Auto-tap to focus
    await wdaPost(`/element/${elementId}/click`, {});
    // Wait for iOS to confirm focus (fixes "Aucun champ en focus" bug)
    await new Promise((r) => setTimeout(r, 300));
  }

  // Get active element if not found by text
  if (!elementId) {
    // Wait a bit in case focus is still settling from a recent tap
    await new Promise((r) => setTimeout(r, 200));
    const activeRes = await wdaPost("/element/active", {}) as { value?: { ELEMENT?: string } };
    elementId = activeRes.value?.ELEMENT ?? null;
  }

  // PRIMARY: pbcopy + Cmd+V paste — fast, keyboard-layout agnostic (fixes AZERTY)
  if (deviceUdid) {
    try {
      // Copy text to simulator clipboard
      await new Promise<void>((resolve, reject) => {
        const proc = spawn("xcrun", ["simctl", "pbcopy", deviceUdid]);
        proc.stdin.write(text);
        proc.stdin.end();
        proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`pbcopy exit ${code}`)));
        proc.on("error", reject);
      });

      if (clearFirst) {
        // Cmd+A to select all before pasting
        await wdaPost("/wda/keys", { value: ["a"], modifierFlags: 1 << 20 });
        await new Promise((r) => setTimeout(r, 100));
      }

      // Cmd+V to paste — instant, no keyboard layout issues
      await wdaPost("/wda/keys", { value: ["v"], modifierFlags: 1 << 20 });
      return true;
    } catch (err) {
      console.error(`[phantom] pbcopy+paste failed, falling back to WDA typing: ${err instanceof Error ? err.message : err}`);
    }
  }

  // FALLBACK: direct WDA typing (slower, keyboard-layout dependent)
  if (elementId) {
    try {
      if (clearFirst) {
        await wdaPost(`/element/${elementId}/clear`, {});
        await new Promise((r) => setTimeout(r, 100));
      }
      await wdaPost(`/element/${elementId}/value`, { value: [text] });
      return true;
    } catch (err) {
      console.error(`[phantom] WDA typing also failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  return false;
}

export async function iosSwipe(fromX: number, fromY: number, toX: number, toY: number): Promise<void> {
  await wdaPost("/wda/dragfromtoforduration", { fromX, fromY, toX, toY, duration: 0.5 });
}

export async function iosGetScreenSize(): Promise<{ width: number; height: number }> {
  const res = await wdaGet("/window/size") as { value: { width: number; height: number } };
  return res.value;
}

// --- Tier 2 ---

export async function iosLongPress(x: number, y: number, durationSec: number = 1): Promise<void> {
  await wdaPost("/wda/touchAndHold", { x, y, duration: durationSec });
}


