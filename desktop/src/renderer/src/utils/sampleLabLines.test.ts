// The lab lines under a sample in the track editor's reference pane (owner
// 2026-10-01: "i also want the psd's of monster to be visible in the right
// hand pane"): one short line per test, never a line for a test that reported
// nothing, organic matter and organic carbon never under one label.
import { describe, expect, it } from 'vitest'

import type { SampleResponse } from '../api/clients/borehole'
import { makeFixtureBorehole } from '../test/fixtures/borehole'
import { formatLabNumber, sampleLabLines } from './sampleLabLines'

function sample(patch: Partial<SampleResponse>): SampleResponse {
  return {
    ...makeFixtureBorehole().samples[1],
    scalar_lab_tests: [],
    ...patch,
  }
}

describe('sampleLabLines', () => {
  it('prints matter and carbon as two different lines', () => {
    const lines = sampleLabLines(
      sample({
        organic_content_tests: [{ id: 'o', carbon_pct: 1.234, matter_pct: 2.5, method: 'm', test_date: null }],
      }),
    )
    expect(lines.map(l => l.key)).toEqual(['tracks.samples.organicMatter', 'tracks.samples.organicCarbon'])
    expect(lines[1].params).toEqual({ pct: '1.2' })
  })

  it('a non-plastic Atterberg test says so; an empty one prints nothing', () => {
    const lines = sampleLabLines(
      sample({
        atterberg_limits_tests: [
          { id: 'a', liquid_limit_pct: null, plastic_limit_pct: null, non_plastic: true, method: null, test_date: null },
          { id: 'b', liquid_limit_pct: null, plastic_limit_pct: null, non_plastic: false, method: null, test_date: null },
        ],
      }),
    )
    expect(lines.map(l => l.key)).toEqual(['tracks.samples.nonPlastic'])
  })

  it('a missing limit prints "?" and no plasticity index is invented', () => {
    const [line] = sampleLabLines(
      sample({
        atterberg_limits_tests: [
          { id: 'a', liquid_limit_pct: 40, plastic_limit_pct: null, non_plastic: false, method: null, test_date: null },
        ],
      }),
    )
    expect(line.params).toEqual({ ll: '40', pl: '?', pi: '?' })
  })

  it('a catch-all row prints its raw parameter with value (not rounded to a percent) and unit, the group as tooltip', () => {
    const [line] = sampleLabLines(
      sample({
        scalar_lab_tests: [
          {
            id: 's',
            parameter_group: 'Korrelvolumemassa',
            parameter: 'Korrelvolumemassa',
            value_numeric: 2.65,
            value_text: null,
            unit: 'g/cm3',
            method: null,
            test_date: null,
            detection_condition: null,
          },
        ],
      }),
    )
    expect(line.params).toEqual({ parameter: 'Korrelvolumemassa', value: '2.65 g/cm3' })
    expect(line.title).toBe('Korrelvolumemassa')
  })

  it('formatLabNumber keeps one decimal at most', () => {
    expect(formatLabNumber(12)).toBe('12')
    expect(formatLabNumber(12.04)).toBe('12')
    expect(formatLabNumber(null)).toBe('?')
  })
})
