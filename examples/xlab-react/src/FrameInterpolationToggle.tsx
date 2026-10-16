interface FrameInterpolationToggleProps {
  enabled: boolean;
  switching?: boolean;
  disabled?: boolean;
  onToggle: () => void;
}

/** 功能开关，不表示每一帧是否成功插值或实际输出帧率。 */
export function FrameInterpolationToggle({ enabled, switching = false, disabled = false, onToggle }: FrameInterpolationToggleProps) {
  return (
    <button
      type="button"
      className={`interpolationPill${enabled ? " active" : ""}`}
      disabled={disabled || switching}
      aria-label="Frame interpolation"
      aria-pressed={enabled}
      aria-busy={switching}
      title={switching ? "Switching frame interpolation…" : enabled ? "2× frame interpolation is on. Click to turn off" : "Frame interpolation is off. Click to turn on"}
      onClick={onToggle}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M13.7 2.3a.75.75 0 0 0-1.3-.5L4.2 13a.75.75 0 0 0 .6 1.2h5.6l-.9 7.5a.75.75 0 0 0 1.3.5L19.8 11a.75.75 0 0 0-.6-1.2h-6.3l.8-7.5Z" />
      </svg>
      <span>2x</span>
    </button>
  );
}
