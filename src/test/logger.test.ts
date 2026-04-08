import { describe, it, expect, vi } from "vitest";

describe("logger", () => {
  it("exports log, debug, info, warn, error functions", async () => {
    const { logger } = await import("@/lib/logger");
    expect(typeof logger.log).toBe("function");
    expect(typeof logger.debug).toBe("function");
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
  });

  it("error always calls console.error", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { logger } = await import("@/lib/logger");
    logger.error("test error");
    expect(spy).toHaveBeenCalledWith("test error");
    spy.mockRestore();
  });
});
