import { XmaxEnvironment } from "../Runtime/XmaxEnvironment";
import { AgoraRtcManager } from "./Agora/AgoraRtcManager";
import { RtcProvider } from "./RtcProvider";
import { TrtcRtcManager } from "./TRTC/TrtcRtcManager";
import { VeRtcManager } from "./VeRTC/VeRtcManager";
import type { RtcManaging } from "./RtcManaging";

/**
 * 按固定的接入配置创建 RTC 实现；构造阶段不加载厂商运行时。
 */
export function createRtcManager(provider: RtcProvider, environment: XmaxEnvironment): RtcManaging {
  switch (provider) {
    case RtcProvider.agora: return new AgoraRtcManager({ environment });
    case RtcProvider.vertc: return new VeRtcManager();
    default: return new TrtcRtcManager();
  }
}
