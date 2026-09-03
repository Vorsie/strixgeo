/**
 * React hook that runs a 3-D voxel build as a background job and surfaces its
 * progress, so the Build button can show a phase bar + a Cancel button while the
 * build runs (debt #282).
 *
 * It mirrors {@link useDovImportStream}: a two-step SSE flow — ``POST .../jobs``
 * returns ``202 {job_id}`` at once, then ``GET .../jobs/{job_id}`` streams the
 * build's events. The build's CPU phases run server-side under the existing per-
 * process lock, so the UI stays responsive and cancellable.
 *
 * State machine:
 * 1. ``idle``       — no build running.
 * 2. ``running``    — the stream is open; ``latest`` is the newest phase tick and
 *                     ``cancelRequested`` is set once the user hit Cancel.
 * 3. ``done``       — the terminal ``{"type":"done",...}`` event arrived; carries
 *                     the ``RebuildLithoSolidsResponse`` so the caller refreshes
 *                     exactly what the synchronous build refreshed.
 * 4. ``cancelled``  — the build ended with ``{"type":"error","code":
 *                     "build_cancelled"}`` (the model was left untouched).
 * 5. ``error``      — any other terminal error, or a network failure.
 *
 * ``cancel()`` POSTs to the cancel endpoint (which sets the cooperative flag) but
 * deliberately KEEPS the SSE stream open, so the terminal ``build_cancelled``
 * event still flows down and drives the transition to ``cancelled``.
 */

import { useCallback, useRef, useState } from 'react'

import type { RebuildLithoSolidsResponse } from '../api/client'
import { messageForApiCode, messageForDetail } from '../api/clients/apiCodeMessages'
import type { VoxelBuildRequest } from '../utils/buildVoxelRequest'
import { log } from '../utils/log'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Named CPU phases the backend reports, in order. */
export type VoxelBuildPhase = 'label' | 'reconcile' | 'extract' | 'persist'

/** Phase order for a step indicator — advances monotonically even if the
 *  backend fires a phase out of order. */
export const VOXEL_BUILD_PHASE_ORDER: VoxelBuildPhase[] = [
  'label',
  'reconcile',
  'extract',
  'persist',
]

export interface VoxelBuildProgressTick {
  phase: VoxelBuildPhase
  done: number
  total: number
}

export type VoxelBuildState =
  | { status: 'idle' }
  | {
      status: 'running'
      /** Latest phase tick — null until the first progress event fires. */
      latest: VoxelBuildProgressTick | null
      /** Highest phase index reached, so a step indicator never goes backwards. */
      highestPhaseIndex: number
      /** True once the user pressed Cancel and we are awaiting the terminal event. */
      cancelRequested: boolean
    }
  | { status: 'done'; result: RebuildLithoSolidsResponse }
  | { status: 'cancelled' }
  | { status: 'error'; message: string }

export interface StartVoxelBuildOptions {
  projectId: string
  modelId: string
  request: VoxelBuildRequest
}

export interface UseVoxelBuildStreamResult {
  state: VoxelBuildState
  /** Spawn the build job and open its progress stream. */
  start: (opts: StartVoxelBuildOptions) => void
  /** Ask the running build to stop; the stream stays open for the terminal event. */
  cancel: () => void
  /** Return to ``idle`` (aborts any in-flight stream). */
  reset: () => void
}

/** The terminal SSE error code that means "the user cancelled", not "it broke". */
const BUILD_CANCELLED_CODE = 'build_cancelled'

// The desktop backend always listens on loopback :8765 — the same constant
// ``useDovImportStream`` uses (the module-level API base is not exported).
const API_BASE = 'http://127.0.0.1:8765'

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Manage a 3-D voxel build SSE job.
 *
 * @returns ``{ state, start, cancel, reset }``.
 */
