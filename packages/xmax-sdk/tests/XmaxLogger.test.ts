import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { XmaxLogger, XmaxLoggerOption } from "../src/Foundation/Logging/XmaxLogger";

describe("XmaxLogger console formatting", () => {
  beforeEach(() => {
    for (const method of ["debug", "info", "warn", "error"] as const) {
      vi.spyOn(console, method).mockImplementation(() => {});
    }
    XmaxLogger.configure(XmaxLoggerOption.all);
  });

  afterEach(() => {
    XmaxLogger.configure(XmaxLoggerOption.none);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses a styled brand badge in the browser and keeps format tokens in the message literal", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", {});
    const message = "prompt: 100% %c red %s %o\n└─ RTT: 20 ms";
    XmaxLogger.rtc.info(() => message, XmaxLoggerOption.performance);
    expect(console.info).toHaveBeenCalledWith(
      "%c[Xmax]%c %c[RTC]%c\n%s",
      expect.stringContaining("background:"),
      "",
      expect.stringContaining("background:"),
      "",
      message,
    );
    expect(console.info).toHaveBeenCalledTimes(1);
  });

  it("preserves each log level's native console method", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", {});
    XmaxLogger.api.debug(() => "debug");
    XmaxLogger.api.info(() => "info");
    XmaxLogger.api.warning(() => "warning");
    XmaxLogger.api.error(() => "error");
    const levels = [
      ["debug", "debug"],
      ["info", "info"],
      ["warn", "warning"],
      ["error", "error"],
    ] as const;
    for (const [method, text] of levels) {
      expect(console[method]).toHaveBeenCalledWith(
        "%c[Xmax]%c %c[API]%c\n%s",
        expect.stringContaining("#2563eb"),
        "",
        expect.stringContaining("#475569"),
        "",
        text,
      );
    }
  });

  it("falls back to the plain Xmax prefix outside the browser", () => {
    vi.stubGlobal("window", undefined);
    vi.stubGlobal("document", undefined);
    XmaxLogger.stream.info(() => "subscribed\n└─ user: bot-1");
    expect(console.info).toHaveBeenCalledWith("[Xmax][Stream] subscribed\n└─ user: bot-1");
  });

  it("does not evaluate disabled messages while styling is enabled", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", {});
    XmaxLogger.configure(XmaxLoggerOption.business);
    const message = vi.fn(() => "performance");
    XmaxLogger.rtc.info(message, XmaxLoggerOption.performance);
    expect(message).not.toHaveBeenCalled();
    expect(console.info).not.toHaveBeenCalled();
  });
});
