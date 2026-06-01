const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const levels: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function shouldLog(level: LogLevel): boolean {
  return levels[level] >= levels[LOG_LEVEL as LogLevel];
}

function formatMessage(level: LogLevel, context: string, message: string, data?: unknown): string {
  const timestamp = new Date().toISOString();
  const dataStr = data ? ` ${JSON.stringify(data)}` : '';
  return `[${timestamp}] [${level.toUpperCase()}] [${context}]${dataStr} ${message}`;
}

export function createLogger(context: string) {
  return {
    debug: (message: string, data?: unknown) => {
      if (shouldLog('debug')) console.log(formatMessage('debug', context, message, data));
    },
    info: (message: string, data?: unknown) => {
      if (shouldLog('info')) console.log(formatMessage('info', context, message, data));
    },
    warn: (message: string, data?: unknown) => {
      if (shouldLog('warn')) console.warn(formatMessage('warn', context, message, data));
    },
    error: (message: string, data?: unknown) => {
      if (shouldLog('error')) console.error(formatMessage('error', context, message, data));
    },
  };
}
