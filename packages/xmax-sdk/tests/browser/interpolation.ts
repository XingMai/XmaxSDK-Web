import { RealtimeVideoTrack, XmaxLogger, XmaxLoggerOption, XmaxVideoView } from "../../src/index";

// 测试页开启 SDK 日志并捕获到全局数组，便于自动化读取遥测输出。
XmaxLogger.configure(XmaxLoggerOption.all);
const logs: string[] = [];
const originalInfo = console.info.bind(console);
console.info = (...args: unknown[]) => {
  logs.push(args.map(String).join(" "));
  originalInfo(...args);
};
Object.assign(window, { __xmaxLogs: logs });

const input = document.createElement("canvas");
const query = new URLSearchParams(location.search);
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
// jitter=1 时模拟网络抖动：绘制间隔在 15-90ms 间随机，平均约 40ms。
if (query.get("jitter")) {
  const tick = () => {
    draw();
    setTimeout(tick, 15 + Math.random() * 75);
  };
  setTimeout(tick, 40);
} else if (query.get("drops")) {
  // drops=1 时模拟均匀 25fps 源流随机丢帧：约 15% 的周期不重绘。
  setInterval(() => { if (Math.random() > 0.15) draw(); }, 40);
} else {
  setInterval(draw, 40);
}
const stream = input.captureStream(25);
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

const state = { requested: true, active: false, activations: 0, errors: [] as string[], attached: true };
function status() {
  document.getElementById("status")!.textContent = JSON.stringify(state, null, 2);
}
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
  stop: () => { view.track = undefined; view.detach(); stream.getTracks().forEach((t) => t.stop()); },
};
Object.assign(window, { interpolationCheck: check });
window.addEventListener("pagehide", check.stop, { once: true });
