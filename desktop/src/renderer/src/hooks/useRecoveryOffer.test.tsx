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
      },
    ]),
    deleteRecovery: vi.fn().mockResolvedValue(true),
    ...overrides,
  }
  ;(globalThis as unknown as { window: { electron: unknown } }).window.electron = stub
  return stub
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
    act(() => hook.result.current.restoreOffer())
    expect(onRestore).toHaveBeenCalledWith(offered)
    expect(electron.deleteRecovery).not.toHaveBeenCalled()
    await waitFor(() => expect(hook.result.current.offer).toBeNull())
  })

  it('open-without-restoring keeps the file so a restart offers it again', async () => {
    const electron = installElectron()
    const { hook, onRestore } = mount()
    await waitFor(() => expect(hook.result.current.offer).not.toBeNull())
    act(() => hook.result.current.dismissOffer())
    expect(onRestore).not.toHaveBeenCalled()
    expect(electron.deleteRecovery).not.toHaveBeenCalled()
    expect(hook.result.current.offer).toBeNull()
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

    act(() => hook.result.current.restoreOffer())

    expect(onRestore).toHaveBeenCalledTimes(1)
  })

  it('ignores a second Restore click on an offer already answered', async () => {
    installElectron()
    const { hook, onRestore } = mount()
    await waitFor(() => expect(hook.result.current.offer).not.toBeNull())

    act(() => {
      hook.result.current.restoreOffer()
      hook.result.current.restoreOffer()
    })

    expect(onRestore).toHaveBeenCalledTimes(1)
  })

  it('does not re-offer the same project after the user has answered', async () => {
    // Any state change in App re-runs effects; a prompt that reappears after
    // "Open without restoring" would be unusable.
    installElectron()
    const { hook } = mount()
    await waitFor(() => expect(hook.result.current.offer).not.toBeNull())
    act(() => hook.result.current.dismissOffer())
    hook.rerender({ id: PROJECT_ID })
    await waitFor(() => expect(hook.result.current.offer).toBeNull())
  })
})
