import { execFile, spawn } from "child_process";
import { promisify } from "util";
import type { DeviceInfo, ParsedElement } from "../types.js";
import { getAttr } from "../../utils/xml.js";

const execFileAsync = promisify(execFile);

// Regex to validate package names — blocks shell injection
const PACKAGE_REGEX = /^[a-zA-Z0-9._]+$/;

function validatePackageName(pkg: string): void {
  if (!PACKAGE_REGEX.test(pkg)) {
    throw new Error(`Package name invalide : "${pkg}". Seuls les caractères alphanumériques, points et underscores sont autorisés.`);
  }
}

// --- ADB path discovery ---

const ADB_CANDIDATES = [
  process.env.ANDROID_HOME ? `${process.env.ANDROID_HOME}/platform-tools/adb` : null,
  `${process.env.HOME}/Library/Android/sdk/platform-tools/adb`,
  "/usr/local/bin/adb",
].filter(Boolean) as string[];

let adbPath: string | null = null;

async function findAdb(): Promise<string> {
  if (adbPath) return adbPath;

  for (const candidate of ADB_CANDIDATES) {
    try {
      await execFileAsync(candidate, ["version"]);
      adbPath = candidate;
      return adbPath;
    } catch (err) {
      console.error(`[phantom] ADB not found at ${candidate}: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Try bare "adb" in PATH
  try {
    await execFileAsync("adb", ["version"]);
    adbPath = "adb";
    return adbPath;
  } catch (err) {
    console.error(`[phantom] ADB not in PATH: ${err instanceof Error ? err.message : err}`);
  }

  throw new Error("ADB non trouvé. Installe Android Studio ou le SDK Android.");
}

// Active device serial — set via setAdbSerial(), injected as `-s <serial>` in all commands
let currentSerial: string | null = null;

/**
 * Set the target device serial for all subsequent ADB commands.
 */
export function setAdbSerial(serial: string | null): void {
  currentSerial = serial;
}

export function getCurrentAdbSerial(): string | null {
  return currentSerial;
}

/**
 * Build the full args array, injecting `-s <serial>` when a device is selected.
 */
function buildArgs(args: string[]): string[] {
  if (currentSerial) return ["-s", currentSerial, ...args];
  return args;
}

/**
 * Execute ADB with safe argument passing (array, no shell).
 * Automatically targets the selected device via `-s <serial>`.
 */
async function adb(args: string[]): Promise<string> {
  const path = await findAdb();
  const { stdout } = await execFileAsync(path, buildArgs(args));
  return stdout.trim();
}

/**
 * Execute ADB and return raw binary output (for screenshots).
 */
async function adbBuffer(args: string[]): Promise<Buffer> {
  const path = await findAdb();
  const fullArgs = buildArgs(args);
  return new Promise((resolve, reject) => {
    const proc = spawn(path, fullArgs, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    proc.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    proc.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`adb ${fullArgs.join(" ")} failed with code ${code}`));
    });
    proc.on("error", reject);
  });
}

/**
 * Execute ADB WITHOUT serial targeting (for device listing only).
 */
async function adbGlobal(args: string[]): Promise<string> {
  const path = await findAdb();
  const { stdout } = await execFileAsync(path, args);
  return stdout.trim();
}

// --- Device management ---

export async function listAndroidDevices(): Promise<DeviceInfo[]> {
  try {
    const output = await adbGlobal(["devices", "-l"]);
    const lines = output.split("\n");
    const devices: DeviceInfo[] = [];

    for (const line of lines) {
      if (line.startsWith("List") || !line.trim()) continue;
      const parts = line.trim().split(/\s+/);
      const serial = parts[0];
      const status = parts[1];

      if (!serial || status !== "device") continue;

      const modelMatch = line.match(/model:(\S+)/);
      const name = modelMatch ? modelMatch[1].replace(/_/g, " ") : serial;
      const isEmulator = serial.startsWith("emulator-");

      devices.push({
        id: serial,
        name,
        platform: "android",
        type: isEmulator ? "emulator" : "device",
        state: "booted",
      });
    }
    return devices;
  } catch (err) {
    console.error(`[phantom] Erreur listAndroidDevices: ${err instanceof Error ? err.message : err}`);
    return [];
  }
}

/**
 * Boot an Android emulator by AVD name. Only called from set_device.
 */
const AVD_NAME_REGEX = /^[a-zA-Z0-9._-]+$/;

export async function bootEmulator(avdName: string): Promise<DeviceInfo | null> {
  if (!AVD_NAME_REGEX.test(avdName)) {
    throw new Error(`Nom d'AVD invalide : "${avdName}".`);
  }
  const emulatorPath = `${process.env.HOME}/Library/Android/sdk/emulator/emulator`;

  console.error(`[phantom] Booting Android emulator: ${avdName}`);

  // Note existing devices to detect the new one
  const existingDevices = await listAndroidDevices();
  const existingIds = new Set(existingDevices.map((d) => d.id));

  const proc = spawn(emulatorPath, ["-avd", avdName], {
    detached: true,
    stdio: "ignore",
  });
  proc.unref();

  const start = Date.now();
  while (Date.now() - start < 60000) {
    const devs = await listAndroidDevices();
    // Find the NEW device that wasn't there before
    const newDev = devs.find((d) => !existingIds.has(d.id));
    if (newDev) {
      try {
        const bootCheck = await adb(["shell", "getprop", "sys.boot_completed"]);
        if (bootCheck.trim() === "1") {
          console.error(`[phantom] Emulator "${avdName}" ready (${newDev.id})`);
          return newDev;
        }
      } catch (err) {
        console.error(`[phantom] Boot check pending: ${err instanceof Error ? err.message : err}`);
      }
    }
    await new Promise((r) => setTimeout(r, 2000));
  }

  console.error(`[phantom] Timeout — emulator "${avdName}" didn't boot in 60s`);
  return null;
}

/**
 * List available AVDs (not yet booted).
 */
export async function listAvds(): Promise<string[]> {
  try {
    const emulatorPath = `${process.env.HOME}/Library/Android/sdk/emulator/emulator`;
    const { stdout } = await execFileAsync(emulatorPath, ["-list-avds"]);
    return stdout.trim().split("\n").filter((l) => l.length > 0);
  } catch (err) {
    console.error(`[phantom] Erreur listAvds: ${err instanceof Error ? err.message : err}`);
    return [];
  }
}

// --- Screenshot ---

export async function androidScreenshot(): Promise<Buffer> {
  return adbBuffer(["exec-out", "screencap", "-p"]);
}

// --- UI Tree ---

function parseAndroidUiTree(xml: string): ParsedElement[] {
  const elements: ParsedElement[] = [];
  const seenKeys = new Set<string>();
  const nodeRegex = /<node\s+([^>]*?)\/?>|<node\s+([^>]*?)>/g;
  let match: RegExpExecArray | null;

  while ((match = nodeRegex.exec(xml)) !== null) {
    const attrs = match[1] || match[2];

    const className = getAttr(attrs, "class");
    const type = className.replace(/^android\.\w+\./, "");
    const text = getAttr(attrs, "text");
    const contentDesc = getAttr(attrs, "content-desc");
    const resourceId = getAttr(attrs, "resource-id");
    const enabled = getAttr(attrs, "enabled") === "true";

    const boundsStr = getAttr(attrs, "bounds");
    const boundsMatch = boundsStr.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    if (!boundsMatch) continue;

    const x = parseInt(boundsMatch[1]);
    const y = parseInt(boundsMatch[2]);
    const width = parseInt(boundsMatch[3]) - x;
    const height = parseInt(boundsMatch[4]) - y;

    if (width <= 0 || height <= 0) continue;

    const displayText = text || contentDesc || "";
    const shortResId = resourceId.replace(/^[^:]+:id\//, "");
    if (!displayText && !shortResId) continue;

    const key = `${type}|${displayText}|${x},${y}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    elements.push({
      type, label: contentDesc, name: shortResId, value: text,
      x, y, width, height, visible: true, enabled, placeholderValue: "",
    });
  }
  return elements;
}



export async function androidGetUiTree(): Promise<ParsedElement[]> {
  // Try dump to stdout first
  try {
    const xml = await adb(["shell", "uiautomator", "dump", "/dev/tty"]);
    const elements = parseAndroidUiTree(xml);
    if (elements.length > 0) return elements;
  } catch (err) {
    console.error(`[phantom] uiautomator dump stdout failed: ${err instanceof Error ? err.message : err}`);
  }

  // Fallback: dump to file
  try {
    await adb(["shell", "uiautomator", "dump", "/sdcard/phantom-dump.xml"]);
    const xml = await adb(["shell", "cat", "/sdcard/phantom-dump.xml"]);
    await adb(["shell", "rm", "/sdcard/phantom-dump.xml"]).catch(() => {});
    const elements = parseAndroidUiTree(xml);
    if (elements.length === 0) {
      console.error("[phantom] uiautomator dump retourné vide — l'écran est peut-être en transition");
    }
    return elements;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Impossible de lire l'UI Android : ${msg}`);
  }
}

// --- Interactions ---

export async function androidTap(x: number, y: number): Promise<void> {
  await adb(["shell", "input", "tap", String(Math.round(x)), String(Math.round(y))]);
}

/**
 * Escape text for safe injection into Android shell via `adb shell input text`.
 * Android shell interprets: ; | & $ ` ( ) < > ! etc.
 * We single-quote the entire string and escape internal single quotes.
 */
function escapeForAndroidShell(text: string): string {
  // Escape existing % first (so "100%" doesn't become "100%s")
  // Then replace spaces with %s (adb input text convention)
  // Wrap in single quotes to prevent shell interpretation
  // Internal single quotes become: '\''
  const escaped = text.replace(/%/g, "%%").replace(/ /g, "%s");
  return "'" + escaped.replace(/'/g, "'\\''") + "'";
}

/**
 * Type text on Android. Detects non-ASCII and warns.
 * All text is shell-escaped to prevent command injection on the device.
 */
export async function androidTypeText(text: string): Promise<{ warning?: string }> {
  const hasNonAscii = /[^\x20-\x7E]/.test(text);

  if (hasNonAscii) {
    // Use ADB broadcast for Unicode support (Android 7+)
    try {
      const safeText = escapeForAndroidShell(text);
      await adb(["shell", "am", "broadcast", "-a", "ADB_INPUT_TEXT", "--es", "msg", safeText]);
      return { warning: "Texte Unicode envoyé via broadcast. Si ça ne fonctionne pas, installe ADBKeyboard sur l'émulateur." };
    } catch (err) {
      console.error(`[phantom] ADB broadcast failed: ${err instanceof Error ? err.message : err}`);
      const asciiOnly = text.replace(/[^\x20-\x7E]/g, "?");
      const escaped = escapeForAndroidShell(asciiOnly);
      await adb(["shell", "input", "text", escaped]);
      return { warning: `Caractères non-ASCII détectés. Seuls les caractères ASCII ont été tapés : "${asciiOnly}"` };
    }
  }

  // Pure ASCII — escape for Android shell safety
  const escaped = escapeForAndroidShell(text);
  await adb(["shell", "input", "text", escaped]);
  return {};
}

export async function androidSwipe(fromX: number, fromY: number, toX: number, toY: number, durationMs: number = 500): Promise<void> {
  await adb(["shell", "input", "swipe",
    String(Math.round(fromX)), String(Math.round(fromY)),
    String(Math.round(toX)), String(Math.round(toY)),
    String(durationMs),
  ]);
}

export async function androidLaunchApp(packageName: string): Promise<void> {
  validatePackageName(packageName);
  await adb(["shell", "monkey", "-p", packageName, "-c", "android.intent.category.LAUNCHER", "1"]);
}

export async function androidKillApp(packageName: string): Promise<void> {
  validatePackageName(packageName);
  await adb(["shell", "am", "force-stop", packageName]);
}

export async function androidGetScreenSize(): Promise<{ width: number; height: number }> {
  const output = await adb(["shell", "wm", "size"]);
  const match = output.match(/(\d+)x(\d+)/);
  if (!match) return { width: 1080, height: 1920 };
  return { width: parseInt(match[1]), height: parseInt(match[2]) };
}

export async function androidClearTextField(): Promise<void> {
  await adb(["shell", "input", "keyevent", "123"]); // MOVE_END
  await adb(["shell", "input", "keyevent", "--longpress", "59", "122"]); // SHIFT+MOVE_HOME
  await adb(["shell", "input", "keyevent", "67"]); // DEL
}

// --- Tier 2 ---

export async function androidLongPress(x: number, y: number, durationMs: number = 1000): Promise<void> {
  // Long press = swipe from point to same point with long duration
  await adb(["shell", "input", "swipe",
    String(Math.round(x)), String(Math.round(y)),
    String(Math.round(x)), String(Math.round(y)),
    String(durationMs),
  ]);
}

export async function androidOpenUrl(url: string): Promise<void> {
  // Validate URL to prevent intent flag injection (url starting with "-" would be parsed as a flag by am)
  if (url.startsWith("-")) throw new Error(`URL invalide : ne peut pas commencer par "-".`);
  if (/[\x00-\x1F\x7F]/.test(url)) throw new Error("URL contient des caractères de contrôle.");
  await adb(["shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", url]);
}

export async function androidStartScreenRecord(outputPath: string = "/sdcard/phantom-record.mp4"): Promise<void> {
  if (!outputPath.startsWith("/sdcard/phantom-")) throw new Error("outputPath doit commencer par /sdcard/phantom-");
  const path = await findAdb();
  const proc = spawn(path, buildArgs(["shell", "screenrecord", outputPath]), {
    detached: true,
    stdio: "ignore",
  });
  proc.unref();
  // Store PID for later kill
  screenRecordPid = proc.pid ?? null;
  console.error(`[phantom] Screen recording started on Android (PID: ${screenRecordPid})`);
}

let screenRecordPid: number | null = null;

export async function androidStopScreenRecord(): Promise<string> {
  // Kill the screenrecord process
  if (screenRecordPid) {
    try { process.kill(screenRecordPid); } catch (err) {
      console.error(`[phantom] Failed to kill screenrecord (PID ${screenRecordPid}): ${err instanceof Error ? err.message : err}`);
    }
    screenRecordPid = null;
  } else {
    await adb(["shell", "pkill", "-f", "screenrecord"]).catch(() => {});
  }
  await new Promise((r) => setTimeout(r, 1000));

  // Pull the file to local disk
  const localPath = "/tmp/phantom-android-record.mp4";
  const adbPath = await findAdb();
  await execFileAsync(adbPath, buildArgs(["pull", "/sdcard/phantom-record.mp4", localPath]));
  await adb(["shell", "rm", "/sdcard/phantom-record.mp4"]).catch(() => {});

  return localPath;
}

export async function androidRotate(orientation: "portrait" | "landscape"): Promise<void> {
  // Disable auto-rotate first
  await adb(["shell", "settings", "put", "system", "accelerometer_rotation", "0"]);
  // 0 = portrait, 1 = landscape
  const value = orientation === "landscape" ? "1" : "0";
  await adb(["shell", "settings", "put", "system", "user_rotation", value]);
}

export async function androidShake(): Promise<void> {
  // Simulate sensor events for shake — rapid x-axis accelerometer changes
  // This uses `input swipe` as a workaround — real shake needs instrumentation
  const size = await androidGetScreenSize();
  const cx = size.width / 2, cy = size.height / 2;
  // Rapid side-to-side swipes simulate a shake visually
  await androidSwipe(cx - 100, cy, cx + 100, cy, 50);
  await androidSwipe(cx + 100, cy, cx - 100, cy, 50);
  await androidSwipe(cx - 100, cy, cx + 100, cy, 50);
}

/**
 * Detect if the Android soft keyboard is currently visible.
 * Uses `dumpsys input_method` and checks the mInputShown flag.
 *
 * Why a multiline-anchored regex?
 *   `dumpsys input_method` may print `mInputShown` on multiple lines
 *   (history, server vs view state). Matching loosely can pick up an old
 *   "true" value that no longer reflects what the user sees. We anchor on
 *   the start-of-line and tolerate leading whitespace to target the active
 *   block printed by recent Android versions.
 */
export async function androidIsKeyboardVisible(): Promise<boolean> {
  try {
    const out = await adb(["shell", "dumpsys", "input_method"]);
    return /^\s*mInputShown=true\b/m.test(out);
  } catch {
    return false;
  }
}

/**
 * Dismiss the Android soft keyboard.
 * Uses BACK keyevent — this is the standard way to dismiss IMEs on Android.
 *
 * Note: BACK can sometimes navigate back if no IME is open. We check first.
 *
 * Returns true if the keyboard was dismissed, false if there was nothing to dismiss.
 */
export async function androidDismissKeyboard(): Promise<boolean> {
  if (!(await androidIsKeyboardVisible())) return false;
  await adb(["shell", "input", "keyevent", "111"]); // KEYCODE_ESCAPE — dismisses IME without navigating
  await new Promise((r) => setTimeout(r, 200));
  if (await androidIsKeyboardVisible()) {
    // ESCAPE didn't work on this device, fall back to BACK
    await adb(["shell", "input", "keyevent", "4"]); // KEYCODE_BACK
    await new Promise((r) => setTimeout(r, 200));
  }
  return !(await androidIsKeyboardVisible());
}

/**
 * Clear the Android clipboard.
 * Uses a no-op input that overwrites whatever was in the clipboard.
 *
 * Note: Android doesn't expose a direct "clear clipboard" via adb without
 * a helper app. The most portable approach is to set the clipboard to an
 * empty string via service call (works on API 23+).
 */
export async function androidClearClipboard(): Promise<void> {
  try {
    // Service call to clipboard service to set an empty primary clip.
    // This is best-effort; on some devices it fails silently — non-fatal.
    await adb(["shell", "service", "call", "clipboard", "2", "i32", "0"]);
  } catch {
    // Non-fatal. The pbcopy+paste path is iOS-specific anyway.
  }
}
