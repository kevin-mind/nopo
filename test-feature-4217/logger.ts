/**
 * Logging utility with structured logging and log levels.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLogLevel: LogLevel = 'info';

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[currentLogLevel];
}

function formatLogEntry(entry: LogEntry): string {
  const base = `[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.message}`;
  if (entry.context && Object.keys(entry.context).length > 0) {
    return `${base} ${JSON.stringify(entry.context)}`;
  }
  return base;
}

function createLogEntry(
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>
): LogEntry {
  return {
    level,
    message,
    timestamp: new Date().toISOString(),
    context,
  };
}

function log(
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>
): void {
  if (!shouldLog(level)) {
    return;
  }

  const entry = createLogEntry(level, message, context);
  const formatted = formatLogEntry(entry);

  switch (level) {
    case 'debug':
    case 'info':
      console.log(formatted);
      break;
    case 'warn':
      console.warn(formatted);
      break;
    case 'error':
      console.error(formatted);
      break;
  }
}

export function setLogLevel(level: LogLevel): void {
  currentLogLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLogLevel;
}

export function debug(message: string, context?: Record<string, unknown>): void {
  log('debug', message, context);
}

export function info(message: string, context?: Record<string, unknown>): void {
  log('info', message, context);
}

export function warn(message: string, context?: Record<string, unknown>): void {
  log('warn', message, context);
}

export function error(message: string, context?: Record<string, unknown>): void {
  log('error', message, context);
}

export const logger = {
  debug,
  info,
  warn,
  error,
  setLogLevel,
  getLogLevel,
};

export default logger;
