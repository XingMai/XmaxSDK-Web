import { useEffect, type RefObject } from "react";
import type { ReferenceItem } from "./ReferenceLibrary";

interface ReferenceListProps {
  items: readonly ReferenceItem[];
  rowRef: RefObject<HTMLDivElement>;
  hidden?: boolean;
  disabled: boolean;
  onUpload: () => void;
  onSelect: (item: ReferenceItem) => void;
}

/** Upload 占第一个格子，其余参考图按行自动换行，纵向滚动浏览。 */
export function ReferenceList({ items, rowRef, hidden = false, disabled, onUpload, onSelect }: ReferenceListProps) {
  // 预设列表滚动：滚轮与触控板纵向滚动为原生行为，左键按住可上下拖拽滚动。
  useEffect(() => {
    const row = rowRef.current;
    if (!row || hidden) {
      return;
    }

    let dragging = false;
    let moved = false;
    let horizontal = false;
    let startPos = 0;
    let startScroll = 0;

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) {
        return;
      }
      dragging = true;
      moved = false;
      // 移动端为横向单列滚动，桌面端为纵向多行滚动。
      horizontal = getComputedStyle(row).flexWrap === "nowrap";
      startPos = horizontal ? event.clientX : event.clientY;
      startScroll = horizontal ? row.scrollLeft : row.scrollTop;
    };
    const handlePointerMove = (event: PointerEvent) => {
      if (!dragging) {
        return;
      }
      const delta = (horizontal ? event.clientX : event.clientY) - startPos;
      if (Math.abs(delta) > 4) {
        moved = true;
        row.classList.add("dragging");
        // 真正拖动后才捕获指针，否则普通点击会被重定向到容器，无法选中图片。
        if (!row.hasPointerCapture(event.pointerId)) row.setPointerCapture(event.pointerId);
      }
      if (horizontal) {
        row.scrollLeft = startScroll - delta;
      } else {
        row.scrollTop = startScroll - delta;
      }
    };
    const handlePointerEnd = (event: PointerEvent) => {
      dragging = false;
      row.classList.remove("dragging");
      if (row.hasPointerCapture(event.pointerId)) {
        row.releasePointerCapture(event.pointerId);
      }
    };
    const handleClickCapture = (event: MouseEvent) => {
      if (moved) {
        event.preventDefault();
        event.stopPropagation();
        moved = false;
      }
    };

    row.addEventListener("pointerdown", handlePointerDown);
    row.addEventListener("pointermove", handlePointerMove);
    row.addEventListener("pointerup", handlePointerEnd);
    row.addEventListener("pointercancel", handlePointerEnd);
    row.addEventListener("click", handleClickCapture, true);

    return () => {
      row.classList.remove("dragging");
      row.removeEventListener("pointerdown", handlePointerDown);
      row.removeEventListener("pointermove", handlePointerMove);
      row.removeEventListener("pointerup", handlePointerEnd);
      row.removeEventListener("pointercancel", handlePointerEnd);
      row.removeEventListener("click", handleClickCapture, true);
    };
  }, [rowRef, hidden]);
  return (
    <div className={disabled ? "presetRow disabled" : "presetRow"} ref={rowRef} hidden={hidden}>
      <button
        className="presetItem uploadItem"
        onClick={onUpload}
        disabled={disabled}
        title="Upload your own reference image"
      >
        <span className="uploadCircle">＋</span>
        <span>Upload</span>
      </button>
      {items.map((item) => (
        <button
          key={item.id}
          className={item.is_selected ? "presetItem active" : "presetItem"}
          onClick={() => onSelect(item)}
          disabled={disabled || item.upload_status === "uploading"}
          aria-pressed={item.is_selected}
          aria-busy={item.upload_status === "uploading"}
          title={item.error ? `${item.error} — Click to retry` : item.name}
        >
          <span className="presetThumbnail">
            <img src={item.thumbnail} alt={item.name} loading="lazy" draggable={false} />
            {item.upload_status === "uploading" && (
              <span className="presetUploadOverlay" role="status">
                <span className="presetSpinner" />
                {item.upload_progress ? `${item.upload_progress}%` : null}
              </span>
            )}
            {item.upload_status === "error" && (
              <span className="presetUploadOverlay presetUploadError">Retry</span>
            )}
          </span>
          <span>{item.name}</span>
        </button>
      ))}
    </div>
  );
}
