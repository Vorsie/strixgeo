// Owner ruling 2026-10-04 (option a): raw lab series (oedometer / triaxial)
// move INTO the sample slide-in. "One place for all lab data of a sample."
// So: no lab-test section below the log any more; every sample marker on the
// "Samples + lab tests" track whose sample has at least one raw test carries
// the flask (the map marker's glyph); the track header count counts DOV
// tests + raw tests; and the borehole's raw tests are fetched ONCE per
// borehole (no request per sample).

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { LabSeriesTestSummary } from '../api/client'

const listForBorehole = vi.fn()
const getForSample = vi.fn()
const deleteTest = vi.fn()
vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client')
  return {
    ...actual,
    api: {
      labSeries: {
        listForBorehole: (...a: unknown[]) => listForBorehole(...a),
        getForSample: (...a: unknown[]) => getForSample(...a),
        deleteTest: (...a: unknown[]) => deleteTest(...a),
      },
    },
  }
})

import { makeFixtureBorehole } from '../test/fixtures/borehole'
import BoreholeLog from './BoreholeLog'

/** One raw test on the fixture's second sample (M2 = "sample-B"). */
function seriesOnM2(overrides: Partial<LabSeriesTestSummary> = {}): LabSeriesTestSummary {
  return {
    id: 't1',
    sample_id: 'sample-B',
    sample_depth_top_m: 2.0,
    sample_depth_base_m: 2.5,
    sample_number: 'M2',
    kind: 'oedometer',
    test_type_token: null,
    lab_sample_number: '20/0568',
    source_file_name: 'oed-M2.txt',
    n_specimens: 1,
    n_stages: 16,
    n_readings: 800,
    n_warnings: 0,
    n_errors: 0,
    test_start_date: '2020-03-09',
    ...overrides,
  }
}

describe('BoreholeLog: raw lab tests live in the sample slide-in', () => {
  beforeEach(() => {
    localStorage.clear()
    listForBorehole.mockReset()
    getForSample.mockReset()
    deleteTest.mockReset()
  })

  it('shows no lab-test section below the log', async () => {
    listForBorehole.mockResolvedValue([seriesOnM2()])
    render(<BoreholeLog borehole={makeFixtureBorehole()} projectId="p" />)
    await waitFor(() => expect(listForBorehole).toHaveBeenCalled())
    expect(screen.queryByTestId('lab-series-section')).not.toBeInTheDocument()
    expect(screen.queryByText(/^Lab tests \(/)).not.toBeInTheDocument()
  })

  it("the sample with a raw test carries the flask; the sample without one does not", async () => {
    listForBorehole.mockResolvedValue([seriesOnM2()])
    render(<BoreholeLog borehole={makeFixtureBorehole()} projectId="p" />)
    expect(await screen.findByTestId('sample-lab-flask-sample-B')).toBeInTheDocument()
    expect(screen.queryByTestId('sample-lab-flask-sample-A')).not.toBeInTheDocument()
  })

  it('the flask is the map marker glyph, not a new drawing', async () => {
    listForBorehole.mockResolvedValue([seriesOnM2()])
    render(<BoreholeLog borehole={makeFixtureBorehole()} projectId="p" />)
    const flask = await screen.findByTestId('sample-lab-flask-sample-B')
    expect(flask.getAttribute('data-glyph')).toBe('lab-flask')
  })

  it('the track header counts DOV tests + raw tests', async () => {
    // Fixture: M1 has grain size + Atterberg (2), M2 one scalar test (1) = 3
    // DOV tests; one raw test on M2 makes 4.
    listForBorehole.mockResolvedValue([seriesOnM2()])
    render(<BoreholeLog borehole={makeFixtureBorehole()} projectId="p" />)
    expect(await screen.findByText('2 samples · 4 lab tests')).toBeInTheDocument()
  })

  it('fetches the raw tests once per borehole, not once per sample', async () => {
    listForBorehole.mockResolvedValue([seriesOnM2()])
    render(<BoreholeLog borehole={makeFixtureBorehole()} projectId="p" />)
    await screen.findByTestId('sample-lab-flask-sample-B')
    fireEvent.click(screen.getByText('M1'))
    fireEvent.click(screen.getByText('M2'))
    expect(listForBorehole).toHaveBeenCalledTimes(1)
    expect(listForBorehole).toHaveBeenCalledWith('p', 'bh-fixture-1')
    expect(getForSample).not.toHaveBeenCalled()
  })

  it("opening M2 lists its raw test in the slide-in; M1's slide-in does not", async () => {
    listForBorehole.mockResolvedValue([seriesOnM2()])
    render(<BoreholeLog borehole={makeFixtureBorehole()} projectId="p" />)
    await screen.findByTestId('sample-lab-flask-sample-B')
    fireEvent.click(screen.getByText('M1'))
    expect(screen.queryByText('oed-M2.txt')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('M2'))
    const panel = screen.getByTestId('sample-inspector-sample-B')
    expect(within(panel).getByText('oed-M2.txt')).toBeInTheDocument()
  })

  it('a delete in the slide-in reaches the caller and the flask goes away', async () => {
    listForBorehole.mockResolvedValue([seriesOnM2()])
    deleteTest.mockResolvedValue(undefined)
    const onDeleted = vi.fn()
    render(<BoreholeLog borehole={makeFixtureBorehole()} projectId="p" onLabTestDeleted={onDeleted} />)
    await screen.findByTestId('sample-lab-flask-sample-B')
    fireEvent.click(screen.getByText('M2'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    listForBorehole.mockResolvedValue([])
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete lab test' }))
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' })))
    await waitFor(() => expect(screen.queryByTestId('sample-lab-flask-sample-B')).not.toBeInTheDocument())
  })
})
