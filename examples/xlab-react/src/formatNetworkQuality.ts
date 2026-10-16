import type { NetworkQualityLevel } from "@xmaxai/web-sdk";

const LABELS: Record<NetworkQualityLevel, string> = {
  0: "未知", 1: "极好", 2: "良好", 3: "一般", 4: "差", 5: "极差", 6: "断网",
};

export function formatNetworkQuality(quality?: NetworkQualityLevel): string {
  return quality === undefined ? "—" : LABELS[quality] ?? "—";
}
