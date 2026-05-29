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
