import {
  VideoContentMode,
  XmaxVideoView,
  type RealtimeVideoTrack,
  type TrajectoryEffectRendering,
  type VideoRenderStatistics,
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
   * 当前视图的呈现帧率统计；换流或卸载时清空，不受统计面板显示开关影响。
   */
  onRenderStatistics?: (statistics?: VideoRenderStatistics) => void;

  /**
   * 容器类名。
   */
  className?: string;

  /**
   * 是否允许远端轨迹交互，默认 true；本地轨道不参与。
   */
  isInteractionEnabled?: boolean;

  /**
   * 自定义轨迹视觉效果，不传时使用默认效果；一个实例仅供一个视图使用。
   */
  trajectoryRenderer?: TrajectoryEffectRendering;

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
    if (viewRef.current) viewRef.current.renderStatisticsHandler = props.onRenderStatistics;
  }, [props.onRenderStatistics]);

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

  useEffect(() => {
    if (viewRef.current) {
      viewRef.current.isInteractionEnabled = props.isInteractionEnabled ?? true;
    }
  }, [props.isInteractionEnabled]);

  useEffect(() => {
    if (viewRef.current) {
      viewRef.current.trajectoryRenderer = props.trajectoryRenderer;
    }
  }, [props.trajectoryRenderer]);

  return (
    <div
      ref={containerRef}
      className={props.className}
      style={{ position: "relative", overflow: "hidden", ...props.style }}
    />
  );
}
