// "Assen controleren" on a printed-table sounding (owner finding on the
// packaged 0.1.6, 2026-10-12, report Z2255777: CPTE090 opened an empty panel).
// Owner ruling: "i see the thumbnail, i should be able to set the axes, that is
// a cpt". The overlay shows the sounding's GRAPH sheet with the axes the
// backend detects for it; the user drags the frame corners and types tick
// values exactly as on a raster sheet. The printed TABLE stays the default
// source of the stored series; a switch "Source: printed table (default) / read
// graph" lets the user store the picture reading instead.

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CptPdfDigitised, CptPdfSounding, PageCalibrationDict } from '../../api/clients/cptPdf'
import { setLanguage } from '../../i18n/languageSelect'

const digitise = vi.fn()
vi.mock('../../api/clients/cptPdf', async () => {
  const actual = await vi.importActual<typeof import('../../api/clients/cptPdf')>('../../api/clients/cptPdf')
  return { ...actual, cptPdfClient: { ...actual.cptPdfClient, digitise: (b: unknown) => digitise(b) } }
})

import CptPdfCalibrationOverlay from './CptPdfCalibrationOverlay'

const SHA = 'b'.repeat(64)
const GRAPH_PAGE = 41

// The graph sheet's detected axes: a qc draft on the picture (no tick read).
function draft(): PageCalibrationDict {
  return {
    page_number: GRAPH_PAGE,
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
        assumptions: ['axis values not read; the user must type two ticks per axis'],
      },
    ],
    ground_level_m: 7.4,
    sounding_id: null,
    profile_name: 'generic',
    assumptions: [],
  }
}

function tableAnswer(overrides: Partial<CptPdfDigitised> = {}): CptPdfDigitised {
  return {
    sounding_id: 'CPTE090',
    page_numbers: [41, 42, 43],
    series: { depth_m: [0.01, 0.2, 36.61], qc_mpa: [1, 2, 3] },
    sampling: 'printed table rows (no resampling)',
    calibrations: [draft()],
    assumptions: [],
    clipped_count: 0,
    printed_values: [],
    header: { x: 152000.5, y: 212000.25, epsg: 31370, ground_level_m: 7.4, z_epsg: 5710, test_date: '2024-03-12' },
    warnings: [],
    overlays: [{ page_number: GRAPH_PAGE, dpi: 110, width: 909, height: 1286, png_base64: 'iVBORw0KGgo=' }],
    graph_series: null,
    graph_comparison: null,
    series_source_default: 'table',
    ...overrides,
  }
}

const GRAPH_READ: Partial<CptPdfDigitised> = {
  graph_series: { depth_m: [0.02, 0.04, 36.6, 36.62], qc_mpa: [1.1, 2.1, 3.1, 3.2] },
  graph_comparison: { n: 183, median_abs_qc_mpa: 0.08, rms_qc_mpa: 0.12 },
}

function tableSounding(): CptPdfSounding {
  return {
    key: 'CPTE090',
    sounding_id: 'CPTE090',
    origin: 'campaign',
    page_numbers: [41, 42, 43],
    sheet_count: 3,
    graph_kind: 'printed-table',
    profile_name: 'printed-table',
    ground_level_m: 7.4,
    z_epsg: 5710,
    x: 152000.5,
    y: 212000.25,
    epsg: 31370,
    test_date: '2024-03-12',
    curves: ['qc', 'fs', 'rf'],
    clipped_points: 0,
    digitised: true,
    warnings: [],
    ground_level_source: 'printed-table',
  }
}

function renderOverlay(onDone = vi.fn()) {
  render(
    <CptPdfCalibrationOverlay
      projectId="p1"
      fileSha={SHA}
      sounding={tableSounding()}
      initial={{}}
      onDone={onDone}
      onBack={vi.fn()}
    />,
  )
  return { onDone }
}

beforeEach(() => {
  digitise.mockReset()
  digitise.mockResolvedValue(tableAnswer())
})
afterEach(() => setLanguage('en'))

