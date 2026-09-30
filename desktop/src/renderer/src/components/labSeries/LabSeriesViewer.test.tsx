// The lab-series viewer (2026-09-29). Pinned in the owner's / reviewer's words:
//
//  * oedometer: "settlement vs log-time per stage and the lab's e-log sigma'
//    as pass-through"; "strain vs log time per stage ... and the end-of-stage
//    strain vs log sigma' as its own panel beside the lab's e-log sigma'".
//  * "the t = 0 reading of a stage cannot sit on a log time axis; draw it as
//    the panel's left-edge marker".
//  * triaxial: "deviator vs strain and pore pressure/volume vs strain per
//    specimen"; no time channel — "say so in the UI".
//  * Q3: every "Reported by the lab" value in its own read-only table.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { LabSeriesStage, LabSeriesTest } from '../../api/client'

const getForSample = vi.fn()
vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client')
  return { ...actual, api: { labSeries: { getForSample: (...a: unknown[]) => getForSample(...a) } } }
})

import LabSeriesViewer from './LabSeriesViewer'

function ch(key: string, values: (number | null)[], provenance = 'measured') {
  return { channel_key: key, source_label: key, unit: null, provenance, values, formula: null, derivation_inputs: null }
}

function oedStage(i: number, stress: number): LabSeriesStage {
  return {
    stage_index: i,
    stage_kind: 'load_step',
    direction_token: 'Belasting',
    hanger_load_kg: 1,
    target_stress_kpa: stress,
    height_at_start_mm: 20,
    lab_stage_settlement_mm: 0.1,
    lab_coefficient_label: null,
    lab_coefficient: null,
    started_at: null,
    reading_timestamps: null,
    point_numbers: null,
    rezero_indices: i === 2 ? [2] : [],
    n_readings: 4,
    channels: [
      ch('elapsed_min', [0, 0.5, 0.5, 10]),
      ch('settlement_mm', [0, 0.1, 0.1, 0.2]),
      ch('total_settlement_mm', [0, 0.1, 0.1, 0.2]),
      ch('vertical_strain', [0, 0.005, 0.005, 0.01], 'derived'),
    ],
  }
}

const specimenBase = {
  initial_height_mm: 20,
  initial_diameter_mm: 63.5,
  initial_wet_mass_g: null,
  dry_mass_g: null,
  initial_water_content_pct: null,
  grain_density_t_m3: null,
  strain_rate_mm_per_min: null,
  consolidation_stress_kpa: null,
  failure_description: null,
  n_points: 8,
}

function oedometer(): LabSeriesTest {
  return {
    id: 't-oed',
    sample_id: 's1',
    kind: 'oedometer',
    test_type_token: null,
    lab_job_number: 'GEO-19/122',
    lab_sample_number: '20/0568',
    lab_borehole_name: 'B7A',
    sampling_depth_top_m: 14.5,
    sampling_depth_base_m: 15,
    visual_description: null,
    source_format: 'oed_control_listing',
    source_file_name: '200568B7-LstSMControleListing.txt',
    source_native_file: null,
    import_issues: [{ level: 'warning', code: 'DIAL_REZERO', message: 'stage 2: dial jumps', rows: [3] }],
    n_specimens: 1,
    specimens: [{ ...specimenBase, specimen_label: null, stages: [oedStage(1, 100), oedStage(2, 200)] }],
    lab_results: [
      { specimen_label: null, stage_index: 1, parameter: 'Druk', value_numeric: 100, value_text: null, unit: 'kPa', provenance: 'lab_reported' },
      { specimen_label: null, stage_index: 1, parameter: 'e', value_numeric: 0.62, value_text: null, unit: '-', provenance: 'lab_reported' },
    ],
  }
}

function triaxial(withVolume: boolean): LabSeriesTest {
  const stage = (): LabSeriesStage => ({
    ...oedStage(1, 0),
    stage_kind: 'shear',
    target_stress_kpa: null,
    rezero_indices: [],
    point_numbers: [60, 61, 62],
    channels: [
      ch('axial_strain_pct', [0, 1, 2], 'lab_derived'),
      ch('deviator_stress_kpa', [0, 50, 80], 'lab_derived'),
      ch('pore_pressure_kpa', [100, 110, 115]),
      ...(withVolume ? [ch('volume_change_cm3', [0, -0.1, -0.2])] : []),
    ],
  })
  return {
    ...oedometer(),
    id: 't-tx',
    kind: 'triaxial',
    test_type_token: withVolume ? 'CD' : 'CU',
    specimens: [
      { ...specimenBase, specimen_label: 'a', stages: [stage()] },
      { ...specimenBase, specimen_label: 'b', stages: [stage()] },
    ],
    lab_results: [
      { specimen_label: 'a', stage_index: null, parameter: 'Type breuk / Afschuifhoek', value_numeric: null, value_text: 'breuk 2 / 57 °', unit: null, provenance: 'lab_reported' },
    ],
  }
}

// No beforeEach reset: with a mockClear / mockReset in a hook, vitest 4 reports the
// rejected promise of the failure test as a test error even though the component
// catches it. Every test sets its own implementation instead.

