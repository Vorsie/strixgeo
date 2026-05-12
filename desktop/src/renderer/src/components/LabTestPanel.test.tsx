// Smoke tests for LabTestPanel (debt #34).
//
// LabTestPanel is the slide-in lab-test detail panel — opens from
// a sample marker in the borelog. The component dispatches on the
// six lab-test families (grain-size, Atterberg, CaCO3, organic,
// water, scalar catch-all); empty families render nothing so the
// panel stays compact. These tests pin the dispatch contract +
// the prev/next nav + the keyboard-shortcut close.

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { SampleResponse } from '../api/client'
import LabTestPanel from './LabTestPanel'

function makeSample(overrides: Partial<SampleResponse> = {}): SampleResponse {
  return {
    id: 'sample-1',
    depth_top_m: 1.0,
    depth_base_m: 1.5,
    description: 'Lean clay, brown',
    sample_number: 'S1',
    sample_type: 'D',
    composition: null,
    instrument: null,
    sampling_date: null,
    grain_sizes: [],
    atterberg_limits_tests: [],
    caco3_content_tests: [],
    organic_content_tests: [],
    water_content_tests: [],
    scalar_lab_tests: [],
    ...overrides,
  }
}

describe('LabTestPanel — smoke + dispatch', () => {
  it('renders the sample header with depth band + composition / instrument / date', () => {
    const sample = makeSample({
      composition: 'CL',
      instrument: 'D',
      sampling_date: '2026-01-15',
    })
    render(
      <LabTestPanel
        sample={sample}
        allSamples={[sample]}
        onSelectSample={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    // Depth band shows as "1.00 – 1.50 m" in the header.
    expect(screen.getByText(/1\.00 – 1\.50 m/)).toBeInTheDocument()
    expect(screen.getByText('CL')).toBeInTheDocument()
    expect(screen.getByText('2026-01-15')).toBeInTheDocument()
  })

  it('renders an empty-state message when the sample has no lab tests', () => {
    const sample = makeSample()
    render(
      <LabTestPanel
        sample={sample}
        allSamples={[sample]}
        onSelectSample={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    // Implementation surfaces "No lab tests recorded for this sample."
    // when every family is empty.
    expect(screen.getByText(/No lab tests recorded/i)).toBeInTheDocument()
  })

  it('renders the scalar-tests panel when the sample has a water-content test', () => {
    // Water content rolls into the scalar-tests table at the bottom
    // of the panel — every test that isn't grain-size or Atterberg
    // ends up here as a (parameter, value, unit) row.
    const sample = makeSample({
      water_content_tests: [
        {
          id: 'w-1',
          content_pct: 23.5,
          method: null,
          test_date: null,
        },
      ],
    })
    render(
      <LabTestPanel
        sample={sample}
        allSamples={[sample]}
        onSelectSample={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    // Numeric value lands in the value cell as "23.5"; the empty-
    // state line should NOT show.
    expect(screen.queryByText(/No lab tests recorded/i)).not.toBeInTheDocument()
    expect(screen.getByText(/23\.5/)).toBeInTheDocument()
  })
})

describe('LabTestPanel — keyboard navigation', () => {
  it('fires onClose on Escape', () => {
    const onClose = vi.fn()
    const sample = makeSample()
    render(
      <LabTestPanel
        sample={sample}
        allSamples={[sample]}
        onSelectSample={vi.fn()}
        onClose={onClose}
      />,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('navigates to next sample on ArrowRight', () => {
    const onSelectSample = vi.fn()
    const a = makeSample({ id: 'a' })
    const b = makeSample({ id: 'b', depth_top_m: 2.0, depth_base_m: 2.5 })
    render(
      <LabTestPanel
        sample={a}
        allSamples={[a, b]}
        onSelectSample={onSelectSample}
        onClose={vi.fn()}
      />,
    )
    fireEvent.keyDown(document, { key: 'ArrowRight' })
    expect(onSelectSample).toHaveBeenCalledWith('b')
  })

  it('does not navigate past the last sample', () => {
    const onSelectSample = vi.fn()
    const a = makeSample({ id: 'a' })
    render(
      <LabTestPanel
        sample={a}
        allSamples={[a]}
        onSelectSample={onSelectSample}
        onClose={vi.fn()}
      />,
    )
    fireEvent.keyDown(document, { key: 'ArrowRight' })
    expect(onSelectSample).not.toHaveBeenCalled()
  })
})
