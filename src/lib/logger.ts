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
  log: isDev ? console.log.bind(console) : noop,
  debug: isDev ? console.debug.bind(console) : noop,
  info: isDev ? console.info.bind(console) : noop,
  warn: isDev ? console.warn.bind(console) : noop,
  // Errors always print — they indicate real problems
  error: console.error.bind(console),
};

export default logger;
