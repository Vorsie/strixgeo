// The PDF borehole import dialog's flow (owner 2026-10-10, phase 2: "the same
// user path as the CPT one"), with the owner's rulings 2026-10-08 in his words:
//
//   D1  the triage list shows one row per borehole with its findings as notes.
//   D2  ruling 3/4: a row whose X/Y has no system or whose water level has no
//       unit is "never silent": Import stays disabled until the user answers.
//   D3  the answers travel in the import body per borehole: ``crs: {epsg,
//       scope}`` and ``water_unit_confirmed``.
//   D4  a borehole already in the project is never replaced without consent:
//       the XML import's dialog asks, only "Replace" re-posts with
//       ``confirm_refresh``; Cancel writes nothing and posts nothing more.
//   D5  ruling 5: two prints of one borehole ticked together block the import.
//   D6  a 422 refusal is shown in the dialog, nothing is reported as imported.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { BoreholePdfDigest, BoreholePdfRow } from '../../api/clients/boreholePdf'

const importBoreholes = vi.fn()
vi.mock('../../api/clients/boreholePdf', async () => {
  const actual = await vi.importActual<typeof import('../../api/clients/boreholePdf')>(
    '../../api/clients/boreholePdf',
  )
  return {
    ...actual,
    boreholePdfClient: { ...actual.boreholePdfClient, importBoreholes: (b: unknown) => importBoreholes(b) },
  }
})

const triageState: { current: unknown } = { current: { status: 'idle' } }
const start = vi.fn()
vi.mock('../../hooks/useBoreholePdfTriage', () => ({
  useBoreholePdfTriage: () => ({ state: triageState.current, start, reset: vi.fn() }),
}))
vi.mock('../../hooks/usePdfPageThumbnail', () => ({
  usePdfPageThumbnail: () => ({ url: null, error: false }),
}))

import { BoreholeRefreshConfirmationRequiredError } from '../../api/client'
import { BoreholePdfImportRefusedError } from '../../api/clients/boreholePdf'
import BoreholePdfImportDialog from './BoreholePdfImportDialog'

function row(over: Partial<BoreholePdfRow>): BoreholePdfRow {
  return {
    key: 'B-1@p1',
    name: 'B-1',
    profile: 'boorstaat',
    pages: [1, 2],
    text_verdict: 'text',
    parses_rows: true,
    x: 68000.5,
    y: 224000.25,
    epsg: 31370,
    crs_assumed: false,
    ground_level_m: 6.5,
    z_epsg: 5710,
    date_text: '9-1-2024',
    date_iso: '2024-01-09',
    driller: null,
    project_code: null,
    project_name: null,
    depth_top_m: 0,
    depth_base_m: 7.28,
    repeat_of: null,
    repeat_differences: [],
    parsed: true,
    n_intervals: 7,
    n_samples: 2,
    water_level_m: 2,
    water_unit_assumed: false,
    findings: [],
    importable: true,
    ...over,
  }
}

const PROFILE = row({
  key: 'B-2@p3',
  name: 'B-2',
  pages: [3],
  crs_assumed: true,
  water_unit_assumed: true,
  water_level_m: 3.8,
  findings: [
    { level: 'warning', code: 'CRS_ASSUMED', message: 'x', params: { page: 3, x: 1, y: 2, epsg: 31370 } },
    {
      level: 'warning',
      code: 'WATER_UNIT_ASSUMED',
      message: 'w',
      params: { page: 3, label: 'GWS:', value: '380', depth_m: 3.8 },
    },
    { level: 'error', code: 'PDF_BOREHOLE_LEVEL_UNREADABLE', message: 'm', params: { page: 3, text: '15O' } },
  ],
})

function digest(boreholes: BoreholePdfRow[]): BoreholePdfDigest {
  return {
    file_name: 'report.pdf',
    file_sha: 'a'.repeat(64),
    page_count: 4,
    pages_not_triaged: 0,
    class_counts: {},
    needs_ocr_pages: [],
    ocr_available: false,
    ocr_pages: [],
    boreholes,
    dropped: [],
  }
}

const OK = { boreholes: [{ borehole_id: 'b1', name: 'B-1', test_id: 'B-1', has_errors: false, issues: [], refreshed: false, imported: true }], file_issues: [] }

function renderDialog(onImported = vi.fn()): ReturnType<typeof vi.fn> {
  render(
    <BoreholePdfImportDialog
      open
      filePath={'C:\\data\\report.pdf'}
      projectId="P1"
      onClose={vi.fn()}
      onImported={onImported}
    />,
  )
  return onImported
}

beforeEach(() => {
  importBoreholes.mockReset()
  start.mockReset()
})

