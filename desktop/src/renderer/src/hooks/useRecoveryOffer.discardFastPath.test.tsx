import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useRecoveryOffer } from './useRecoveryOffer'
import { RECOVERY_SNAPSHOT_VERSION } from '../utils/recoverySnapshot'
import type { RecoverySnapshotV1 } from '../utils/recoverySnapshot'

// The Discard fast path (owner defect 2026-08-12: "Delete backup holds the
// app busy for too long").
//
// Behaviour under test, in the defect's own words: the pre-discard revert
// re-reads the whole ``.strix`` and replace-restores the ENTIRE project tree,
// then reloads the project — tens of seconds of blocked dialog — "even when
// the crashed session never touched the database". The recovery snapshot
// records exactly what the crashed session changed, so:
//
//   * a snapshot with NO database delta skips the revert AND the reload —
//     Discard is instant; the file still dies and the residue reset (cheap,
//     always required) still runs;
//   * any recorded DB delta — unsaved mutations OR session-created rows —
//     takes the full path unchanged, because the replace-restore is what
//     REMOVES creates: skipping with creates present would leave them alive
//     after "the session never happened";
//   * a snapshot that cannot PROVE cleanliness (fields absent — a legacy or
//     foreign payload) takes the full path: never skip on absence of
//     evidence.
//
// These tests live beside ``useRecoveryOffer.test.tsx`` (which pins the rest
// of the three-answer contract) rather than inside it — that file is already
// past the 500-line pressure threshold.

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'

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

interface ElectronStub {
  readRecovery: ReturnType<typeof vi.fn>
  listRecovery: ReturnType<typeof vi.fn>
  deleteRecovery: ReturnType<typeof vi.fn>
  deleteDeclinedRecovery: ReturnType<typeof vi.fn>
  declineRecovery: ReturnType<typeof vi.fn>
  writeRecovery: ReturnType<typeof vi.fn>
}

function installElectron(snapshot: unknown): ElectronStub {
  const stub: ElectronStub = {
    readRecovery: vi.fn().mockResolvedValue(snapshot),
    listRecovery: vi.fn().mockResolvedValue([]),
    deleteRecovery: vi.fn().mockResolvedValue(true),
    deleteDeclinedRecovery: vi.fn().mockResolvedValue(true),
    declineRecovery: vi.fn().mockResolvedValue(true),
    writeRecovery: vi.fn().mockResolvedValue({}),
  }
  ;(globalThis as unknown as { window: { electron: unknown } }).window.electron = stub
  return stub
}

/** Mount with all three discard callbacks spied, ready to assert on. */
function mountWithDiscardSpies() {
  const onBeforeDiscard = vi.fn(async () => true)
  const onAfterDiscard = vi.fn(async () => {})
  const onDiscardResidue = vi.fn(async () => {})
  const hook = renderHook(() =>
    useRecoveryOffer({
      projectId: PROJECT_ID,
      projectName: 'Site A',
      onRestore: vi.fn(),
      onDiscardResidue,
      onBeforeDiscard,
      onAfterDiscard,
    }),
  )
  return { hook, onBeforeDiscard, onAfterDiscard, onDiscardResidue }
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useRecoveryOffer — the Discard fast path', () => {
  it('skips the revert and the reload when the snapshot records no DB delta', async () => {
    // The crashed session held only renderer-side work: the DB already
    // equals the last save, so the replace-restore and the reload are
    // semantic no-ops costing tens of seconds. Discard must be instant —
    // but the file must still die and the (cheap) residue reset must still
    // run: "no traces" is not negotiable, only the no-op revert is.
    const electron = installElectron(makeSnapshot())
    const { hook, onBeforeDiscard, onAfterDiscard, onDiscardResidue } = mountWithDiscardSpies()
    await waitFor(() => expect(hook.result.current.offer).not.toBeNull())

    await act(async () => {
      await hook.result.current.discardOffer()
    })

    expect(onBeforeDiscard).not.toHaveBeenCalled()
    expect(onAfterDiscard).not.toHaveBeenCalled()
    expect(electron.deleteRecovery).toHaveBeenCalledWith(PROJECT_ID)
    expect(onDiscardResidue).toHaveBeenCalledTimes(1)
    expect(hook.result.current.offer).toBeNull()
  })

  it('unsaved mutations take the full revert-then-reload path', async () => {
    const electron = installElectron(makeSnapshot({ hasUnsavedMutations: true }))
    const { hook, onBeforeDiscard, onAfterDiscard, onDiscardResidue } = mountWithDiscardSpies()
    await waitFor(() => expect(hook.result.current.offer).not.toBeNull())

    await act(async () => {
      await hook.result.current.discardOffer()
    })

    expect(onBeforeDiscard).toHaveBeenCalledTimes(1)
    expect(onAfterDiscard).toHaveBeenCalledTimes(1)
    expect(electron.deleteRecovery).toHaveBeenCalledWith(PROJECT_ID)
    expect(onDiscardResidue).toHaveBeenCalledTimes(1)
  })

  it('a creates-only session takes the full path — the revert is what removes creates', async () => {
    // hasUnsavedMutations is false but the session IMPORTED a CPT. Skipping
    // the revert here would leave the imported rows alive after the user was
    // told the session never happened.
    const electron = installElectron(
      makeSnapshot({
        sessionImports: {
          cpt: ['cpt-9'],
          borehole: [],
          formation: [],
          section: [],
          contact: [],
        },
      }),
    )
    const { hook, onBeforeDiscard, onAfterDiscard } = mountWithDiscardSpies()
    await waitFor(() => expect(hook.result.current.offer).not.toBeNull())

    await act(async () => {
      await hook.result.current.discardOffer()
    })

    expect(onBeforeDiscard).toHaveBeenCalledTimes(1)
    expect(onAfterDiscard).toHaveBeenCalledTimes(1)
    expect(electron.deleteRecovery).toHaveBeenCalledWith(PROJECT_ID)
  })

  it('a snapshot missing the delta fields takes the full path — never skip on absence of evidence', async () => {
    // Today's parser rebuilds every field, so a field-less snapshot cannot
    // arrive through the detection effect; this pins the DEFENSIVE default
    // for a payload shape the compiler never saw (a future snapshot version
    // reaching discard). The offered snapshot is stripped in place because
    // discard reads it at click time.
    const electron = installElectron(makeSnapshot())
    const { hook, onBeforeDiscard, onAfterDiscard } = mountWithDiscardSpies()
    await waitFor(() => expect(hook.result.current.offer).not.toBeNull())

    const offered = hook.result.current.offer!.snapshot as unknown as Record<string, unknown>
    delete offered.hasUnsavedMutations
    delete offered.manifests
    delete offered.sessionImports

    await act(async () => {
      await hook.result.current.discardOffer()
    })

    expect(onBeforeDiscard).toHaveBeenCalledTimes(1)
    expect(onAfterDiscard).toHaveBeenCalledTimes(1)
    expect(electron.deleteRecovery).toHaveBeenCalledWith(PROJECT_ID)
  })
})
