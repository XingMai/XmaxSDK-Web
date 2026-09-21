import { useEffect, useId, useRef, useState } from "react";

interface RemoteVolumeControlProps {
  volume: number;
  disabled?: boolean;
  onChange: (volume: number) => void;
}

export function RemoteVolumeControl({ volume, disabled = false, onChange }: RemoteVolumeControlProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const sliderRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const percent = Math.round(volume * 100);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!open) return;
    sliderRef.current?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="remoteVolumeControl" ref={rootRef} onBlur={(event) => {
      // 原生滑杆交互时可能暂时失焦且 relatedTarget 为 null，不能据此关闭。
      // 只有焦点明确移到控件外才收起；外部点击由 pointerdown 处理。
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
    }}>
      <button
        ref={buttonRef}
        type="button"
        className={`remoteVolumeButton${percent > 0 ? " active" : ""}`}
        disabled={disabled}
        aria-label={`远端音量：${percent === 0 ? "静音" : `${percent}%`}`}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
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
      {open && !disabled && (
        <div className="remoteVolumePopover" id={id} role="dialog" aria-label="远端播放音量">
          <div className="remoteVolumeHeading">
            <label htmlFor={`${id}-slider`}>远端音量</label>
            <output htmlFor={`${id}-slider`}>{percent === 0 ? "静音" : `${percent}%`}</output>
          </div>
          <input ref={sliderRef} id={`${id}-slider`} type="range" min="0" max="100" step="1"
            value={percent} aria-valuetext={percent === 0 ? "静音" : `${percent}%`}
            style={{ backgroundImage: `linear-gradient(to right, var(--accent) ${percent}%, #e9ebef ${percent}%)` }}
            onChange={(event) => onChange(Number(event.currentTarget.value) / 100)} />
        </div>
      )}
    </div>
  );
}
