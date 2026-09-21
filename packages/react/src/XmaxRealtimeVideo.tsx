import {
  VideoContentMode,
  XmaxRealtimeVideoView,
  type RealtimeVideoTrack,
} from "@xmax/sdk";
import {
  useEffect,
  useRef,
  type CSSProperties,
} from "react";

export interface XmaxRealtimeVideoProps {
  /** 当前显示的本地视频轨道。 */
  localTrack?: RealtimeVideoTrack;

  /** 当前显示的远端生成视频轨道；首帧提交后自动渐入。 */
  remoteTrack?: RealtimeVideoTrack;

  /** 视频内容在容器中的显示模式，默认 fill。 */
  videoContentMode?: VideoContentMode;

  /** 容器类名。 */
  className?: string;

  /** 容器样式。 */
  style?: CSSProperties;
}

/**
 * 本地预览和远端生成画面自动切换的 React 组件。
 */
export function XmaxRealtimeVideo(props: XmaxRealtimeVideoProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<XmaxRealtimeVideoView | undefined>(undefined);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const view = new XmaxRealtimeVideoView();
    view.element.style.width = "100%";
    view.element.style.height = "100%";
    view.attach(container);
    viewRef.current = view;
    return () => {
      viewRef.current = undefined;
      view.localTrack = undefined;
      view.remoteTrack = undefined;
      view.detach();
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (view) {
      view.localTrack = props.localTrack;
    }
  }, [props.localTrack]);

  useEffect(() => {
    const view = viewRef.current;
    if (view) {
      view.remoteTrack = props.remoteTrack;
    }
  }, [props.remoteTrack]);

  useEffect(() => {
    const view = viewRef.current;
    if (view && props.videoContentMode) {
      view.videoContentMode = props.videoContentMode;
    }
  }, [props.videoContentMode]);

  return (
    <div
      ref={containerRef}
      className={props.className}
      style={{ position: "relative", overflow: "hidden", ...props.style }}
    />
  );
}
