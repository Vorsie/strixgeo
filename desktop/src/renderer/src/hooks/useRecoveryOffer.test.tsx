import { act, renderHook, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useRecoveryOffer } from './useRecoveryOffer'
import { RECOVERY_SNAPSHOT_VERSION } from '../utils/recoverySnapshot'
import type { RecoverySnapshotV1 } from '../utils/recoverySnapshot'

// Detecting the offer (docs/design/autosave-recovery.md §4, "Crash detection:
// the file's own existence"). There is no sentinel and no heartbeat — a file
// present when a project opens means the previous session never reached a
// clean exit. The three answers the design allows are: restore (keep the
// file), open without restoring (keep the file), discard (delete it).
//
// A malformed payload must offer nothing at all: recovery may never break an
// open.
//
// Owner decision 2026-08-03 changed one of the three: "Open without restoring"
// now PRESERVES the copy (Word-style) instead of leaving it to be overwritten,
// so a restart offers the same unsaved work again. Only the prompt's Discard
// destroys it.

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

function installElectron(overrides: Partial<ElectronStub> = {}): ElectronStub {
  const stub: ElectronStub = {
    readRecovery: vi.fn().mockResolvedValue(makeSnapshot()),
    listRecovery: vi.fn().mockResolvedValue([
      {
        projectId: PROJECT_ID,
        projectName: 'Site A',
        filePath: 'C:/userData/recovery/x.recovery.json',
        writtenAt: '2026-08-02T14:32:00Z',
        appVersion: '0.1.0',
        sizeBytes: 128,
        declined: false,
      },
    ]),
    deleteRecovery: vi.fn().mockResolvedValue(true),
    deleteDeclinedRecovery: vi.fn().mockResolvedValue(true),
    declineRecovery: vi.fn().mockResolvedValue(true),
    writeRecovery: vi.fn().mockResolvedValue({}),
    ...overrides,
  }
  ;(globalThis as unknown as { window: { electron: unknown } }).window.electron = stub
  return stub
}

/**
 * A stub whose four recovery verbs behave like the real two-slot store.
 *
 * The re-offer bugs in this area are all about which file is left on disk
 * after a sequence of answers, and a per-call ``vi.fn()`` cannot express that:
 * it can only pin the calls that were made, not the state they left behind.
 * These slots mirror ``main/recoveryStore``'s semantics — the scheduler writes
 * the primary, declining moves primary→declined, a readable primary wins over
 * a declined copy, and each of the three clears reaches exactly its own slots.
 */
function installStoreBackedElectron(initial: {
  primary?: RecoverySnapshotV1 | null
  declined?: RecoverySnapshotV1 | null
}): ElectronStub & { slots: { primary: unknown; declined: unknown } } {
  const slots: { primary: unknown; declined: unknown } = {
    primary: initial.primary ?? null,
    declined: initial.declined ?? null,
  }
  const resolve = (): unknown => slots.primary ?? slots.declined
  const stub = {
    slots,
    writeRecovery: vi.fn(async (_id: string, payload: unknown) => {
      slots.primary = payload
      return {}
    }),
    readRecovery: vi.fn(async () => resolve()),
    listRecovery: vi.fn(async () =>
      resolve() === null
        ? []
        : [
            {
              projectId: PROJECT_ID,
              projectName: 'Site A',
              filePath: 'C:/userData/recovery/x.recovery.json',
              writtenAt: '2026-08-02T14:32:00Z',
              appVersion: '0.1.0',
              sizeBytes: 128,
              declined: slots.primary === null,
            },
          ],
    ),
    declineRecovery: vi.fn(async () => {
      if (slots.primary === null) return false
      slots.declined = slots.primary
      slots.primary = null
      return true
    }),
    deleteDeclinedRecovery: vi.fn(async () => {
      const had = slots.declined !== null
      slots.declined = null
      return had
    }),
    deleteRecovery: vi.fn(async () => {
      const had = slots.primary !== null || slots.declined !== null
      slots.primary = null
      slots.declined = null
      return had
    }),
  }
  ;(globalThis as unknown as { window: { electron: unknown } }).window.electron = stub
  return stub as unknown as ElectronStub & { slots: { primary: unknown; declined: unknown } }
}

function mount(projectId: string | null = PROJECT_ID) {
  const onRestore = vi.fn()
  const hook = renderHook(
    ({ id }: { id: string | null }) =>
      useRecoveryOffer({ projectId: id, projectName: 'Site A', onRestore }),
    { initialProps: { id: projectId } },
  )
  return { hook, onRestore }
}

let consoleWarnSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useRecoveryOffer', () => {
  it('offers a restore when an opened project has a readable recovery file', async () => {
    installElectron()
    const { hook } = mount()
    await waitFor(() => expect(hook.result.current.offer).not.toBeNull())
    expect(hook.result.current.offer?.projectId).toBe(PROJECT_ID)
    expect(hook.result.current.offer?.snapshot.snapshot_version).toBe(
      RECOVERY_SNAPSHOT_VERSION,
    )
    // The age shown in the prompt comes off the descriptor, not the payload.
    expect(hook.result.current.offer?.writtenAt).toBe('2026-08-02T14:32:00Z')
  })

  it('offers nothing when there is no recovery file', async () => {
    const electron = installElectron({ readRecovery: vi.fn().mockResolvedValue(null) })
    const { hook } = mount()
    await waitFor(() => expect(electron.readRecovery).toHaveBeenCalled())
    expect(hook.result.current.offer).toBeNull()
  })

  it('offers nothing when the payload is malformed — recovery never breaks an open', async () => {
    const electron = installElectron({
      readRecovery: vi.fn().mockResolvedValue({ snapshot_version: 999, junk: true }),
    })
    const { hook } = mount()
    await waitFor(() => expect(electron.readRecovery).toHaveBeenCalled())
    expect(hook.result.current.offer).toBeNull()
    expect(consoleWarnSpy).toHaveBeenCalled()
  })

  it('offers nothing when the read itself fails', async () => {
    const electron = installElectron({
      readRecovery: vi.fn().mockRejectedValue(new Error('IPC down')),
    })
    const { hook } = mount()
    await waitFor(() => expect(electron.readRecovery).toHaveBeenCalled())
    expect(hook.result.current.offer).toBeNull()
  })

  it('never reads anything while no project is open', async () => {
    const electron = installElectron()
    const { hook } = mount(null)
    await waitFor(() => expect(hook.result.current.offer).toBeNull())
    expect(electron.readRecovery).not.toHaveBeenCalled()
  })

  it('restore applies the parsed snapshot and KEEPS the file', async () => {
    // The restored state is at risk all over again; the scheduler keeps the
    // file fresh from here on, so deleting it would widen the crash window.
    const electron = installElectron()
    const { hook, onRestore } = mount()
    await waitFor(() => expect(hook.result.current.offer).not.toBeNull())
    const offered = hook.result.current.offer!.snapshot
    await act(async () => {
      await hook.result.current.restoreOffer()
    })
    expect(onRestore).toHaveBeenCalledWith(offered)
    expect(electron.deleteRecovery).not.toHaveBeenCalled()
    await waitFor(() => expect(hook.result.current.offer).toBeNull())
  })

  // -------------------------------------------------------------------------
  // Restoring a DECLINED copy has to end the decline.
  //
  // Restore leaves the copy on disk on purpose — the restored state is at risk
  // again. But when the copy came out of the DECLINED slot, "leave it" means
  // the declined file stays there while the scheduler starts writing the
  // primary one, every clean exit clears only the primary, and the same work
  // is offered again at the next launch. And the next. A user who restores can
  // never make the prompt stop.
  // -------------------------------------------------------------------------

  it('promotes a restored copy to the primary slot and ends the decline', async () => {
    const declined = makeSnapshot({ filePath: 'C:/projects/site-A.strix' })
    const electron = installStoreBackedElectron({ declined })
    const { hook } = mount()
    await waitFor(() => expect(hook.result.current.offer).not.toBeNull())

    await act(async () => {
      await hook.result.current.restoreOffer()
    })

    // The restored content now lives in the slot the scheduler owns, and
    // nothing is left in the declined one.
    expect(electron.slots.primary).toEqual(declined)
    expect(electron.slots.declined).toBeNull()
  })

  it('writes the durable copy BEFORE deleting the one it replaces', async () => {
    // The crash window: between the two IPC calls the app can die. Deleting
    // first would mean an instant in which the ONLY copy of the restored work
    // is the one in memory — the exact loss recovery exists to prevent. So the
    // replacement must be on disk before the original goes.
    const electron = installStoreBackedElectron({ declined: makeSnapshot() })
    const { hook } = mount()
    await waitFor(() => expect(hook.result.current.offer).not.toBeNull())

    await act(async () => {
      await hook.result.current.restoreOffer()
    })

    expect(electron.writeRecovery.mock.invocationCallOrder[0]).toBeLessThan(
      electron.deleteDeclinedRecovery.mock.invocationCallOrder[0],
    )
  })

  it('stops re-offering the same work at the next launch', async () => {
    // The whole point, end to end: restore, then reach a clean exit (which
    // clears the primary slot), then open the project again. Before the
    // decline was ended, this second open found the declined file still there
    // and put the same prompt up — forever.
    const electron = installStoreBackedElectron({ declined: makeSnapshot() })
    const first = mount()
    await waitFor(() => expect(first.hook.result.current.offer).not.toBeNull())
    await act(async () => {
      await first.hook.result.current.restoreOffer()
    })
    first.hook.unmount()

    // A decided exit — the scheduler's own clear, primary slot only.
    electron.slots.primary = null

    const second = mount()
    await waitFor(() => expect(electron.readRecovery).toHaveBeenCalledTimes(2))
    // Let the detection effect's whole async chain settle — a broken restore
    // shows up as an offer that appears a tick after the read resolves, so
    // asserting straight off the read would pass either way.
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(second.hook.result.current.offer).toBeNull()
  })

  it('still restores when promoting the copy fails', async () => {
    // A failed write is not a reason to refuse the restore: the snapshot is
    // already parsed and applying it is what the user asked for. It IS a
    // reason not to delete the declined copy — the only durable one left.
    const electron = installStoreBackedElectron({ declined: makeSnapshot() })
    electron.writeRecovery.mockRejectedValue(new Error('disk full'))
    const { hook, onRestore } = mount()
    await waitFor(() => expect(hook.result.current.offer).not.toBeNull())

    await act(async () => {
      await hook.result.current.restoreOffer()
    })

    expect(onRestore).toHaveBeenCalled()
    expect(electron.deleteDeclinedRecovery).not.toHaveBeenCalled()
    expect(electron.slots.declined).not.toBeNull()
  })

  it('keeps the prompt up until the whole answer sequence has run', async () => {
    // The autosave scheduler is SUSPENDED while an offer is pending (App
    // passes ``suspended={recoveryOffer !== null}``), which is what stops a
    // debounced write from landing between these IPC calls and moving this
    // session's delta into the slot being rearranged. That protection is only
    // real if the offer state outlives the disk work — clearing it first would
    // un-suspend the scheduler mid-sequence.
    const electron = installStoreBackedElectron({ declined: makeSnapshot() })
    let release: () => void = () => {}
    electron.deleteDeclinedRecovery.mockImplementation(
      () => new Promise<boolean>(resolve => (release = () => resolve(true))),
    )
    const { hook } = mount()
    await waitFor(() => expect(hook.result.current.offer).not.toBeNull())

    let done = false
    await act(async () => {
      void hook.result.current.restoreOffer().then(() => {
        done = true
      })
      await Promise.resolve()
    })
    expect(done).toBe(false)
    expect(hook.result.current.offer).not.toBeNull()

    await act(async () => {
      release()
      await Promise.resolve()
    })
    await waitFor(() => expect(hook.result.current.offer).toBeNull())
    expect(done).toBe(true)
  })

  it('open-without-restoring preserves the copy so a restart offers it again', async () => {
    // Owner decision 2026-08-03. Deleting nothing was NOT enough to keep this
    // promise: the file stayed in the slot the autosave scheduler writes, so
    // this session overwrote it within seconds and the next decided exit
    // cleared it. Declining moves it out of that slot instead.
    const electron = installElectron()
    const { hook, onRestore } = mount()
    await waitFor(() => expect(hook.result.current.offer).not.toBeNull())
    await act(async () => {
      await hook.result.current.dismissOffer()
    })
    expect(onRestore).not.toHaveBeenCalled()
    expect(electron.declineRecovery).toHaveBeenCalledWith(PROJECT_ID)
    // Discard is the only thing that may destroy the copy.
    expect(electron.deleteRecovery).not.toHaveBeenCalled()
    expect(hook.result.current.offer).toBeNull()
  })

  it('preserves the copy the prompt described, not whatever is on disk by then', async () => {
    // The prompt can sit open for minutes while this session's own scheduler
    // writes the same slot (a crash-reopened project is at risk from the
    // moment it mounts — the session-import sets survive in localStorage).
    // Preserving whatever happened to be on disk at click time would hand the
    // next launch a copy WITHOUT the crashed session's triage, under a prompt
    // that promised to keep it. So the offered snapshot is written back first,
    // and only then moved to the declined slot.
    const electron = installElectron()
    const { hook } = mount()
    await waitFor(() => expect(hook.result.current.offer).not.toBeNull())
    const offered = hook.result.current.offer!.snapshot

    await act(async () => {
      await hook.result.current.dismissOffer()
    })

    expect(electron.writeRecovery).toHaveBeenCalledWith(PROJECT_ID, offered, {
      projectName: 'Site A',
    })
    expect(electron.writeRecovery.mock.invocationCallOrder[0]).toBeLessThan(
      electron.declineRecovery.mock.invocationCallOrder[0],
    )
  })

  it('still preserves the copy when the write-back fails', async () => {
    // A refused write is a reason to keep the older on-disk copy, not a reason
    // to abandon it in the slot the scheduler is about to overwrite.
    const electron = installElectron({
      writeRecovery: vi.fn().mockRejectedValue(new Error('disk full')),
    })
    const { hook } = mount()
    await waitFor(() => expect(hook.result.current.offer).not.toBeNull())
    await act(async () => {
      await hook.result.current.dismissOffer()
    })
    expect(electron.declineRecovery).toHaveBeenCalledWith(PROJECT_ID)
    expect(hook.result.current.offer).toBeNull()
  })

  it('closes the prompt even when preserving the copy fails outright', async () => {
    // Recovery may never break an open, and a dialog the user answered must
    // never stay up: a failed decline costs the copy at the next clean exit,
    // which is the safe direction to fail in.
    const electron = installElectron({
      declineRecovery: vi.fn().mockRejectedValue(new Error('IPC down')),
    })
    const { hook } = mount()
    await waitFor(() => expect(hook.result.current.offer).not.toBeNull())
    await act(async () => {
      await hook.result.current.dismissOffer()
    })
    expect(electron.deleteRecovery).not.toHaveBeenCalled()
    expect(hook.result.current.offer).toBeNull()
  })

  it('keeps the prompt up across the whole write-back-then-decline sequence', async () => {
    // The scheduler is suspended for as long as the offer is pending, and the
    // decline's two IPC calls are exactly what a scheduler write must not
    // interleave with: a write landing between them moves THIS session's thin
    // delta into the declined slot and destroys the crashed copy. So the offer
    // may only clear after both calls have returned.
    const electron = installStoreBackedElectron({ primary: makeSnapshot() })
    let release: () => void = () => {}
    electron.declineRecovery.mockImplementation(
      () => new Promise<boolean>(resolve => (release = () => resolve(true))),
    )
    const { hook } = mount()
    await waitFor(() => expect(hook.result.current.offer).not.toBeNull())

    await act(async () => {
      void hook.result.current.dismissOffer()
      await Promise.resolve()
    })
    // The write-back has run; the decline has not returned yet.
    expect(electron.writeRecovery).toHaveBeenCalled()
    expect(hook.result.current.offer).not.toBeNull()

    await act(async () => {
      release()
      await Promise.resolve()
    })
    await waitFor(() => expect(hook.result.current.offer).toBeNull())
  })

  it('ignores a second Open-without-restoring click on an answered offer', async () => {
    const electron = installElectron()
    const { hook } = mount()
    await waitFor(() => expect(hook.result.current.offer).not.toBeNull())
    await act(async () => {
      await Promise.all([
        hook.result.current.dismissOffer(),
        hook.result.current.dismissOffer(),
      ])
    })
    expect(electron.declineRecovery).toHaveBeenCalledTimes(1)
  })

  it('discard deletes the recovery file', async () => {
    const electron = installElectron()
    const { hook, onRestore } = mount()
    await waitFor(() => expect(hook.result.current.offer).not.toBeNull())
    await act(async () => {
      await hook.result.current.discardOffer()
    })
    expect(electron.deleteRecovery).toHaveBeenCalledWith(PROJECT_ID)
    expect(onRestore).not.toHaveBeenCalled()
    expect(hook.result.current.offer).toBeNull()
  })

  it('applies the restore exactly once when React double-invokes state updaters', async () => {
    // React.StrictMode double-invokes updater functions on purpose, to surface
    // impure ones. The restore used to do its work INSIDE ``setOffer``'s
    // updater, so under StrictMode it applied the snapshot twice — two
    // ``stageLumping`` PUTs today, and worse the day the restore grows a step
    // that is not idempotent.
    installElectron()
    const onRestore = vi.fn()
    const hook = renderHook(
      () => useRecoveryOffer({ projectId: PROJECT_ID, projectName: 'Site A', onRestore }),
      { wrapper: ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode> },
    )
    await waitFor(() => expect(hook.result.current.offer).not.toBeNull())

    await act(async () => {
      await hook.result.current.restoreOffer()
    })

    expect(onRestore).toHaveBeenCalledTimes(1)
  })

  it('ignores a second Restore click on an offer already answered', async () => {
    installElectron()
    const { hook, onRestore } = mount()
    await waitFor(() => expect(hook.result.current.offer).not.toBeNull())

    await act(async () => {
      await Promise.all([
        hook.result.current.restoreOffer(),
        hook.result.current.restoreOffer(),
      ])
    })

    expect(onRestore).toHaveBeenCalledTimes(1)
  })

  it('does not re-offer the same project after the user has answered', async () => {
    // Any state change in App re-runs effects; a prompt that reappears after
    // "Open without restoring" would be unusable.
    installElectron()
    const { hook } = mount()
    await waitFor(() => expect(hook.result.current.offer).not.toBeNull())
    await act(async () => {
      await hook.result.current.dismissOffer()
    })
    hook.rerender({ id: PROJECT_ID })
    await waitFor(() => expect(hook.result.current.offer).toBeNull())
  })
})
