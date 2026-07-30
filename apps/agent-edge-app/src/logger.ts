/**
 * Lightweight structured logger for the agent-edge-app CLI.
 *
 * - No external dependencies (runs in the edge gateway package).
 * - Respects `EDGE_LOG_LEVEL` env var: debug | info | warn | error (default info).
 * - Output goes to stdout/stderr via console so it integrates with systemd / docker logs.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const DEFAULT_LEVEL: LogLevel = 'info';

function resolveLevel(env?: string): LogLevel {
  const level = (env ?? DEFAULT_LEVEL).toLowerCase() as LogLevel;
  return level in LEVEL_RANK ? level : DEFAULT_LEVEL;
}

function formatTimestamp(now = new Date()): string {
  return now.toISOString();
}

function formatValue(v: unknown): string {
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  return `[${typeof v}]`;
}

function formatExtra(extra: Record<string, unknown> | undefined): string {
  if (!extra || Object.keys(extra).length === 0) return '';
  return ' ' + Object.entries(extra).map(([k, v]) => `${k}=${formatValue(v)}`).join(' ');
}

export interface Logger {
  debug(message: string, extra?: Record<string, unknown>): void;
  info(message: string, extra?: Record<string, unknown>): void;
  warn(message: string, extra?: Record<string, unknown>): void;
  error(message: string, extra?: Record<string, unknown>): void;
  child(prefix: string): Logger;
}

export function createLogger(prefix = ''): Logger {
  const effectiveLevel = resolveLevel(process.env.EDGE_LOG_LEVEL);

  function log(level: LogLevel, message: string, extra?: Record<string, unknown>): void {
    if (LEVEL_RANK[level] < LEVEL_RANK[effectiveLevel]) return;

    const tag = prefix ? `[${prefix}]` : '';
    const line = `${formatTimestamp()} ${level.toUpperCase().padEnd(5)}${tag ? ` ${tag}` : ''} ${message}${formatExtra(extra)}`;

    if (level === 'error') {
      console.error(line);
    } else if (level === 'warn') {
      console.warn(line);
    } else {
      console.log(line);
    }
  }

  return {
    debug: (message, extra) => log('debug', message, extra),
    info: (message, extra) => log('info', message, extra),
    warn: (message, extra) => log('warn', message, extra),
    error: (message, extra) => log('error', message, extra),
    child: (childPrefix) => createLogger(prefix ? `${prefix}:${childPrefix}` : childPrefix),
  };
}
