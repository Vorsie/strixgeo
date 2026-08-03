/**
 * Frontend logging wrapper.
 *
 * Thin shim over ``console.*`` so we have a single seam to swap in a
 * real logger (telemetry, file-based crash reporting) later. Until
 * then it just adds a structured prefix + timestamp so messages from
 * different parts of the renderer are easy to grep in the browser
 * devtools console.
 *
 * Levels match the backend's ``GroundModelLogger`` so a user-reported
 * issue traced through ``[api]`` lines in stdout reads identically to
 * the ``[ui]`` lines we'd want for a frontend bug. ``debug`` is
 * suppressed in production builds (decided via ``import.meta.env.DEV``)
 * to keep the console quiet for end users.
 *
 * ``trace`` mirrors the backend's TRACE (5): per-render / per-row detail that
 * is OFF even in dev unless a device opts in via ``localStorage``. It exists
 * because the level guide's own rule — "trace = per-row / per-byte detail" —
 * had no renderer-side home, so per-render lines were being written at
 * ``debug`` and drowning it. Dogfeed 2026-08-02: the shell's per-render line
 * fired dozens of times a second and made the dev console unreadable, which
 * costs far more than the line was ever worth.
 *
 * Usage:
 *
 *   import { log } from './utils/log'
 *   log.info('boot', { apiBase, projectId })
 *   log.warn('import', `409 conflict for ${name}, auto-loading existing`)
 *   log.error('api', err)
 */

// ``success`` mirrors the backend GroundModelLogger's SUCCESS level
// so an end-to-end flow logs identically on both sides. Browsers don't
// surface a dedicated success colour the way the Python logger does,
// so it routes through console.info — readers tell it apart by the
// ``SUCCESS`` prefix in the log line, not by colour.
type LogLevel = 'trace' | 'debug' | 'info' | 'success' | 'warn' | 'error'

// Vite injects ``import.meta.env.DEV`` as a boolean. ``true`` for
// ``npm run dev``, ``false`` for ``npm run build``.
const IS_DEV =
  typeof import.meta !== 'undefined' && (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true

/**
 * localStorage key that opts a device in to ``trace`` output.
 *
 * Set ``localStorage['strix.log.trace'] = '1'`` in DevTools and reload-free
 * tracing turns on; remove it to turn it off.
 */
export const TRACE_OPT_IN_KEY = 'strix.log.trace'

/**
 * Whether ``trace`` lines should be emitted right now.
 *
 * Read per call rather than cached at module load so the flag can be flipped
 * from the DevTools console mid-session — the moment you want tracing is
 * always after the interesting thing has started happening.
 */
function traceEnabled(): boolean {
  if (!IS_DEV) return false
  try {
    return globalThis.localStorage?.getItem(TRACE_OPT_IN_KEY) === '1'
  } catch {
    // Storage can throw on a locked-down origin; tracing is never worth a crash.
    return false
  }
}

function emit(level: LogLevel, scope: string, ...args: unknown[]): void {
  if (level === 'debug' && !IS_DEV) return
  if (level === 'trace' && !traceEnabled()) return
  const ts = new Date().toISOString().slice(11, 23) // HH:mm:ss.sss
  const prefix = `[ui ${ts} ${level.toUpperCase().padEnd(5)} ${scope}]`
  switch (level) {
    case 'trace':
    case 'debug':
      console.debug(prefix, ...args)
      break
    case 'info':
    case 'success':
      console.info(prefix, ...args)
      break
    case 'warn':
      console.warn(prefix, ...args)
      break
    case 'error':
      console.error(prefix, ...args)
      break
  }
}

export const log = {
  trace: (scope: string, ...args: unknown[]): void => emit('trace', scope, ...args),
  debug: (scope: string, ...args: unknown[]): void => emit('debug', scope, ...args),
  info: (scope: string, ...args: unknown[]): void => emit('info', scope, ...args),
  success: (scope: string, ...args: unknown[]): void => emit('success', scope, ...args),
  warn: (scope: string, ...args: unknown[]): void => emit('warn', scope, ...args),
  error: (scope: string, ...args: unknown[]): void => emit('error', scope, ...args),
}
