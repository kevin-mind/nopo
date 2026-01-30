/**
 * Logging utility for test feature 4189
 * Provides structured logging with configurable log levels
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[currentLevel];
}

export function debug(...args: unknown[]): void {
  if (shouldLog("debug")) {
    console.debug("[DEBUG]", ...args);
  }
}

export function info(...args: unknown[]): void {
  if (shouldLog("info")) {
    console.info("[INFO]", ...args);
  }
}

export function warn(...args: unknown[]): void {
  if (shouldLog("warn")) {
    console.warn("[WARN]", ...args);
  }
}

export function error(...args: unknown[]): void {
  if (shouldLog("error")) {
    console.error("[ERROR]", ...args);
  }
}
