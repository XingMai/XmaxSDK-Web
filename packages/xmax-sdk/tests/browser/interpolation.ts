import { RealtimeVideoTrack, XmaxVideoView } from "../../src/index";
import { RemoteVideoFramePipeline } from "../../src/Render/Video/RemoteVideoFramePipeline";
import { FrameInterpolationManager } from "../../src/Foundation/Media/Video/FrameInterpolationManager";

// Test-page-only instrumentation; no new SDK API or production per-frame logging.
const presentation = { frames: 0, midpoints: 0, regressions: 0 };
const lastPresented = new WeakMap<object, number>();
const prototype = RemoteVideoFramePipeline.prototype as unknown as {
  present(time: number, draw: () => void): void;
};
const originalPresent = prototype.present;
prototype.present = function (time, draw) {
  originalPresent.call(this, time, () => {
    const last = lastPresented.get(this);
    if (last !== undefined && time < last) presentation.regressions++;
    draw();
    lastPresented.set(this, time);
    presentation.frames++;
  });
};
const originalMidpoint = FrameInterpolationManager.prototype.presentInterpolated;
FrameInterpolationManager.prototype.presentInterpolated = function () {
  originalMidpoint.call(this);
  presentation.midpoints++;
};

const input = document.createElement("canvas");
const query = new URLSearchParams(location.search);
const jitter = query.get('jitter') === '1';
input.width = Number(query.get("width")) || 320;
input.height = Number(query.get("height")) || 180;
const context = input.getContext("2d")!;
context.scale(input.width / 320, input.height / 180);
let phase = 0;
function draw() {
  const time = performance.now() / 1000;
  context.fillStyle = "#10233b";
  context.fillRect(0, 0, 320, 180);
  context.fillStyle = "#fff";
  context.fillRect(12, 12, 20, 20); // orientation marker at top-left
  context.fillStyle = "#14d3aa";
  context.beginPath();
  context.arc(160 + Math.sin(time * 1.5) * 110, 90, 25, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#fff";
  context.font = "16px sans-serif";
  context.fillText(`input ${++phase}`, 12, 164);
}
draw();
const stream = input.captureStream(jitter ? 0 : 25);
const inputTrack = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
const intervals = jitter ? [40, 40, 20, 60, 40, 80, 40, 40] : [40];
let tick = 0;
let timer: ReturnType<typeof setTimeout>;
function nextInput() {
  draw();
  if (jitter) inputTrack.requestFrame();
  timer = setTimeout(nextInput, intervals[tick++ % intervals.length]);
}
timer = setTimeout(nextInput, 40);
const source = document.createElement("video");
source.autoplay = true;
source.muted = true;
source.playsInline = true;
source.srcObject = stream;
document.getElementById("source")!.appendChild(source);
const view = new XmaxVideoView();
view.element.style.width = "100%";
view.element.style.height = "100%";
view.attach(document.getElementById("result")!);
const track = new RealtimeVideoTrack({ id: "interpolation-browser-check" });
track.mediaStreamTrack = stream.getVideoTracks()[0];
view.track = track;

const state = { requested: true, active: false, activations: 0, errors: [] as string[], attached: true, jitter };
function status() {
  document.getElementById("status")!.textContent = JSON.stringify({ ...state, presentation }, null, 2);
}
const statusTimer = setInterval(status, 1000);
function setEnabled(enabled: boolean) {
  state.requested = enabled;
  view.setFrameInterpolation(enabled ? {
    size: { width: input.width, height: input.height }, targetFrameRate: 60,
    onActiveChange: (active) => { state.active = active; if (active) state.activations++; status(); },
    onFailure: (error) => { state.errors.push(String(error)); status(); },
  } : undefined);
  status();
}
function toggleMount() {
  state.attached = !state.attached;
  if (state.attached) view.attach(document.getElementById("result")!);
  else view.detach();
  status();
}
setEnabled(true);
document.getElementById("toggle")!.onclick = () => setEnabled(!state.requested);
document.getElementById("detach")!.onclick = toggleMount;

const check = {
  state, setEnabled, toggleMount,
  stop: () => { view.track = undefined; view.detach(); clearTimeout(timer); clearInterval(statusTimer); stream.getTracks().forEach((t) => t.stop()); },
};
Object.assign(window, { interpolationCheck: check });
window.addEventListener("pagehide", check.stop, { once: true });