describe('LabSeriesViewer — oedometer', () => {
  it('draws settlement and strain vs log time, the strain-stress panel and the lab e-log stress', async () => {
    getForSample.mockResolvedValue([oedometer()])
    render(<LabSeriesViewer projectId="p" sampleId="s1" testId="t-oed" onClose={() => {}} />)
    expect(await screen.findByText('Settlement vs log time (measured)')).toBeInTheDocument()
    expect(screen.getByText('Vertical strain delta_h / h0 vs log time (derived by Strix)')).toBeInTheDocument()
    expect(screen.getByText('End-of-stage vertical strain vs log stress (derived by Strix)')).toBeInTheDocument()
    expect(screen.getByText('Void ratio e vs log stress (reported by the lab)')).toBeInTheDocument()
    expect(getForSample).toHaveBeenCalledWith('p', 's1')
  })

  it('draws each stage t = 0 reading as a left-edge marker, and says why', async () => {
    getForSample.mockResolvedValue([oedometer()])
    render(<LabSeriesViewer projectId="p" sampleId="s1" testId="t-oed" onClose={() => {}} />)
    const settlement = await screen.findByTestId('lab-chart-settlement')
    // Two stages → two t = 0 markers on the settlement panel.
    expect(within(settlement).getAllByTestId('t0-marker')).toHaveLength(2)
    expect(screen.getByText(/drawn as a marker on the left edge/)).toBeInTheDocument()
  })

  it('says how many re-zero duplicates it did not draw', async () => {
    getForSample.mockResolvedValue([oedometer()])
    render(<LabSeriesViewer projectId="p" sampleId="s1" testId="t-oed" onClose={() => {}} />)
    expect(await screen.findByText('1 dial re-zero duplicate(s) are not drawn.')).toBeInTheDocument()
  })

  it('lists the lab values read-only under "Reported by the lab", and the import findings', async () => {
    getForSample.mockResolvedValue([oedometer()])
    render(<LabSeriesViewer projectId="p" sampleId="s1" testId="t-oed" onClose={() => {}} />)
    const table = await screen.findByTestId('lab-reported-table')
    expect(screen.getByText('Reported by the lab')).toBeInTheDocument()
    expect(within(table).getByText('0.62')).toBeInTheDocument()
    expect(within(table).queryByRole('textbox')).toBeNull()
    expect(screen.getByText(/DIAL_REZERO/)).toBeInTheDocument()
  })

  it('shows one stage when a stage is picked', async () => {
    getForSample.mockResolvedValue([oedometer()])
    render(<LabSeriesViewer projectId="p" sampleId="s1" testId="t-oed" onClose={() => {}} />)
    const select = await screen.findByTestId('lab-viewer-stage-select')
    fireEvent.change(select, { target: { value: '2' } })
    const settlement = screen.getByTestId('lab-chart-settlement')
    expect(within(settlement).getAllByTestId('t0-marker')).toHaveLength(1)
  })
})

describe('LabSeriesViewer — triaxial', () => {
  it('draws deviator, pore pressure and volume change vs strain per specimen, and says there is no time channel', async () => {
    getForSample.mockResolvedValue([triaxial(true)])
    render(<LabSeriesViewer projectId="p" sampleId="s1" testId="t-tx" onClose={() => {}} />)
    expect(await screen.findByText('Deviator stress vs axial strain (both lab-derived)')).toBeInTheDocument()
    expect(screen.getByText('Pore pressure vs axial strain')).toBeInTheDocument()
    expect(screen.getByText('Volume change vs axial strain')).toBeInTheDocument()
    expect(screen.getAllByText('Specimen a').length).toBeGreaterThan(0)
    expect(screen.getByText(/No time channel in the triaxial export/)).toBeInTheDocument()
    expect(screen.getByText('breuk 2 / 57 °')).toBeInTheDocument()
  })

  it('says an undrained test has no volume channel instead of drawing an empty panel', async () => {
    getForSample.mockResolvedValue([triaxial(false)])
    render(<LabSeriesViewer projectId="p" sampleId="s1" testId="t-tx" onClose={() => {}} />)
    expect(await screen.findByText('No volume change channel (undrained test).')).toBeInTheDocument()
  })
})

describe('LabSeriesViewer — states', () => {
  it('shows an error when the readings cannot be loaded', async () => {
    // The spy records the returned promise; a pre-attached no-op catch keeps the
    // runner from reporting the rejection before the component's own .catch runs.
    getForSample.mockImplementation(() => {
      const p = Promise.reject(new Error('boom'))
      p.catch(() => {})
      return p
    })
    render(<LabSeriesViewer projectId="p" sampleId="s1" testId="t-oed" onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('Could not load the readings.')).toBeInTheDocument())
  })

  it('closes on the Close button', async () => {
    getForSample.mockResolvedValue([oedometer()])
    const onClose = vi.fn()
    render(<LabSeriesViewer projectId="p" sampleId="s1" testId="t-oed" onClose={onClose} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalled()
  })
})
