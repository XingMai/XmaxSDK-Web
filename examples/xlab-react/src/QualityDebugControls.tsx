interface QualityDebugControlsProps {
  disabled: boolean;
  onAdjust: (link: "uplink" | "downlink", direction: "upgrade" | "downgrade") => void;
}

/** 临时手动调档入口，不关闭 SDK 自动调档。 */
export function QualityDebugControls({ disabled, onAdjust }: QualityDebugControlsProps) {
  return (
    <div className="qualityDebug" role="group" aria-label="上下行档位调试">
      <span>临时调试 · 自动调档仍开启</span>
      {(["uplink", "downlink"] as const).map(link => (
        <div className="qualityDebugGroup" key={link} role="group" aria-label={link === "uplink" ? "上行档位" : "下行档位"}>
          {(["downgrade", "upgrade"] as const).map(direction => (
            <button key={direction} type="button" disabled={disabled}
              onClick={() => { if (!disabled) onAdjust(link, direction); }}>
              {link === "uplink" ? "上行" : "下行"}{direction === "upgrade" ? "升一档" : "降一档"}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
