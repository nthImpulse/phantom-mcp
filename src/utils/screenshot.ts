import { iosScreenshot } from "../platforms/ios/simctl.js";
import { androidScreenshot } from "../platforms/android/adb.js";

/**
 * Take a screenshot on the given platform/device.
 * Shared utility used by test-report, visual-diff, and screenshot tools.
 */
export async function takeScreenshot(platform: "ios" | "android", deviceId: string): Promise<Buffer> {
  if (platform === "ios") return iosScreenshot(deviceId);
  return androidScreenshot();
}
