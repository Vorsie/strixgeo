// Always-on pick consistency check (uncertainty slice A0, owner 2026-10-19).
//
// The engine computes in the background and answers ``computing`` until a
// changed formation is done, so this hook never blocks: it fetches when a
// model opens, waits PICK_CHECK_DEBOUNCE_MS after a pick edit (a drag fires
// many edits), and polls every PICK_CHECK_POLL_MS while the answer is
// ``computing``. The model id must already be project-guarded by the caller
// (``modelOfProject``), so a project switch sends no request for the old model.

import { useEffect, useRef, useState } from 'react'

import { api } from '../api/client'
import type { FormationPickCheckResponse } from '../api/client'
import { log } from '../utils/log'

export const PICK_CHECK_DEBOUNCE_MS = 2000
export const PICK_CHECK_POLL_MS = 2000

export type PickCheckStatus = 'idle' | 'computing' | 'ready' | 'failed'

export interface ContactConsistency {
  status: PickCheckStatus
  formations: FormationPickCheckResponse[]
}

/**
 * Track the pick consistency report of a geological model.
 *
 * Parameters
 * ----------
 * projectId
 *     The active project id.
 * modelId
 *     The active geological model id, or ``null`` when none.
 * refreshSignal
 *     Bumps on every contact mutation (``crossingsRefreshCounter``).
 *
 * Returns
 * -------
 * ContactConsistency
 *     ``status`` and the per-formation results.
 */
export function useContactConsistency(
  projectId: string,
  modelId: string | null,
  refreshSignal: number,
): ContactConsistency {
  const [state, setState] = useState<ContactConsistency>({ status: 'idle', formations: [] })
  const lastModelRef = useRef<string | null>(null)

  useEffect(() => {
    if (modelId === null) {
      lastModelRef.current = null
      setState({ status: 'idle', formations: [] })
      return
    }
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const fetchOnce = (): void => {
      api.geology
        .getContactConsistency(projectId, modelId)
        .then(resp => {
          if (cancelled) return
          if (resp.status === 'computing') {
            setState({ status: 'computing', formations: resp.formations })
            timer = setTimeout(fetchOnce, PICK_CHECK_POLL_MS)
            return
          }
          setState({ status: 'ready', formations: resp.formations })
        })
        .catch(err => {
          // ERROR: an unchecked model must not look like a clean one.
          log.error('geology', `getContactConsistency failed for ${modelId}`, err)
          if (cancelled) return
          setState({ status: 'failed', formations: [] })
        })
    }
    const delay = lastModelRef.current === modelId ? PICK_CHECK_DEBOUNCE_MS : 0
    lastModelRef.current = modelId
    timer = setTimeout(fetchOnce, delay)
    return () => {
      cancelled = true
      if (timer !== null) clearTimeout(timer)
    }
  }, [projectId, modelId, refreshSignal])

  return state
}
