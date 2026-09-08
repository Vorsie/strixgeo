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
    revertToLastSaved: vi.fn().mockResolvedValue('reverted'),
    hasSavedSnapshot: true,
    clearRecoveryNow: vi.fn().mockResolvedValue(undefined),
    lastSaveWroteFile: vi.fn().mockReturnValue(true),
    projectFilePath: 'C:/projects/Site A.strix',
    toast: vi.fn(),
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
    const revertToLastSaved = vi.fn().mockResolvedValue('reverted')
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
    const revertToLastSaved = vi.fn().mockResolvedValue('no-snapshot')
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

// Owner ruling (installer #26, 2026-09-08): "I don't want to save, I want the
// changes to be gone." A refused revert (the .strix on disk is not this
// project's latest save) must NOT dead-end — it must offer a way to throw the
// session away without Task Manager. The confirmation preserves the audit
// protection by making the loss explicit and named before it happens.
describe('useProjectLifecycle — refused revert offers a force-revert, never traps', () => {
  it('a refused revert opens the force-revert confirmation instead of closing or deleting', async () => {
    const revertToLastSaved = vi
      .fn()
      .mockResolvedValue('refused-not-latest-save')
    const closeProject = vi.fn()
    const setHasUnsavedMutations = vi.fn()
    const args = makeArgs({
      revertToLastSaved,
      closeProject,
      setHasUnsavedMutations,
    })
    const { result } = renderHook(() => useProjectLifecycle(args))

    await act(async () => {
      await result.current.handleUnsavedDiscard()
    })

    // The gate refused: nothing was deleted, nothing closed — but the user is
    // NOT stuck. The prompt that lets him throw the session away is now open.
    expect(result.current.forceRevertPromptOpen).toBe(true)
    expect(closeProject).not.toHaveBeenCalled()
    expect(setHasUnsavedMutations).not.toHaveBeenCalled()
  })

  it('confirming force-revert replaces the DB from the file and closes — no Task Manager', async () => {
    // First call (no force) refuses; the forced call reverts.
    const revertToLastSaved = vi
      .fn()
      .mockImplementation(async (force?: boolean) =>
        force ? 'reverted' : 'refused-not-latest-save',
      )
    const closeProject = vi.fn()
    const setHasUnsavedMutations = vi.fn()
    const clearRecoveryNow = vi.fn().mockResolvedValue(undefined)
    const args = makeArgs({
      revertToLastSaved,
      closeProject,
      setHasUnsavedMutations,
      clearRecoveryNow,
    })
    const { result } = renderHook(() => useProjectLifecycle(args))

    await act(async () => {
      await result.current.handleUnsavedDiscard()
    })
    await act(async () => {
      await result.current.handleForceRevertConfirm()
    })

    // The forced revert bypassed the anchor gate…
    expect(revertToLastSaved).toHaveBeenLastCalledWith(true)
    // …and the changes are gone: mutations cleared, recovery cleared, closed.
    expect(setHasUnsavedMutations).toHaveBeenCalledWith(false)
    expect(clearRecoveryNow).toHaveBeenCalled()
    expect(closeProject).toHaveBeenCalledTimes(1)
    expect(result.current.forceRevertPromptOpen).toBe(false)
  })

  it('cancelling the force-revert prompt keeps the project open and deletes nothing', async () => {
    const revertToLastSaved = vi
      .fn()
      .mockResolvedValue('refused-not-latest-save')
    const closeProject = vi.fn()
    const args = makeArgs({ revertToLastSaved, closeProject })
    const { result } = renderHook(() => useProjectLifecycle(args))

    await act(async () => {
      await result.current.handleUnsavedDiscard()
    })
    act(() => {
      result.current.handleForceRevertCancel()
    })

    expect(result.current.forceRevertPromptOpen).toBe(false)
    expect(closeProject).not.toHaveBeenCalled()
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

// Owner, 2026-08-17: "open from recent project should always open from the
// strix file, if user moved it you get a toast, file not found, did you
// change it's location". The File-menu recents path used to discard the
// open's outcome entirely, so a moved file failed into pure silence — no
// banner (that's the welcome screen's), no toast, nothing.
describe('useProjectLifecycle — File > Open Recent with a moved file', () => {
  it('toasts the move question when the file is gone', async () => {
    const toast = vi.fn()
    const openProjectFile = vi.fn().mockResolvedValue('file-missing')
    let fireOpenRecent: ((path: string) => void) | null = null
    ;(window.electron as unknown as Record<string, unknown>).onMenuProjectOpenRecent = vi
      .fn()
      .mockImplementation((cb: (path: string) => void) => {
        fireOpenRecent = cb
        return noopUnsub
      })
    renderHook(() => useProjectLifecycle(makeArgs({ toast, openProjectFile })))

    await act(async () => {
      fireOpenRecent?.('C:/moved/test.strix')
    })

    expect(openProjectFile).toHaveBeenCalledWith('C:/moved/test.strix')
    expect(toast).toHaveBeenCalledTimes(1)
    expect(toast.mock.calls[0][0]).toBe('error')
    expect(String(toast.mock.calls[0][1])).toContain('C:/moved/test.strix')
    expect(String(toast.mock.calls[0][1])).toMatch(/move or rename/i)
  })

  it('stays silent when the open succeeds', async () => {
    const toast = vi.fn()
    const openProjectFile = vi.fn().mockResolvedValue({ id: 'p1', name: 'Test' })
    let fireOpenRecent: ((path: string) => void) | null = null
    ;(window.electron as unknown as Record<string, unknown>).onMenuProjectOpenRecent = vi
      .fn()
      .mockImplementation((cb: (path: string) => void) => {
        fireOpenRecent = cb
        return noopUnsub
      })
    renderHook(() => useProjectLifecycle(makeArgs({ toast, openProjectFile })))

    await act(async () => {
      fireOpenRecent?.('C:/projects/test.strix')
    })

    expect(toast).not.toHaveBeenCalled()
  })
})

// Audit 2026-08-02, MAJOR: a save that never reached its .strix, and a
// Discard whose revert was refused, both ended in a console line. The rule,
// in the rule's own words: an engineer who clicks Save or Don't Save and does
// not get what they asked for must be told, on screen, which file it was
// about — and the app must not quietly delete this session's work instead.
describe('useProjectLifecycle — a failed Save reaches the engineer', () => {
  it('shows an error naming the file when the save never landed', async () => {
    const toast = vi.fn()
    const args = makeArgs({
      toast,
      saveMetadata: vi.fn().mockResolvedValue(false),
      projectFilePath: 'C:/projects/Site A.strix',
    })
    const { result } = renderHook(() => useProjectLifecycle(args))

    let ok: boolean | undefined
    await act(async () => {
      ok = await result.current.saveProject()
    })

    expect(ok).toBe(false)
    expect(toast).toHaveBeenCalledTimes(1)
    expect(toast.mock.calls[0][0]).toBe('error')
    expect(String(toast.mock.calls[0][1])).toContain('Site A.strix')
    // The same reason is published for the dialog, which stays open.
    expect(result.current.unsavedError).toContain('Site A.strix')
  })

  it('keeps the unsaved dialog open (and the project un-closed) after a failed Save', async () => {
    const closeProject = vi.fn()
    const args = makeArgs({
      closeProject,
      saveMetadata: vi.fn().mockResolvedValue(false),
    })
    const { result } = renderHook(() => useProjectLifecycle(args))

    await act(async () => {
      await result.current.handleUnsavedSave()
    })

    expect(closeProject).not.toHaveBeenCalled()
    expect(result.current.unsavedError).not.toBeNull()
  })

  it('says nothing on a save that worked', async () => {
    const toast = vi.fn()
    const { result } = renderHook(() => useProjectLifecycle(makeArgs({ toast })))

    await act(async () => {
      await result.current.saveProject()
    })

    expect(toast).not.toHaveBeenCalled()
    expect(result.current.unsavedError).toBeNull()
  })
})

describe('useProjectLifecycle — Discard acts on WHICH revert outcome it got', () => {
  it('deletes the session creates ONLY when there is no snapshot to revert to', async () => {
    const removeFromManifest = vi.fn()
    const closeProject = vi.fn()
    const { result } = renderHook(() =>
      useProjectLifecycle(
        makeArgs({
          revertToLastSaved: vi.fn().mockResolvedValue('no-snapshot'),
          removeFromManifest,
          closeProject,
        }),
      ),
    )

    await act(async () => {
      await result.current.handleUnsavedDiscard()
    })

    expect(removeFromManifest).toHaveBeenCalled()
    expect(closeProject).toHaveBeenCalledTimes(1)
  })

  it('does NOT delete session work when the file is not this project’s latest save', async () => {
    // The refusal is the protective outcome: the file on disk cannot restore
    // what this session made, so deleting the session's creates would destroy
    // work nothing can bring back.
    const removeFromManifest = vi.fn()
    const discardContacts = vi.fn()
    const closeProject = vi.fn()
    const clearRecoveryNow = vi.fn().mockResolvedValue(undefined)
    const setHasUnsavedMutations = vi.fn()
    const toast = vi.fn()
    const { result } = renderHook(() =>
      useProjectLifecycle(
        makeArgs({
          revertToLastSaved: vi.fn().mockResolvedValue('refused-not-latest-save'),
          sessionImportCptIds: new Set(['c1']),
          sessionImportContactIds: new Set(['ct1']),
          removeFromManifest,
          discardContacts,
          closeProject,
          clearRecoveryNow,
          setHasUnsavedMutations,
          toast,
          projectFilePath: 'C:/projects/site-backup-0801.strix',
        }),
      ),
    )

    await act(async () => {
      await result.current.handleUnsavedDiscard()
    })

    expect(removeFromManifest).not.toHaveBeenCalled()
    expect(discardContacts).not.toHaveBeenCalled()
    expect(closeProject).not.toHaveBeenCalled()
    // The recovery file protects exactly the work that was NOT discarded.
    expect(clearRecoveryNow).not.toHaveBeenCalled()
    expect(setHasUnsavedMutations).not.toHaveBeenCalledWith(false)
    // NEW (owner ruling, installer #26): the refusal is no longer a dead-end
    // toast — it opens the force-revert prompt so the user is never trapped.
    // The named-file body reaches the dialog through ``forceRevertMessage``.
    expect(result.current.forceRevertPromptOpen).toBe(true)
    expect(result.current.forceRevertMessage).toContain('site-backup-0801.strix')
    // No error toast now — the prompt IS the surface.
    expect(toast).not.toHaveBeenCalled()
    expect(result.current.unsavedDialogOpen).toBe(false)
  })

  it('aborts the close when the revert threw, and keeps the session work', async () => {
    const removeFromManifest = vi.fn()
    const closeProject = vi.fn()
    const toast = vi.fn()
    const { result } = renderHook(() =>
      useProjectLifecycle(
        makeArgs({
          revertToLastSaved: vi.fn().mockResolvedValue('failed'),
          sessionImportCptIds: new Set(['c1']),
          removeFromManifest,
          closeProject,
          toast,
        }),
      ),
    )

    await act(async () => {
      await result.current.handleUnsavedDiscard()
    })

    expect(removeFromManifest).not.toHaveBeenCalled()
    expect(closeProject).not.toHaveBeenCalled()
    expect(result.current.unsavedDialogOpen).toBe(true)
    expect(toast.mock.calls[0][0]).toBe('error')
  })

  it('clears the tracking sets (and nothing else) on a real revert', async () => {
    const removeFromManifest = vi.fn()
    const setSessionImportCptIds = vi.fn()
    const closeProject = vi.fn()
    const { result } = renderHook(() =>
      useProjectLifecycle(
        makeArgs({
          revertToLastSaved: vi.fn().mockResolvedValue('reverted'),
          removeFromManifest,
          setSessionImportCptIds,
          closeProject,
        }),
      ),
    )

    await act(async () => {
      await result.current.handleUnsavedDiscard()
    })

    expect(setSessionImportCptIds).toHaveBeenCalledWith(new Set())
    expect(removeFromManifest).not.toHaveBeenCalled()
    expect(closeProject).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// HW — the window goes away as soon as the question is answered
// ---------------------------------------------------------------------------
//
// Owner, 2026-08-10: "takes a while to shutdown though (can't we close window and
// let operations run in the background for a while)".
//
// The heavy part is the replace-restore of the whole bundle, awaited BEFORE the
// renderer answers the quit handshake — so the window sits there, apparently
// hung, for the length of a full project rewrite.
//
// Backgrounding it is safe because the restore is ONE transaction: the route
// commits once and restore_project_bundle never commits internally, so a process
// that dies mid-restore rolls back. The worst case is "the discard did not
// happen", never a half-deleted project.
//
// It is only safe to hide on the QUIT path. Closing a project keeps the window —
// it goes back to the welcome screen — so hiding there would be a bug.

describe('HW — the window hides before the slow work, on the quit path only', () => {
  /** Drive the app-quit handshake so the dialog opens in 'quit-app' mode. */
  async function openQuitDialog(args: ReturnType<typeof makeArgs>): Promise<{
    result: { current: ReturnType<typeof useProjectLifecycle> }
  }> {
    const onAppBeforeQuit = (
      globalThis as unknown as {
        window: { electron: { onAppBeforeQuit: ReturnType<typeof vi.fn> } }
      }
    ).window.electron.onAppBeforeQuit
    const { result } = renderHook(() => useProjectLifecycle(args))
    const beforeQuitCb = onAppBeforeQuit.mock.calls.at(-1)?.[0] as () => void
    await act(async () => {
      beforeQuitCb()
    })
    return { result }
  }

  it('HW1 — Discard hides the window BEFORE the revert finishes', async () => {
    const order: string[] = []
    const setWindowVisible = vi.fn().mockImplementation(async (visible: boolean) => {
      order.push(visible ? 'show' : 'hide')
    })
    ;(globalThis as unknown as { window: { electron: Record<string, unknown> } }).window.electron
      .setWindowVisible = setWindowVisible
    const revertToLastSaved = vi.fn().mockImplementation(async () => {
      order.push('revert')
      return 'reverted'
    })

    const args = makeArgs({ hasUnsavedMutations: true, revertToLastSaved })
    const { result } = await openQuitDialog(args)

    await act(async () => {
      await result.current.handleUnsavedDiscard()
    })

    expect(order, 'the window must go before the work, or the wait is what it was').toEqual([
      'hide',
      'revert',
    ])
  })

  it('HW2 — a FAILED revert brings the window back, because the app is not closing', async () => {
    // The revert can refuse (the file is not the latest save) or fail. The close is
    // then aborted and the dialog re-opened — onto a hidden window, unless it is
    // shown again. A dialog nobody can see is worse than the wait.
    const setWindowVisible = vi.fn().mockResolvedValue(undefined)
    ;(globalThis as unknown as { window: { electron: Record<string, unknown> } }).window.electron
      .setWindowVisible = setWindowVisible
    const revertToLastSaved = vi.fn().mockResolvedValue('failed')

    const args = makeArgs({ hasUnsavedMutations: true, revertToLastSaved })
    const { result } = await openQuitDialog(args)

    await act(async () => {
      await result.current.handleUnsavedDiscard()
    })

    expect(setWindowVisible).toHaveBeenLastCalledWith(true)
  })

  it('HW3 — closing a PROJECT never hides the window', async () => {
    // Default mode is close-project: the window survives and shows the welcome
    // screen, so hiding it would blank the app the engineer is still using.
    const setWindowVisible = vi.fn().mockResolvedValue(undefined)
    ;(globalThis as unknown as { window: { electron: Record<string, unknown> } }).window.electron
      .setWindowVisible = setWindowVisible
    const revertToLastSaved = vi.fn().mockResolvedValue('reverted')

    const { result } = renderHook(() =>
      useProjectLifecycle(makeArgs({ hasUnsavedMutations: true, revertToLastSaved })),
    )

    await act(async () => {
      await result.current.handleUnsavedDiscard()
    })

    expect(setWindowVisible).not.toHaveBeenCalled()
  })
})

describe('HW4 — Save hides too, and comes back when it fails', () => {
  it('a failed save re-shows the window, because the retry dialog stays open', async () => {
    const setWindowVisible = vi.fn().mockResolvedValue(undefined)
    ;(globalThis as unknown as { window: { electron: Record<string, unknown> } }).window.electron
      .setWindowVisible = setWindowVisible
    // saveProject is INTERNAL to the hook, so a failure is driven through the
    // injected saveMetadata it calls first — overriding saveProject would have been
    // ignored, and the test would have passed on the happy path while claiming to
    // cover the failure one.
    const saveMetadata = vi.fn().mockResolvedValue(false)
    const onAppBeforeQuit = (
      globalThis as unknown as {
        window: { electron: { onAppBeforeQuit: ReturnType<typeof vi.fn> } }
      }
    ).window.electron.onAppBeforeQuit

    const { result } = renderHook(() =>
      useProjectLifecycle(makeArgs({ hasUnsavedMutations: true, saveMetadata })),
    )
    const beforeQuitCb = onAppBeforeQuit.mock.calls.at(-1)?.[0] as () => void
    await act(async () => {
      beforeQuitCb()
    })

    await act(async () => {
      await result.current.handleUnsavedSave()
    })

    expect(setWindowVisible).toHaveBeenNthCalledWith(1, false)
    expect(setWindowVisible).toHaveBeenLastCalledWith(true)
  })
})
