// Import boreholes from local DOV XML files — the renderer half.
//
// The rules, in the owner's words and the contract's: "flag everything that is
// weird" — so after the run the flags are SHOWN (a report the engineer reads),
// not buried in a toast; every boring of every file is imported; a file whose
// borings are already in the project is only replaced after the engineer agreed
// on the numbers (the CPT re-import rule), asked one file at a time; a refresh
// dirties the project without calling the borehole a session import.

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const importFileMock = vi.fn()

vi.mock('../api/client', () => ({
  api: {
    borehole: { importFile: (...args: unknown[]) => importFileMock(...args) },
  },
  BoreholeRefreshConfirmationRequiredError: class BoreholeRefreshConfirmationRequiredError extends Error {
    diffs: unknown[]
    constructor(diffs: unknown[]) {
      super('needs confirmation')
      this.name = 'BoreholeRefreshConfirmationRequiredError'
      this.diffs = diffs
    }
  },
}))

vi.mock('../utils/log', () => ({
  log: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

import { BoreholeRefreshConfirmationRequiredError } from '../api/client'
import { useBoreholeXmlImport } from './useBoreholeXmlImport'

const PROJECT = { id: 'P1', name: 'Test' }

const FLAG_WARNING = {
  level: 'warning',
  code: 'DEPTH_MISMATCH',
  message: 'BGD024E0220: total depth 44.00 m but the description ends at 47.00 m',
  rows: [],
}
const FLAG_INFO = {
  level: 'info',
  code: 'NAME_FROM_ALTERNATIVE',
  message: 'BGD024E0220: named by its alternative name',
  rows: [],
}

function boring(id: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    borehole_id: id,
    name,
    test_id: `T-${name}`,
    has_errors: false,
    issues: [],
    refreshed: false,
    imported: true,
    ...extra,
  }
}

function mount() {
  const deps = {
    project: PROJECT,
    toast: vi.fn(),
    addToManifest: vi.fn(),
    setSessionImportBoreholeIds: vi.fn(),
    markMutated: vi.fn(),
    unhideBoreholes: vi.fn(),
    refreshBoreholeList: vi.fn().mockResolvedValue(undefined),
    setImporting: vi.fn(),
  }
  const { result } = renderHook(() => useBoreholeXmlImport(deps))
  return { deps, result }
}

function pick(paths: string[]): void {
  ;(globalThis as unknown as { window: Record<string, unknown> }).window.electron = {
    openFiles: vi.fn().mockResolvedValue(paths),
    readFile: vi.fn(),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useBoreholeXmlImport — every boring imported, every flag shown', () => {
  it('imports every boring of every file and opens the report with their flags', async () => {
    pick(['C:/x/GEO-25-121.xml', 'C:/x/Smet.xml'])
    importFileMock
      .mockResolvedValueOnce({
        boreholes: [boring('B3', 'GEO-25/121-B3'), boring('B4', 'GEO-25/121-B4')],
        file_issues: [],
      })
      .mockResolvedValueOnce({
        boreholes: [boring('S1', 'BGD024E0220', { issues: [FLAG_WARNING, FLAG_INFO] })],
        file_issues: [],
      })
    const { deps, result } = mount()

    await act(async () => {
      await result.current.handleImportBoreholeXml()
    })

    expect(importFileMock).toHaveBeenCalledTimes(2)
    expect(deps.addToManifest).toHaveBeenCalledWith('borehole', ['B3', 'B4', 'S1'])
    expect(deps.setSessionImportBoreholeIds).toHaveBeenCalled()
    expect(deps.markMutated).not.toHaveBeenCalled()
    const [severity, message] = deps.toast.mock.calls[0]
    expect(severity).toBe('warning')
    expect(message).toContain('3 imported')
    expect(message).toContain('2 flags to review')

    const report = result.current.boreholeImportReport
    expect(report?.map(f => f.fileName)).toEqual(['GEO-25-121.xml', 'Smet.xml'])
    expect(report?.[1].boreholes[0].issues.map(i => i.code)).toEqual([
      'DEPTH_MISMATCH',
      'NAME_FROM_ALTERNATIVE',
    ])

    act(() => result.current.closeBoreholeImportReport())
    expect(result.current.boreholeImportReport).toBeNull()
  })

  it('a clean import still opens the report, and toasts success', async () => {
    pick(['C:/x/B2.xml'])
    importFileMock.mockResolvedValueOnce({ boreholes: [boring('B2', 'GEO-25/110-B2')], file_issues: [] })
    const { deps, result } = mount()
    await act(async () => {
      await result.current.handleImportBoreholeXml()
    })
    expect(deps.toast.mock.calls[0][0]).toBe('success')
    expect(result.current.boreholeImportReport).toHaveLength(1)
  })

  it('a file the backend refuses is reported as failed with its message', async () => {
    pick(['C:/x/bad.xml'])
    importFileMock.mockRejectedValueOnce(new Error("'bad.xml' is not a readable XML file"))
    const { deps, result } = mount()
    await act(async () => {
      await result.current.handleImportBoreholeXml()
    })
    expect(deps.toast.mock.calls[0][0]).toBe('error')
    const [file] = result.current.boreholeImportReport ?? []
    expect(file.outcome).toBe('failed')
    expect(file.error).toContain('not a readable XML file')
  })
})

describe('useBoreholeXmlImport — replacing boreholes already in the project is consented', () => {
  const DIFF = {
    boreholeId: 'B1',
    name: 'GEO-25/110-B1',
    testId: 'X-B1',
    oldTotalDepthM: 30,
    newTotalDepthM: 35,
    oldNLithoLayers: 60,
    newNLithoLayers: 70,
    nErrors: 0,
    nWarnings: 0,
  }

  it('asks on the numbers, then re-posts with consent and marks the project dirty', async () => {
    pick(['C:/x/B1.xml'])
    importFileMock
      .mockRejectedValueOnce(new BoreholeRefreshConfirmationRequiredError([DIFF] as never))
      .mockResolvedValueOnce({
        boreholes: [boring('B1', 'GEO-25/110-B1', { refreshed: true })],
        file_issues: [],
      })
    const { deps, result } = mount()

    let run: Promise<void> = Promise.resolve()
    await act(async () => {
      run = result.current.handleImportBoreholeXml()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(result.current.boreholeRefreshConfirm?.diffs).toEqual([DIFF])
    expect(result.current.boreholeRefreshConfirm?.fileName).toBe('B1.xml')

    await act(async () => {
      result.current.confirmBoreholeRefresh()
      await run
    })

    expect(importFileMock).toHaveBeenLastCalledWith('C:/x/B1.xml', 'P1', true)
    expect(deps.markMutated).toHaveBeenCalled()
    // A refreshed borehole was already in the project: it must NOT join the
    // session-imports set, whose discard path would delete it.
    expect(deps.setSessionImportBoreholeIds).not.toHaveBeenCalled()
    expect(deps.toast.mock.calls[0][1]).toContain('GEO-25/110-B1')
    expect(result.current.boreholeImportReport?.[0].boreholes[0].refreshed).toBe(true)
  })

  it('cancel leaves the stored boreholes untouched and says so in the report', async () => {
    pick(['C:/x/B1.xml'])
    importFileMock.mockRejectedValueOnce(
      new BoreholeRefreshConfirmationRequiredError([DIFF] as never),
    )
    const { deps, result } = mount()

    let run: Promise<void> = Promise.resolve()
    await act(async () => {
      run = result.current.handleImportBoreholeXml()
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      result.current.cancelBoreholeRefresh()
      await run
    })

    expect(importFileMock).toHaveBeenCalledTimes(1)
    expect(deps.markMutated).not.toHaveBeenCalled()
    expect(result.current.boreholeImportReport?.[0].outcome).toBe('declined')
    expect(deps.toast.mock.calls[0][1]).toContain('B1.xml')
  })
})
