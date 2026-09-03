/**
 * React hook that opens an SSE connection to a DOV import streaming endpoint
 * and surfaces typed progress state to the caller.
 *
 * The hook manages the full lifecycle:
 * 1. Idle — no connection; state is ``{ status: 'idle' }``.
 * 2. Running — the fetch is open; ``status: 'running'`` carries the latest
 *    phase + done/total tick.
 * 3. Done — the terminal ``{"type":"done",...}`` event was received; the
 *    hook returns the result payload.
 * 4. Error — the terminal ``{"type":"error",...}`` event or a network failure
 *    ended the stream; ``errorMessage`` is surfaced.
 *
 * Usage:
 *
 *   const { state, start, reset } = useDovImportStream()
 *
 *   // Start a CPT import:
 *   start({ kind: 'cpt', bbox: { west, south, east, north }, projectId })
 *
 *   // Or a borehole import:
 *   start({ kind: 'borehole', bbox: { west, south, east, north }, projectId })
 *
 * ``reset()`` returns the hook to ``{ status: 'idle' }`` so the caller can
 * show the dialog again after a completed/errored import.
 */

import { useCallback, useRef, useState } from 'react'

import { messageForApiCode, messageForDetail } from '../api/clients/apiCodeMessages'
import { log } from '../utils/log'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * One pending CPT pin emitted in the ``"pins"`` SSE event.
 *
 * Coordinates are in Belgian Lambert 72 (EPSG:31370).  The map
 * converts them to WGS84 via ``lambertToWgs84`` before rendering.
 */
export interface PendingPin {
  permkey: string
  name: string
  x_lambert72: number
  y_lambert72: number
}

/** Named phases as emitted by the backend progress callback. */
export type ImportPhase =
  | 'wfs'
  | 'download'
  | 'dedup'
  | 'persist'
  | 'interpretations'
  | 'samples'
  | 'commit'

/** Human-readable labels for the progress bar. */
export const PHASE_LABELS: Record<ImportPhase, string> = {
  wfs: 'Discovering in DOV…',
  download: 'Downloading XMLs…',
  dedup: 'Checking duplicates…',
  persist: 'Saving…',
  interpretations: 'Attaching interpretations…',
  samples: 'Attaching samples…',
  commit: 'Committing…',
}

/** Phase order for the step indicator — controls which phase label is shown
 *  as "current" when phases fire out of a strict sequential order. */
const PHASE_ORDER: ImportPhase[] = [
  'wfs',
  'download',
  'dedup',
  'persist',
  'interpretations',
  'samples',
  'commit',
]

export interface ProgressTick {
  phase: ImportPhase
  done: number
  total: number
}

export interface CptImportDonePayload {
  imported: number
  duplicates: number
  failed: number
  cpt_ids: string[]
}

export interface BoreholeImportDonePayload {
  imported: number
  duplicates: number
  failed: number
  borehole_ids: string[]
  interpretations_attached: number
  interpretations_failed: number
  /**
   * Boreholes DOV's Boringen WFS says HAVE an interpretation stream that the
   * per-stream ``interpretaties:*`` layer then returned nothing for.
   *
   * Not a failure — DOV's WFS lags behind its own database — but exactly the
   * case the engineer must see: the import went cleanly and the descriptions
   * are still missing, which "Import complete" reads as "DOV has none for
   * these boreholes" (audit 2026-08-02). Optional so a payload from a backend
   * that predates the field still parses.
   */
  interpretations_wfs_gaps?: number
  samples_attached: number
  samples_failed: number
  grain_sizes_attached: number
  grain_sizes_failed: number
  atterberg_attached: number
  atterberg_failed: number
  caco3_attached: number
  caco3_failed: number
  organic_attached: number
  organic_failed: number
  water_content_attached: number
  water_content_failed: number
  scalar_lab_tests_attached: number
  scalar_lab_tests_failed: number
}

