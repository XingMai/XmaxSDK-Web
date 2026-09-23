import {
  VideoContentMode,
  XmaxVideoView,
  type RealtimeVideoTrack,
} from "../index";
import {
  useEffect,
  useRef,
  type CSSProperties,
} from "react";

export interface XmaxVideoProps {
  /**
   * 当前显示的视频轨道；置空时清空画面。
   */
  track?: RealtimeVideoTrack;

  /**
   * 视频内容在容器中的显示模式，默认 fill。
   */
  videoContentMode?: VideoContentMode;

  /**
   * 是否镜像显示（仅影响显示，不影响发布流）。
   */
  mirrored?: boolean;

  /**
   * 容器类名。
   */
  className?: string;

  /**
   * 容器样式。
   */
  style?: CSSProperties;
}

/**
 * 单轨视频 React 组件：把一路视频轨渲染到容器。
 */
export function XmaxVideo(props: XmaxVideoProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<XmaxVideoView | undefined>(undefined);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const view = new XmaxVideoView();
    view.element.style.width = "100%";
    view.element.style.height = "100%";
    view.attach(container);
    viewRef.current = view;
    return () => {
      viewRef.current = undefined;
      view.track = undefined;
      view.detach();
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (view) {
      view.track = props.track;
    }
  }, [props.track]);

  useEffect(() => {
    const view = viewRef.current;
    if (view && props.videoContentMode) {
      view.videoContentMode = props.videoContentMode;
    }
  }, [props.videoContentMode]);

  useEffect(() => {
    const view = viewRef.current;
    if (view && props.mirrored !== undefined) {
      view.isMirrored = props.mirrored;
    }
  }, [props.mirrored]);

  return (
    <div
      ref={containerRef}
      className={props.className}
      style={{ position: "relative", overflow: "hidden", ...props.style }}
    />
  );
}
