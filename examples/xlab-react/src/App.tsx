import {
  CameraPosition,
  RealtimeConfiguration,
  RealtimeConnectionState,
  RealtimeContext,
  RealtimeModel,
  RealtimeVideoFormat,
  XmaxClient,
  XmaxConfiguration,
  XmaxEnvironment,
  XmaxLoggerOption,
  type RealtimeMediaStream,
  type RealtimeLaunchTiming,
  type VideoStatistics,
  type RemoteVideoStatistics,
  type RealtimeState,
  type XmaxRealtimeManaging,
} from "@xmax/sdk";
import { XmaxVideo } from "@xmax/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { EXAMPLE_MODES, type ExampleModeKey } from "./presets";
import { ReferenceLibrary, type ReferenceItem } from "./ReferenceLibrary";

const API_KEY_STORAGE = "xmax.xlab.apiKey";
const PROMPT_STORAGE = "xmax.xlab.prompt";

/** 相机采集格式：横屏 1920×1024（x2.0 受像素上限约束会自动等比缩小）。 */
const CAMERA_VIDEO_FORMAT = new RealtimeVideoFormat({
  width: 1920,
  height: 1024,
  fps: 30,
});

/** 会话计时的显示文案（mm:ss）。 */
function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatLaunchTiming(milliseconds?: number): string {
  return milliseconds === undefined ? "—" : `${Math.round(milliseconds)} ms`;
}

function formatVideoMetric(value: number | undefined, unit: string): string {
  return value === undefined ? "—" : `${Number(value.toFixed(1))} ${unit}`;
}

function formatVideoResolution(statistics?: VideoStatistics): string {
  return statistics?.width !== undefined && statistics.height !== undefined
    ? `${statistics.width} × ${statistics.height}`
    : "—";
}

