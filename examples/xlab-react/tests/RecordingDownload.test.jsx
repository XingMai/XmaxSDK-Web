import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RecordingDownload, recordingFileName } from "../src/RecordingDownload";

it("does not show a download entry before a result arrives", () => {
  expect(renderToStaticMarkup(<RecordingDownload />)).toBe("");
});

it.each([false, true])("offers the actual file for download, interrupted=%s", interrupted => {
  const html = renderToStaticMarkup(<RecordingDownload file={{
    url: "blob:test-recording", fileName: "xmax-recording-task.webm", interrupted,
  }} />);
  expect(html).toContain('href="blob:test-recording"');
  expect(html).toContain('download="xmax-recording-task.webm"');
  expect(html).toContain(`aria-label="${interrupted ? "Download partial recording" : "Download recording"}"`);
  expect(html).toContain('class="recordingDownload"');
  expect(html).not.toContain("disabled");
});

it.each([
  ["video/mp4;codecs=avc1,mp4a.40.2", "mp4"],
  ["video/webm;codecs=vp8,opus", "webm"],
  [" VIDEO/MP4 ", "mp4"],
  ["", "bin"],
])("uses the actual MIME type %s for the filename", (mime, extension) => {
  expect(recordingFileName("task-123", mime)).toBe(`xmax-recording-task-123.${extension}`);
});

it("sanitizes task identifiers for filenames", () => {
  expect(recordingFileName("task/a?os=web", "video/mp4")).toBe("xmax-recording-task_a_os_web.mp4");
  expect(recordingFileName("", "video/webm")).toBe("xmax-recording-video.webm");
});
