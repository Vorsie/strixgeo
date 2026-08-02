import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useRecoveryRestore } from './useRecoveryRestore'
import type { RecoveryRestoreDeps } from './useRecoveryRestore'
import { RECOVERY_SNAPSHOT_VERSION } from '../utils/recoverySnapshot'
import type { RecoverySnapshotV1 } from '../utils/recoverySnapshot'
import type { StratigraphyLumping } from '../utils/projectFile'

// Applying a restored snapshot (docs/design/autosave-recovery.md §2 + §3).
//
// The design's rules this suite encodes:
//   * The four manifest sets are "unreconstructed, not lost" — the
//     localStorage mirror is LOSSY (DOV dedupe-hit ids and Fill-matched
//     pre-existing formations enter the manifest without entering the session
//     set), so the snapshot's copy is the complete one and must be UNIONED
//     onto whatever the file seeded.
//   * The five session-import sets "must stay consistent with the manifest
//     snapshot taken at the same instant" — so they are replaced, not merged.
//   * The lumping map is the only double-written item, and its reconciliation
//     is by REVISION, never the clock.

function makeSnapshot(overrides: Partial<RecoverySnapshotV1> = {}): RecoverySnapshotV1 {
  return {
    snapshot_version: RECOVERY_SNAPSHOT_VERSION,
    filePath: 'C:/projects/site-A.strix',
    lumping: { current: null, revision: null },
    ghosts: [],
    metadataDraftPatch: {},
    manifests: { cpt: [], borehole: [], formation: [], section: [] },
    sessionImports: { cpt: [], borehole: [], formation: [], section: [], contact: [] },
    hasUnsavedMutations: false,
    ...overrides,
  }
}

function lumping(map: Record<string, string>): StratigraphyLumping {
  return { schema_version: 1, applied_at: '2026-08-02T10:00:00Z', map }
}

