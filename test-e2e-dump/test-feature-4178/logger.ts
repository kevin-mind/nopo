/**
 * @module test-feature-4178/logger
 *
 * Logging utility for E2E test feature #4178.
 * Provides structured logging with configurable log levels.
 *
 * @example
 * ```typescript
 * import { createLogger, LogLevel } from './logger';
 *
 * const logger = createLogger({ level: LogLevel.DEBUG });
 * logger.info('Application started');
 * logger.debug('Debug details', { userId: 123 });
 * logger.warn('Potential issue detected');
 * logger.error('Operation failed', { code: 500 });
 * ```
 */

/** Supported log levels in order of severity */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

/** Configuration options for the logger */
export interface LoggerConfig {
  /** Minimum log level to output */
  level: LogLevel;
  /** Optional prefix for all log messages */
  prefix?: string;
}

/** Structure of a log entry */
export interface LogEntry {
  /** The log level of the entry */
  level: LogLevel;
  /** The log message */
  message: string;
  /** Unix timestamp when the log was created */
  timestamp: number;
  /** Optional additional data */
  data?: Record<string, unknown>;
}

/** Logger interface with methods for each log level */
export interface Logger {
  /** Log a debug message */
  debug(message: string, data?: Record<string, unknown>): LogEntry;
  /** Log an info message */
  info(message: string, data?: Record<string, unknown>): LogEntry;
  /** Log a warning message */
  warn(message: string, data?: Record<string, unknown>): LogEntry;
  /** Log an error message */
  error(message: string, data?: Record<string, unknown>): LogEntry;
}

/** Default logger configuration */
export const DEFAULT_CONFIG: LoggerConfig = {
  level: LogLevel.INFO,
};

/** Map of log level to string representation */
const LEVEL_NAMES: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: "DEBUG",
  [LogLevel.INFO]: "INFO",
  [LogLevel.WARN]: "WARN",
  [LogLevel.ERROR]: "ERROR",
};

/**
 * Format a log entry as a string.
 *
 * @param entry - The log entry to format
 * @param prefix - Optional prefix to prepend
 * @returns Formatted log string
 */
function formatLogEntry(entry: LogEntry, prefix?: string): string {
  const levelName = LEVEL_NAMES[entry.level];
  const timestamp = new Date(entry.timestamp).toISOString();
  const prefixStr = prefix ? `[${prefix}] ` : "";
  const dataStr = entry.data ? ` ${JSON.stringify(entry.data)}` : "";
  return `${timestamp} ${prefixStr}[${levelName}] ${entry.message}${dataStr}`;
}

/**
 * Create a new logger instance with the specified configuration.
 *
 * @param config - Logger configuration options
 * @returns A logger instance
 */
export function createLogger(config: Partial<LoggerConfig> = {}): Logger {
  const mergedConfig: LoggerConfig = { ...DEFAULT_CONFIG, ...config };

  function createLogEntry(
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>,
  ): LogEntry {
    const entry: LogEntry = {
      level,
      message,
      timestamp: Date.now(),
      data,
    };

    if (level >= mergedConfig.level) {
      const formatted = formatLogEntry(entry, mergedConfig.prefix);
      switch (level) {
        case LogLevel.ERROR:
          console.error(formatted);
          break;
        case LogLevel.WARN:
          console.warn(formatted);
          break;
        default:
          console.log(formatted);
      }
    }

    return entry;
  }

  return {
    debug: (message, data) => createLogEntry(LogLevel.DEBUG, message, data),
    info: (message, data) => createLogEntry(LogLevel.INFO, message, data),
    warn: (message, data) => createLogEntry(LogLevel.WARN, message, data),
    error: (message, data) => createLogEntry(LogLevel.ERROR, message, data),
  };
}
