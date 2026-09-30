// What the app does once a PDF report import settles (brief 2026-09-30, piece
// C): "a summary toast; the CPT list refetches; the project marks mutated". New
// CPTs join the manifest and the session-import set exactly like a GEF import
// (so discard-on-close can roll them back); a replaced CPT was already in the
// project, so it dirties the project through markMutated instead.

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CptPdfImportResult } from '../api/clients/cptPdf'
import { useCptPdfImport } from './useCptPdfImport'

function result(key: string, status: CptPdfImportResult['status']): CptPdfImportResult {
  return {
    sounding_id: key,
    status,
    name: key,
    cpt_id: status === 'imported' || status === 'refreshed' ? `cpt-${key}` : null,
    code: null,
    message: null,
    diff: null,
    issues: [],
  }
}

function setup() {
  const deps = {
    project: { id: 'p1' },
    toast: vi.fn(),
    refreshList: vi.fn(async () => undefined),
    unhideCpts: vi.fn(),
    addToManifest: vi.fn(),
    setSessionImportCptIds: vi.fn(),
    markMutated: vi.fn(),
    setSelectedId: vi.fn(),
  }
  const hook = renderHook(() => useCptPdfImport(deps))
  return { deps, hook }
}

beforeEach(() => {
  window.electron = { ...(window.electron ?? {}), openFile: vi.fn(async () => 'C:/r/camz-001.pdf') } as never
})

describe('useCptPdfImport', () => {
  it('picking a report opens the dialog on it; cancelling the picker opens nothing', async () => {
    const { hook } = setup()
    await act(async () => hook.result.current.handleImportCptPdf())
    expect(hook.result.current.pdfImport).toEqual({ filePath: 'C:/r/camz-001.pdf' })
    ;(window.electron.openFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)
    act(() => hook.result.current.closePdfImport())
    await act(async () => hook.result.current.handleImportCptPdf())
    expect(hook.result.current.pdfImport).toBeNull()
  })

  it('counts the outcomes in one toast', async () => {
    const { deps, hook } = setup()
    await act(async () =>
      hook.result.current.handlePdfImported(
        [
          result('110', 'imported'),
          result('112', 'imported'),
          result('7', 'refreshed'),
          result('9', 'confirmation_required'),
          result('13', 'refused'),
        ],
        'camz-001.pdf',
      ),
    )
    expect(deps.toast).toHaveBeenCalledTimes(1)
    const [kind, message] = deps.toast.mock.calls[0]
    expect(kind).toBe('success')
    expect(message).toContain('2 imported')
    expect(message).toContain('7')
    expect(message).toContain('9')
    expect(message).toContain('1 failed')
  })

  it('new CPTs join the manifest and the session imports; a replacement marks the project mutated', async () => {
    const { deps, hook } = setup()
    await act(async () =>
      hook.result.current.handlePdfImported([result('110', 'imported'), result('7', 'refreshed')], 'r.pdf'),
    )
    expect(deps.addToManifest).toHaveBeenCalledWith('cpt', ['cpt-110'])
    expect(deps.setSessionImportCptIds).toHaveBeenCalled()
    expect(deps.markMutated).toHaveBeenCalledTimes(1)
    expect(deps.unhideCpts).toHaveBeenCalledWith(['cpt-110', 'cpt-7'])
    expect(deps.refreshList).toHaveBeenCalled()
    expect(deps.setSelectedId).toHaveBeenCalledWith('cpt-110')
  })

  it('nothing imported: an error toast, no manifest change', async () => {
    const { deps, hook } = setup()
    await act(async () => hook.result.current.handlePdfImported([result('13', 'failed')], 'r.pdf'))
    expect(deps.toast.mock.calls[0][0]).toBe('error')
    expect(deps.addToManifest).not.toHaveBeenCalled()
  })
})
