import { useEffect, useRef, type FocusEvent } from "react";

interface PopoverInteractionOptions {
  open: boolean;
  initialFocus: string;
  onOpenChange: (open: boolean) => void;
}

/**
 * 统一弹层的初始焦点、外部点击、Esc 关闭和焦点离开行为。
 */
export function usePopoverInteraction({ open, initialFocus, onOpenChange }: PopoverInteractionOptions) {
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    rootRef.current?.querySelector<HTMLElement>(initialFocus)?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onOpenChange(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      onOpenChange(false);
      buttonRef.current?.focus();
    };

    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, initialFocus, onOpenChange]);

  function onBlur(event: FocusEvent<HTMLDivElement>) {
    // 原生滑杆可能暂时失焦，relatedTarget 为空时不能关闭弹层。
    // 明确移到外部才收起；点击不可聚焦区域由 pointerdown 处理。
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) onOpenChange(false);
  }

  return { rootRef, buttonRef, onBlur };
}
