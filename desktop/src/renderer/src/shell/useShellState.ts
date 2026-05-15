// Shell UI chrome state — active stage + inspector open/collapsed.
//
// Both values are localStorage-backed per the persistence rules in
// ui-shell-architecture.md §2.4:
//
//   - Active stage → ``groundmodel.shell.stage`` (per-user preference,
//     not a project decision; different engineers opening the same .gmproj
//     may reasonably want to start on different stages).
//   - Inspector open → ``groundmodel.shell.inspector_open`` (per-user
//     preference; defaults to open so the inspector is always-on by default).
//
// Neither value rides in the .gmproj bundle — see the same section.

import { useCallback, useState } from 'react'

import type { StageId } from './StageDescriptor'
import { STAGE_ORDER } from './StageRegistry'
import { log } from '../utils/log'

const STAGE_KEY = 'groundmodel.shell.stage'
const INSPECTOR_KEY = 'groundmodel.shell.inspector_open'

// Default stage — always the first one in the engineering workflow order.
const DEFAULT_STAGE: StageId = STAGE_ORDER[0]

function readStoredStage(): StageId {
  try {
    const raw = localStorage.getItem(STAGE_KEY)
    if (raw && (STAGE_ORDER as readonly string[]).includes(raw)) {
      return raw as StageId
    }
  } catch {
    // localStorage unavailable (privacy mode, quota); fall through.
  }
  return DEFAULT_STAGE
}

function readStoredInspectorOpen(): boolean {
  try {
    const raw = localStorage.getItem(INSPECTOR_KEY)
    if (raw !== null) return raw !== 'false'
  } catch {
    // localStorage unavailable; fall through.
  }
  return true // default: inspector open
}

export interface UseShellStateResult {
  /** Currently active stage id. */
  activeStageId: StageId
  /** Whether the right inspector panel is expanded. */
  inspectorOpen: boolean
  /** Switch to a different stage. Persists to localStorage. */
  setActiveStage: (id: StageId) => void
  /** Toggle the inspector open/collapsed. Persists to localStorage. */
  toggleInspector: () => void
  /** Explicitly open or close the inspector. Persists to localStorage. */
  setInspectorOpen: (open: boolean) => void
}

/**
 * React hook that owns the shell's UI chrome state.
 *
 * Manages the active stage id and the inspector open/collapsed flag.
 * Both values are backed by ``localStorage`` so the user's last-used stage
 * and inspector state survive page reloads and app restarts.
 *
 * Neither value rides in the ``.gmproj`` bundle — see §2.4 of
 * ``docs/ui-shell-architecture.md``.
 *
 * Returns
 * -------
 * UseShellStateResult
 *     Active stage id, inspector open flag, and their setters.
 */
export function useShellState(): UseShellStateResult {
  const [activeStageId, setActiveStageIdRaw] = useState<StageId>(readStoredStage)
  const [inspectorOpen, setInspectorOpenRaw] = useState<boolean>(readStoredInspectorOpen)

  const setActiveStage = useCallback((id: StageId): void => {
    log.debug('shell', `stage → ${id}`)
    try {
      localStorage.setItem(STAGE_KEY, id)
    } catch {
      // Ignore write failures — the in-memory state still updates.
    }
    setActiveStageIdRaw(id)
  }, [])

  const setInspectorOpen = useCallback((open: boolean): void => {
    log.debug('shell', `inspector ${open ? 'open' : 'closed'}`)
    try {
      localStorage.setItem(INSPECTOR_KEY, String(open))
    } catch {
      // Ignore write failures.
    }
    setInspectorOpenRaw(open)
  }, [])

  const toggleInspector = useCallback((): void => {
    setInspectorOpenRaw(prev => {
      const next = !prev
      log.debug('shell', `inspector toggle → ${next ? 'open' : 'closed'}`)
      try {
        localStorage.setItem(INSPECTOR_KEY, String(next))
      } catch {
        // Ignore write failures.
      }
      return next
    })
  }, [])

  return { activeStageId, inspectorOpen, setActiveStage, toggleInspector, setInspectorOpen }
}