describe('BoreholePdfImportDialog', () => {
  it('D1: lists each borehole with its findings as notes', () => {
    triageState.current = { status: 'done', digest: digest([row({}), PROFILE]) }
    renderDialog()
    const rows = screen.getAllByTestId('borehole-pdf-row')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText('B-1')).toBeInTheDocument()
    expect(within(rows[1]).getByTestId('borehole-pdf-notes')).toHaveTextContent("the level label '15O' is not a number")
    expect(start).toHaveBeenCalledWith('C:\\data\\report.pdf', 'P1')
  })

  it('D2/D3: Import waits for both answers, then sends them per borehole', async () => {
    triageState.current = { status: 'done', digest: digest([row({}), PROFILE]) }
    importBoreholes.mockResolvedValue(OK)
    const onImported = renderDialog()
    const importButton = screen.getByTestId('borehole-pdf-import')
    expect(importButton).toBeDisabled()
    expect(screen.getByTestId('borehole-pdf-waiting')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('borehole-pdf-crs-report'))
    expect(importButton).toBeDisabled()
    fireEvent.click(screen.getByTestId('borehole-pdf-water-confirm'))
    expect(importButton).toBeEnabled()

    fireEvent.click(importButton)
    await waitFor(() => expect(onImported).toHaveBeenCalledWith(OK, 'report.pdf'))
    expect(importBoreholes).toHaveBeenCalledWith({
      project_id: 'P1',
      file_sha: 'a'.repeat(64),
      boreholes: [
        { key: 'B-1@p1' },
        { key: 'B-2@p3', crs: { epsg: 31370, scope: 'report' }, water_unit_confirmed: true },
      ],
    })
  })

  it('D3: "another system" sends the picked EPSG for this borehole only', async () => {
    triageState.current = { status: 'done', digest: digest([PROFILE]) }
    importBoreholes.mockResolvedValue(OK)
    renderDialog()
    fireEvent.click(screen.getByTestId('borehole-pdf-crs-other'))
    fireEvent.change(screen.getByTestId('borehole-pdf-crs-epsg'), { target: { value: '28992' } })
    fireEvent.click(screen.getByTestId('borehole-pdf-water-confirm'))
    fireEvent.click(screen.getByTestId('borehole-pdf-import'))
    await waitFor(() => expect(importBoreholes).toHaveBeenCalled())
    expect(importBoreholes.mock.calls[0][0].boreholes[0].crs).toEqual({ epsg: 28992, scope: 'this' })
  })

  it('D4: a borehole already in the project is asked about; Replace re-posts with consent', async () => {
    triageState.current = { status: 'done', digest: digest([row({})]) }
    const diff = {
      boreholeId: 'b1', name: 'B-1', testId: 'B-1', oldTotalDepthM: 3, newTotalDepthM: 7.28,
      oldNLithoLayers: 1, newNLithoLayers: 7, nErrors: 0, nWarnings: 0,
    }
    importBoreholes
      .mockRejectedValueOnce(new BoreholeRefreshConfirmationRequiredError([diff]))
      .mockResolvedValueOnce(OK)
    const onImported = renderDialog()
    fireEvent.click(screen.getByTestId('borehole-pdf-import'))
    const ask = await screen.findByTestId('borehole-refresh-confirm-dialog')
    expect(onImported).not.toHaveBeenCalled()
    fireEvent.click(within(ask).getByRole('button', { name: /replace/i }))
    await waitFor(() => expect(onImported).toHaveBeenCalledWith(OK, 'report.pdf'))
    expect(importBoreholes.mock.calls[1][0].confirm_refresh).toBe(true)
  })

  it('D4: Cancel on the consent posts nothing more and reports nothing', async () => {
    triageState.current = { status: 'done', digest: digest([row({})]) }
    importBoreholes.mockRejectedValueOnce(
      new BoreholeRefreshConfirmationRequiredError([
        { boreholeId: 'b1', name: 'B-1', testId: 'B-1', oldTotalDepthM: 3, newTotalDepthM: 7, oldNLithoLayers: 1, newNLithoLayers: 7, nErrors: 0, nWarnings: 0 },
      ]),
    )
    const onImported = renderDialog()
    fireEvent.click(screen.getByTestId('borehole-pdf-import'))
    const ask = await screen.findByTestId('borehole-refresh-confirm-dialog')
    fireEvent.click(within(ask).getByRole('button', { name: /cancel/i }))
    await waitFor(() => expect(screen.queryByTestId('borehole-refresh-confirm-dialog')).not.toBeInTheDocument())
    expect(importBoreholes).toHaveBeenCalledTimes(1)
    expect(onImported).not.toHaveBeenCalled()
  })

  it('D5: two prints of one borehole ticked block the import', () => {
    const repeat = row({ key: 'B-1@p9', pages: [9], repeat_of: 'B-1@p1' })
    triageState.current = { status: 'done', digest: digest([row({}), repeat]) }
    renderDialog()
    const rows = screen.getAllByTestId('borehole-pdf-row')
    // The second print starts unticked; ticking it too is the clash.
    fireEvent.click(within(rows[1]).getByRole('checkbox'))
    expect(screen.getByTestId('borehole-pdf-clash')).toBeInTheDocument()
    expect(screen.getByTestId('borehole-pdf-import')).toBeDisabled()
  })

  it('D6: a refusal is shown in the dialog and nothing is reported', async () => {
    triageState.current = { status: 'done', digest: digest([row({})]) }
    importBoreholes.mockRejectedValueOnce(
      new BoreholePdfImportRefusedError('Two prints ticked', 'borehole_pdf_repeat_choose_one', []),
    )
    const onImported = renderDialog()
    fireEvent.click(screen.getByTestId('borehole-pdf-import'))
    expect(await screen.findByTestId('borehole-pdf-error')).toHaveTextContent('Two prints ticked')
    expect(onImported).not.toHaveBeenCalled()
  })
})