function makeDeps(overrides: Partial<RecoveryRestoreDeps> = {}): RecoveryRestoreDeps {
  return {
    setGhostsByAnchor: vi.fn(),
    applyMetadataDraft: vi.fn(),
    addToManifest: vi.fn(),
    setSessionImportCptIds: vi.fn(),
    setSessionImportBoreholeIds: vi.fn(),
    setSessionImportFormationIds: vi.fn(),
    setSessionImportSectionIds: vi.fn(),
    setSessionImportContactIds: vi.fn(),
    setHasUnsavedMutations: vi.fn(),
    currentLumping: null,
    lumpingRevision: null,
    stageLumping: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

async function restore(
  snapshot: RecoverySnapshotV1,
  deps: RecoveryRestoreDeps,
): Promise<void> {
  const { result } = renderHook(() => useRecoveryRestore(deps))
  await act(async () => {
    await result.current.restoreFromSnapshot(snapshot)
  })
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useRecoveryRestore', () => {
  it('rebuilds the ghost workspace with real Sets and Maps, not the arrays on disk', () => {
    // A Set or Map written straight to the recovery file serialises to {},
    // so the codec flattens them — restore has to put them back or the
    // overlay silently reads an empty triage.
    const deps = makeDeps()
    const snapshot = makeSnapshot({
      ghosts: [
        [
          'anchor-1',
          {
            kind: 'cpt',
            suggestions: [],
            surfaceElevationM: 4.2,
            accepted: [0, 2],
            rejected: [1],
            edits: [[0, { depth_top_m: 1.5 }]],
          },
        ],
      ],
    })
    return restore(snapshot, deps).then(() => {
      const ghosts = (deps.setGhostsByAnchor as ReturnType<typeof vi.fn>).mock.calls[0][0]
      const entry = ghosts.get('anchor-1')
      expect(entry.accepted).toBeInstanceOf(Set)
      expect(entry.accepted.has(2)).toBe(true)
      expect(entry.rejected).toBeInstanceOf(Set)
      expect(entry.edits).toBeInstanceOf(Map)
      expect(entry.edits.get(0)).toEqual({ depth_top_m: 1.5 })
      expect(entry.surfaceElevationM).toBe(4.2)
    })
  })

  it('applies the metadata draft patch', async () => {
    const deps = makeDeps()
    await restore(makeSnapshot({ metadataDraftPatch: { name: 'Renamed' } }), deps)
    expect(deps.applyMetadataDraft).toHaveBeenCalledWith({ name: 'Renamed' })
  })

  it('leaves the metadata alone when the snapshot carries no draft', async () => {
    const deps = makeDeps()
    await restore(makeSnapshot(), deps)
    expect(deps.applyMetadataDraft).not.toHaveBeenCalled()
  })

  it('UNIONS the manifests onto the file-seeded floor rather than replacing them', async () => {
    // The file-seeded manifest is the floor; the snapshot may carry additions
    // the crash lost, and addToManifest is the union primitive.
    const deps = makeDeps()
    await restore(
      makeSnapshot({
        manifests: { cpt: ['c1', 'c2'], borehole: ['b1'], formation: [], section: ['s1'] },
      }),
      deps,
    )
    expect(deps.addToManifest).toHaveBeenCalledWith('cpt', ['c1', 'c2'])
    expect(deps.addToManifest).toHaveBeenCalledWith('borehole', ['b1'])
    expect(deps.addToManifest).toHaveBeenCalledWith('section', ['s1'])
    // Nothing to add for formations — no empty call.
    expect(deps.addToManifest).not.toHaveBeenCalledWith('formation', [])
  })

  it('REPLACES the session-import sets, because they were snapshotted with the manifests', async () => {
    const deps = makeDeps()
    await restore(
      makeSnapshot({
        sessionImports: {
          cpt: ['c1'],
          borehole: [],
          formation: ['f1', 'f2'],
          section: [],
          contact: ['k1'],
        },
      }),
      deps,
    )
    expect(deps.setSessionImportCptIds).toHaveBeenCalledWith(new Set(['c1']))
    expect(deps.setSessionImportBoreholeIds).toHaveBeenCalledWith(new Set())
    expect(deps.setSessionImportFormationIds).toHaveBeenCalledWith(new Set(['f1', 'f2']))
    expect(deps.setSessionImportContactIds).toHaveBeenCalledWith(new Set(['k1']))
  })

  it('restores the unsaved-changes bit exactly as snapshotted, true or false', async () => {
    const dirty = makeDeps()
    await restore(makeSnapshot({ hasUnsavedMutations: true }), dirty)
    expect(dirty.setHasUnsavedMutations).toHaveBeenCalledWith(true)

    const clean = makeDeps()
    await restore(makeSnapshot({ hasUnsavedMutations: false }), clean)
    expect(clean.setHasUnsavedMutations).toHaveBeenCalledWith(false)
  })

  it('lumping — revisions equal: skips the stage entirely (the common case)', async () => {
    const deps = makeDeps({ currentLumping: lumping({ a: 'A' }), lumpingRevision: 3 })
    await restore(makeSnapshot({ lumping: { current: lumping({ a: 'A' }), revision: 3 } }), deps)
    expect(deps.stageLumping).not.toHaveBeenCalled()
  })

  it('lumping — file revision higher: replays the file map under the FILE revision', async () => {
    // The staged PUT never landed, so the database has to catch up — and it
    // has to catch up to the number the file already claims, not a fresh bump.
    const fileMap = lumping({ a: 'A', b: 'B' })
    const deps = makeDeps({ currentLumping: lumping({ a: 'A' }), lumpingRevision: 3 })
    await restore(makeSnapshot({ lumping: { current: fileMap, revision: 6 } }), deps)
    expect(deps.stageLumping).toHaveBeenCalledWith(fileMap, 6)
  })

  it('lumping — DB revision higher: the crash beat the debounce, so nothing is staged', async () => {
    const deps = makeDeps({ currentLumping: lumping({ a: 'A', b: 'B' }), lumpingRevision: 9 })
    await restore(makeSnapshot({ lumping: { current: lumping({ a: 'A' }), revision: 4 } }), deps)
    expect(deps.stageLumping).not.toHaveBeenCalled()
  })

  it('lumping — equal revision but different content: logs loudly and prefers the DB', async () => {
    const deps = makeDeps({ currentLumping: lumping({ a: 'DB' }), lumpingRevision: 5 })
    await restore(makeSnapshot({ lumping: { current: lumping({ a: 'FILE' }), revision: 5 } }), deps)
    expect(deps.stageLumping).not.toHaveBeenCalled()
    // "A bug, not a conflict. Log loudly" — error level, not a quiet debug.
    expect(consoleErrorSpy).toHaveBeenCalled()
  })
})
