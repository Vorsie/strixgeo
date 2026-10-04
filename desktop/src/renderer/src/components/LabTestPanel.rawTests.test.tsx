// Owner ruling 2026-10-04 (option a): "one place for all lab data of a
// sample". The sample slide-in shows the DOV results (grain size, Atterberg,
// scalar) FIRST, then a "Raw tests" block listing that sample's raw series
// (kind, file name, date, stages). Each test expands to the existing readings
// viewer; the delete keeps its ConfirmDialog and still tells the caller.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { LabSeriesTestSummary, SampleResponse } from '../api/client'

const getForSample = vi.fn()
const deleteTest = vi.fn()
vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client')
  return {
    ...actual,
    api: {
      labSeries: {
        listForBorehole: vi.fn(),
        getForSample: (...a: unknown[]) => getForSample(...a),
        deleteTest: (...a: unknown[]) => deleteTest(...a),
      },
    },
  }
})

import LabTestPanel from './LabTestPanel'

function sampleS2(overrides: Partial<SampleResponse> = {}): SampleResponse {
  return {
    id: 'S2',
    depth_top_m: 2.0,
    depth_base_m: 2.5,
    description: null,
    sample_number: 'S2',
    sample_type: null,
    composition: null,
    instrument: null,
    sampling_date: null,
    grain_sizes: [],
    atterberg_limits_tests: [],
    caco3_content_tests: [],
    organic_content_tests: [],
    water_content_tests: [{ id: 'w1', content_pct: 21.5, method: null, test_date: null }],
    scalar_lab_tests: [],
    geotech_body_id: null,
    geotech_nad_class: null,
    geotech_assignment_source: null,
    ...overrides,
  } as SampleResponse
}

function series(overrides: Partial<LabSeriesTestSummary> = {}): LabSeriesTestSummary {
  return {
    id: 't1',
    sample_id: 'S2',
    sample_depth_top_m: 2.0,
    sample_depth_base_m: 2.5,
    sample_number: 'S2',
    kind: 'oedometer',
    test_type_token: null,
    lab_sample_number: '20/0568',
    source_file_name: 'oed-S2.txt',
    n_specimens: 1,
    n_stages: 16,
    n_readings: 800,
    n_warnings: 0,
    n_errors: 0,
    test_start_date: '2020-03-09',
    ...overrides,
  }
}

function renderPanel(
  props: { sample?: SampleResponse; tests?: LabSeriesTestSummary[]; onDeleted?: () => void } = {},
): void {
  const sample = props.sample ?? sampleS2()
  render(
    <LabTestPanel
      sample={sample}
      allSamples={[sample]}
      onSelectSample={vi.fn()}
      onClose={vi.fn()}
      projectId="p"
      labSeries={props.tests ?? [series()]}
      onLabTestDeleted={props.onDeleted}
    />,
  )
}

describe('LabTestPanel: the raw tests of the sample', () => {
  beforeEach(() => {
    getForSample.mockReset()
    deleteTest.mockReset()
  })

  it('lists the raw tests BELOW the DOV results', () => {
    renderPanel()
    const dov = screen.getByTestId('lab-test-identification')
    const raw = screen.getByTestId('lab-series-section')
    expect(within(raw).getByText('Raw tests (1)')).toBeInTheDocument()
    // DOCUMENT_POSITION_FOLLOWING: the raw block comes after the DOV results.
    expect(dov.compareDocumentPosition(raw) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('each raw test shows its kind, file name, date and stages', () => {
    renderPanel({
      tests: [series(), series({ id: 't2', kind: 'triaxial', test_type_token: 'CD', source_file_name: 'tx-S2.txt', n_stages: 3, test_start_date: null })],
    })
    const rows = screen.getAllByTestId('lab-series-row')
    expect(within(rows[0]).getByText('Oedometer')).toBeInTheDocument()
    expect(within(rows[0]).getByText('oed-S2.txt')).toBeInTheDocument()
    expect(within(rows[0]).getByText('2020-03-09')).toBeInTheDocument()
    expect(within(rows[0]).getByText('16 stage(s)')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Triaxial CD')).toBeInTheDocument()
    expect(within(rows[1]).getByText('3 stage(s)')).toBeInTheDocument()
  })

  it('a sample with only raw tests is not "empty"', () => {
    renderPanel({ sample: sampleS2({ water_content_tests: [] }) })
    expect(screen.queryByTestId('lab-test-empty-state')).not.toBeInTheDocument()
    expect(screen.getByText('oed-S2.txt')).toBeInTheDocument()
  })

  it('a sample without raw tests shows no raw block', () => {
    renderPanel({ tests: [] })
    expect(screen.queryByTestId('lab-series-section')).not.toBeInTheDocument()
  })

  it('expanding a test shows the readings viewer; collapsing hides it', async () => {
    getForSample.mockResolvedValue([])
    renderPanel()
    const toggle = screen.getByRole('button', { name: /oed-S2\.txt/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(await screen.findByTestId('lab-series-viewer')).toBeInTheDocument()
    expect(getForSample).toHaveBeenCalledWith('p', 'S2')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(toggle)
    await waitFor(() => expect(screen.queryByTestId('lab-series-viewer')).not.toBeInTheDocument())
  })

  it('delete asks first (Cancel focused) and, confirmed, tells the caller', async () => {
    deleteTest.mockResolvedValue(undefined)
    const onDeleted = vi.fn()
    renderPanel({ onDeleted })
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete lab test' }))
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' })))
    expect(deleteTest).toHaveBeenCalledWith('p', 't1')
  })
})
