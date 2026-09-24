import type { RefObject } from "react";
import type { ReferenceItem } from "./ReferenceLibrary";

interface ReferenceListProps {
  items: readonly ReferenceItem[];
  rowRef: RefObject<HTMLDivElement>;
  disabled: boolean;
  onUpload: () => void;
  onSelect: (item: ReferenceItem) => void;
}

/** Upload 占第一个格子，其余参考图按行自动换行，纵向滚动浏览。 */
export function ReferenceList({ items, rowRef, disabled, onUpload, onSelect }: ReferenceListProps) {
  return (
    <div className={disabled ? "presetRow disabled" : "presetRow"} ref={rowRef}>
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
