// The PDF CPT import dialog's flow (brief 2026-09-30, piece C): triage → list
// (campaign soundings all ticked, unknown ones not) → "Import selected": one
// POST; a sounding already in the project is put to the user one at a time with
// the GEF import's own consent dialog; only the agreed ones are re-posted with
// consent; the report shows per sounding what happened; the caller is told.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CptPdfDigest, CptPdfImportResult, CptPdfSounding } from '../../api/clients/cptPdf'

const importSoundings = vi.fn()
vi.mock('../../api/clients/cptPdf', async () => {
  const actual = await vi.importActual<typeof import('../../api/clients/cptPdf')>('../../api/clients/cptPdf')
  return {
    ...actual,
    cptPdfClient: { ...actual.cptPdfClient, importSoundings: (b: unknown) => importSoundings(b) },
  }
})

const triageState: { current: unknown } = { current: { status: 'idle' } }
const start = vi.fn()
vi.mock('../../hooks/useCptPdfTriage', () => ({
  useCptPdfTriage: () => ({ state: triageState.current, start, reset: vi.fn() }),
}))

import CptPdfImportDialog from './CptPdfImportDialog'

function sounding(key: string, origin: 'campaign' | 'unknown' = 'campaign'): CptPdfSounding {
  return {
    key,
    sounding_id: key,
    origin,
    page_numbers: [231],
    sheet_count: 1,
    graph_kind: 'vector',
    profile_name: 'van-der-straaten',
    ground_level_m: 6.02,
    z_epsg: 5710,
    x: 1,
    y: 2,
    epsg: 31370,
    test_date: null,
    curves: ['qc'],
    clipped_points: 0,
    digitised: true,
    warnings: [],
  }
}

const DIGEST: CptPdfDigest = {
  file_sha: 'a'.repeat(64),
  page_count: 300,
  class_counts: {},
  campaign: [sounding('110'), sounding('7')],
  unknown: [sounding('page-12', 'unknown')],
  dropped: [],
  desk_study_ids: [],
  report_code: 'CAMZ-001',
  campaign_codes: ['CAMZ-001'],
  project_numbers: [],
  ocr_available: true,
  raster_pages_unread: 0,
  profiles: [],
}

function result(key: string, status: CptPdfImportResult['status'], extra: Partial<CptPdfImportResult> = {}): CptPdfImportResult {
  return {
    sounding_id: key,
    status,
    name: key,
    cpt_id: status === 'imported' || status === 'refreshed' ? `cpt-${key}` : null,
    code: null,
    message: null,
    diff: null,
    issues: [],
    ...extra,
  }
}

const ASK = result('7', 'confirmation_required', {
  code: 'cpt_refresh_confirmation_required',
  cpt_id: 'cpt-7',
  diff: { name: '7', old_max_depth_m: 20, new_max_depth_m: 21, old_n_rows: 900, new_n_rows: 950, n_errors: 0, n_warnings: 0 },
})

function renderDialog(onImported = vi.fn()) {
  render(
    <CptPdfImportDialog
      open
      filePath="C:/reports/camz-001.pdf"
      projectId="p1"
      onClose={vi.fn()}
      onImported={onImported}
    />,
  )
  return { onImported }
}

beforeEach(() => {
  importSoundings.mockReset()
  start.mockReset()
  triageState.current = { status: 'done', digest: DIGEST }
})

