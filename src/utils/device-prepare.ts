/**
 * Shared device-preparation logic, used by both:
 *  - the explicit `prepare_device` tool
 *  - the auto-trigger inside `set_device` (when skip_setup is false)
 *
 * Each step is best-effort: a single failure doesn't block the others.
 * Returns a list of human-readable steps performed and a list of failures
 * for callers to report back to the user.
 */

import type { DeviceInfo } from "../platforms/types.js";
import {
  iosClearClipboard,
  iosClearStatusBar,
  iosForceKeyboardQwerty,
} from "../platforms/ios/simctl.js";
import { ensureWdaRunning, iosDismissKeyboard, iosIsKeyboardVisible } from "../platforms/ios/wda.js";
import { androidClearClipboard, androidDismissKeyboard } from "../platforms/android/adb.js";

export interface PrepareDeviceOptions {
  dismissKeyboard?: boolean;
  clearClipboard?: boolean;
  clearStatusBar?: boolean;
  forceQwerty?: boolean;
  /**
   * If true, skip launching WDA just to check the keyboard. Used by the
   * auto-trigger path inside `set_device` to avoid blocking up to 120s
   * when WDA isn't already up. The explicit `prepare_device` tool leaves
   * this false to do the full job.
   */
  skipKeyboardIfWdaNotReady?: boolean;
}

export interface PrepareDeviceResult {
  steps: string[];
  failures: string[];
}

const DEFAULT_OPTIONS: Required<PrepareDeviceOptions> = {
  dismissKeyboard: true,
  clearClipboard: true,
  clearStatusBar: true,
  forceQwerty: true,
  skipKeyboardIfWdaNotReady: false,
};

/**
 * Best-effort prepare. Never throws — failures are collected and returned.
 */
export async function prepareDevice(
  dev: DeviceInfo,
  opts: PrepareDeviceOptions = {},
): Promise<PrepareDeviceResult> {
  const o = { ...DEFAULT_OPTIONS, ...opts };
  const steps: string[] = [];
  const failures: string[] = [];

  if (dev.platform === "ios") {
    if (o.clearClipboard) {
      try {
        await iosClearClipboard(dev.id);
        steps.push("clipboard cleared");
      } catch (e) {
        failures.push(`clipboard: ${e instanceof Error ? e.message : e}`);
      }
    }

    if (o.clearStatusBar) {
      try {
        await iosClearStatusBar(dev.id);
        steps.push("status bar cleared");
      } catch (e) {
        failures.push(`status_bar: ${e instanceof Error ? e.message : e}`);
      }
    }

    if (o.forceQwerty) {
      try {
        await iosForceKeyboardQwerty(dev.id);
        steps.push("keyboard QWERTY enforced");
      } catch (e) {
        failures.push(`qwerty: ${e instanceof Error ? e.message : e}`);
      }
    }

    if (o.dismissKeyboard) {
      try {
        const wda = await ensureWdaRunning(dev);
        if (!wda.ready) {
          if (!o.skipKeyboardIfWdaNotReady) {
            failures.push(`dismiss_keyboard: WDA not ready (${wda.message ?? "unknown"})`);
          } else {
            steps.push("keyboard check skipped (WDA not ready, opt-in skip)");
          }
        } else if (await iosIsKeyboardVisible()) {
          const dismissed = await iosDismissKeyboard();
          steps.push(dismissed ? "keyboard dismissed" : "keyboard dismiss attempted (still visible)");
        } else {
          steps.push("keyboard not visible");
        }
      } catch (e) {
        failures.push(`dismiss_keyboard: ${e instanceof Error ? e.message : e}`);
      }
    }
  } else {
    // Android
    if (o.clearClipboard) {
      try {
        await androidClearClipboard();
        steps.push("clipboard cleared");
      } catch (e) {
        failures.push(`clipboard: ${e instanceof Error ? e.message : e}`);
      }
    }

    if (o.dismissKeyboard) {
      try {
        const dismissed = await androidDismissKeyboard();
        steps.push(dismissed ? "keyboard dismissed" : "keyboard not visible");
      } catch (e) {
        failures.push(`dismiss_keyboard: ${e instanceof Error ? e.message : e}`);
      }
    }

    if (o.clearStatusBar) steps.push("status bar override: skipped on Android (iOS-only)");
    if (o.forceQwerty) steps.push("force QWERTY: skipped on Android (iOS-only)");
  }

  return { steps, failures };
}
