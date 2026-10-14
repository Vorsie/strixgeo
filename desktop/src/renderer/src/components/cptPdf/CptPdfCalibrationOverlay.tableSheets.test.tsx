// Owner dogfeed on the packaged 0.1.6 (2026-10-14, report Z2255777):
//   (1) "sondering wordt gelezen is traag": the graph sheet of a printed-table
//       sounding is now read in the background after the triage. When the
//       overlay opens before its graph sheet is ready, it says so with a
//       spinner ("Grafiekblad wordt gelezen…") until the reading arrives.
//   (2) "the table pages are also selectable but that is useless": only the
//       GRAPH sheets of a printed-table sounding can be calibrated, so only
//       they are offered; the table pages are named in a note ("tabelbladen
//       44–47").

import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CptPdfDigitised, CptPdfSounding, PageCalibrationDict } from '../../api/clients/cptPdf'
import { setLanguage } from '../../i18n/languageSelect'

const digitise = vi.fn()
vi.mock('../../api/clients/cptPdf', async () => {
  const actual = await vi.importActual<typeof import('../../api/clients/cptPdf')>('../../api/clients/cptPdf')
  return { ...actual, cptPdfClient: { ...actual.cptPdfClient, digitise: (b: unknown) => digitise(b) } }
})

import CptPdfCalibrationOverlay from './CptPdfCalibrationOverlay'

const SHA = 'c'.repeat(64)

function draft(page: number): PageCalibrationDict {
  return {
    page_number: page,
    coordinate_space: 'image-px',
    dpi: 300,
    depth_reference: 'depth',
    panels: [
      {
        kind: 'qc',
        frame: { x0: 200, y0: 600, x1: 2300, y1: 3300 },
        value_scale: null,
        depth_scale: null,
        unit: 'MPa',
        to_storage_factor: 1,
        curve_colour: null,
        source: 'draft',
        assumptions: [],
      },
    ],
    ground_level_m: 7.4,
    sounding_id: null,
    profile_name: 'generic',
    assumptions: [],
  }
}

function overlay(page: number, png: string) {
  return { page_number: page, dpi: 110, width: 909, height: 1286, png_base64: png }
}

/** Graph sheets 43 and 48, table sheets 44–47 (Z2255777 prints both). */
function answer(): CptPdfDigitised {
  return {
    sounding_id: 'CPTE090',
    page_numbers: [43, 44, 45, 46, 47, 48],
    series: { depth_m: [0.2, 0.4], qc_mpa: [1, 2] },
    sampling: 'printed table rows (no resampling)',
    calibrations: [draft(43), draft(48)],
    assumptions: [],
    clipped_count: 0,
    printed_values: [],
    header: { x: 1, y: 2, epsg: 31370, ground_level_m: 7.4, z_epsg: 5710, test_date: null },
    warnings: [],
    overlays: [overlay(43, 'AAAA'), overlay(48, 'BBBB')],
    graph_series: null,
    graph_comparison: null,
    series_source_default: 'table',
  }
}

function sounding(): CptPdfSounding {
  return {
    key: 'CPTE090',
    sounding_id: 'CPTE090',
    origin: 'campaign',
    page_numbers: [43, 44, 45, 46, 47, 48],
    sheet_count: 6,
    graph_kind: 'printed-table',
    profile_name: 'printed-table',
    ground_level_m: 7.4,
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

function renderOverlay(graphSheetReady?: boolean) {
  render(
    <CptPdfCalibrationOverlay
      projectId="p1"
      fileSha={SHA}
      sounding={sounding()}
      initial={{}}
      onDone={vi.fn()}
      onBack={vi.fn()}
      graphSheetReady={graphSheetReady}
    />,
  )
}

beforeEach(() => {
  digitise.mockReset()
  digitise.mockResolvedValue(answer())
})
afterEach(() => setLanguage('en'))

describe('the sheet strip of a printed-table sounding', () => {
  it('offers only its graph sheets, never a table page', async () => {
    renderOverlay(true)
    await screen.findByTestId('cpt-pdf-overlay-image')
    expect(screen.getByRole('button', { name: 'Page 43' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Page 48' })).toBeTruthy()
    for (const page of [44, 45, 46, 47]) expect(screen.queryByRole('button', { name: `Page ${page}` })).toBeNull()
  })

  it('a graph sheet chosen in the strip shows that sheet', async () => {
    renderOverlay(true)
    await screen.findByTestId('cpt-pdf-overlay-image')
    fireEvent.click(screen.getByRole('button', { name: 'Page 48' }))
    expect(screen.getByTestId('cpt-pdf-overlay-image').getAttribute('src')).toBe('data:image/png;base64,BBBB')
  })

  it('names the table pages in a note: "Table sheets 44–47"', async () => {
    renderOverlay(true)
    await screen.findByTestId('cpt-pdf-overlay-image')
    expect(screen.getByTestId('cpt-pdf-table-sheets').textContent).toBe('Table sheets 44–47')
  })

  it('in Dutch the note reads "Tabelbladen 44–47"', async () => {
    setLanguage('nl')
    renderOverlay(true)
    await screen.findByTestId('cpt-pdf-overlay-image')
    expect(screen.getByTestId('cpt-pdf-table-sheets').textContent).toBe('Tabelbladen 44–47')
  })

  it('a single graph sheet shows no strip at all', async () => {
    digitise.mockResolvedValue({
      ...answer(),
      page_numbers: [43, 44, 45],
      calibrations: [draft(43)],
      overlays: [overlay(43, 'AAAA')],
    })
    renderOverlay(true)
    await screen.findByTestId('cpt-pdf-overlay-image')
    expect(screen.queryByRole('button', { name: /^Page / })).toBeNull()
    expect(screen.getByTestId('cpt-pdf-table-sheets').textContent).toBe('Table sheets 44–45')
  })
})

describe('opening a printed-table sounding whose graph sheet is still being read', () => {
  it('shows a spinner and "Reading the graph sheet…" until the reading arrives', async () => {
    let resolve: (v: CptPdfDigitised) => void = () => {}
    digitise.mockReturnValue(new Promise<CptPdfDigitised>(r => (resolve = r)))
    renderOverlay(false)
    const loading = screen.getByTestId('cpt-pdf-graph-loading')
    expect(loading.textContent).toBe('Reading the graph sheet…')
    expect(loading.querySelector('.animate-spin')).not.toBeNull()
    resolve(answer())
    await screen.findByTestId('cpt-pdf-overlay-image')
    expect(screen.queryByTestId('cpt-pdf-graph-loading')).toBeNull()
  })

  it('in Dutch it reads "Grafiekblad wordt gelezen…"', () => {
    setLanguage('nl')
    digitise.mockReturnValue(new Promise(() => {}))
    renderOverlay(false)
    expect(screen.getByTestId('cpt-pdf-graph-loading').textContent).toBe('Grafiekblad wordt gelezen…')
  })

  it('a graph sheet already read opens without that state', () => {
    digitise.mockReturnValue(new Promise(() => {}))
    renderOverlay(true)
    expect(screen.queryByTestId('cpt-pdf-graph-loading')).toBeNull()
  })
})