describe('CptPdfImportDialog', () => {
  it('starts the triage of the picked report in the open project', () => {
    triageState.current = { status: 'idle' }
    renderDialog()
    expect(start).toHaveBeenCalledWith('C:/reports/camz-001.pdf', 'p1')
  })

  it('shows the triage progress while the job runs', () => {
    triageState.current = { status: 'running', phase: 'classify', done: 40, total: 300 }
    renderDialog()
    expect(screen.getByTestId('cpt-pdf-progress').textContent).toContain('40/300')
  })

  // Owner finding 2026-10-05: OCR of a sheet takes seconds, a normal page
  // milliseconds; the progress line says when OCR is what the triage is doing.
  it('says the titles are read with OCR while OCR runs', () => {
    triageState.current = { status: 'running', phase: 'classify', done: 12, total: 97, ocr: true }
    renderDialog()
    expect(screen.getByTestId('cpt-pdf-progress').textContent).toBe('Reading titles with OCR (12/97)…')
  })

  it('says pages are read when no OCR runs', () => {
    triageState.current = { status: 'running', phase: 'classify', done: 12, total: 97, ocr: false }
    renderDialog()
    expect(screen.getByTestId('cpt-pdf-progress').textContent).toBe('Reading pages (12/97)…')
  })

  it('imports every campaign sounding in one POST (unknown ones only when ticked)', async () => {
    importSoundings.mockResolvedValue({ results: [result('110', 'imported'), result('7', 'imported')] })
    const { onImported } = renderDialog()
    fireEvent.click(screen.getByTestId('cpt-pdf-import'))
    await waitFor(() => expect(onImported).toHaveBeenCalled())
    expect(importSoundings).toHaveBeenCalledTimes(1)
    expect(importSoundings.mock.calls[0][0]).toMatchObject({
      project_id: 'p1',
      file_sha: DIGEST.file_sha,
      sounding_ids: ['110', '7'],
    })
    expect(importSoundings.mock.calls[0][0].confirm_refresh).toBeFalsy()
  })

  it('asks before replacing a sounding already in the project, and re-posts only the agreed one with consent', async () => {
    importSoundings
      .mockResolvedValueOnce({ results: [result('110', 'imported'), ASK] })
      .mockResolvedValueOnce({ results: [result('7', 'refreshed')] })
    const { onImported } = renderDialog()
    fireEvent.click(screen.getByTestId('cpt-pdf-import'))
    const dialog = await screen.findByTestId('cpt-refresh-confirm-dialog')
    expect(within(dialog).getByTestId('cpt-refresh-diff').textContent).toContain('950')
    fireEvent.click(screen.getByTestId('cpt-refresh-confirm'))
    await waitFor(() => expect(onImported).toHaveBeenCalled())
    expect(importSoundings.mock.calls[1][0]).toMatchObject({ sounding_ids: ['7'], confirm_refresh: true })
    const statuses = (onImported.mock.calls[0][0] as CptPdfImportResult[]).map(r => r.status)
    expect(statuses).toEqual(['imported', 'refreshed'])
  })

  it('a declined replacement is left unchanged and nothing is re-posted', async () => {
    importSoundings.mockResolvedValueOnce({ results: [result('110', 'imported'), ASK] })
    const { onImported } = renderDialog()
    fireEvent.click(screen.getByTestId('cpt-pdf-import'))
    await screen.findByTestId('cpt-refresh-confirm-dialog')
    fireEvent.click(screen.getByTestId('cpt-refresh-cancel'))
    await waitFor(() => expect(onImported).toHaveBeenCalled())
    expect(importSoundings).toHaveBeenCalledTimes(1)
    const rows = screen.getAllByTestId('cpt-pdf-report-row')
    expect(rows[1].textContent).toContain('left unchanged')
  })

  it('the report lists each sounding with its remarks', async () => {
    importSoundings.mockResolvedValue({
      results: [
        result('110', 'imported', {
          issues: [{ level: 'warning', code: 'PDF_CLIPPED_POINTS', message: '37 qc point(s) on the axis maximum', rows: [] }],
        }),
        result('7', 'refused', { code: 'pdf_no_xy', message: '7: the sheet prints no position' }),
      ],
    })
    renderDialog()
    fireEvent.click(screen.getByTestId('cpt-pdf-import'))
    const rows = await screen.findAllByTestId('cpt-pdf-report-row')
    expect(rows[0].textContent).toContain('PDF_CLIPPED_POINTS')
    expect(rows[1].textContent).toContain('not imported')
  })
})