export function App() {
  const [apiKey, setApiKey] = useState(
    () => localStorage.getItem(API_KEY_STORAGE) ?? "",
  );
  const [model] = useState<RealtimeModel>(RealtimeModel.x2_fast_1080p);
  const [wechatOpen, setWechatOpen] = useState(false);
  const [keyEditorOpen, setKeyEditorOpen] = useState(false);
  const [useMicrophone, setUseMicrophone] = useState(true);
  const [prompt, setPrompt] = useState(
    () =>
      localStorage.getItem(PROMPT_STORAGE) ??
      "Turn the scene into a cyberpunk style",
  );
  const [activeModeKey, setActiveModeKey] = useState<ExampleModeKey>("charx");
  const [presetLineCapacity, setPresetLineCapacity] = useState(0);
  const [localStream, setLocalStream] = useState<RealtimeMediaStream | undefined>();
  const [remoteStream, setRemoteStream] = useState<RealtimeMediaStream | undefined>();
  const [stateText, setStateText] = useState<RealtimeConnectionState>(
    RealtimeConnectionState.idle,
  );
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [launchTiming, setLaunchTiming] = useState<RealtimeLaunchTiming>({});
  const [localVideoStatistics, setLocalVideoStatistics] = useState<VideoStatistics>();
  const [remoteVideoStatistics, setRemoteVideoStatistics] = useState<RemoteVideoStatistics>();
  const [errorText, setErrorText] = useState("");
  const [busy, setBusy] = useState(false);

  const realtimeRef = useRef<XmaxRealtimeManaging | undefined>(undefined);
  const generationBusyRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const wechatRef = useRef<HTMLDivElement>(null);
  const keyFieldRef = useRef<HTMLDivElement>(null);
  const presetRowRef = useRef<HTMLDivElement>(null);

  // 点击微信图标外部时收起二维码弹层。
  useEffect(() => {
    if (!wechatOpen) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      if (!wechatRef.current?.contains(event.target as Node)) {
        setWechatOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [wechatOpen]);

  // 点击 Key 编辑器外部时收起弹层。
  useEffect(() => {
    if (!keyEditorOpen) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      if (!keyFieldRef.current?.contains(event.target as Node)) {
        setKeyEditorOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [keyEditorOpen]);

  // 会话计时：本地流建立后从 00:00 开始，停止时清零。
  useEffect(() => {
    if (!localStream) {
      setElapsedSeconds(0);
      return;
    }
    const startedAt = Date.now();
    setElapsedSeconds(0);
    const timer = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [localStream]);

  const client = useMemo(
    () =>
      new XmaxClient(
        new XmaxConfiguration({
          apiKey: apiKey || "xlab-local-preview",
          environment: XmaxEnvironment.china,
          loggerOptions: XmaxLoggerOption.all,
        }),
      ),
    [apiKey],
  );

  const clientRef = useRef(client);
  clientRef.current = client;
  const [references] = useState(() => new ReferenceLibrary(async (item, onProgress) => {
    // 内置预设首次使用也上传 COS，成功地址缓存在条目中，后续点击直接复用。
    let data: Blob;
    if (item.file) {
      data = item.file;
    } else {
      const response = await fetch(item.source_url!);
      if (!response.ok) throw new Error(`Failed to load preset image (${response.status})`);
      data = await response.blob();
    }
    const stored = await clientRef.current.createStorageService().uploadImage({
      data,
      fileName: item.file?.name ?? `${item.name.replace(/\s+/g, "-").toLowerCase()}.png`,
      contentType: data.type || undefined,
      onProgress,
    });
    return stored.url;
  }));
  const [referenceItems, setReferenceItems] = useState(references.snapshot);
  useEffect(() => {
    const unsubscribe = references.subscribe(setReferenceItems);
    return () => { unsubscribe(); references.dispose(); };
  }, [references]);
  const activeReferences = referenceItems.filter((item) => item.mode === activeModeKey);
  const selectedReference = activeReferences.find((item) => item.is_selected);
  const referencePath = selectedReference?.reference_path;
  const referencePreview = selectedReference?.thumbnail;
  const referenceUploading = activeReferences.some((item) => item.upload_status === "uploading");

  useEffect(() => {
    localStorage.setItem(API_KEY_STORAGE, apiKey);
  }, [apiKey]);

  useEffect(() => {
    localStorage.setItem(PROMPT_STORAGE, prompt);
  }, [prompt]);

  // 卸载时释放实时生命周期。
  useEffect(() => {
    return () => {
      const realtime = realtimeRef.current;
      realtimeRef.current = undefined;
      void realtime?.close();
    };
  }, []);

  const sessionActive = localStream !== undefined;

  /** 当前页签模式与提交生成时使用的文本条件。 */
  const activeMode =
    EXAMPLE_MODES.find((mode) => mode.key === activeModeKey) ??
    EXAMPLE_MODES[0]!;
  const submitPrompt = activeMode.key === "free" ? prompt : selectedReference?.prompt ?? activeMode.prompt;

  // 预设列表滚动：纵向滚轮映射为横向滚动，左键按住可拖拽滚动。
  useEffect(() => {
    const row = presetRowRef.current;
    if (!row) {
      return;
    }

    const handleWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
        event.preventDefault();
        row.scrollLeft += event.deltaY;
      }
    };

    let dragging = false;
    let moved = false;
    let startX = 0;
    let startScrollLeft = 0;

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) {
        return;
      }
      dragging = true;
      moved = false;
      startX = event.clientX;
      startScrollLeft = row.scrollLeft;
    };
    const handlePointerMove = (event: PointerEvent) => {
      if (!dragging) {
        return;
      }
      const deltaX = event.clientX - startX;
      if (Math.abs(deltaX) > 4) {
        moved = true;
        row.classList.add("dragging");
        // 真正拖动后才捕获指针，否则普通点击会被重定向到容器，无法选中图片。
        if (!row.hasPointerCapture(event.pointerId)) row.setPointerCapture(event.pointerId);
      }
      row.scrollLeft = startScrollLeft - deltaX;
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

    row.addEventListener("wheel", handleWheel, { passive: false });
    row.addEventListener("pointerdown", handlePointerDown);
    row.addEventListener("pointermove", handlePointerMove);
    row.addEventListener("pointerup", handlePointerEnd);
    row.addEventListener("pointercancel", handlePointerEnd);
    row.addEventListener("click", handleClickCapture, true);

    // 测量可视宽度能容纳的预设个数，用于决定第一行填多少再换行。
    const measureCapacity = () => {
      const item = row.querySelector<HTMLElement>(".presetItem");
      if (!item) {
        return;
      }
      const pitch = item.getBoundingClientRect().width + 14;
      setPresetLineCapacity(
        Math.max(1, Math.floor((row.clientWidth + 14) / pitch)),
      );
    };
    const resizeObserver = new ResizeObserver(measureCapacity);
    resizeObserver.observe(row);
    measureCapacity();

    return () => {
      resizeObserver.disconnect();
      row.removeEventListener("wheel", handleWheel);
      row.removeEventListener("pointerdown", handlePointerDown);
      row.removeEventListener("pointermove", handlePointerMove);
      row.removeEventListener("pointerup", handlePointerEnd);
      row.removeEventListener("pointercancel", handlePointerEnd);
      row.removeEventListener("click", handleClickCapture, true);
    };
  }, [sessionActive, activeModeKey]);
  const isConnected =
    stateText === RealtimeConnectionState.connected ||
    stateText === RealtimeConnectionState.generating;

  function attachStateListener(
    realtime: XmaxRealtimeManaging,
    onConnected?: () => void,
  ) {
    // 会话建立成功的回调只触发一次，generating 等后续状态不再重复调用。
    let connectedNotified = false;
    return realtime.setStateListener((state: RealtimeState) => {
      if (realtimeRef.current !== realtime) return;
      setStateText(state.connectionState);
      if (
        state.connectionState === RealtimeConnectionState.connected ||
        state.connectionState === RealtimeConnectionState.generating
      ) {
        // 会话建立成功后立刻切换到生成页面，不等待首帧。
        if (!connectedNotified) {
          connectedNotified = true;
          onConnected?.();
        }
      } else {
        // 连接释放后清空远端流，视图回到本地预览。
        setRemoteStream(undefined);
      }
      if (state.reason?.kind === "failure") {
        setErrorText(`${state.reason.error.code}: ${state.reason.error.message}`);
      }
    });
  }

  /**
   * 一键完成开启摄像头到开始生成的完整流程。
   *
   * 先校验 API Key，再打开摄像头；会话建立成功即切换到生成页面，
   * 首帧等待等后续过程在生成页面内完成。
   */
  async function handleStart() {
    if (generationBusyRef.current) return;
    if (!apiKey) {
      setErrorText("API Key is required");
      return;
    }
    generationBusyRef.current = true;
    setBusy(true);
    setErrorText("");
    const realtime = client.createRealtimeManager(
      new RealtimeConfiguration({ model }),
    );
    realtimeRef.current = realtime;
    // 会话建立成功后是否已切换到生成页面。
    let switchedToSession = false;
    try {
      await realtime.setLaunchTimingListener((timing) => {
        if (realtimeRef.current === realtime) {
          setLaunchTiming(timing);
        }
      });
      await realtime.setLocalVideoStatisticsListener((statistics) => {
        if (realtimeRef.current === realtime) {
          setLocalVideoStatistics(statistics);
        }
      });
      await realtime.setRemoteVideoStatisticsListener((statistics) => {
        if (realtimeRef.current === realtime) {
          setRemoteVideoStatistics(statistics);
        }
      });
      const stream = await realtime.createLocalCameraStream({
        videoFormat: CAMERA_VIDEO_FORMAT,
        position: CameraPosition.front,
        useMicrophone,
      });
      await attachStateListener(realtime, () => {
        switchedToSession = true;
        setLocalStream(stream);
      });
      const remote = await realtime.startGeneration({
        localStream: stream,
        context: new RealtimeContext({ prompt: submitPrompt, referencePath }),
      });
      setRemoteStream(remote);
    } catch (error) {
      if (!switchedToSession) {
        // 会话尚未建立时释放本次会话，停留在初始界面。
        if (realtimeRef.current === realtime) {
          realtimeRef.current = undefined;
        }
        void realtime.close();
      }
      setErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      generationBusyRef.current = false;
      setBusy(false);
    }
  }

  /** 提交生成条件：未生成时开始生成，生成中更新条件。 */
  async function handleSubmitPrompt() {
    if (referenceUploading) return;
    await submitContext(new RealtimeContext({ prompt: submitPrompt, referencePath }));
  }

  /** 所有选图和文本提交共用生成入口，条件显式传入，避免读取旧的 React state。 */
  async function submitContext(context: RealtimeContext) {
    const realtime = realtimeRef.current;
    if (!realtime || !localStream || !apiKey || generationBusyRef.current) {
      return;
    }
    generationBusyRef.current = true;
    setBusy(true);
    setErrorText("");
    try {
      const remote = await realtime.startGeneration({
        localStream,
        context,
      });
      if (realtimeRef.current === realtime) setRemoteStream(remote);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      generationBusyRef.current = false;
      setBusy(false);
    }
  }

  /** 上传完成和普通点击均走同一条选中、生成逻辑。 */
  async function applyReference(item: ReferenceItem) {
    if (item.mode === "free") setPrompt(item.prompt);
    await submitContext(new RealtimeContext({ prompt: item.prompt, referencePath: item.reference_path }));
  }

  async function handleSelectReference(item: ReferenceItem) {
    if (!apiKey || generationBusyRef.current) return;
    setErrorText("");
    try {
      await references.select(item.id, applyReference);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error));
    }
  }

  /** 本地文件立即插入列表首位预览，上传期间显示条目 loading，成功后自动选中。 */
  async function handleReferenceChange(
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !apiKey || generationBusyRef.current) {
      return;
    }
    setErrorText("");
    try {
      const uploading = references.addFile(file, submitPrompt, applyReference);
      if (presetRowRef.current) presetRowRef.current.scrollLeft = 0;
      await uploading;
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error));
    }
  }

  /** 清除当前参考图。 */
  function handleClearReference() {
    references.clearSelection();
  }

  function handleModeChange(mode: ExampleModeKey) {
    references.setMode(mode);
    setActiveModeKey(mode);
    setErrorText("");
  }

  /** 停止会话并立刻回到初始界面，连接在后台释放。 */
  function handleStop() {
    references.clearSelection();
    const realtime = realtimeRef.current;
    realtimeRef.current = undefined;
    setLocalStream(undefined);
    setRemoteStream(undefined);
    setLocalVideoStatistics(undefined);
    setRemoteVideoStatistics(undefined);
    setStateText(RealtimeConnectionState.idle);
    setErrorText("");
    void realtime?.close();
  }

  /** 页脚：左侧社交入口，右侧法务与平台链接。 */
  const footer = (
    <footer className="siteFooter">
      <div className="footerSocial">
        <div className="wechat" ref={wechatRef}>
          <button
            type="button"
            aria-label="WeChat"
            onClick={() => setWechatOpen((open) => !open)}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <g transform="translate(-1.8 -1.8) scale(1.15)">
                <path d="M9.3 4C5.6 4 2.6 6.6 2.6 9.9c0 1.9 1 3.5 2.6 4.6l-.7 2.2 2.4-1.2c.7.2 1.5.3 2.4.3h.5c-.1-.4-.2-.9-.2-1.3 0-3.1 2.9-5.6 6.4-5.6h.3C15.7 6.2 12.8 4 9.3 4Zm-2 3.2a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8Zm4.4 0a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8Z" />
                <path d="M15.8 9.9c-3.1 0-5.6 2-5.6 4.6 0 2.5 2.5 4.6 5.6 4.6.6 0 1.3-.1 1.9-.3l2 1-.5-1.8c1.3-.8 2.2-2.1 2.2-3.5 0-2.5-2.5-4.6-5.6-4.6Zm-1.6 2.5a.8.8 0 1 1 0 1.6.8.8 0 0 1 0-1.6Zm3.2 0a.8.8 0 1 1 0 1.6.8.8 0 0 1 0-1.6Z" />
              </g>
            </svg>
          </button>
          {wechatOpen && (
            <div className="wechatPopover">
              <img
                src="https://assets.22duck.fun/image/wechatAccount.jpg"
                alt="WeChat Official Account"
              />
              <span>扫码关注微信公众号</span>
            </div>
          )}
        </div>
        <a
          href="https://x.com/XmaxAIOfficial"
          target="_blank"
          rel="noreferrer"
          aria-label="X"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.451-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117l11.966 15.644Z" />
          </svg>
        </a>
        <a
          href="https://www.xmaxai.com"
          target="_blank"
          rel="noreferrer"
          aria-label="Website"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M2 12h20" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </svg>
        </a>
      </div>
      <nav className="footerLinks">
        <a href="mailto:contact@xmax.ai">Contact us</a>
        <a href="https://platform.xmaxai.com" target="_blank" rel="noreferrer">
          API Platform
        </a>
      </nav>
    </footer>
  );

  if (!sessionActive) {
    return (
      <div className="page">
        <header className="topbar">
          <div className="brand">
            <img className="brandLogo" src="/xmax-wordmark.png" alt="Xmax" />
          </div>
          <div className="topbarRight">
            <div className="keyEntry" ref={keyFieldRef}>
              <button
                type="button"
                className={apiKey ? "keyButton filled" : "keyButton"}
                onClick={() => setKeyEditorOpen((open) => !open)}
                title="API Key"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4" />
                </svg>
                {apiKey && <span className="keyValue">{apiKey}</span>}
              </button>
              {keyEditorOpen && (
                <div className="keyPopover">
                  <input
                    autoFocus
                    type="text"
                    placeholder="API Key"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === "Escape") {
                        setKeyEditorOpen(false);
                      }
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="hero">
          <h1>Experience Live AI with Xmax</h1>
          <div className="heroStage">
            <div className="heroActions">
              <button
                className="startButton"
                onClick={handleStart}
                disabled={busy}
              >
                {busy ? (
                  <>
                    <span className="spinner" aria-hidden="true" />
                    Starting…
                  </>
                ) : (
                  <>
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="m16 10 6-3.5v11L16 14" />
                      <rect x="2" y="6" width="14" height="12" rx="3" />
                    </svg>
                    Start Camera
                  </>
                )}
              </button>
              <button
                type="button"
                role="switch"
                aria-checked={useMicrophone}
                className={useMicrophone ? "micToggle on" : "micToggle"}
                onClick={() => setUseMicrophone((on) => !on)}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" x2="12" y1="19" y2="22" />
                </svg>
                Microphone
                <span className="micSwitch">
                  <span className="micKnob" />
                </span>
              </button>
            </div>
            <p className="agreement">
              By clicking Start, you agree to our{" "}
              <a
                className="agreementLink"
                href="https://platform.xmaxai.com/docs/resources/terms"
                target="_blank"
                rel="noreferrer"
              >
                Terms of Use
              </a>{" "}
              and{" "}
              <a
                className="agreementLink"
                href="https://platform.xmaxai.com/docs/resources/privacy"
                target="_blank"
                rel="noreferrer"
              >
                Privacy Policy
              </a>
              .
            </p>
          </div>
          {errorText && <div className="error">{errorText}</div>}
        </main>
        {footer}
      </div>
    );
  }

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <img className="brandLogo" src="/xmax-wordmark.png" alt="Xmax" />
        </div>
        <div className="sessionControls">
          <span className="sessionTimer">{formatElapsed(elapsedSeconds)}</span>
          <button
            className="stopButton"
            onClick={handleStop}
            disabled={busy}
          >
            ■ Stop Session
          </button>
        </div>
      </header>

      <div className="stageRow">
        <div className="stage">
          <XmaxVideo
            track={localStream?.videoTrack}
            style={{ width: "100%", height: "100%" }}
          />
          <span className="stageLabel">Local</span>
          <div className="localStatistics">
            <dl className="launchTiming" aria-label="启动耗时统计">
              <div><dt>打开摄像头</dt><dd>{formatLaunchTiming(launchTiming.cameraMs)}</dd></div>
              <div><dt>建立连接</dt><dd>{formatLaunchTiming(launchTiming.connectionMs)}</dd></div>
              <div><dt>首帧到达</dt><dd>{formatLaunchTiming(launchTiming.firstFrameMs)}</dd></div>
              <div className="launchTimingTotal"><dt>完整启动耗时</dt><dd>{formatLaunchTiming(launchTiming.totalMs)}</dd></div>
            </dl>
            <dl className="videoStatistics" aria-label="本地视频统计">
              <div><dt>本地分辨率</dt><dd>{formatVideoResolution(localVideoStatistics)}</dd></div>
              <div><dt>本地帧率</dt><dd>{formatVideoMetric(localVideoStatistics?.frameRate, "fps")}</dd></div>
              <div><dt>本地码率</dt><dd>{formatVideoMetric(localVideoStatistics?.bitrateKbps, "kbps")}</dd></div>
            </dl>
          </div>
        </div>
        <div className="stage">
          <XmaxVideo
            track={remoteStream?.videoTrack}
            style={{ width: "100%", height: "100%" }}
          />
          <span className="stageLabel">Result</span>
          <dl className="videoStatistics" aria-label="生成结果视频统计">
            <div><dt>分辨率</dt><dd>{formatVideoResolution(remoteVideoStatistics)}</dd></div>
            <div><dt>帧率</dt><dd>{formatVideoMetric(remoteVideoStatistics?.frameRate, "fps")}</dd></div>
            <div><dt>码率</dt><dd>{formatVideoMetric(remoteVideoStatistics?.bitrateKbps, "kbps")}</dd></div>
            <div><dt>RTT（云端）</dt><dd>{formatVideoMetric(remoteVideoStatistics?.rttMs, "ms")}</dd></div>
            <div><dt>E2E（RTC 估算）</dt><dd>{formatVideoMetric(remoteVideoStatistics?.endToEndDelayMs, "ms")}</dd></div>
          </dl>
          <span className="watermark">✦ Xmax</span>
          {!remoteStream && (
            <span className="stageHint">
              {isConnected ? "Generating…" : "Waiting for connection…"}
            </span>
          )}
        </div>
      </div>

      <div className="modeSection">
        <div className="modeTabs">
          {EXAMPLE_MODES.map((mode) => (
            <button
              key={mode.key}
              className={
                mode.key === activeModeKey ? "modeTab active" : "modeTab"
              }
              onClick={() => handleModeChange(mode.key)}
              disabled={busy}
            >
              {mode.label}
            </button>
          ))}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={handleReferenceChange}
        />

        {activeMode.key === "free" && (
          <div className="promptBar">
            <input
              type="text"
              placeholder="Describe how you want the video to change"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void handleSubmitPrompt();
                }
              }}
            />
            <button
              className="submitButton"
              onClick={handleSubmitPrompt}
              disabled={busy || !apiKey || referenceUploading}
              title={apiKey ? "" : "Generation requires an API Key"}
            >
              ➜
            </button>
          </div>
        )}
          <div className="presetRow" ref={presetRowRef}>
            {(() => {
              const uploadItem = (
                <button
                  key="__upload__"
                  className="presetItem uploadItem"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={busy || !apiKey}
                  title={apiKey ? "Upload your own reference image" : "Uploading a reference image requires an API Key"}
                >
                  <span className="uploadCircle">＋</span>
                  <span>Upload</span>
                </button>
              );
              const items = [
                ...activeReferences.map((preset) => (
                  <button
                    key={preset.id}
                    className={
                      preset.is_selected ? "presetItem active" : "presetItem"
                    }
                    onClick={() => void handleSelectReference(preset)}
                    disabled={busy || !apiKey || preset.upload_status === "uploading"}
                    aria-pressed={preset.is_selected}
                    aria-busy={preset.upload_status === "uploading"}
                    title={preset.error ? `${preset.error} — Click to retry` : preset.name}
                  >
                    <span className="presetThumbnail">
                      <img src={preset.thumbnail} alt={preset.name} loading="lazy" draggable={false} />
                      {preset.upload_status === "uploading" && (
                        <span className="presetUploadOverlay" role="status">
                          <span className="presetSpinner" />
                          {preset.upload_progress ? `${preset.upload_progress}%` : "Uploading…"}
                        </span>
                      )}
                      {preset.upload_status === "error" && (
                        <span className="presetUploadOverlay presetUploadError">Retry</span>
                      )}
                    </span>
                    <span>{preset.name}</span>
                  </button>
                )),
              ];
              // 新上传的参考图排在最前，上传入口仍靠近列表起点。
              items.splice(activeReferences.filter((item) => item.file).length, 0, uploadItem);
              // 第一行优先填满可视宽度，装不下时两行均分后横向滚动。
              const perLine = Math.max(
                presetLineCapacity || 1,
                Math.ceil(items.length / 2),
              );
              const lines = [items.slice(0, perLine), items.slice(perLine)];
              return lines
                .filter((line) => line.length > 0)
                .map((line, lineIndex) => (
                  <div className="presetLine" key={lineIndex}>
                    {line}
                  </div>
                ));
            })()}
          </div>
      </div>

      {referencePreview && (
        <div className="referenceChip">
          <img src={referencePreview} alt="Reference" />
          <span>Reference ready</span>
          <button className="chipClose" onClick={handleClearReference} disabled={busy}>
            ×
          </button>
        </div>
      )}

      {errorText && <div className="error">{errorText}</div>}
    </div>
  );
}
