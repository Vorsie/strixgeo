import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  RECOVERY_DEBOUNCE_MS,
  RECOVERY_MAX_LATENCY_MS,
  useRecoveryAutosave,
} from './useRecoveryAutosave'
import type { UseRecoveryAutosaveOptions } from './useRecoveryAutosave'
import type { ProjectResponse } from '../api/client'
import type { BulkAnchorGhost } from './useGeologicalModel'

// The write schedule for crash recovery (docs/design/autosave-recovery.md §4).
//
// Behaviour under test, in the design's own words:
//   * "A pure timer was rejected — it rewrites an unchanged file forever and
//     blunts the existence signal. A pure debounce was rejected — sustained
//     ghost triage starves it. The cap bounds worst-case loss at 15 s of
//     continuous work." So: debounce AND cap, both.
//   * "The clean paths delete the file, so a file present at launch means the
//     previous session reached no clean exit."
//   * Ordering trap: "cancel every pending debounce/cap timer INSIDE the
//     clear path. A late timer firing after a clean save resurrects the file
//     and produces a false recovery offer next launch."
//   * A recovery file kept via "Open without restoring" must survive a
//     session that never gets dirty — so a clean MOUNT deletes nothing.
//   * ...and it must survive a session that DOES get dirty and then reaches a
//     clean exit. Declining preserves the copy until the user discards it
//     (owner decision 2026-08-03), so every clear on this side of the app
//     clears THIS session's slot only. The both-slots delete belongs to the
//     prompt's Discard button and to nothing else.

const PROJECT: ProjectResponse = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Kanaal Noord',
  project_number: null,
  client: null,
  site_label: null,
  description: null,
  tags: [],
  default_horizontal_epsg: null,
  default_vertical_epsg: null,
  phase: null,
  status: 'active',
  archived_at: null,
  created_at: '2026-08-02T09:00:00Z',
  updated_at: '2026-08-02T09:00:00Z',
  view_state: {},
}

const writeRecovery = vi.fn()
const deleteRecovery = vi.fn()
const deletePrimaryRecovery = vi.fn()

/** One anchor of ghost triage — the irreproducible half of the delta. */
function ghost(acceptedIdx: number): BulkAnchorGhost {
  return {
    kind: 'cpt',
    suggestions: [],
    surfaceElevationM: null,
    accepted: new Set([acceptedIdx]),
    rejected: new Set<number>(),
    edits: new Map(),
  }
}

/** A clean session: nothing at risk, nothing to write. */
function cleanOptions(): UseRecoveryAutosaveOptions {
  return {
    filePath: 'C:/projects/kanaal.strix',
    project: PROJECT,
    saved: PROJECT,
    currentLumping: null,
    savedLumping: null,
    lumpingRevision: null,
    ghostsByAnchor: new Map(),
    manifestCptIds: new Set(),
    manifestBoreholeIds: new Set(),
    manifestFormationIds: new Set(),
    manifestSectionIds: new Set(),
    sessionImportCptIds: new Set(),
    sessionImportBoreholeIds: new Set(),
    sessionImportFormationIds: new Set(),
    sessionImportSectionIds: new Set(),
    sessionImportContactIds: new Set(),
    hasUnsavedMutations: false,
  }
}

/** The same session with one ghost anchor under triage. */
function dirtyOptions(acceptedIdx = 0): UseRecoveryAutosaveOptions {
  return { ...cleanOptions(), ghostsByAnchor: new Map([['anchor-1', ghost(acceptedIdx)]]) }
}

