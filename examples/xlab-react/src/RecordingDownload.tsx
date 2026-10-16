export interface RecordingDownloadFile {
  url: string;
  fileName: string;
  interrupted: boolean;
}

/** 使用实际容器类型生成文件名，不把 WebM 录像误标成 MP4。 */
export function recordingFileName(taskID: string, mimeType: string): string {
  const type = mimeType.split(";")[0]?.trim().toLowerCase();
  const extension = type === "video/mp4" ? "mp4" : type === "video/webm" ? "webm" : "bin";
  const safeTaskID = taskID.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100);
  return `xmax-recording-${safeTaskID || "video"}.${extension}`;
}

/** 仅在收到可保存的录制结果后展示，下载由用户点击触发。 */
export function RecordingDownload({ file }: { file?: RecordingDownloadFile }) {
  if (!file) return null;

  const label = file.interrupted ? "Download partial recording" : "Download recording";
  return (
    <a
      className="recordingDownload"
      href={file.url}
      download={file.fileName}
      aria-label={label}
      title={file.interrupted ? "Recording ended early. Click to download the saved clip" : "Recording complete. Click to download the video"}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4" />
      </svg>
      <span>{file.interrupted ? "Partial recording" : "Recording"}</span>
    </a>
  );
}
