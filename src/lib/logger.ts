/**
 * Gated logger utility — only outputs in development mode.
 * Replace raw `console.log` with `logger.log()` to silence production builds.
 *
 * Usage:
 *   import { logger } from '@/lib/logger';
 *   logger.log('[ModelLoader]', 'loaded', modelId);
 *   logger.warn('Unexpected state', data);
 */

const isDev = typeof import.meta !== 'undefined' && import.meta.env?.DEV;

function noop() {}

export const logger = {
  log: isDev ? (...args: unknown[]) => console.log(...args) : noop,
  debug: isDev ? (...args: unknown[]) => console.debug(...args) : noop,
  info: isDev ? (...args: unknown[]) => console.info(...args) : noop,
  warn: isDev ? (...args: unknown[]) => console.warn(...args) : noop,
  // Errors always print — they indicate real problems
  error: (...args: unknown[]) => console.error(...args),
};

export default logger;