beforeEach(() => {
  vi.useFakeTimers()
  writeRecovery.mockReset().mockResolvedValue({})
  deleteRecovery.mockReset().mockResolvedValue(true)
  deletePrimaryRecovery.mockReset().mockResolvedValue(true)
  ;(window as unknown as { electron: unknown }).electron = {
    writeRecovery,
    deleteRecovery,
    deletePrimaryRecovery,
  }
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useRecoveryAutosave write schedule', () => {
  it('writes once, two seconds after the last change in a burst', () => {
    const { rerender } = renderHook(opts => useRecoveryAutosave(opts), {
      initialProps: dirtyOptions(0),
    })
    // A burst: three more triage gestures inside half a second.
    for (const idx of [1, 2, 3]) {
      act(() => {
        vi.advanceTimersByTime(150)
      })
      rerender(dirtyOptions(idx))
    }
    act(() => {
      vi.advanceTimersByTime(RECOVERY_DEBOUNCE_MS - 1)
    })
    expect(writeRecovery).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(writeRecovery).toHaveBeenCalledTimes(1)
    expect(writeRecovery.mock.calls[0][0]).toBe(PROJECT.id)
  })

  it('still reaches disk within the cap when the user never pauses', () => {
    const { rerender } = renderHook(opts => useRecoveryAutosave(opts), {
      initialProps: dirtyOptions(0),
    })
    // A change every second keeps resetting the debounce; only the cap can
    // land this write.
    for (let i = 1; i <= 14; i++) {
      act(() => {
        vi.advanceTimersByTime(1_000)
      })
      rerender(dirtyOptions(i))
    }
    expect(writeRecovery).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(RECOVERY_MAX_LATENCY_MS - 14_000)
    })
    expect(writeRecovery).toHaveBeenCalledTimes(1)
  })

  it('hands the store plain JSON, with the ghost Sets converted', () => {
    renderHook(opts => useRecoveryAutosave(opts), { initialProps: dirtyOptions(2) })
    act(() => {
      vi.advanceTimersByTime(RECOVERY_DEBOUNCE_MS)
    })
    const payload = writeRecovery.mock.calls[0][1] as {
      ghosts: [string, { accepted: number[] }][]
    }
    expect(payload.ghosts[0][0]).toBe('anchor-1')
    expect(payload.ghosts[0][1].accepted).toEqual([2])
    expect(writeRecovery.mock.calls[0][2]).toEqual({ projectName: 'Kanaal Noord' })
  })

  it('survives a write failure without retry-looping', async () => {
    writeRecovery.mockRejectedValue(new Error('disk full'))
    renderHook(opts => useRecoveryAutosave(opts), { initialProps: dirtyOptions(0) })
    await act(async () => {
      vi.advanceTimersByTime(RECOVERY_DEBOUNCE_MS)
    })
    expect(writeRecovery).toHaveBeenCalledTimes(1)
    // No re-arm: only a fresh change reschedules.
    await act(async () => {
      vi.advanceTimersByTime(RECOVERY_MAX_LATENCY_MS * 2)
    })
    expect(writeRecovery).toHaveBeenCalledTimes(1)
  })
})

