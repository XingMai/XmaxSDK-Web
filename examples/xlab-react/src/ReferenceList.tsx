import type { RefObject } from "react";
import type { ReferenceItem } from "./ReferenceLibrary";

interface ReferenceListProps {
  items: readonly ReferenceItem[];
  rowRef: RefObject<HTMLDivElement>;
  lineCapacity: number;
  disabled: boolean;
  onUpload: () => void;
  onSelect: (item: ReferenceItem) => void;
}

/** Web 两行布局：Upload 占第一个格子，新上传图紧随其后，两行从同一左边界排列。 */
export function ReferenceList({ items, rowRef, lineCapacity, disabled, onUpload, onSelect }: ReferenceListProps) {
  const entries = [null, ...items];
  const perLine = Math.max(lineCapacity || 1, Math.ceil(entries.length / 2));
  const lines = [entries.slice(0, perLine), entries.slice(perLine)];
  return (
      <div className={disabled ? "presetRow disabled" : "presetRow"} ref={rowRef}>
        {lines.filter((line) => line.length > 0).map((line, index) => (
          <div className="presetLine" key={index}>
            {line.map((item) => item ? (
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
                      {item.upload_progress ? `${item.upload_progress}%` : "Uploading…"}
                    </span>
                  )}
                  {item.upload_status === "error" && (
                    <span className="presetUploadOverlay presetUploadError">Retry</span>
                  )}
                </span>
                <span>{item.name}</span>
              </button>
            ) : (
              <button
                key="__upload__"
                className="presetItem uploadItem"
                onClick={onUpload}
                disabled={disabled}
                title="Upload your own reference image"
              >
                <span className="uploadCircle">＋</span>
                <span>Upload</span>
              </button>
            ))}
          </div>
        ))}
      </div>
  );
}
