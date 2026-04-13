export interface DeviceInfo {
  id: string;
  name: string;
  platform: "ios" | "android";
  type: "simulator" | "emulator" | "device";
  state: "booted" | "shutdown";
}

export interface ParsedElement {
  type: string;
  label: string;
  name: string;
  value: string;
  x: number;
  y: number;
  width: number;
  height: number;
  enabled: boolean;
  visible: boolean;
  placeholderValue: string;
}
