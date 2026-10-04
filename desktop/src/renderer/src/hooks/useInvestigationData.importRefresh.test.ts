// Re-importing a GEF that is already in the project REFRESHES it — and the
// user must be told that, not told "1 imported".
//
// The rule, in the owner's words (dogfeed 2026-08-02): re-importing a file
// whose CPT is already in the project used to 409 and leave the stale-depth
// CPT in place. The import now refreshes the existing row, so the message
// says so: "Refreshed existing CPT <name> from file" — a refreshed CPT is
// neither a new import nor a skipped duplicate.

import { renderHook, act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DovImportState } from './useDovImportStream'

const streamState: DovImportState = { status: 'idle' }

vi.mock('./useDovImportStream', () => ({
  useDovImportStream: () => ({
    state: streamState,
    start: vi.fn(),
    reset: vi.fn(),
  }),
}))

const importMock = vi.fn()

vi.mock('../api/client', () => ({
  api: {
    review: { list: vi.fn().mockResolvedValue([]), upsert: vi.fn().mockResolvedValue(undefined) },
    cpt: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue({ id: 'C1' }),
      plot: vi.fn().mockResolvedValue({ cpt_id: 'C1', depths_m: [] }),
      import: (...args: unknown[]) => importMock(...args),
    },
    borehole: { list: vi.fn().mockResolvedValue([]), get: vi.fn() },
  },
  // The renderer's duplicate-import error class — still exported for a
  // backend that predates refresh-on-reimport.
  DuplicateCptError: class DuplicateCptError extends Error {
    cptId = ''
  },
  CptRefreshConfirmationRequiredError: class CptRefreshConfirmationRequiredError extends Error {
    diff: unknown
    constructor(diff: unknown) {
      super('needs confirmation')
      this.name = 'CptRefreshConfirmationRequiredError'
      this.diff = diff
    }
  },
}))

vi.mock('../utils/log', () => ({
  log: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}))

import { CptRefreshConfirmationRequiredError } from '../api/client'
import { useInvestigationData } from './useInvestigationData'

/** The diff the backend sends with its 409 — the numbers the dialog shows. */
const DIFF = {
  cptId: 'C1',
  name: 'CPT-1',
  oldMaxDepthM: 18.4,
  newMaxDepthM: 12.1,
  oldNRows: 920,
  newNRows: 605,
  nErrors: 0,
  nWarnings: 1,
}

const PROJECT = { id: 'P1', name: 'Test' }

interface HookHandles {
  handleImportCpt: () => Promise<void>
  refreshConfirm: { fileName: string; diff: { name: string } } | null
  confirmRefreshImport: () => void
  cancelRefreshImport: () => void
}

async function renderImportHook(): Promise<{
  toast: ReturnType<typeof vi.fn>
  markMutated: ReturnType<typeof vi.fn>
  setSessionImportCptIds: ReturnType<typeof vi.fn>
  handles: { current: HookHandles }
}> {
  const toast = vi.fn()
  const markMutated = vi.fn()
  const setSessionImportCptIds = vi.fn()
  const { result } = renderHook(() =>
    useInvestigationData({
      project: PROJECT,
      ready: false,
      toast,
      pushUndo: vi.fn(),
      addToManifest: vi.fn(),
      setSessionImportCptIds,
      setSessionImportBoreholeIds: vi.fn(),
      selectedId: null,
      setSelectedId: vi.fn(),
      selectedBoreholeId: null,
      setSelectedBoreholeId: vi.fn(),
      setView: vi.fn(),
      markMutated,
    }),
  )
  await act(async () => {
    await Promise.resolve()
  })
  return {
    toast,
    markMutated,
    setSessionImportCptIds,
    handles: result as unknown as { current: HookHandles },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  // One file picked; the import result is set per test.
  ;(globalThis as unknown as { window: Record<string, unknown> }).window.electron = {
    openFiles: vi.fn().mockResolvedValue(['C:/tmp/CPT-1.gef']),
    readFile: vi.fn(),
  }
})

describe('handleImportCpt — a refreshed CPT reads as refreshed', () => {
  it('names the refreshed CPT instead of counting it as a new import', async () => {
    importMock.mockResolvedValue({
      cpt_id: 'C1',
      has_errors: false,
      issues: [],
      refreshed: true,
      name: 'CPT-1',
    })
    const { toast, handles } = await renderImportHook()

    await act(async () => {
      await handles.current.handleImportCpt()
    })

    expect(toast).toHaveBeenCalled()
    const [, message] = toast.mock.calls[0]
    expect(message).toContain('CPT-1')
    expect(message.toLowerCase()).toContain('refreshed')
    expect(message.toLowerCase()).not.toContain('1 imported')
  })

  it('marks the project dirty on a refresh WITHOUT calling it a session import', async () => {
    // A refresh replaces stored data, so the project has unsaved changes — but
    // the id was already in the project, and putting it in the session-imports
    // set would make discard-on-close DELETE a CPT that predates the session.
    importMock.mockResolvedValue({
      cpt_id: 'C1',
      has_errors: false,
      issues: [],
      refreshed: true,
      name: 'CPT-1',
    })
    const { markMutated, setSessionImportCptIds, handles } = await renderImportHook()

    await act(async () => {
      await handles.current.handleImportCpt()
    })

    expect(markMutated).toHaveBeenCalled()
    expect(setSessionImportCptIds).not.toHaveBeenCalled()
  })

  it('still reads as an import when the CPT is genuinely new', async () => {
    importMock.mockResolvedValue({
      cpt_id: 'C2',
      has_errors: false,
      issues: [],
      refreshed: false,
      name: 'CPT-2',
    })
    const { toast, handles } = await renderImportHook()

    await act(async () => {
      await handles.current.handleImportCpt()
    })

    const [severity, message] = toast.mock.calls[0]
    expect(severity).toBe('success')
    expect(message).toContain('1 imported')
    expect(message.toLowerCase()).not.toContain('refreshed')
  })
})

