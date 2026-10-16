import type { NetworkQualityLevel } from "@xmaxai/web-sdk";

const LABELS: Record<NetworkQualityLevel, string> = {
  0: "Unknown", 1: "Excellent", 2: "Good", 3: "Fair", 4: "Poor", 5: "Very poor", 6: "Disconnected",
};

export function formatNetworkQuality(quality?: NetworkQualityLevel): string {
  return quality === undefined ? "—" : LABELS[quality] ?? "—";
}
