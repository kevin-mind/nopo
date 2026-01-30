import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  log,
  info,
  warn,
  error,
  setLogLevel,
  getLogLevel,
} from "../src/lib/logger";

describe("logger", () => {
  const originalConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };

  beforeEach(() => {
    console.log = vi.fn();
    console.info = vi.fn();
    console.warn = vi.fn();
    console.error = vi.fn();
    setLogLevel("info");
  });

  afterEach(() => {
    console.log = originalConsole.log;
    console.info = originalConsole.info;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
  });

  describe("log level management", () => {
    it("should have info as default log level", () => {
      expect(getLogLevel()).toBe("info");
    });

    it("should allow setting log level", () => {
      setLogLevel("debug");
      expect(getLogLevel()).toBe("debug");

      setLogLevel("error");
      expect(getLogLevel()).toBe("error");
    });
  });

  describe("log function", () => {
    it("should call console.log when level is debug", () => {
      setLogLevel("debug");
      log("test message");
      expect(console.log).toHaveBeenCalledWith("test message");
    });

    it("should not call console.log when level is info", () => {
      setLogLevel("info");
      log("test message");
      expect(console.log).not.toHaveBeenCalled();
    });
  });

  describe("info function", () => {
    it("should call console.info when level is info or lower", () => {
      setLogLevel("info");
      info("info message");
      expect(console.info).toHaveBeenCalledWith("info message");
    });

    it("should not call console.info when level is warn", () => {
      setLogLevel("warn");
      info("info message");
      expect(console.info).not.toHaveBeenCalled();
    });
  });

  describe("warn function", () => {
    it("should call console.warn when level is warn or lower", () => {
      setLogLevel("warn");
      warn("warning message");
      expect(console.warn).toHaveBeenCalledWith("warning message");
    });

    it("should call console.warn when level is info", () => {
      setLogLevel("info");
      warn("warning message");
      expect(console.warn).toHaveBeenCalledWith("warning message");
    });

    it("should not call console.warn when level is error", () => {
      setLogLevel("error");
      warn("warning message");
      expect(console.warn).not.toHaveBeenCalled();
    });
  });

  describe("error function", () => {
    it("should always call console.error", () => {
      setLogLevel("error");
      error("error message");
      expect(console.error).toHaveBeenCalledWith("error message");
    });

    it("should call console.error at any log level", () => {
      setLogLevel("debug");
      error("error message");
      expect(console.error).toHaveBeenCalledWith("error message");
    });
  });

  describe("multiple arguments", () => {
    it("should pass multiple arguments to console methods", () => {
      setLogLevel("debug");
      log("message", { data: 123 }, [1, 2, 3]);
      expect(console.log).toHaveBeenCalledWith(
        "message",
        { data: 123 },
        [1, 2, 3],
      );
    });
  });
});