// Replacing a stored CPT's series is irreversible — there is no undo and every
// contact anchored on the old depths now sits against different numbers. So the
// engineer is ASKED, per file, on the numbers (docs/ux.md "Reversible vs
// irreversible"): confirmation dialog, Cancel default-focused, action-named
// button. Declining must leave the row exactly as it was.
describe('handleImportCpt — a refresh is consented, never automatic', () => {
  it('asks before replacing, and writes nothing while the question is open', async () => {
    importMock.mockRejectedValue(new CptRefreshConfirmationRequiredError(DIFF))
    const { handles } = await renderImportHook()

    let pending: Promise<void>
    await act(async () => {
      pending = handles.current.handleImportCpt()
      await Promise.resolve()
    })

    expect(handles.current.refreshConfirm).not.toBeNull()
    expect(handles.current.refreshConfirm?.diff.name).toBe('CPT-1')
    expect(handles.current.refreshConfirm?.fileName).toBe('CPT-1.gef')
    // Exactly one attempt so far — the unconfirmed one that the backend refused.
    expect(importMock).toHaveBeenCalledTimes(1)
    expect(importMock.mock.calls[0][2]).toBeFalsy()

    await act(async () => {
      handles.current.cancelRefreshImport()
      await pending
    })
  })

  it('re-posts with the confirmation when the engineer accepts', async () => {
    importMock
      .mockRejectedValueOnce(new CptRefreshConfirmationRequiredError(DIFF))
      .mockResolvedValueOnce({
        cpt_id: 'C1',
        has_errors: false,
        issues: [],
        refreshed: true,
        name: 'CPT-1',
      })
    const { toast, markMutated, handles } = await renderImportHook()

    let pending: Promise<void>
    await act(async () => {
      pending = handles.current.handleImportCpt()
      await Promise.resolve()
    })
    await act(async () => {
      handles.current.confirmRefreshImport()
      await pending
    })

    expect(importMock).toHaveBeenCalledTimes(2)
    expect(importMock.mock.calls[1][2]).toBe(true)
    expect(handles.current.refreshConfirm).toBeNull()
    expect(markMutated).toHaveBeenCalled()
    const [, message] = toast.mock.calls[0]
    expect(message).toContain('CPT-1')
  })

  it('leaves the row untouched when the engineer declines', async () => {
    importMock.mockRejectedValue(new CptRefreshConfirmationRequiredError(DIFF))
    const { toast, markMutated, handles } = await renderImportHook()

    let pending: Promise<void>
    await act(async () => {
      pending = handles.current.handleImportCpt()
      await Promise.resolve()
    })
    await act(async () => {
      handles.current.cancelRefreshImport()
      await pending
    })

    // No second POST — nothing was written, so nothing is dirty.
    expect(importMock).toHaveBeenCalledTimes(1)
    expect(markMutated).not.toHaveBeenCalled()
    const [, message] = toast.mock.calls[0]
    expect(message.toLowerCase()).toContain('unchanged')
    expect(message).toContain('CPT-1')
  })
})

// A GEF that declares a pre-drill (#MEASUREMENTVAR= 13) but whose depth column
// still starts at the surface (camz-001 soundings 39 and 42: 0.35 m declared,
// data from 0.02 m) comes back with a PRE_DRILL_NOT_APPLIED warning. The import
// summary must SAY so, naming the CPT, the declared pre-drill and the first
// depth: the depths were kept as read and the engineer has to check them.
describe('handleImportCpt — a pre-drill the depths were not shifted by is told', () => {
  const PRE_DRILL_ISSUE = {
    level: 'warning',
    code: 'PRE_DRILL_NOT_APPLIED',
    message: 'Pre-drill of 0.35 m declared ...',
    rows: [],
    details: { pre_drill_m: 0.35, first_depth_m: 0.02 },
  }

  it('warns with the CPT name, the declared pre-drill and the first depth', async () => {
    importMock.mockResolvedValue({
      cpt_id: 'C39',
      has_errors: false,
      issues: [PRE_DRILL_ISSUE],
      refreshed: false,
      name: '23.15-002_39',
    })
    const { toast, handles } = await renderImportHook()

    await act(async () => {
      await handles.current.handleImportCpt()
    })

    const warning = toast.mock.calls.find(([severity]) => severity === 'warning')
    expect(warning).toBeDefined()
    const [, message] = warning as [string, string]
    expect(message).toContain('23.15-002_39')
    expect(message).toContain('0.35 m')
    expect(message).toContain('0.02 m')
  })

  it('says nothing extra for a CPT without the finding', async () => {
    importMock.mockResolvedValue({
      cpt_id: 'C1',
      has_errors: false,
      issues: [{ level: 'info', code: 'PRE_DRILL', message: '...', rows: [] }],
      refreshed: false,
      name: '23.15-002_112',
    })
    const { toast, handles } = await renderImportHook()

    await act(async () => {
      await handles.current.handleImportCpt()
    })

    expect(toast.mock.calls.some(([severity]) => severity === 'warning')).toBe(false)
  })
})
