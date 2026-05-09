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
 * Usage:
 *
 *   import { log } from './utils/log'
 *   log.info('boot', { apiBase, projectId })
 *   log.warn('import', `409 conflict for ${name}, auto-loading existing`)
 *   log.error('api', err)
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

// Vite injects ``import.meta.env.DEV`` as a boolean. ``true`` for
// ``npm run dev``, ``false`` for ``npm run build``.
const IS_DEV =
  typeof import.meta !== 'undefined' && (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true

function emit(level: LogLevel, scope: string, ...args: unknown[]): void {
  if (level === 'debug' && !IS_DEV) return
  const ts = new Date().toISOString().slice(11, 23) // HH:mm:ss.sss
  const prefix = `[ui ${ts} ${level.toUpperCase().padEnd(5)} ${scope}]`
  switch (level) {
    case 'debug':
      console.debug(prefix, ...args)
      break
    case 'info':
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
  debug: (scope: string, ...args: unknown[]): void => emit('debug', scope, ...args),
  info: (scope: string, ...args: unknown[]): void => emit('info', scope, ...args),
  warn: (scope: string, ...args: unknown[]): void => emit('warn', scope, ...args),
  error: (scope: string, ...args: unknown[]): void => emit('error', scope, ...args),
}
