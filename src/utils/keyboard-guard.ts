/**
 * Keyboard guard — used by interaction tools (tap, long_press, …) to detect
 * when the soft keyboard is physically masking the target and dismiss it
 * before the action.
 *
 * Centralised here so that any tool needing the same "tap below the keyboard"
 * guarantee uses identical heuristics, and bug fixes apply uniformly.
 */

import { iosGetKeyboardBounds, iosDismissKeyboard, iosIsKeyboardVisible } from "../platforms/ios/wda.js";
import { androidIsKeyboardVisible, androidDismissKeyboard, androidGetScreenSize } from "../platforms/android/adb.js";

/**
 * If the keyboard is currently masking the target Y coordinate, dismiss it
 * before the caller proceeds. Returns true if a dismiss was performed.
 *
 * Conservative behavior:
 *   • If no keyboard is visible → no-op
 *   • iOS: dismiss only when target Y is below the keyboard top AND inside
 *     the keyboard region (target visually masked). Tapping a key on the
 *     keyboard itself remains supported when the user disables auto-dismiss.
 *   • Android: we can't read keyboard bounds via adb. We use the heuristic
 *     "target is in the bottom 40% of the screen" — that's the typical IME
 *     region on portrait phones. Above the bottom 40%, we don't dismiss to
 *     avoid surprising regressions on top-of-screen taps.
 *
 * iOS lightweight optimisation: this function does ONE wdaPost (`iosIsKeyboardVisible`)
 * and only fetches full bounds (`iosGetKeyboardBounds`) when the keyboard is
 * actually visible. The common case (keyboard not visible) costs ~1 source XML
 * fetch instead of 2.
 */
export async function ensureKeyboardNotBlocking(
  platform: "ios" | "android",
  targetY: number,
): Promise<boolean> {
  if (platform === "ios") {
    // Light early-exit: avoid fetching bounds when no keyboard is visible.
    if (!(await iosIsKeyboardVisible())) return false;

    const bounds = await iosGetKeyboardBounds();
    // Keyboard could have just disappeared between the two calls — treat as no-op
    if (!bounds) return false;

    const keyboardTop = bounds.y;
    const keyboardBottom = bounds.y + bounds.height;

    // If the target is inside the keyboard region itself, the user is likely
    // testing the keyboard — don't auto-dismiss.
    if (targetY >= keyboardTop && targetY <= keyboardBottom) return false;

    // If the target is BELOW the keyboard top (i.e. visually behind it), the
    // user can't see it — dismiss the keyboard first.
    // Note: targetY > keyboardBottom shouldn't happen on standard layouts
    // (no UI below the keyboard on iPhones) but we keep it inclusive.
    if (targetY > keyboardTop) {
      await iosDismissKeyboard();
      return true;
    }

    return false;
  }

  // Android
  if (!(await androidIsKeyboardVisible())) return false;

  // Heuristic: only dismiss if the target Y falls in the bottom 40% of the
  // screen, which is where the IME usually lives on portrait phones. If the
  // target is in the top 60% — typical for app bars, headers, lists — assume
  // the user knows what they're doing and don't auto-dismiss.
  try {
    const { height } = await androidGetScreenSize();
    const bottomZone = height * 0.6; // anything below this Y is bottom 40%
    if (targetY < bottomZone) return false;
  } catch {
    // If we can't get the screen size, fall back to the previous (aggressive)
    // behaviour so we don't silently break the masking-guard.
  }

  await androidDismissKeyboard();
  return true;
}
