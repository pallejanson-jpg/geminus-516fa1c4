import { describe, it, expect, vi } from "vitest";
import { logger } from "@/lib/logger";

describe("logger", () => {
  it("exports log, debug, info, warn, error functions", () => {
    expect(typeof logger.log).toBe("function");
    expect(typeof logger.debug).toBe("function");
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
  });

  it("error always calls console.error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.error("test error");
    expect(spy).toHaveBeenCalledWith("test error");
    spy.mockRestore();
  });
});