describe('useRecoveryAutosave clearing', () => {
  it('deletes the file when the session goes clean, and kills pending timers', () => {
    const { rerender } = renderHook(opts => useRecoveryAutosave(opts), {
      initialProps: dirtyOptions(0),
    })
    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    rerender(cleanOptions())
    expect(deletePrimaryRecovery).toHaveBeenCalledWith(PROJECT.id)
    // A copy the user declined in an earlier session is NOT this session's to
    // clear: it lives on until they answer Discard in the prompt.
    expect(deleteRecovery).not.toHaveBeenCalled()

    // The ordering trap: a timer armed before the clean transition must not
    // fire afterwards and resurrect the file.
    act(() => {
      vi.advanceTimersByTime(RECOVERY_MAX_LATENCY_MS * 2)
    })
    expect(writeRecovery).not.toHaveBeenCalled()
  })

  // §4 gates the clear on THE FILE WRITE, not on the save's return value.
  // The save path resets the session-import sets and the mutations flag even
  // when the .strix write failed, so the watched values below go clean while
  // the delta is still homeless — and deleting the file there would destroy
  // the only copy of work that never reached disk.
  it('keeps the file on a clean transition when the last save never reached the file', () => {
    const canClearOnClean = vi.fn().mockReturnValue(false)
    const { rerender } = renderHook(opts => useRecoveryAutosave(opts), {
      initialProps: { ...dirtyOptions(0), canClearOnClean },
    })
    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    rerender({ ...cleanOptions(), canClearOnClean })

    expect(canClearOnClean).toHaveBeenCalled()
    expect(deletePrimaryRecovery).not.toHaveBeenCalled()
    expect(deleteRecovery).not.toHaveBeenCalled()
    // The timers still die: a late write after the user reached a clean-
    // looking state is the ordering trap regardless of the file's fate.
    act(() => {
      vi.advanceTimersByTime(RECOVERY_MAX_LATENCY_MS * 2)
    })
    expect(writeRecovery).not.toHaveBeenCalled()
  })

  it('deletes on a clean transition when the last save did reach the file', () => {
    const canClearOnClean = vi.fn().mockReturnValue(true)
    const { rerender } = renderHook(opts => useRecoveryAutosave(opts), {
      initialProps: { ...dirtyOptions(0), canClearOnClean },
    })
    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    rerender({ ...cleanOptions(), canClearOnClean })

    expect(deletePrimaryRecovery).toHaveBeenCalledWith(PROJECT.id)
  })

  it('leaves a kept recovery file alone when the session never gets dirty', () => {
    const { rerender } = renderHook(opts => useRecoveryAutosave(opts), {
      initialProps: cleanOptions(),
    })
    rerender(cleanOptions())
    act(() => {
      vi.advanceTimersByTime(RECOVERY_MAX_LATENCY_MS * 2)
    })
    expect(deletePrimaryRecovery).not.toHaveBeenCalled()
    expect(deleteRecovery).not.toHaveBeenCalled()
    expect(writeRecovery).not.toHaveBeenCalled()
  })

  it('clearRecoveryNow deletes immediately and cancels the pending write', async () => {
    const { result } = renderHook(opts => useRecoveryAutosave(opts), {
      initialProps: dirtyOptions(0),
    })
    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    await act(async () => {
      await result.current.clearRecoveryNow()
    })
    expect(deletePrimaryRecovery).toHaveBeenCalledWith(PROJECT.id)
    expect(deleteRecovery).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(RECOVERY_MAX_LATENCY_MS * 2)
    })
    expect(writeRecovery).not.toHaveBeenCalled()
  })

  it('drops a pending write when the project closes, and deletes nothing', () => {
    const { rerender } = renderHook(opts => useRecoveryAutosave(opts), {
      initialProps: dirtyOptions(0),
    })
    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    // Project closed: the at-risk state is gone from memory, and deciding
    // whether the file should die belongs to the close flow, not here.
    rerender({ ...dirtyOptions(0), project: null, saved: null })
    act(() => {
      vi.advanceTimersByTime(RECOVERY_MAX_LATENCY_MS * 2)
    })
    expect(writeRecovery).not.toHaveBeenCalled()
    expect(deletePrimaryRecovery).not.toHaveBeenCalled()
    expect(deleteRecovery).not.toHaveBeenCalled()
  })

  // The sequence the owner decision turns on: a crashed session's copy was
  // declined ("Open without restoring"), so it sits in the declined slot while
  // this session works and then saves. Nothing on this side of the app may
  // reach that slot — the moment a clear here did, declining would again lose
  // the work seconds later, which is the behaviour the second slot exists to
  // end.
  it('never reaches the declined slot, on either clearing path', async () => {
    const { result, rerender } = renderHook(opts => useRecoveryAutosave(opts), {
      initialProps: dirtyOptions(0),
    })
    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    rerender(cleanOptions())
    await act(async () => {
      await result.current.clearRecoveryNow()
    })
    expect(deleteRecovery).not.toHaveBeenCalled()
    expect(deletePrimaryRecovery).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Suspension while a recovery prompt is unanswered.
//
// The window between "the prompt goes up" and "the user clicks something" is
// the one moment when the recovery files on disk do NOT belong to this
// session: they hold the crashed session's work, and the answer sequence is
// about to move them between slots. A scheduler write landing in that window
// overwrites the crashed copy with this session's much thinner delta — and the
// decline then preserves THAT, keeping the promise in name only. A decided
// exit in that window is worse: it deletes a crash copy the user never
// answered for.
//
// So App suspends the scheduler for exactly as long as an offer is pending
// (``suspended={recoveryOffer !== null}``), and the answer handlers finish
// their IPC work before clearing the offer.
// ---------------------------------------------------------------------------

describe('useRecoveryAutosave suspension (an unanswered recovery prompt)', () => {
  it('writes nothing while the prompt is up, however dirty the session gets', () => {
    const { rerender } = renderHook(opts => useRecoveryAutosave(opts), {
      initialProps: { ...dirtyOptions(0), suspended: true },
    })
    for (const idx of [1, 2, 3]) {
      act(() => {
        vi.advanceTimersByTime(1_000)
      })
      rerender({ ...dirtyOptions(idx), suspended: true })
    }
    act(() => {
      vi.advanceTimersByTime(RECOVERY_MAX_LATENCY_MS * 2)
    })
    expect(writeRecovery).not.toHaveBeenCalled()
  })

  it('resumes writing as soon as the prompt is answered', () => {
    const { rerender } = renderHook(opts => useRecoveryAutosave(opts), {
      initialProps: { ...dirtyOptions(0), suspended: true },
    })
    act(() => {
      vi.advanceTimersByTime(RECOVERY_MAX_LATENCY_MS)
    })
    expect(writeRecovery).not.toHaveBeenCalled()

    rerender({ ...dirtyOptions(0), suspended: false })
    act(() => {
      vi.advanceTimersByTime(RECOVERY_DEBOUNCE_MS)
    })
    expect(writeRecovery).toHaveBeenCalledTimes(1)
  })

  it('does not clear the crashed copy when the session goes clean under the prompt', () => {
    // Save-while-the-prompt-is-up. The clean transition is about THIS
    // session's delta; the file on disk is the crashed session's, still
    // unanswered for.
    const { rerender } = renderHook(opts => useRecoveryAutosave(opts), {
      initialProps: { ...dirtyOptions(0), suspended: true },
    })
    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    rerender({ ...cleanOptions(), suspended: true })
    expect(deletePrimaryRecovery).not.toHaveBeenCalled()
    expect(deleteRecovery).not.toHaveBeenCalled()
  })

  it('keeps the copy when the user quits with the prompt still unanswered', async () => {
    // A decided exit (quit / close / save) mid-prompt used to run the ordinary
    // clear, destroying a crash copy the user had not answered for and would
    // never be offered again. Suspended, the clear does nothing — so the next
    // launch offers the same work, which is the whole promise.
    const { result } = renderHook(opts => useRecoveryAutosave(opts), {
      initialProps: { ...dirtyOptions(0), suspended: true },
    })
    await act(async () => {
      await result.current.clearRecoveryNow()
    })
    expect(deletePrimaryRecovery).not.toHaveBeenCalled()
    expect(deleteRecovery).not.toHaveBeenCalled()
  })

  it('still kills pending timers on a suspended clear — the ordering trap holds', () => {
    // Whatever happens to the file, a timer armed before the exit must not
    // fire afterwards: a late write resurrects a file the next launch reads as
    // a crash signal.
    const { result } = renderHook(opts => useRecoveryAutosave(opts), {
      initialProps: dirtyOptions(0),
    })
    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    // The prompt appears (a second project's offer, a re-detect) and the user
    // quits before answering.
    void result.current.clearRecoveryNow()
    act(() => {
      vi.advanceTimersByTime(RECOVERY_MAX_LATENCY_MS * 2)
    })
    expect(writeRecovery).not.toHaveBeenCalled()
  })
})