export type ImportDonePayload = CptImportDonePayload | BoreholeImportDonePayload

export type DovImportState =
  | { status: 'idle' }
  | {
      status: 'running'
      kind: 'cpt' | 'borehole'
      /** Latest phase tick — null until the first event fires. */
      latest: ProgressTick | null
      /** Tracks the highest phase reached so the step indicator advances
       *  monotonically even if the backend fires phases out of order. */
      highestPhaseIndex: number
      /**
       * Pending pin markers emitted by the backend "pins" SSE event.
       *
       * Populated immediately after WFS discovery (~1 s) so the map can
       * show all N investigation locations before any XML is downloaded.
       * Empty until the ``"pins"`` event fires; stays empty for borehole
       * imports (only CPT imports emit pins today).  Cleared wholesale
       * when the import transitions to ``"done"`` — the real
       * ``GET /cpt/?project_id=`` list refresh repopulates the map.
       */
      pendingPins: PendingPin[]
    }
  | {
      status: 'done'
      kind: 'cpt' | 'borehole'
      result: ImportDonePayload
    }
  | { status: 'error'; message: string }

export interface StartOptions {
  kind: 'cpt' | 'borehole'
  bbox: { west: number; south: number; east: number; north: number }
  projectId: string | undefined
}

export interface UseDovImportStreamResult {
  state: DovImportState
  start: (opts: StartOptions) => void
  reset: () => void
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Manage a DOV import SSE stream.
 *
 * @returns ``{ state, start, reset }`` — state is the current import
 *   lifecycle phase; ``start`` fires the SSE connection; ``reset`` returns
 *   to idle.
 */
export function useDovImportStream(): UseDovImportStreamResult {
  const [state, setState] = useState<DovImportState>({ status: 'idle' })
  // Kept in a ref so the abort callback closure always reads the current
  // controller without needing it as a state dep.
  const abortRef = useRef<AbortController | null>(null)

  const reset = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setState({ status: 'idle' })
  }, [])

  const start = useCallback((opts: StartOptions) => {
    // Abort any in-flight import before starting a new one (defensive —
    // the UI gates the button while running).
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const { kind, bbox, projectId } = opts
    // POST endpoint spawns the background task and returns 202 {job_id}.
    // GET endpoint (with the job_id path param) delivers the SSE stream.
    const spawnPath =
      kind === 'cpt' ? '/cpt/import-dov/stream' : '/borehole/import-dov/stream'

    setState({
      status: 'running',
      kind,
      latest: null,
      highestPhaseIndex: -1,
      pendingPins: [],
    })

    log.info('dov-stream', `spawning ${kind} import job (${spawnPath})`, bbox)

    // Kick off the async read in an immediately-invoked async IIFE so we
    // can use ``for await`` on the ReadableStream without making the
    // ``useCallback`` body itself async.
    void (async () => {
      // The desktop always targets 127.0.0.1:8765 — replicate the API
      // client's default since the module-level ``_base`` is not exported.
      const base = 'http://127.0.0.1:8765'

      try {
        // Step 1 — spawn: POST returns 202 { job_id } immediately.
        const spawnRes = await fetch(`${base}${spawnPath}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...bbox, project_id: projectId ?? null }),
          signal: controller.signal,
        })

        if (!spawnRes.ok) {
          const detail = await spawnRes.json().catch(() => ({}))
          // ``detail`` is a string for plain refusals and ``{ code, message }`` for
          // the bbox guards (too large, already running) — never show "[object Object]".
          const msg = messageForDetail((detail as { detail?: unknown }).detail, `HTTP ${spawnRes.status}`)
          log.error('dov-stream', `spawn request failed: ${msg}`)
          setState({ status: 'error', message: msg })
          return
        }

        const { job_id } = (await spawnRes.json()) as { job_id: string }
        log.info('dov-stream', `${kind} import job spawned: ${job_id}`)

        // Step 2 — connect: GET the SSE stream by job_id.
        const streamPath = `${spawnPath}/${job_id}`
        const res = await fetch(`${base}${streamPath}`, {
          method: 'GET',
          signal: controller.signal,
        })

        if (!res.ok) {
          const detail = await res.json().catch(() => ({}))
          const msg = messageForDetail((detail as { detail?: unknown }).detail, `HTTP ${res.status}`)
          log.error('dov-stream', `stream connect failed: ${msg}`)
          setState({ status: 'error', message: msg })
          return
        }

        if (!res.body) {
          setState({ status: 'error', message: 'No response body from server' })
          return
        }

        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
        // Accumulate partial SSE frames across chunk boundaries.
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += value

          // SSE frames are separated by double newlines. Split on them
          // and process every complete frame in the current buffer.
          const parts = buffer.split('\n\n')
          // The last element may be an incomplete frame — keep it in the
          // buffer for the next chunk.
          buffer = parts.pop() ?? ''

          for (const frame of parts) {
            // Each frame is ``data: <json>`` — strip the prefix.
            const dataLine = frame
              .split('\n')
              .find(l => l.startsWith('data: '))
            if (!dataLine) continue
            const raw = dataLine.slice('data: '.length)

            let event: Record<string, unknown>
            try {
              event = JSON.parse(raw) as Record<string, unknown>
            } catch {
              log.warn('dov-stream', `unparseable SSE frame: ${raw}`)
              continue
            }

            if (event.type === 'done') {
              log.success('dov-stream', `${kind} import done`, event)
              setState({ status: 'done', kind, result: event as unknown as ImportDonePayload })
              return
            }

            if (event.type === 'error') {
              // A guard code (too large, already running) shows in the app's language.
              const msg =
                messageForApiCode(event.code as string | undefined) ??
                (event.message as string | undefined) ??
                'Import failed'
              log.error('dov-stream', `server-side error: ${msg}`)
              setState({ status: 'error', message: msg })
              return
            }

            // Pins event — ``{ type: "pins", items: [...] }``
            // Fires once after WFS discovery, before any XML download.
            // Populates pendingPins so the map renders all N investigation
            // locations immediately; discarded wholesale on "done" when the
            // real GET /cpt/ list refresh repopulates the real markers.
            if (event.type === 'pins' && Array.isArray(event.items)) {
              const pins = event.items as PendingPin[]
              log.info('dov-stream', `pins event: ${pins.length} pending markers`)
              setState(prev => {
                if (prev.status !== 'running') return prev
                return { ...prev, pendingPins: pins }
              })
              continue
            }

            // Progress tick — ``{ phase, done, total }``
            if (typeof event.phase === 'string') {
              const tick: ProgressTick = {
                phase: event.phase as ImportPhase,
                done: (event.done as number) ?? 0,
                total: (event.total as number) ?? 0,
              }
              log.debug(
                'dov-stream',
                `[${tick.phase}] ${tick.done}/${tick.total}`,
              )
              const phaseIdx = PHASE_ORDER.indexOf(tick.phase)
              setState(prev => {
                if (prev.status !== 'running') return prev
                return {
                  ...prev,
                  latest: tick,
                  highestPhaseIndex: Math.max(prev.highestPhaseIndex, phaseIdx),
                }
              })
            }
          }
        }

        // Stream closed without a terminal event — treat as error.
        log.warn('dov-stream', 'stream closed without terminal done/error event')
        setState(prev =>
          prev.status === 'running'
            ? { status: 'error', message: 'Import stream closed unexpectedly' }
            : prev,
        )
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          // Intentional cancel — go back to idle rather than showing an
          // error (the user reset or started a new import).
          log.info('dov-stream', 'stream aborted by client')
          return
        }
        const msg = err instanceof Error ? err.message : 'Unknown stream error'
        log.error('dov-stream', `stream error: ${msg}`, err)
        setState({ status: 'error', message: msg })
      }
    })()
  }, [])

  return { state, start, reset }
}
