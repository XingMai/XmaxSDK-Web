import { describe, expect, it } from "vitest";
import { XmaxConfiguration } from "../src/Core/XmaxConfiguration";
import { XmaxEnvironment, apiBaseURL } from "../src/Core/XmaxEnvironment";
import { XmaxError, XmaxErrorCode } from "../src/Foundation/Errors/XmaxError";
import { XmaxLoggerOption } from "../src/Foundation/Logging/XmaxLogger";

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
      "https://dev.xmaxai.com/open/api/v1",
    );
    expect(apiBaseURL(XmaxEnvironment.global)).toBe(
      "https://api.xmax.cloud/open/api/v1",
    );
  });
});
