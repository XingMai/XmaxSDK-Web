import {
  CameraPosition,
  RealtimeConfiguration,
  RealtimeConnectionState,
  RealtimeContext,
  RealtimeModel,
  XmaxClient,
  XmaxConfiguration,
  XmaxEnvironment,
  XmaxLoggerOption,
  defaultCameraVideoFormat,
  type RealtimeMediaStream,
  type RealtimeState,
  type XmaxRealtimeManaging,
} from "@xmax/sdk";
import { XmaxRealtimeVideo } from "@xmax/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { clearDebugLogs, useDebugLogs } from "./debugLog";

const API_KEY_STORAGE = "xmax.xlab.apiKey";
const PROMPT_STORAGE = "xmax.xlab.prompt";

export function App() {
  const [apiKey, setApiKey] = useState(
    () => localStorage.getItem(API_KEY_STORAGE) ?? "",
  );
  const [model, setModel] = useState<RealtimeModel>(RealtimeModel.x2_0);
  const [useMicrophone, setUseMicrophone] = useState(true);
  const [prompt, setPrompt] = useState(
    () => localStorage.getItem(PROMPT_STORAGE) ?? "把画面变成赛博朋克风格",
  );
  const [localStream, setLocalStream] = useState<RealtimeMediaStream | undefined>();
  const [remoteStream, setRemoteStream] = useState<RealtimeMediaStream | undefined>();
  const [stateText, setStateText] = useState<RealtimeConnectionState>(
    RealtimeConnectionState.idle,
  );
  const [errorText, setErrorText] = useState("");
  const [busy, setBusy] = useState(false);

  const realtimeRef = useRef<XmaxRealtimeManaging | undefined>(undefined);

  const logs = useDebugLogs();
  const logPanelRef = useRef<HTMLPreElement>(null);

  // 新日志到达时滚动到底部。
  useEffect(() => {
    const panel = logPanelRef.current;
    if (panel) {
      panel.scrollTop = panel.scrollHeight;
    }
  }, [logs]);

  async function handleCopyLogs() {
    const text = logs
      .map((entry) => `${entry.time} [${entry.level}] ${entry.text}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 剪贴板不可用时忽略，面板内容仍可手动复制。
    }
  }

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
        videoFormat: defaultCameraVideoFormat(model),
        position: CameraPosition.front,
        useMicrophone,
      });
      setLocalStream(stream);
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

  async function handleGenerate() {
    const realtime = realtimeRef.current;
    if (!realtime || !localStream) {
      return;
    }
    setBusy(true);
    setErrorText("");
    try {
      const remote = await realtime.startGeneration({
        localStream,
        context: new RealtimeContext({ prompt }),
      });
      setRemoteStream(remote);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    const realtime = realtimeRef.current;
    if (!realtime) {
      return;
    }
    setBusy(true);
    setErrorText("");
    try {
      await realtime.disconnect();
      setRemoteStream(undefined);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleStop() {
    const realtime = realtimeRef.current;
    setBusy(true);
    setErrorText("");
    try {
      await realtime?.close();
    } finally {
      realtimeRef.current = undefined;
      setLocalStream(undefined);
      setRemoteStream(undefined);
      setStateText(RealtimeConnectionState.idle);
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <h1>
        X-Lab<span>XmaxSDK Web · 摄像头 + 实时生成（M2 联调）</span>
      </h1>

      <div className="stage">
        <XmaxRealtimeVideo
          localTrack={localStream?.videoTrack}
          remoteTrack={remoteStream?.videoTrack}
          style={{ width: "100%", height: "100%" }}
        />
      </div>

      <div className="controls">
        <input
          type="text"
          placeholder="Xmax API Key（本地预览可不填）"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
        />
        <label>
          模型
          <select
            value={model}
            onChange={(event) => setModel(event.target.value as RealtimeModel)}
            disabled={!!localStream}
          >
            <option value={RealtimeModel.x2_0}>x2.0</option>
            <option value={RealtimeModel.x2_0_pro}>x2.0-pro</option>
            <option value={RealtimeModel.x2_fast_1080p}>x2-fast-1080p（临时）</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={useMicrophone}
            onChange={(event) => setUseMicrophone(event.target.checked)}
            disabled={!!localStream}
          />
          麦克风
        </label>
      </div>

      <div className="controls">
        <input
          type="text"
          placeholder="生成条件（prompt）"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
        />
      </div>

      <div className="controls">
        <button onClick={handleStart} disabled={busy || !!localStream}>
          开启摄像头
        </button>
        <button
          onClick={handleGenerate}
          disabled={busy || !localStream || !apiKey}
          title={apiKey ? "" : "生成需要填写 API Key"}
        >
          {isGenerating ? "更新条件" : "开始生成"}
        </button>
        <button
          className="secondary"
          onClick={handleDisconnect}
          disabled={busy || !isConnected}
        >
          断开连接
        </button>
        <button
          className="secondary"
          onClick={handleSwitchCamera}
          disabled={busy || !localStream}
        >
          切换摄像头
        </button>
        <button
          className="secondary"
          onClick={handleStop}
          disabled={busy || !localStream}
        >
          关闭
        </button>
      </div>

      <div className="status">
        状态：{stateText}
        {errorText && <div className="error">{errorText}</div>}
      </div>

      <div className="logPanel">
        <div className="logHeader">
          <span>运行日志</span>
          <button className="secondary" onClick={handleCopyLogs}>
            复制
          </button>
          <button className="secondary" onClick={clearDebugLogs}>
            清空
          </button>
        </div>
        <pre ref={logPanelRef}>
          {logs.map((entry, index) => (
            <div key={index} className={`logLine log-${entry.level}`}>
              {entry.time} [{entry.level}] {entry.text}
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}
