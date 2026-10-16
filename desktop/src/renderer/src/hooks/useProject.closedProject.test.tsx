import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useProject } from './useProject'
import { resetOpenProjectGuard } from '../utils/openProjectGuard'

// The rule (owner direction, PR #90; deep walker 2026-10-16 seed 631210857):
// "once a project is closed, nothing of it runs any more". A save is bound to
// the project it was requested for; when that project is no longer the open
// one at any point after an await, the save is abandoned with one INFO line
// ("save of <name> abandoned: project closed") and sends no further request.
//
// The walker caught two saves of the worked example (requested 0.4 s apart,
// before the close) still running after the next project was open: the second
// half of each save POSTed the lumping promote for the CLOSED project.

const A_ID = '01a-AAAA'
const B_ID = '6e6-BBBB'

function projectRow(id: string, name: string): Record<string, unknown> {
  return {
    id,
    name,
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
    created_at: '2026-10-16T05:00:00Z',
    updated_at: '2026-10-16T05:00:00Z',
    view_state: {},
    stratigraphy_lumping_revision: 3,
  }
}

const ROWS: Record<string, Record<string, unknown>> = {
  [A_ID]: projectRow(A_ID, 'worked_example'),
  [B_ID]: projectRow(B_ID, 'E2E Smoke Project'),
}
const PATHS: Record<string, string> = { [A_ID]: 'C:/p/a.strix', [B_ID]: 'C:/p/b.strix' }

function fileJson(id: string): string {
  return JSON.stringify({
    format_version: 3,
    project: { ...ROWS[id], stratigraphy_lumping_revision: undefined },
    cpts: [],
    boreholes: [],
    geological_formations: [],
    geological_models: [],
    cross_sections: [],
    investigation_reviews: [],
    stratigraphy_lumping: null,
  })
}

function bundleOf(id: string): Record<string, unknown> {
  return {
    format_version: 3,
    project: { ...ROWS[id] },
    cpts: [],
    boreholes: [],
    geological_formations: [],
    geological_models: [],
    cross_sections: [],
    investigation_reviews: [],
  }
}

vi.mock('../api/client', () => ({
  api: {
    project: {
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      archive: vi.fn(),
      duplicate: vi.fn(),
      restore: vi.fn(),
      bundle: vi.fn(),
      patchViewState: vi.fn(),
      stageLumping: vi.fn(),
      promoteLumping: vi.fn(),
    },
  },
}))

const logInfo = vi.fn()
vi.mock('../utils/log', () => ({
  log: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: (...args: unknown[]) => logInfo(...args),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}))

type Mock = ReturnType<typeof vi.fn>

/** A promise the test resolves by hand, to hold a save inside an await. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>(r => {
    resolve = r
  })
  return { promise, resolve }
}

beforeEach(async () => {
  resetOpenProjectGuard()
  logInfo.mockReset()
  const { api } = await import('../api/client')
  for (const fn of Object.values(api.project)) (fn as Mock).mockReset()
  ;(api.project.get as Mock).mockImplementation(async (id: string) => ({ ...ROWS[id] }))
  ;(api.project.bundle as Mock).mockImplementation(async (id: string) => bundleOf(id))
  ;(api.project.patchViewState as Mock).mockImplementation(async (id: string) => ({ ...ROWS[id] }))
  ;(api.project.stageLumping as Mock).mockImplementation(async (id: string) => ({ ...ROWS[id] }))
  ;(api.project.promoteLumping as Mock).mockImplementation(async (id: string) => ({ ...ROWS[id] }))
  ;(globalThis as unknown as { window: { electron: unknown } }).window.electron = {
    showProjectOpenDialog: vi.fn(),
    showProjectSaveDialog: vi.fn(),
    projectFileExists: vi.fn().mockResolvedValue(true),
    readProjectFile: vi.fn(async (path: string) => ({
      ok: true,
      json: fileJson(path === PATHS[A_ID] ? A_ID : B_ID),
    })),
    writeProjectFile: vi.fn().mockResolvedValue(undefined),
    addRecentProject: vi.fn().mockResolvedValue([]),
    getRecentProjects: vi.fn().mockResolvedValue([]),
  }
})

afterEach(() => {
  resetOpenProjectGuard()
})

/** Every API call that names project ``id``, across the whole project client. */
async function callsFor(id: string): Promise<string[]> {
  const { api } = await import('../api/client')
  const out: string[] = []
  for (const [name, fn] of Object.entries(api.project)) {
    for (const args of (fn as Mock).mock.calls) {
      if (args[0] === id) out.push(name)
    }
  }
  return out
}

