// The app side of the PDF borehole import, in the brief's words (2026-10-10):
//
//   BP1  the import report is the XML import's flags report (one file, every
//        borehole with its flags), and a summary toast held 10 s
//        (``TOAST_LONG_TIMEOUT_MS``) when it sums up several boreholes.
//   BP2  new boreholes are adopted (unhidden, manifest, session imports,
//        refetch); a refreshed one dirties the project instead, never the
//        session-import set whose discard path would delete it.
//   BP3  nothing imported is an error toast with the dialog's own wording.

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { ImportBoreholeFileResponse } from '../api/client'
import { useBoreholePdfImport } from './useBoreholePdfImport'
import { TOAST_LONG_TIMEOUT_MS } from './useToasts'

vi.mock('../utils/log', () => ({
  log: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

function boring(id: string | null, over: Partial<ImportBoreholeFileResponse['boreholes'][number]> = {}) {
  return { borehole_id: id, name: id ?? 'B-x', test_id: id ?? 'B-x', has_errors: false, issues: [], refreshed: false, imported: true, ...over }
}

function setup() {
  const deps = {
    project: { id: 'P1' },
    toast: vi.fn(),
    adoptImportedBoreholes: vi.fn().mockResolvedValue(undefined),
    unhideBoreholes: vi.fn(),
    markMutated: vi.fn(),
    refreshBoreholeList: vi.fn().mockResolvedValue(undefined),
  }
  const hook = renderHook(() => useBoreholePdfImport(deps))
  return { deps, hook }
}

describe('useBoreholePdfImport', () => {
  it('BP1/BP2: new + refreshed boreholes: adopted, dirtied, reported, toast held 10 s', async () => {
    const { deps, hook } = setup()
    const response: ImportBoreholeFileResponse = {
      boreholes: [boring('n1'), boring('r1', { refreshed: true })],
      file_issues: [],
    }
    await act(async () => {
      await hook.result.current.handleBoreholePdfImported(response, 'report.pdf')
    })
    expect(deps.adoptImportedBoreholes).toHaveBeenCalledWith(['n1'])
    expect(deps.unhideBoreholes).toHaveBeenCalledWith(['r1'])
    expect(deps.markMutated).toHaveBeenCalledTimes(1)
    const [severity, , , options] = deps.toast.mock.calls[0]
    expect(severity).toBe('success')
    expect(options).toEqual({ durationMs: TOAST_LONG_TIMEOUT_MS })
    expect(hook.result.current.boreholePdfReport).toEqual([
      { fileName: 'report.pdf', outcome: 'imported', boreholes: response.boreholes, fileIssues: [] },
    ])
    expect(hook.result.current.boreholePdfImport).toBeNull()
  })

  it('BP3: nothing imported is an error toast and adopts nothing', async () => {
    const { deps, hook } = setup()
    await act(async () => {
      await hook.result.current.handleBoreholePdfImported(
        { boreholes: [boring(null, { imported: false })], file_issues: [] },
        'report.pdf',
      )
    })
    expect(deps.toast.mock.calls[0][0]).toBe('error')
    expect(deps.adoptImportedBoreholes).not.toHaveBeenCalled()
    expect(deps.markMutated).not.toHaveBeenCalled()
  })
})
