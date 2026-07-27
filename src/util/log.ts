/** Logger Setup **/

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export interface Logger {
  debug(message: string, ...args: any[]): void;
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
}

function timestamp(): string {
  return new Date().toISOString().slice(11, 19);
}

export function createLogger(): Logger {
    const emit = (level: LogLevel, message: string, ...args: any[]) => {
        const logMessage = `[${timestamp()}] [${level.toUpperCase()}] ${message}`;
        const type = level === "error" ? console.error : console.log;
        type(logMessage, ...args);
    }
    return {
        debug: (message: string, ...args: any[]) => emit("debug", message, ...args),
        info: (message: string, ...args: any[]) => emit("info", message, ...args),
        warn: (message: string, ...args: any[]) => emit("warn", message, ...args),
        error: (message: string, ...args: any[]) => emit("error", message, ...args),
    };
}