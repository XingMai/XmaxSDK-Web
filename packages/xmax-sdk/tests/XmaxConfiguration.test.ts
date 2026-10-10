import { describe, expect, it } from "vitest";
import { XmaxConfiguration } from "../src/Core/XmaxConfiguration";
import { XmaxEnvironment, apiBaseURL } from "../src/Foundation/Runtime/XmaxEnvironment";
import { XmaxError, XmaxErrorCode } from "../src/Foundation/Errors/XmaxError";
import { XmaxLoggerOption } from "../src/Foundation/Logging/XmaxLogger";
import { RealtimeModel, modelBaseURL } from "../src/Service/Realtime/RealtimeModel";

describe("XmaxConfiguration", () => {
  it("trims the API key and applies defaults", () => {
    const configuration = new XmaxConfiguration({ apiKey: "  key-123  " });
    expect(configuration.apiKey).toBe("key-123");
    expect(configuration.environment).toBe(XmaxEnvironment.china);
    expect(configuration.loggerOptions).toBe(XmaxLoggerOption.none);
  });

  it("validate throws for an empty API key", () => {
    const configuration = new XmaxConfiguration({ apiKey: "   " });
    try {
      configuration.validate();
      throw new Error("Expected XmaxError to be thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(XmaxError);
      expect((error as XmaxError).code).toBe(XmaxErrorCode.invalidAPIKey);
    }
  });

  it("resolves environment API base URLs", () => {
    expect(apiBaseURL(XmaxEnvironment.china)).toBe(
      "https://cloud.xmax.22duck.cn/open/api/v1",
    );
    expect(apiBaseURL(XmaxEnvironment.global)).toBe(
      "https://api.xmax.cloud/open/api/v1",
    );
  });

  it("uses the fixed production endpoint for preview and environment routing for the other models", () => {
    expect(modelBaseURL(RealtimeModel.x2_1_preview)).toBe("https://cloud.xmax.22duck.cn/open/api/v1");
    for (const model of [RealtimeModel.x2_0, RealtimeModel.x2_0_trtc]) {
      expect(modelBaseURL(model)).toBeUndefined();
    }
  });
});
