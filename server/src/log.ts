// Tiny structured logger: `2026-09-26T06:40:12.345Z WARN  hermes: request failed url=… status=502`.
// One line per event, to stdout/stderr so `docker logs` shows everything.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';
type Fields = Record<string, unknown>;

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

export function parseLogLevel(value: string | undefined): LogLevel {
  const v = value?.toLowerCase();
  return v && v in ORDER ? (v as LogLevel) : 'info';
}

let threshold: LogLevel = parseLogLevel(process.env.LOG_LEVEL);
let sink: ((line: string, level: LogLevel) => void) | undefined;

export function setLogLevel(level: LogLevel): void {
  threshold = level;
}

/** Test hook: capture lines instead of writing them. */
export function setLogSink(fn: ((line: string, level: LogLevel) => void) | undefined): void {
  sink = fn;
}

function formatValue(v: unknown): string {
  const s = typeof v === 'string' ? v : v instanceof Error ? describeError(v) : JSON.stringify(v);
  return /[\s"=]/.test(s) || s === '' ? JSON.stringify(s) : s;
}

function write(level: Exclude<LogLevel, 'silent'>, scope: string, msg: string, fields?: Fields): void {
  if (ORDER[level] < ORDER[threshold]) return;
  const parts = [new Date().toISOString(), level.toUpperCase().padEnd(5), `${scope}: ${msg}`];
  for (const [k, v] of Object.entries(fields ?? {})) {
    if (v !== undefined) parts.push(`${k}=${formatValue(v)}`);
  }
  const line = parts.join(' ');
  if (sink) sink(line, level);
  else if (level === 'error' || level === 'warn') console.error(line);
  else console.log(line);
}

export interface Logger {
  debug(msg: string, fields?: Fields): void;
  info(msg: string, fields?: Fields): void;
  warn(msg: string, fields?: Fields): void;
  error(msg: string, fields?: Fields): void;
}

export function createLogger(scope: string): Logger {
  return {
    debug: (m, f) => write('debug', scope, m, f),
    info: (m, f) => write('info', scope, m, f),
    warn: (m, f) => write('warn', scope, m, f),
    error: (m, f) => write('error', scope, m, f),
  };
}

/**
 * A human-readable error, including the cause that Node's fetch hides behind "fetch failed"
 * (ECONNREFUSED, ENOTFOUND, certificate problems, …).
 */
export function describeError(err: unknown): string {
  if (err instanceof Error || (typeof err === 'object' && err !== null && 'message' in err)) {
    const e = err as Error & { cause?: unknown };
    if (e.name === 'TimeoutError') return 'timed out';
    const cause = e.cause as { message?: string; code?: string; errors?: unknown[] } | undefined;
    const attempts = Array.isArray(cause?.errors)
      ? cause.errors.map((x) => (x instanceof Error ? x.message : String(x))).join('; ')
      : '';
    const detail = cause?.message || attempts || cause?.code;
    return detail && detail !== e.message ? `${e.message}: ${detail}` : e.message;
  }
  return String(err);
}