describe('Check axes on a printed-table sounding', () => {
  it('shows the graph sheet with the detected frame to drag, never an empty panel', async () => {
    renderOverlay()
    const image = await screen.findByTestId('cpt-pdf-overlay-image')
    expect(image.getAttribute('src')).toBe('data:image/png;base64,iVBORw0KGgo=')
    expect(screen.getByTestId('cpt-pdf-corner-0-top-left')).toBeTruthy()
    expect(screen.getByTestId('cpt-pdf-corner-0-bottom-right')).toBeTruthy()
    // Opened as it is: the backend detects the axes itself.
    expect(digitise).toHaveBeenCalledWith({ project_id: 'p1', file_sha: SHA, sounding_id: 'CPTE090' })
  })

  it('the tick values are typed exactly as on a raster sheet, and Read again posts them', async () => {
    renderOverlay()
    await screen.findByTestId('cpt-pdf-overlay-image')
    fireEvent.change(screen.getByTestId('cpt-pdf-value-tick-a'), { target: { value: '0' } })
    fireEvent.change(screen.getByTestId('cpt-pdf-value-tick-b'), { target: { value: '30' } })
    fireEvent.change(screen.getByTestId('cpt-pdf-depth-tick-a'), { target: { value: '0' } })
    fireEvent.change(screen.getByTestId('cpt-pdf-depth-tick-b'), { target: { value: '40' } })
    digitise.mockResolvedValue(tableAnswer(GRAPH_READ))
    fireEvent.click(screen.getByTestId('cpt-pdf-reextract'))
    await waitFor(() => expect(digitise).toHaveBeenCalledTimes(2))
    const posted = digitise.mock.calls[1][0].calibrations[0] as PageCalibrationDict
    expect(posted.page_number).toBe(GRAPH_PAGE)
    expect(posted.panels[0].value_scale).not.toBeNull()
    expect(posted.panels[0].depth_scale).not.toBeNull()
  })

  it('the source switch reads "Source: printed table (default) / read graph", printed table chosen', async () => {
    renderOverlay()
    await screen.findByTestId('cpt-pdf-overlay-image')
    const group = screen.getByTestId('cpt-pdf-series-source')
    expect(group.textContent).toContain('Source')
    const table = screen.getByRole('radio', { name: 'printed table (default)' }) as HTMLInputElement
    const graph = screen.getByRole('radio', { name: 'read graph' }) as HTMLInputElement
    expect(table.checked).toBe(true)
    expect(graph.checked).toBe(false)
  })

  it('"read graph" cannot be chosen before a qc curve is read off the picture', async () => {
    renderOverlay()
    await screen.findByTestId('cpt-pdf-overlay-image')
    expect((screen.getByRole('radio', { name: 'read graph' }) as HTMLInputElement).disabled).toBe(true)
  })

  it('once the picture is read it shows both row counts and how far the graph is off the table', async () => {
    digitise.mockResolvedValue(tableAnswer(GRAPH_READ))
    renderOverlay()
    await screen.findByTestId('cpt-pdf-overlay-image')
    expect(screen.getByTestId('cpt-pdf-table-rows').textContent).toBe('3 rows from the printed table')
    expect(screen.getByTestId('cpt-pdf-graph-rows').textContent).toBe('4 rows read off the graph')
    expect(screen.getByTestId('cpt-pdf-graph-comparison').textContent).toBe(
      'Graph vs table (qc, 183 rows): median 0.08 MPa, RMS 0.12 MPa',
    )
  })

  it('kept on the printed table, "Use" sends no source and no unread calibration', async () => {
    const { onDone } = renderOverlay()
    await screen.findByTestId('cpt-pdf-overlay-image')
    fireEvent.click(screen.getByTestId('cpt-pdf-use'))
    const edit = onDone.mock.calls[0][0]
    expect(edit.seriesSource).toBeUndefined()
    // The detected draft has no tick values: posting it would fail the import.
    expect(edit.calibrations).toBeUndefined()
  })

  it('choosing "read graph" hands the source and the calibration to the import', async () => {
    digitise.mockResolvedValue(tableAnswer(GRAPH_READ))
    const { onDone } = renderOverlay()
    await screen.findByTestId('cpt-pdf-overlay-image')
    fireEvent.click(screen.getByRole('radio', { name: 'read graph' }))
    fireEvent.click(screen.getByTestId('cpt-pdf-use'))
    const edit = onDone.mock.calls[0][0]
    expect(edit.seriesSource).toBe('graph')
    expect(edit.calibrations?.[0].page_number).toBe(GRAPH_PAGE)
  })

  it('a sounding whose report prints no graph sheet shows the header to correct, not an empty panel', async () => {
    digitise.mockResolvedValue(tableAnswer({ calibrations: [], overlays: [] }))
    const { onDone } = renderOverlay()
    expect(await screen.findByTestId('cpt-pdf-no-graph-sheet')).toBeTruthy()
    expect(screen.getByTestId('cpt-pdf-no-graph-sheet').textContent).toBe(
      'No graph sheet printed for this sounding: the values come from the printed table.',
    )
    fireEvent.change(screen.getByTestId('cpt-pdf-header-y'), { target: { value: '212433.03' } })
    fireEvent.click(screen.getByTestId('cpt-pdf-use'))
    expect(onDone.mock.calls[0][0].header).toEqual({ y: 212433.03 })
    expect(onDone.mock.calls[0][0].calibrations).toBeUndefined()
  })

  it('in Dutch the switch reads "Bron: gedrukte tabel (standaard) / afgelezen grafiek"', async () => {
    setLanguage('nl')
    digitise.mockResolvedValue(tableAnswer(GRAPH_READ))
    renderOverlay()
    await screen.findByTestId('cpt-pdf-overlay-image')
    expect(screen.getByTestId('cpt-pdf-series-source').textContent).toContain('Bron')
    expect(screen.getByRole('radio', { name: 'gedrukte tabel (standaard)' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'afgelezen grafiek' })).toBeTruthy()
    expect(screen.getByTestId('cpt-pdf-table-rows').textContent).toBe('3 rijen uit de gedrukte tabel')
    expect(screen.getByTestId('cpt-pdf-graph-rows').textContent).toBe('4 rijen van de grafiek afgelezen')
    expect(screen.getByTestId('cpt-pdf-graph-comparison').textContent).toBe(
      'Grafiek t.o.v. tabel (qc, 183 rijen): mediaan 0.08 MPa, RMS 0.12 MPa',
    )
  })
})