export function useVoxelBuildStream(): UseVoxelBuildStreamResult {
  const [state, setState] = useState<VoxelBuildState>({ status: 'idle' })
  // Kept in refs so the cancel closure and the abort path always read the
  // current values without re-identifying the callbacks.
  const abortRef = useRef<AbortController | null>(null)
  const jobIdRef = useRef<string | null>(null)
  const scopeRef = useRef<{ projectId: string; modelId: string } | null>(null)

  const reset = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    jobIdRef.current = null
    scopeRef.current = null
    setState({ status: 'idle' })
  }, [])

  const cancel = useCallback(() => {
    const jobId = jobIdRef.current
    const scope = scopeRef.current
    if (!jobId || !scope) return
    // Optimistic: show "cancelling" at once; the stream stays open so the
    // terminal build_cancelled event still drives the final transition.
    setState(prev =>
      prev.status === 'running' ? { ...prev, cancelRequested: true } : prev,
    )
    log.info('voxel-build', `cancelling build job ${jobId}`)
    void fetch(
      `${API_BASE}/projects/${scope.projectId}/geology/models/${scope.modelId}` +
        `/litho-solids/build-voxel/jobs/${jobId}/cancel`,
      { method: 'POST' },
    ).catch(err => {
      // A failed cancel POST is non-fatal: the build keeps running and the
      // stream keeps flowing; the user can press Cancel again.
      log.warn('voxel-build', `cancel request failed: ${(err as Error).message}`)
    })
  }, [])

  const start = useCallback((opts: StartVoxelBuildOptions) => {
    // Abort any in-flight build before starting a new one (defensive — the UI
    // gates the button while running).
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const { projectId, modelId, request } = opts
    scopeRef.current = { projectId, modelId }
    jobIdRef.current = null

    setState({ status: 'running', latest: null, highestPhaseIndex: -1, cancelRequested: false })
    log.info('voxel-build', `spawning build job model=${modelId}`)

    const spawnPath =
      `/projects/${projectId}/geology/models/${modelId}/litho-solids/build-voxel/jobs`

    void (async () => {
      try {
        // Step 1 — spawn: POST returns 202 { job_id } immediately.
        const spawnRes = await fetch(`${API_BASE}${spawnPath}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
          signal: controller.signal,
        })

        if (!spawnRes.ok) {
          const detail = await spawnRes.json().catch(() => ({}))
          const msg = messageForDetail(
            (detail as { detail?: unknown }).detail,
            `HTTP ${spawnRes.status}`,
          )
          log.error('voxel-build', `spawn failed: ${msg}`)
          setState({ status: 'error', message: msg })
          return
        }

        const { job_id } = (await spawnRes.json()) as { job_id: string }
        jobIdRef.current = job_id
        log.info('voxel-build', `build job spawned: ${job_id}`)

        // Step 2 — connect: GET the SSE stream by job_id.
        const res = await fetch(`${API_BASE}${spawnPath}/${job_id}`, {
          method: 'GET',
          signal: controller.signal,
        })

        if (!res.ok) {
          const detail = await res.json().catch(() => ({}))
          const msg = messageForDetail(
            (detail as { detail?: unknown }).detail,
            `HTTP ${res.status}`,
          )
          log.error('voxel-build', `stream connect failed: ${msg}`)
          setState({ status: 'error', message: msg })
          return
        }

        if (!res.body) {
          setState({ status: 'error', message: 'No response body from server' })
          return
        }

        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += value

          const parts = buffer.split('\n\n')
          buffer = parts.pop() ?? ''

          for (const raw of parts) {
            const dataLine = raw.split('\n').find(l => l.startsWith('data: '))
            if (!dataLine) continue

            let event: Record<string, unknown>
            try {
              event = JSON.parse(dataLine.slice('data: '.length)) as Record<string, unknown>
            } catch {
              log.warn('voxel-build', `unparseable SSE frame: ${dataLine}`)
              continue
            }

            if (event.type === 'done') {
              log.success('voxel-build', 'build done', event)
              setState({ status: 'done', result: event as unknown as RebuildLithoSolidsResponse })
              return
            }

            if (event.type === 'error') {
              // A user cancel is its own terminal state, not a failure — the
              // model was left exactly as it was.
              if (event.code === BUILD_CANCELLED_CODE) {
                log.info('voxel-build', 'build cancelled')
                setState({ status: 'cancelled' })
                return
              }
              const msg =
                messageForApiCode(event.code as string | undefined) ??
                (event.message as string | undefined) ??
                'Build failed'
              log.error('voxel-build', `server-side error: ${msg}`)
              setState({ status: 'error', message: msg })
              return
            }

            // Progress tick — ``{ type: 'progress', phase, done, total }``.
            if (event.type === 'progress' && typeof event.phase === 'string') {
              const tick: VoxelBuildProgressTick = {
                phase: event.phase as VoxelBuildPhase,
                done: (event.done as number) ?? 0,
                total: (event.total as number) ?? 0,
              }
              const phaseIdx = VOXEL_BUILD_PHASE_ORDER.indexOf(tick.phase)
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
        log.warn('voxel-build', 'stream closed without a terminal done/error event')
        setState(prev =>
          prev.status === 'running'
            ? { status: 'error', message: 'Build stream closed unexpectedly' }
            : prev,
        )
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          log.info('voxel-build', 'stream aborted by client')
          return
        }
        const msg = err instanceof Error ? err.message : 'Unknown stream error'
        log.error('voxel-build', `stream error: ${msg}`, err)
        setState({ status: 'error', message: msg })
      }
    })()
  }, [])

  return { state, start, cancel, reset }
}
