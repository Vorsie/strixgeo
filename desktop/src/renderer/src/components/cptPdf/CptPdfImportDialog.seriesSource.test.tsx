// The series source of a printed-table sounding reaches the import (owner
// ruling 2026-10-12, report Z2255777): the printed table stays the default
// source of the stored series; "read graph" chosen in the overlay is posted as
// ``series_source[key] = 'graph'`` together with the graph calibration. Left on
// the table, nothing extra goes out (a backend that predates the field refuses
// it as an extra input).

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CptPdfDigest, CptPdfDigitised, CptPdfSounding } from '../../api/clients/cptPdf'

const importSoundings = vi.fn()
const digitise = vi.fn()
vi.mock('../../api/clients/cptPdf', async () => {
  const actual = await vi.importActual<typeof import('../../api/clients/cptPdf')>('../../api/clients/cptPdf')
  return {
    ...actual,
    cptPdfClient: {
      ...actual.cptPdfClient,
      importSoundings: (b: unknown) => importSoundings(b),
      digitise: (b: unknown) => digitise(b),
      pageBlob: async () => new Blob(['png'], { type: 'image/png' }),
    },
  }
})

const triageState: { current: unknown } = { current: { status: 'idle' } }
vi.mock('../../hooks/useCptPdfTriage', () => ({
  useCptPdfTriage: () => ({ state: triageState.current, start: vi.fn(), reset: vi.fn() }),
}))

import CptPdfImportDialog from './CptPdfImportDialog'

const TABLE: CptPdfSounding = {
  key: 'CPTE090',
  sounding_id: 'CPTE090',
  origin: 'campaign',
  page_numbers: [41, 42, 43],
  sheet_count: 3,
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

const DIGEST: CptPdfDigest = {
  file_sha: 'a'.repeat(64),
  page_count: 60,
  class_counts: {},
  campaign: [TABLE],
  unknown: [],
  dropped: [],
  desk_study_ids: [],
  report_code: 'Z2255777',
  campaign_codes: [],
  project_numbers: [],
  ocr_available: true,
  raster_pages_unread: 0,
  profiles: ['printed-table'],
}

const READ: CptPdfDigitised = {
  sounding_id: 'CPTE090',
  page_numbers: [41, 42, 43],
  series: { depth_m: [0.01, 0.2, 36.61], qc_mpa: [1, 2, 3] },
  sampling: 'printed table rows (no resampling)',
  calibrations: [
    {
      page_number: 41,
      coordinate_space: 'image-px',
      dpi: 300,
      depth_reference: 'depth',
      panels: [
        {
          kind: 'qc',
          frame: { x0: 200, y0: 600, x1: 2300, y1: 3300 },
          value_scale: { coord_a: 200, value_a: 0, coord_b: 2300, value_b: 30 },
          depth_scale: { coord_a: 600, value_a: 0, coord_b: 3300, value_b: 40 },
          unit: 'MPa',
          to_storage_factor: 1,
          curve_colour: [1, 0, 0],
          source: 'ocr',
          assumptions: [],
        },
      ],
      ground_level_m: 7.4,
      sounding_id: null,
      profile_name: 'generic',
      assumptions: [],
    },
  ],
  assumptions: [],
  clipped_count: 0,
  printed_values: [],
  header: { x: 1, y: 2, epsg: 31370, ground_level_m: 7.4, z_epsg: 5710, test_date: null },
  warnings: [],
  overlays: [{ page_number: 41, dpi: 110, width: 909, height: 1286, png_base64: 'iVBORw0KGgo=' }],
  graph_series: { depth_m: [0.02, 36.6], qc_mpa: [1.1, 3.1] },
  graph_comparison: { n: 3, median_abs_qc_mpa: 0.1, rms_qc_mpa: 0.1 },
  series_source_default: 'table',
}

function renderDialog() {
  render(<CptPdfImportDialog open filePath="C:/r/z2255777.pdf" projectId="p1" onClose={vi.fn()} onImported={vi.fn()} />)
}

beforeEach(() => {
  importSoundings.mockReset()
  importSoundings.mockResolvedValue({
    results: [
      { sounding_id: 'CPTE090', status: 'imported', name: 'CPTE090', cpt_id: 'c', code: null, message: null, diff: null, issues: [] },
    ],
  })
  digitise.mockReset()
  digitise.mockResolvedValue(READ)
  triageState.current = { status: 'done', digest: DIGEST }
})

describe('the import of a printed-table sounding', () => {
  it('"Check axes" stays on the row of a printed-table sounding', () => {
    renderDialog()
    expect(screen.getByTestId('cpt-pdf-calibrate')).toBeTruthy()
  })

  it('stores the printed table by default: no series source goes out', async () => {
    renderDialog()
    fireEvent.click(screen.getByTestId('cpt-pdf-import'))
    await waitFor(() => expect(importSoundings).toHaveBeenCalled())
    expect(importSoundings.mock.calls[0][0].series_source).toBeUndefined()
  })

  it('"read graph" chosen in the overlay posts series_source graph with the graph calibration', async () => {
    renderDialog()
    fireEvent.click(screen.getByTestId('cpt-pdf-calibrate'))
    await screen.findByTestId('cpt-pdf-overlay-image')
    fireEvent.click(screen.getByRole('radio', { name: 'read graph' }))
    fireEvent.click(screen.getByTestId('cpt-pdf-use'))
    fireEvent.click(await screen.findByTestId('cpt-pdf-import'))
    await waitFor(() => expect(importSoundings).toHaveBeenCalled())
    const body = importSoundings.mock.calls[0][0]
    expect(body.series_source).toEqual({ CPTE090: 'graph' })
    expect(body.calibrations.CPTE090[0].page_number).toBe(41)
  })
})
