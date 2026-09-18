import {
  CameraPosition,
  RealtimeConfiguration,
  RealtimeConnectionState,
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

const API_KEY_STORAGE = "xmax.xlab.apiKey";

export function App() {
  const [apiKey, setApiKey] = useState(
    () => localStorage.getItem(API_KEY_STORAGE) ?? "",
  );
  const [model, setModel] = useState<RealtimeModel>(RealtimeModel.x2_0);
  const [useMicrophone, setUseMicrophone] = useState(false);
  const [localStream, setLocalStream] = useState<RealtimeMediaStream | undefined>();
  const [stateText, setStateText] = useState<RealtimeConnectionState>(
    RealtimeConnectionState.idle,
  );
  const [errorText, setErrorText] = useState("");
  const [busy, setBusy] = useState(false);

  const realtimeRef = useRef<XmaxRealtimeManaging | undefined>(undefined);

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

  // 卸载时释放实时生命周期。
  useEffect(() => {
    return () => {
      void realtimeRef.current?.close();
    };
  }, []);

  async function handleStart() {
    setBusy(true);
    setErrorText("");
    try {
      const realtime = client.createRealtimeManager(
        new RealtimeConfiguration({ model }),
      );
      realtimeRef.current = realtime;
      await realtime.setStateListener((state: RealtimeState) => {
        setStateText(state.connectionState);
        if (state.reason?.kind === "failure") {
          setErrorText(`${state.reason.error.code}: ${state.reason.error.message}`);
        }
      });
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

  async function handleStop() {
    const realtime = realtimeRef.current;
    setBusy(true);
    setErrorText("");
    try {
      await realtime?.close();
    } finally {
      realtimeRef.current = undefined;
      setLocalStream(undefined);
      setStateText(RealtimeConnectionState.idle);
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <h1>
        X-Lab<span>XmaxSDK Web · 摄像头实时管线（M1）</span>
      </h1>

      <div className="stage">
        <XmaxRealtimeVideo
          localTrack={localStream?.videoTrack}
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
        <button onClick={handleStart} disabled={busy || !!localStream}>
          开启摄像头
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
    </div>
  );
}
