import { XmaxEnvironment } from "../Runtime/XmaxEnvironment";

/**
 * 控制 XmaxSDK 输出的日志类型（位掩码，可组合）。
 */
export enum XmaxLoggerOption {
  none = 0,
  /** Room、API、Realtime、Storage 等业务运行日志。 */
  business = 1 << 0,
  /** RTC 网络质量和音视频运行统计，输出到 console.info。 */
  performance = 1 << 1,
  /** 输出全部 XmaxSDK 日志。 */
  all = business | performance,
}

type XmaxLogLevel = "debug" | "info" | "warning" | "error";

interface XmaxLoggerState {
  options: XmaxLoggerOption;
  environment: XmaxEnvironment;
}

const state: XmaxLoggerState = {
  options: XmaxLoggerOption.none,
  environment: XmaxEnvironment.china,
};

const CONSOLE_METHOD: Record<XmaxLogLevel, "debug" | "info" | "warn" | "error"> = {
  debug: "debug",
  info: "info",
  warning: "warn",
  error: "error",
};

/** Xmax 品牌标签：蓝底白字。 */
const BRAND_BADGE_STYLE = "background:#2563eb;color:#fff;border-radius:3px;padding:1px 4px;font-weight:600;";

/** 业务域标签：使用深灰蓝，与 Xmax 品牌标签明确区分。 */
const CATEGORY_BADGE_STYLE = "background:#475569;color:#fff;border-radius:3px;padding:1px 4px;font-weight:600;";

/**
 * 统一输出带 Xmax 前缀和类别的控制台日志。
 *
 * 调用方不得传入 API Key、Token、Secret、Authorization 或完整敏感响应。
 */
export class XmaxLogger {
  // 分类日志
  static readonly realtime = new XmaxLogger("Realtime");
  static readonly rtc = new XmaxLogger("RTC");
  static readonly media = new XmaxLogger("Media");
  static readonly api = new XmaxLogger("API");
  static readonly storage = new XmaxLogger("Storage");
  static readonly room = new XmaxLogger("Room");
  static readonly stream = new XmaxLogger("Stream");
  static readonly render = new XmaxLogger("Render");
  static readonly interaction = new XmaxLogger("Interaction");
  static readonly permission = new XmaxLogger("Permission");

  // 日志类别
  private readonly category: string;

  private constructor(category: string) {
    this.category = category;
  }

  /**
   * 更新 SDK 全局日志选项和细项语言，后一次配置覆盖前一次。
   *
   * @param options 输出的日志类型位掩码。
   * @param environment 服务环境，决定日志细项语言（国内中文，海外英文）。
   */
  static configure(
    options: XmaxLoggerOption,
    environment: XmaxEnvironment = XmaxEnvironment.china,
  ): void {
    state.options = options;
    state.environment = environment;
  }

  /** 选择日志细项文案；日志标题保持原有中英双语。 */
  static localized(chinese: string, english: string): string {
    return state.environment === XmaxEnvironment.china ? chinese : english;
  }

  /** 判断指定日志类型是否已开启。 */
  static isEnabled(option: XmaxLoggerOption): boolean {
    return (state.options & option) !== 0;
  }

  /** 输出调试日志。 */
  debug(message: () => string, option: XmaxLoggerOption = XmaxLoggerOption.business): void {
    this.log("debug", message, option);
  }

  /** 输出信息日志。 */
  info(message: () => string, option: XmaxLoggerOption = XmaxLoggerOption.business): void {
    this.log("info", message, option);
  }

  /** 输出警告日志。 */
  warning(message: () => string, option: XmaxLoggerOption = XmaxLoggerOption.business): void {
    this.log("warning", message, option);
  }

  /** 输出错误日志。 */
  error(message: () => string, option: XmaxLoggerOption = XmaxLoggerOption.business): void {
    this.log("error", message, option);
  }

  /** 按日志类型开关输出到控制台；未开启时不求值日志内容。 */
  private log(
    level: XmaxLogLevel,
    message: () => string,
    option: XmaxLoggerOption,
  ): void {
    if (!XmaxLogger.isEnabled(option)) {
      return;
    }
    const text = message();
    if (typeof window !== "undefined" && typeof document !== "undefined") {
      // 正文通过 %s 传入，避免其中的 %c / %s 等内容被当作控制台格式指令。
      console[CONSOLE_METHOD[level]](
        `%c[Xmax]%c %c[${this.category}]%c\n%s`,
        BRAND_BADGE_STYLE,
        "",
        CATEGORY_BADGE_STYLE,
        "",
        text,
      );
      return;
    }
    // SSR、Node 和其他非页面环境使用纯文本前缀。
    console[CONSOLE_METHOD[level]](`[Xmax][${this.category}] ${text}`);
  }
}
