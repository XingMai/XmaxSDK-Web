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
  type RealtimeState,
  type XmaxRealtimeManaging,
} from "@xmax/sdk";
import { XmaxVideo } from "@xmax/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { STYLE_PRESETS, type StylePreset } from "./presets";

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
  const [selectedPreset, setSelectedPreset] = useState<string | undefined>();
  const [referencePreview, setReferencePreview] = useState<string | undefined>();
  const [referencePath, setReferencePath] = useState<string | undefined>();
  const [referenceUploading, setReferenceUploading] = useState(false);
  const [examplesVisible, setExamplesVisible] = useState(true);
  const [localStream, setLocalStream] = useState<RealtimeMediaStream | undefined>();
  const [remoteStream, setRemoteStream] = useState<RealtimeMediaStream | undefined>();
  const [stateText, setStateText] = useState<RealtimeConnectionState>(
    RealtimeConnectionState.idle,
  );
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [errorText, setErrorText] = useState("");
  const [busy, setBusy] = useState(false);

  const realtimeRef = useRef<XmaxRealtimeManaging | undefined>(undefined);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const wechatRef = useRef<HTMLDivElement>(null);
  const keyFieldRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    localStorage.setItem(API_KEY_STORAGE, apiKey);
  }, [apiKey]);

  useEffect(() => {
    localStorage.setItem(PROMPT_STORAGE, prompt);
  }, [prompt]);

  // 卸载时释放实时生命周期。
  useEffect(() => {
    return () => {
      void realtimeRef.current?.close();
    };
  }, []);

  const sessionActive = localStream !== undefined;
  const isConnected =
    stateText === RealtimeConnectionState.connected ||
    stateText === RealtimeConnectionState.generating;
  const isGenerating = stateText === RealtimeConnectionState.generating;

  function attachStateListener(realtime: XmaxRealtimeManaging) {
    return realtime.setStateListener((state: RealtimeState) => {
      setStateText(state.connectionState);
      // 连接释放后清空远端流，视图回到本地预览。
      if (
        state.connectionState !== RealtimeConnectionState.connected &&
        state.connectionState !== RealtimeConnectionState.generating
      ) {
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
   * 未填写 API Key 时只开启本地预览。
   */
  async function handleStart() {
    setBusy(true);
    setErrorText("");
    try {
      const realtime = client.createRealtimeManager(
        new RealtimeConfiguration({ model }),
      );
      realtimeRef.current = realtime;
      await attachStateListener(realtime);
      const stream = await realtime.createLocalCameraStream({
        videoFormat: CAMERA_VIDEO_FORMAT,
        position: CameraPosition.front,
        useMicrophone,
      });
      setLocalStream(stream);
      if (!apiKey) {
        return;
      }
      const remote = await realtime.startGeneration({
        localStream: stream,
        context: new RealtimeContext({ prompt, referencePath }),
      });
      setRemoteStream(remote);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  /** 提交生成条件：未生成时开始生成，生成中更新条件。 */
  async function handleSubmitPrompt() {
    const realtime = realtimeRef.current;
    if (!realtime || !localStream || !apiKey) {
      return;
    }
    setBusy(true);
    setErrorText("");
    try {
      const remote = await realtime.startGeneration({
        localStream,
        context: new RealtimeContext({ prompt, referencePath }),
      });
      setRemoteStream(remote);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleSwitchCamera() {
    const realtime = realtimeRef.current;
    if (!realtime) {
      return;
    }
    setBusy(true);
    setErrorText("");
    try {
      const stream = await realtime.switchCamera();
      setLocalStream(stream);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  /** 选中风格预设：拉取参考图上传为生成条件；生成中自动应用。 */
  async function handleSelectPreset(preset: StylePreset) {
    if (!apiKey) {
      setErrorText("Uploading a reference image requires an API Key");
      return;
    }
    setSelectedPreset(preset.name);
    setReferenceUploading(true);
    setErrorText("");
    try {
      const response = await fetch(preset.reference);
      if (!response.ok) {
        throw new Error(`Failed to load preset image (${response.status})`);
      }
      const data = await response.blob();
      const stored = await client.createStorageService().uploadImage({
        data,
        fileName: `${preset.name.replace(/\s+/g, "-").toLowerCase()}.png`,
        contentType: data.type || "image/png",
      });
      setReferencePreview(preset.thumbnail);
      setReferencePath(stored.url);
      // 生成中选中预设时立即应用新条件。
      if (isGenerating) {
        await handleSubmitPromptWith(stored.url);
      }
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      setReferenceUploading(false);
    }
  }

  /** 以指定参考图路径提交生成条件（供预设选中后立即应用）。 */
  async function handleSubmitPromptWith(reference: string) {
    const realtime = realtimeRef.current;
    if (!realtime || !localStream) {
      return;
    }
    const remote = await realtime.startGeneration({
      localStream,
      context: new RealtimeContext({ prompt, referencePath: reference }),
    });
    setRemoteStream(remote);
  }

  /** 选择本地参考图并上传，成功后作为生成条件的参考路径。 */
  async function handleReferenceChange(
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    setReferencePreview((previous) => {
      if (previous && previous.startsWith("blob:")) {
        URL.revokeObjectURL(previous);
      }
      return URL.createObjectURL(file);
    });
    setSelectedPreset(undefined);
    setReferencePath(undefined);
    setReferenceUploading(true);
    setErrorText("");
    try {
      const stored = await client.createStorageService().uploadImage({
        data: file,
        fileName: file.name,
        contentType: file.type || undefined,
      });
      setReferencePath(stored.url);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      setReferenceUploading(false);
    }
  }

  /** 清除当前参考图。 */
  function handleClearReference() {
    if (referencePreview?.startsWith("blob:")) {
      URL.revokeObjectURL(referencePreview);
    }
    setReferencePreview(undefined);
    setReferencePath(undefined);
    setSelectedPreset(undefined);
  }

  /** 停止会话并立刻回到初始界面，连接在后台释放。 */
  function handleStop() {
    const realtime = realtimeRef.current;
    realtimeRef.current = undefined;
    setLocalStream(undefined);
    setRemoteStream(undefined);
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
                  "Starting…"
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
          <button
            className="switchButton"
            onClick={handleSwitchCamera}
            disabled={busy}
            title="Switch camera"
          >
            ⇄
          </button>
        </div>
        <div className="stage">
          <XmaxVideo
            track={remoteStream?.videoTrack}
            style={{ width: "100%", height: "100%" }}
          />
          <span className="stageLabel">Result</span>
          <span className="watermark">✦ Xmax</span>
          {!remoteStream && (
            <span className="stageHint">
              {isConnected ? "Generating…" : "Waiting for connection…"}
            </span>
          )}
        </div>
      </div>

      <div className="promptBar">
        <input
          type="text"
          placeholder="Restyle to animated movie"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              void handleSubmitPrompt();
            }
          }}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={handleReferenceChange}
        />
        <button
          className="uploadButton"
          onClick={() => fileInputRef.current?.click()}
          disabled={referenceUploading || !apiKey}
          title={apiKey ? "" : "Uploading a reference image requires an API Key"}
        >
          ⤒ Upload image
        </button>
        <button
          className="submitButton"
          onClick={handleSubmitPrompt}
          disabled={busy || !apiKey || referenceUploading}
          title={apiKey ? "" : "Generation requires an API Key"}
        >
          ➜
        </button>
      </div>

      {referencePreview && (
        <div className="referenceChip">
          <img src={referencePreview} alt="Reference" />
          <span>
            {referenceUploading
              ? "Uploading…"
              : referencePath
                ? "Reference ready"
                : "Not uploaded"}
          </span>
          <button className="chipClose" onClick={handleClearReference}>
            ×
          </button>
        </div>
      )}

      <div className="examplesSection">
        <button
          className="examplesToggle"
          onClick={() => setExamplesVisible((visible) => !visible)}
        >
          {examplesVisible ? "Hide Examples ⌃" : "Show Examples ⌄"}
        </button>
        {examplesVisible && (
          <div className="presetRow">
            {STYLE_PRESETS.map((preset) => (
              <button
                key={preset.name}
                className={
                  selectedPreset === preset.name ? "presetItem active" : "presetItem"
                }
                onClick={() => void handleSelectPreset(preset)}
                disabled={referenceUploading}
              >
                <img src={preset.thumbnail} alt={preset.name} loading="lazy" />
                <span>{preset.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {errorText && <div className="error">{errorText}</div>}
    </div>
  );
}
