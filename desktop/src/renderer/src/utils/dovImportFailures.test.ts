// The single reading of "what did not arrive" from a DOV borehole import.
//
// Pins the contract both the done panel and the summary toast depend on: an
// empty list means — and ONLY means — the import was clean.

import { describe, expect, it } from 'vitest'

import { dovSubPhaseFailures } from './dovImportFailures'
import type { BoreholeImportDonePayload } from '../hooks/useDovImportStream'

function result(over: Partial<BoreholeImportDonePayload> = {}): BoreholeImportDonePayload {
  return {
    imported: 40,
    duplicates: 0,
    failed: 0,
    borehole_ids: [],
    interpretations_attached: 0,
    interpretations_failed: 0,
    samples_attached: 0,
    samples_failed: 0,
    grain_sizes_attached: 0,
    grain_sizes_failed: 0,
    atterberg_attached: 0,
    atterberg_failed: 0,
    caco3_attached: 0,
    caco3_failed: 0,
    organic_attached: 0,
    organic_failed: 0,
    water_content_attached: 0,
    water_content_failed: 0,
    scalar_lab_tests_attached: 0,
    scalar_lab_tests_failed: 0,
    ...over,
  }
}

describe('dovSubPhaseFailures', () => {
  it('is empty for a clean import', () => {
    expect(dovSubPhaseFailures(result())).toEqual([])
  })

  it('reports each failed sub-phase with its count', () => {
    expect(dovSubPhaseFailures(result({ interpretations_failed: 40 }))).toEqual([
      { label: 'Observations', count: 40, retryable: true },
    ])
  })

  it('lists failures in import order, skipping the phases that succeeded', () => {
    const failures = dovSubPhaseFailures(
      result({ samples_failed: 3, interpretations_failed: 40, caco3_failed: 1 }),
    )
    expect(failures.map(f => f.label)).toEqual(['Observations', 'Samples', 'CaCO₃ tests'])
  })
})

// Audit 2026-08-02: the eight *_failed counters were read and the ninth
// signal — DOV's own WFS listing an interpretation stream it then does not
// return — was not, so a bbox where every borehole hit that case reported
// "Import complete" with a green toast. The rule, in the rule's own words:
// an import where DOV said it had descriptions and did not hand them over is
// not a clean import.
describe('dovSubPhaseFailures — the WFS gap DOV documents as routine', () => {
  it('counts wfs gaps under their own label, not as failures', () => {
    expect(dovSubPhaseFailures(result({ interpretations_wfs_gaps: 7 }))).toEqual([
      // Not retryable: DOV's catalogue and its own service disagree, so a
      // re-run fetches the same nothing.
      { label: 'Observations DOV lists but did not return', count: 7, retryable: false },
    ])
  })

  it('reports a gap and a failure as two separate rows', () => {
    const rows = dovSubPhaseFailures(
      result({ interpretations_failed: 2, interpretations_wfs_gaps: 5 }),
    )
    expect(rows).toEqual([
      { label: 'Observations', count: 2, retryable: true },
      { label: 'Observations DOV lists but did not return', count: 5, retryable: false },
    ])
  })

  it('stays clean for a payload from a backend that predates the field', () => {
    const legacy = result()
    delete legacy.interpretations_wfs_gaps
    expect(dovSubPhaseFailures(legacy)).toEqual([])
  })
})