async function openA() {
  const rendered = renderHook(() => useProject())
  await act(async () => {
    await rendered.result.current.openProjectFile(PATHS[A_ID])
  })
  expect(rendered.result.current.project?.id).toBe(A_ID)
  return rendered
}

describe('useProject: a save of a closed project runs nothing more', () => {
  it('a save requested for project A completes nothing after project B is open', async () => {
    const { api } = await import('../api/client')
    const rendered = await openA()

    // Hold A's save inside its bundle fetch (the slow leg on the walker run).
    const bundleA = deferred<Record<string, unknown>>()
    ;(api.project.bundle as Mock).mockImplementationOnce(() => bundleA.promise)

    let saveResult: boolean | undefined
    let savePromise!: Promise<boolean>
    act(() => {
      savePromise = rendered.result.current.saveProject()
    })

    // The user closes A from the menu and opens B from the recent list.
    act(() => {
      rendered.result.current.closeProject()
    })
    await act(async () => {
      await rendered.result.current.openProjectFile(PATHS[B_ID])
    })
    expect(rendered.result.current.project?.id).toBe(B_ID)
    const aCallsBefore = await callsFor(A_ID)

    // A's bundle finally arrives: nothing of A may run any more.
    await act(async () => {
      bundleA.resolve(bundleOf(A_ID))
      saveResult = await savePromise
    })

    expect(saveResult).toBe(false)
    // No request for A after B opened (no stage, no promote, no anchor).
    expect(await callsFor(A_ID)).toEqual(aCallsBefore)
    expect(api.project.promoteLumping).not.toHaveBeenCalledWith(A_ID)
    // A's file is never written once B is open.
    expect(window.electron.writeProjectFile).not.toHaveBeenCalledWith(PATHS[A_ID], expect.anything())
    // B's state is untouched by A's leftovers.
    expect(rendered.result.current.project?.id).toBe(B_ID)
    expect(rendered.result.current.saved?.id).toBe(B_ID)
    expect(rendered.result.current.dirty).toBe(false)
    expect(logInfo).toHaveBeenCalledWith('project', 'save of worked_example abandoned: project closed')
  })

  it("an anchor stamp that lands after the switch never writes A's anchor onto B", async () => {
    const { api } = await import('../api/client')
    const rendered = await openA()

    const anchorA = deferred<Record<string, unknown>>()
    ;(api.project.patchViewState as Mock).mockImplementationOnce(() => anchorA.promise)

    let savePromise!: Promise<boolean>
    act(() => {
      savePromise = rendered.result.current.saveProject()
    })
    act(() => {
      rendered.result.current.closeProject()
    })
    await act(async () => {
      await rendered.result.current.openProjectFile(PATHS[B_ID])
    })

    await act(async () => {
      anchorA.resolve({ ...ROWS[A_ID] })
      await savePromise
    })

    expect(api.project.bundle).not.toHaveBeenCalledWith(A_ID)
    const b = rendered.result.current.project
    expect(b?.id).toBe(B_ID)
    expect((b?.view_state as Record<string, unknown>)?.save_anchor).toBeUndefined()
    expect(rendered.result.current.dirty).toBe(false)
  })

  it('the close path drops a queued save', async () => {
    const { api } = await import('../api/client')
    const rendered = await openA()
    // A save dispatched from A's render (a queued click or menu IPC handler
    // that still closes over A) but run only after the close.
    const queuedSave = rendered.result.current.saveProject
    act(() => {
      rendered.result.current.closeProject()
    })
    const before = await callsFor(A_ID)

    let result: boolean | undefined
    await act(async () => {
      result = await queuedSave()
    })

    expect(result).toBe(false)
    expect(await callsFor(A_ID)).toEqual(before)
    expect(api.project.bundle).not.toHaveBeenCalled()
    expect(window.electron.writeProjectFile).not.toHaveBeenCalled()
    expect(logInfo).toHaveBeenCalledWith('project', 'save of worked_example abandoned: project closed')
  })

  it('a save of the open project still runs end to end (guard)', async () => {
    const { api } = await import('../api/client')
    const rendered = await openA()
    let result: boolean | undefined
    await act(async () => {
      result = await rendered.result.current.saveProject()
    })
    expect(result).toBe(true)
    expect(window.electron.writeProjectFile).toHaveBeenCalledWith(PATHS[A_ID], expect.any(String))
    expect(api.project.promoteLumping).toHaveBeenCalledWith(A_ID)
  })
})
