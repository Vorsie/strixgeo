// Tests for the two-stage-save / dirty additions to useProjectLifecycle (#160):
//   * a geology MUTATION marks the project dirty (hasUnsavedMutations),
//   * "Don't Save" reverts the DB from the last-saved file (replace-restore)
//     for a saved project, and falls back to deleting session creates for a
//     never-saved one,
//   * Save clears the mutations flag.
//
// The hook registers File-menu IPC listeners + a quit handshake on mount, so
// window.electron is stubbed with the handful of methods it touches.

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useProjectLifecycle } from './useProjectLifecycle'

const noopUnsub = (): void => {}

beforeEach(() => {
  ;(globalThis as unknown as { window: { electron: unknown } }).window.electron = {
    onMenuProjectNew: vi.fn().mockReturnValue(noopUnsub),
    onMenuProjectOpen: vi.fn().mockReturnValue(noopUnsub),
    onMenuProjectOpenRecent: vi.fn().mockReturnValue(noopUnsub),
    onMenuProjectSave: vi.fn().mockReturnValue(noopUnsub),
    onMenuProjectSaveAs: vi.fn().mockReturnValue(noopUnsub),
    onMenuProjectClose: vi.fn().mockReturnValue(noopUnsub),
    onAppBeforeQuit: vi.fn().mockReturnValue(noopUnsub),
    notifyQuitDecision: vi.fn(),
    setWindowTitle: vi.fn(),
    // The close-flow notes' second destination. Present here because their
    // whole purpose is reaching the MAIN process console — a stub without it
    // would let a regression that silently drops them stay green.
    closeFlowNote: vi.fn().mockResolvedValue(undefined),
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** Build a full set of useProjectLifecycle args with vi.fn() mocks. */
function makeArgs(overrides: Record<string, unknown> = {}) {
  return {
    project: { id: 'p1', name: 'Site A' },
    metadataDirty: false,
    sessionImportCptIds: new Set<string>(),
    setSessionImportCptIds: vi.fn(),
    sessionImportBoreholeIds: new Set<string>(),
    setSessionImportBoreholeIds: vi.fn(),
    sessionImportFormationIds: new Set<string>(),
    setSessionImportFormationIds: vi.fn(),
    sessionImportSectionIds: new Set<string>(),
    setSessionImportSectionIds: vi.fn(),
    sessionImportContactIds: new Set<string>(),
    setSessionImportContactIds: vi.fn(),
    removeFromManifest: vi.fn(),
    saveMetadata: vi.fn().mockResolvedValue(true),
    saveAsProject: vi.fn().mockResolvedValue(null),
    closeProject: vi.fn(),
    pickAndOpenProject: vi.fn().mockResolvedValue({ outcome: 'cancelled' }),
    openProjectFile: vi.fn().mockResolvedValue(null),
    discardContacts: vi.fn(),
    activeGeologicalModel: { id: 'm1' },
    stageLumping: vi.fn(),
    currentLumping: null,
    hasUnsavedMutations: false,
    setHasUnsavedMutations: vi.fn(),
    revertToLastSaved: vi.fn().mockResolvedValue(true),
    hasSavedSnapshot: true,
    clearRecoveryNow: vi.fn().mockResolvedValue(undefined),
    lastSaveWroteFile: vi.fn().mockReturnValue(true),
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

describe('useProjectLifecycle — two-stage save (#160)', () => {
  it('projectDirty is true when a mutation flagged the project (no session imports)', () => {
    const { result } = renderHook(() =>
      useProjectLifecycle(makeArgs({ hasUnsavedMutations: true })),
    )
    expect(result.current.projectDirty).toBe(true)
  })

  it('projectDirty is false when clean (no metadata, no imports, no mutations)', () => {
    const { result } = renderHook(() => useProjectLifecycle(makeArgs()))
    expect(result.current.projectDirty).toBe(false)
  })

  it('Don’t Save on a SAVED project replace-restores from the file, clears tracking, and closes', async () => {
    const revertToLastSaved = vi.fn().mockResolvedValue(true)
    const closeProject = vi.fn()
    const setHasUnsavedMutations = vi.fn()
    const removeFromManifest = vi.fn()
    const setSessionImportCptIds = vi.fn()
    const args = makeArgs({
      revertToLastSaved,
      closeProject,
      setHasUnsavedMutations,
      removeFromManifest,
      setSessionImportCptIds,
    })
    const { result } = renderHook(() => useProjectLifecycle(args))

    await act(async () => {
      await result.current.handleUnsavedDiscard()
    })

    expect(revertToLastSaved).toHaveBeenCalledTimes(1)
    // Reverted path clears the tracking sets but does NOT run the
    // discard-delete path (removeFromManifest is only called by
    // discardSessionImports — the replace-restore already wiped the rows).
    expect(setSessionImportCptIds).toHaveBeenCalledWith(new Set())
    expect(removeFromManifest).not.toHaveBeenCalled()
    expect(setHasUnsavedMutations).toHaveBeenCalledWith(false)
    expect(closeProject).toHaveBeenCalledTimes(1)
  })

  it('Don’t Save on a NEVER-SAVED project falls back to discardSessionImports', async () => {
    const revertToLastSaved = vi.fn().mockResolvedValue(false)
    const closeProject = vi.fn()
    const removeFromManifest = vi.fn()
    const setHasUnsavedMutations = vi.fn()
    const args = makeArgs({
      revertToLastSaved,
      closeProject,
      removeFromManifest,
      setHasUnsavedMutations,
    })
    const { result } = renderHook(() => useProjectLifecycle(args))

    await act(async () => {
      await result.current.handleUnsavedDiscard()
    })

    expect(revertToLastSaved).toHaveBeenCalledTimes(1)
    // Fallback path runs discardSessionImports, which removes ids from the
    // manifest (the discriminator vs the reverted path).
    expect(removeFromManifest).toHaveBeenCalled()
    expect(setHasUnsavedMutations).toHaveBeenCalledWith(false)
    expect(closeProject).toHaveBeenCalledTimes(1)
  })

  it('Save clears the mutations flag', async () => {
    const setHasUnsavedMutations = vi.fn()
    const args = makeArgs({ setHasUnsavedMutations })
    const { result } = renderHook(() => useProjectLifecycle(args))

    await act(async () => {
      await result.current.saveProject()
    })

    expect(setHasUnsavedMutations).toHaveBeenCalledWith(false)
  })
})

// The close-without-save dialog names what a Discard takes. One OR'd
// projectDirty boolean cannot carry that, so the hook also publishes the
// itemised view the dialog reads.
describe('useProjectLifecycle — unsavedSummary feeds the discard prompt', () => {
  it('counts this session imports per kind and flags the uncounted edits', () => {
    const { result } = renderHook(() =>
      useProjectLifecycle(
        makeArgs({
          sessionImportCptIds: new Set(['c1', 'c2', 'c3']),
          sessionImportBoreholeIds: new Set(['b1']),
          hasUnsavedMutations: true,
          metadataDirty: true,
        }),
      ),
    )

    expect(result.current.unsavedSummary).toEqual({
      hasSavedSnapshot: true,
      importedCpts: 3,
      importedBoreholes: 1,
      importedFormations: 0,
      importedSections: 0,
      importedContacts: 0,
      hasInterpretationEdits: true,
      hasMetadataEdits: true,
    })
  })

  it('reports a never-saved project as having no snapshot to revert to', () => {
    const { result } = renderHook(() =>
      useProjectLifecycle(makeArgs({ hasSavedSnapshot: false })),
    )

    expect(result.current.unsavedSummary.hasSavedSnapshot).toBe(false)
  })
})

// Crash detection has no sentinel: "a file present at launch means the
// previous session reached no clean exit" (docs/design/autosave-recovery.md
// §4). That only holds if every DECIDED exit deletes the file — and the
// delete after a save is gated on the FILE write, not on saveProject's
// return value, because "a failed file write means the delta still has no
// durable home".
describe('useProjectLifecycle — every decided exit clears the recovery file', () => {
  it('clears after a save that actually reached the file', async () => {
    const clearRecoveryNow = vi.fn().mockResolvedValue(undefined)
    const args = makeArgs({ clearRecoveryNow })
    const { result } = renderHook(() => useProjectLifecycle(args))

    await act(async () => {
      await result.current.saveProject()
    })

    expect(clearRecoveryNow).toHaveBeenCalledTimes(1)
  })

  it('keeps the recovery file when the save never reached the file', async () => {
    const clearRecoveryNow = vi.fn().mockResolvedValue(undefined)
    const args = makeArgs({
      clearRecoveryNow,
      lastSaveWroteFile: vi.fn().mockReturnValue(false),
    })
    const { result } = renderHook(() => useProjectLifecycle(args))

    await act(async () => {
      await result.current.saveProject()
    })

    expect(clearRecoveryNow).not.toHaveBeenCalled()
  })

  it('clears after Discard — the user threw the unsaved work away', async () => {
    const clearRecoveryNow = vi.fn().mockResolvedValue(undefined)
    const args = makeArgs({ clearRecoveryNow })
    const { result } = renderHook(() => useProjectLifecycle(args))

    await act(async () => {
      await result.current.handleUnsavedDiscard()
    })

    expect(clearRecoveryNow).toHaveBeenCalledTimes(1)
  })

  it('clears before telling main it may quit, so the exit is not raced', async () => {
    const order: string[] = []
    const clearRecoveryNow = vi.fn().mockImplementation(async () => {
      order.push('clear')
    })
    const notifyQuitDecision = vi.fn().mockImplementation(async () => {
      order.push('quit')
    })
    ;(globalThis as unknown as { window: { electron: Record<string, unknown> } }).window.electron
      .notifyQuitDecision = notifyQuitDecision
    const onAppBeforeQuit = (
      globalThis as unknown as {
        window: { electron: { onAppBeforeQuit: ReturnType<typeof vi.fn> } }
      }
    ).window.electron.onAppBeforeQuit

    // A clean project: main asks, the renderer agrees straight away — and
    // that agreement IS the decided exit.
    renderHook(() => useProjectLifecycle(makeArgs({ clearRecoveryNow })))
    const beforeQuitCb = onAppBeforeQuit.mock.calls[0][0] as () => void

    await act(async () => {
      beforeQuitCb()
      await Promise.resolve()
    })

    expect(order).toEqual(['clear', 'quit'])
  })
})

// ---------------------------------------------------------------------------
// Close-flow instrumentation.
//
// The failure this answers is a dogfeed report of the shape "it discarded my
// work without asking". Nothing in the close flow reaches the API, so a bug
// report about it is otherwise unfalsifiable — there is no server log to read
// and the user cannot reproduce a thing they did once. One INFO line at each
// decision point makes the next paste of the console the whole answer: which
// surface asked to close, whether the project was dirty, whether a dialog went
// up, and which button ended it. INFO not DEBUG on purpose — DEBUG is stripped
// from production builds, which is exactly where these reports come from.
// ---------------------------------------------------------------------------

describe('useProjectLifecycle — the close flow is legible from the log', () => {
  /** Everything the hook logged, flattened into one greppable string. */
  function loggedText(spy: ReturnType<typeof vi.spyOn>): string {
    const calls = spy.mock.calls as unknown as unknown[][]
    return calls.map(call => call.map(arg => String(arg)).join(' ')).join('\n')
  }

  it('records that a dirty close request opened the dialog rather than closing', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const { result } = renderHook(() =>
      useProjectLifecycle(makeArgs({ hasUnsavedMutations: true })),
    )

    act(() => {
      result.current.handleCloseProjectRequest()
    })

    const text = loggedText(info)
    expect(text).toMatch(/close requested/i)
    expect(text).toMatch(/dirty=true/)
    expect(text).toMatch(/close-project/)
  })

  it('records which button answered the dialog', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const { result } = renderHook(() => useProjectLifecycle(makeArgs()))

    act(() => {
      result.current.handleUnsavedCancel()
    })

    expect(loggedText(info)).toMatch(/cancel/i)
  })

  it('records that a Discard was answered by the user, not taken silently', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const { result } = renderHook(() => useProjectLifecycle(makeArgs()))

    await act(async () => {
      await result.current.handleUnsavedDiscard()
    })

    expect(loggedText(info)).toMatch(/discard/i)
  })

  it('records which branch a quit took — the clean one leaves no dialog', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const onAppBeforeQuit = (
      globalThis as unknown as {
        window: { electron: { onAppBeforeQuit: ReturnType<typeof vi.fn> } }
      }
    ).window.electron.onAppBeforeQuit
    renderHook(() => useProjectLifecycle(makeArgs()))
    const beforeQuitCb = onAppBeforeQuit.mock.calls[0][0] as () => void

    await act(async () => {
      beforeQuitCb()
      await Promise.resolve()
    })

    const text = loggedText(info)
    expect(text).toMatch(/quit/i)
    expect(text).toMatch(/clean/i)
  })
})

// ---------------------------------------------------------------------------
// ...and the notes have to reach the process whose console the report shows.
//
// The renderer-side ``log.info`` lines above are invisible in a packaged
// build: DevTools is disabled there (debt #200) and the renderer console goes
// nowhere. Dogfeed reports are pasted TERMINAL output, which shows the main
// process — the same place ``[main] close intercepted`` and ``[main] quit
// decision`` already print. Half a handshake in the log answers nothing.
// ---------------------------------------------------------------------------

describe('useProjectLifecycle — close-flow notes reach the main process', () => {
  /** The stubbed IPC bridge the notes are mirrored through. */
  function bridge(): ReturnType<typeof vi.fn> {
    return (
      globalThis as unknown as { window: { electron: { closeFlowNote: ReturnType<typeof vi.fn> } } }
    ).window.electron.closeFlowNote
  }

  it('mirrors the dirty-close decision, not just the renderer console', () => {
    const { result } = renderHook(() =>
      useProjectLifecycle(makeArgs({ hasUnsavedMutations: true })),
    )

    act(() => {
      result.current.handleCloseProjectRequest()
    })

    const sent = bridge().mock.calls.map(call => String(call[0])).join('\n')
    expect(sent).toMatch(/close requested/i)
    expect(sent).toMatch(/dirty=true/)
    expect(sent).toMatch(/close-project/)
  })

  it('mirrors which button answered the dialog', async () => {
    const { result } = renderHook(() => useProjectLifecycle(makeArgs()))

    await act(async () => {
      await result.current.handleUnsavedDiscard()
    })

    expect(bridge().mock.calls.map(call => String(call[0])).join('\n')).toMatch(/discard/i)
  })

  it('survives a preload without the channel — a note may never break a close', () => {
    // An older preload, or any embedder that does not expose the bridge. The
    // close still has to happen, and the renderer-side line still has to land.
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const electron = (globalThis as unknown as { window: { electron: Record<string, unknown> } })
      .window.electron
    delete electron.closeFlowNote
    const { result } = renderHook(() => useProjectLifecycle(makeArgs()))

    act(() => {
      result.current.handleCloseProjectRequest()
    })

    // The close still reached its next step (the mis-click confirm)...
    expect(result.current.closeConfirmOpen).toBe(true)
    // ...and the renderer-side half of the note still landed.
    expect(info.mock.calls.map(call => call.map(String).join(' ')).join('\n')).toMatch(
      /clean close from the sidebar/i,
    )
  })
})
