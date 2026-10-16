import { useEffect, useId, useState } from "react";
import { usePopoverInteraction } from "./usePopoverInteraction";

interface RemoteVolumeControlProps {
  volume: number;
  disabled?: boolean;
  onChange: (volume: number) => void;
}

export function RemoteVolumeControl({ volume, disabled = false, onChange }: RemoteVolumeControlProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const percent = Math.round(volume * 100);
  const expanded = open && !disabled;
  const { rootRef, buttonRef, onBlur } = usePopoverInteraction({
    open: expanded,
    initialFocus: 'input[type="range"]',
    onOpenChange: setOpen,
  });

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  return (
    <div className="remoteVolumeControl" ref={rootRef} onBlur={onBlur}>
      <button
        ref={buttonRef}
        type="button"
        className={`remoteVolumeButton${percent > 0 ? " active" : ""}`}
        disabled={disabled}
        aria-label={`远端音量：${percent === 0 ? "静音" : `${percent}%`}`}
        aria-expanded={expanded}
        aria-controls={expanded ? id : undefined}
        aria-haspopup="dialog"
        title="调整远端播放音量"
        onClick={() => setOpen((value) => !value)}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M11 4 6 8H3v8h3l5 4Z" />
          {percent === 0 ? <path d="m16 9 6 6m0-6-6 6" /> : <>
            <path d="M15 8a6 6 0 0 1 0 8" />
            {percent > 50 && <path d="M18 5a10 10 0 0 1 0 14" />}
          </>}
        </svg>
      </button>
      {expanded && (
        <div className="remoteVolumePopover" id={id} role="dialog" aria-label="远端播放音量">
          <div className="remoteVolumeHeading">
            <label htmlFor={`${id}-slider`}>远端音量</label>
            <output htmlFor={`${id}-slider`}>{percent === 0 ? "静音" : `${percent}%`}</output>
          </div>
          <input id={`${id}-slider`} type="range" min="0" max="100" step="1"
            value={percent} aria-valuetext={percent === 0 ? "静音" : `${percent}%`}
            style={{ backgroundImage: `linear-gradient(to right, var(--accent) ${percent}%, #e9ebef ${percent}%)` }}
            onChange={(event) => onChange(Number(event.currentTarget.value) / 100)} />
        </div>
      )}
    </div>
  );
}
