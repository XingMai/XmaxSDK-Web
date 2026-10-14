import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";
import type { MediaService } from "../../Service/Media/MediaService";
import { RealtimeMediaStream } from "../../Service/Realtime/RealtimeMediaStream";
import type { RealtimeVideoFormat } from "../../Service/Realtime/RealtimeVideoFormat";
import { RealtimeVideoTrack } from "../../Service/Realtime/RealtimeVideoTrack";
import { StreamID } from "../../Service/Realtime/StreamID";

/** 仅持有外部视频轨的副本；不采集设备、不处理画面、不创建预览。 */
export class ExternalVideoController {
  private track?: RealtimeVideoTrack;
  private readonly onEnded = () => {
    this.onError(new XmaxError(XmaxErrorCode.mediaError, "External video source ended"));
  };

  constructor(private readonly onError: (error: XmaxError) => void) {}

  get currentTrack(): RealtimeVideoTrack | undefined {
    return this.track;
  }

  create(options: { videoTrack: MediaStreamTrack; videoFormat: RealtimeVideoFormat }, mediaService: MediaService): RealtimeMediaStream {
    if (this.track) throw new XmaxError(XmaxErrorCode.invalidConfiguration, "Close the current external video first");
    const { videoTrack, videoFormat } = options;
    if (!videoTrack || videoTrack.kind !== "video" || videoTrack.readyState !== "live" || typeof videoTrack.clone !== "function") {
      throw new XmaxError(XmaxErrorCode.invalidConfiguration, "External video requires a live video MediaStreamTrack");
    }
    videoFormat.validate();
    const size = mediaService.resolveModelInputSize(videoFormat);
    const format = videoFormat.resized(size.width, size.height);
    const nativeTrack = videoTrack.clone();
    if (nativeTrack.readyState !== "live") {
      nativeTrack.stop();
      throw new XmaxError(XmaxErrorCode.mediaError, "External video source ended during setup");
    }
    const track = new RealtimeVideoTrack({ id: "external-video", videoFormat: format });
    track.mediaStreamTrack = nativeTrack;
    nativeTrack.addEventListener("ended", this.onEnded);
    this.track = track;
    return new RealtimeMediaStream({ id: StreamID.local, videoTrack: track });
  }

  stop(): void {
    const nativeTrack = this.track?.mediaStreamTrack;
    this.track = undefined;
    nativeTrack?.removeEventListener("ended", this.onEnded);
    nativeTrack?.stop();
  }
}
