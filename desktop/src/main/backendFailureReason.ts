/**
 * Name the CAUSE of a backend startup failure from the engine's own output.
 *
 * The main process sends ``app:backend-failed`` when the engine exits before it
 * was ready. That signal used to carry nothing, so the renderer could only show
 * the generic "the backend process exited before it was ready" dialog. For the
 * one cause a user can act on (an older StrixGeo opened over a store a NEWER
 * StrixGeo already migrated; owner finding 2026-10-08, 0.1.4 reinstalled over
 * 0.1.5) the engine says exactly what is wrong: its migrator raises
 * ``NewerDatabaseError`` with a self-contained message
 * (``src/groundmodel/infrastructure/db/database_migrator.py``). This module
 * recognises that in the captured stdout / stderr and shapes the ADDITIVE
 * payload the signal now carries. An old renderer ignores the payload.
 *
 * Second cause (tester finding 2026-10-12): another program owns the engine
 * port, and uvicorn prints ``error while attempting to bind on address``. That
 * reads as ``port-busy``; the payload then also carries the port, so the dialog
 * can name it.
 *
 * Pure: no Electron, no I/O, so it is unit-testable in jsdom.
 *
 * @module main/backendFailureReason
 */

import { NEWER_DATABASE_SIGNAL } from './bootFailureMessage'

/** A recognised backend-failure cause the renderer can name. */
export type BackendFailureReason = 'newer-database' | 'port-busy'

/** The payload sent with ``app:backend-failed``. ``reason`` is null when unknown. */
export interface BackendFailedPayload {
  reason: BackendFailureReason | null
  /** The port the engine was told to bind (additive, 2026-10-12). */
  port?: number
}

/**
 * The engine's markers for a store written by a newer StrixGeo: the exception
 * class name (in the lifespan traceback), the start of its message (when only
 * the logged line reaches us), and alembic's own unknown-revision text (shared
 * with the pre-engine boot path, {@link NEWER_DATABASE_SIGNAL}).
 */
const NEWER_DATABASE_MARKERS: readonly RegExp[] = [
  /NewerDatabaseError/,
  /written by a newer version of StrixGeo/i,
  NEWER_DATABASE_SIGNAL,
]

/**
 * uvicorn's wording when the listening socket cannot be bound (``[Errno 10048]``
 * on Windows, ``[Errno 98]`` on Linux; the sentence is uvicorn's own and the
 * same on every platform).
 */
const PORT_BUSY_MARKERS: readonly RegExp[] = [/error while attempting to bind on address/i]

/**
 * How much of the previous chunk a tracker keeps, so a marker split across two
 * output chunks is still seen. Longer than the longest marker text.
 */
const CHUNK_OVERLAP_CHARS = 128

/**
 * Recognise a failure cause in a piece of engine output.
 *
 * Parameters
 * ----------
 * text : string
 *     Engine stdout / stderr text.
 *
 * Returns
 * -------
 * BackendFailureReason | null
 *     ``'newer-database'`` when the store was written by a newer StrixGeo;
 *     ``'port-busy'`` when the engine could not bind its port; ``null`` for any
 *     other output.
 */
export function backendFailureReasonFromOutput(text: string): BackendFailureReason | null {
  if (NEWER_DATABASE_MARKERS.some(marker => marker.test(text))) return 'newer-database'
  if (PORT_BUSY_MARKERS.some(marker => marker.test(text))) return 'port-busy'
  return null
}

/** A per-spawn observer of the engine output that latches the first cause. */
export interface BackendFailureReasonTracker {
  /** Feed one output chunk. */
  observe(chunk: string): void
  /** The cause seen so far, or null. */
  reason(): BackendFailureReason | null
}

/**
 * Create a tracker for one backend spawn.
 *
 * It keeps only the tail of the previous chunk (never the whole output: the
 * engine logs for hours) and latches the first recognised cause, so later
 * shutdown noise cannot clear it.
 *
 * Returns
 * -------
 * BackendFailureReasonTracker
 *     A fresh tracker with no cause seen.
 */
export function createBackendFailureReasonTracker(): BackendFailureReasonTracker {
  let latched: BackendFailureReason | null = null
  let carry = ''
  return {
    observe(chunk: string): void {
      if (latched !== null) return
      const text = carry + chunk
      latched = backendFailureReasonFromOutput(text)
      carry = text.slice(-CHUNK_OVERLAP_CHARS)
    },
    reason(): BackendFailureReason | null {
      return latched
    },
  }
}

/**
 * Shape the ``app:backend-failed`` payload.
 *
 * Parameters
 * ----------
 * reason : BackendFailureReason | null
 *     The recognised cause, or null.
 * port : number, optional
 *     The port the engine was told to bind.
 *
 * Returns
 * -------
 * BackendFailedPayload
 *     ``{ reason, port? }``; always an object so the renderer reads one shape.
 */
export function backendFailedPayload(
  reason: BackendFailureReason | null,
  port?: number,
): BackendFailedPayload {
  return port === undefined ? { reason } : { reason, port }
}
