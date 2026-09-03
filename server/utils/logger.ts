// 独立 server 日志封装，保持 serverLog.log/info/warn/error 接口不变
type LogLevel = "debug" | "info" | "warn" | "error";

// 各级别权重
const levelWeight: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// 解析日志级别，默认 info
const parseLevel = (): LogLevel => {
  const raw = process.env["LOG_LEVEL"]?.toLowerCase();
  return raw && raw in levelWeight ? (raw as LogLevel) : "info";
};

const currentLevel = parseLevel();

// 是否输出该级别
const shouldLog = (level: LogLevel): boolean => levelWeight[level] >= levelWeight[currentLevel];

// 统一前缀输出
const write = (level: LogLevel, printer: (...args: unknown[]) => void, args: unknown[]): void => {
  if (!shouldLog(level)) return;
  printer(`[server]`, ...args);
};

export const serverLog = {
  log: (...args: unknown[]) => write("info", console.log, args),
  debug: (...args: unknown[]) => write("debug", console.log, args),
  info: (...args: unknown[]) => write("info", console.info, args),
  warn: (...args: unknown[]) => write("warn", console.warn, args),
  error: (...args: unknown[]) => write("error", console.error, args),
};
