// The compact lab lines under a sample in the track editor's reference pane.
//
// Owner 2026-10-01, on a real DOV borehole: "this is too verbose". The label
// was printed twice (translated + the raw token in parentheses) and every
// scalar took a line of its own. The rule, in the session main's words:
//
//   LAB1  at most three short lines: the shares; the classification
//         ("ASTM SW-SM, Well-graded sand with silt · BGGG grofzand"); the
//         scalars joined with " · " under SHORT labels (w, CaCO3, org., ρ, ρs).
//   LAB2  the raw DOV parameter token goes in the tooltip, never inline.
//   LAB3  numbers keep the precision they have (2.65 stays 2.65).
//   LAB4  Atterberg prints as "wL 35 % · wP 20 % · IP 15 %" inside the scalar line.
//   LAB5  an unknown parameter prints its DOV name cut to the first clause,
//         the raw token as tooltip.
//   LAB6  a sieve-only sample gives "fines < 63 µm" + sand + gravel; a share
//         the combined curve does not reach is "?", flagged unknown.
//   LAB7  organic matter and organic carbon never share a label.
//   LAB8  the one chart of a sample is titled with its methods joined
//         ("Zeving + Hydrometer"), each cut to its first words, the raw
//         method tokens as tooltip.
import { describe, expect, it } from 'vitest'

import type { SampleResponse } from '../api/clients/borehole'
import { makeFixtureBorehole } from '../test/fixtures/borehole'
import { makeOwnerDovLabSample } from '../test/fixtures/dovLabSample'
import { formatLabNumber, grainSizeMethodsTitle, sampleLabSummary, type LabPart } from './sampleLabLines'

function sample(patch: Partial<SampleResponse>): SampleResponse {
  return {
    ...makeFixtureBorehole().samples[1],
    scalar_lab_tests: [],
    ...patch,
  }
}

/** A part as plain text, with a literal label (keys print as the key). */
function plain(part: LabPart): string {
  const label = 'text' in part.label ? part.label.text : part.label.key
  return part.value === '' ? label : `${label} ${part.value}`
}

describe('sampleLabSummary — compact lines', () => {
  it("LAB1+LAB2+LAB3: the owner's sample gives one share line, one classification line, one scalar line", () => {
    const summary = sampleLabSummary(makeOwnerDovLabSample())
    expect(summary.shares.map(plain)).toEqual([
      'tracks.samples.fraction.clay 3 %',
      'tracks.samples.fraction.silt 9 %',
      'tracks.samples.fraction.sand 83 %',
      'tracks.samples.fraction.gravel 5 %',
    ])
    expect(summary.classification.map(plain)).toEqual([
      'ASTM SW-SM, Well-graded sand with silt',
      'BGGG grofzand',
    ])
    expect(summary.scalars.map(plain)).toEqual([
      'w 16.8 %',
      'CaCO₃ 1.8 %',
      'org. 0.1 %',
      'ρ 2.1 t/m³',
      'ρs 2.65 t/m³',
    ])
    // Nothing inline carries the raw token or its parentheses ...
    for (const part of [...summary.classification, ...summary.scalars]) {
      expect(plain(part)).not.toMatch(/[()]/)
    }
    // ... the tooltip does.
    const rho = summary.scalars.find(p => plain(p).startsWith('ρ '))
    expect(rho?.title).toContain('Volumemassa nat (volumemassa nat)')
    expect(summary.classification[0].title).toContain('Grondsoort volgens ASTM, de code (ASTM_code)')
    expect(summary.classification[0].title).toContain('Grondsoort volgens ASTM, de beschrijving (ASTM_naam)')
  })

  it('LAB4: Atterberg sits in the scalar line as wL / wP / IP', () => {
    const summary = sampleLabSummary(
      sample({
        atterberg_limits_tests: [
          { id: 'a', liquid_limit_pct: 35, plastic_limit_pct: 20, non_plastic: false, method: 'm', test_date: null },
        ],
        water_content_tests: [{ id: 'w', content_pct: 21.3, method: null, test_date: null }],
      }),
    )
    expect(summary.scalars.map(plain)).toEqual(['w 21.3 %', 'wL 35 %', 'wP 20 %', 'IP 15 %'])
  })

  it('LAB4b: a missing limit invents no plasticity index; non-plastic says so', () => {
    const one = sampleLabSummary(
      sample({
        atterberg_limits_tests: [
          { id: 'a', liquid_limit_pct: 40, plastic_limit_pct: null, non_plastic: false, method: null, test_date: null },
        ],
      }),
    )
    expect(one.scalars.map(plain)).toEqual(['wL 40 %'])
    const np = sampleLabSummary(
      sample({
        atterberg_limits_tests: [
          { id: 'a', liquid_limit_pct: null, plastic_limit_pct: null, non_plastic: true, method: null, test_date: null },
        ],
      }),
    )
    expect(np.scalars.map(plain)).toEqual(['tracks.samples.nonPlastic'])
  })

  it('LAB5: an unknown parameter prints its DOV name cut to the first clause, the raw token as tooltip', () => {
    const raw = 'Doorlatendheid, constant verval (k_cv)'
    const summary = sampleLabSummary(
      sample({
        scalar_lab_tests: [
          {
            id: 'x',
            parameter_group: 'Iets',
            parameter: raw,
            value_numeric: 0.00012,
            value_text: null,
            unit: 'm/s',
            method: null,
            test_date: null,
            detection_condition: null,
          },
        ],
      }),
    )
    expect(summary.scalars.map(plain)).toEqual(['Doorlatendheid 0.00012 m/s'])
    expect(summary.scalars[0].title).toContain(raw)
  })

  it('LAB6: a sieve-only sample prints fines, sand and gravel; an unreached share is "?" and unknown', () => {
    const fixture = makeFixtureBorehole().samples[0]
    const summary = sampleLabSummary(fixture)
    expect(summary.shares.map(plain)).toEqual([
      'tracks.samples.fraction.fines 2 %',
      'tracks.samples.fraction.sand 96 %',
      'tracks.samples.fraction.gravel 2 %',
    ])
    const short = sampleLabSummary(
      sample({
        grain_sizes: [
          {
            id: 'g',
            diameters_mm: [0.063, 0.5],
            pct_larger: [70, 20],
            method: null,
            test_date: null,
            lime_removed: null,
            organics_removed: null,
          },
        ],
      }),
    )
    expect(short.shares.map(plain)).toEqual([
      'tracks.samples.fraction.fines 30 %',
      'tracks.samples.fraction.sand ?',
      'tracks.samples.fraction.gravel ?',
    ])
    expect(short.shares.map(p => p.unknown === true)).toEqual([false, true, true])
  })

  it('LAB7: organic matter and organic carbon get two different labels', () => {
    const summary = sampleLabSummary(
      sample({
        organic_content_tests: [{ id: 'o', carbon_pct: 1.234, matter_pct: 2.5, method: 'm', test_date: null }],
      }),
    )
    expect(summary.scalars.map(plain)).toEqual(['org. 2.5 %', 'Corg 1.234 %'])
  })

  it('no lab test at all gives three empty lines', () => {
    expect(sampleLabSummary(sample({}))).toEqual({ shares: [], classification: [], scalars: [] })
  })

  it('formatLabNumber keeps one decimal at most (the computed shares)', () => {
    expect(formatLabNumber(12)).toBe('12')
    expect(formatLabNumber(12.04)).toBe('12')
    expect(formatLabNumber(null)).toBe('?')
  })
})

describe('grainSizeMethodsTitle', () => {
  it('LAB8: joins the methods, short inline, raw as tooltip', () => {
    const raw = 'Zeving op massa met grootte <= 2mm (fijnkorrelig)'
    expect(grainSizeMethodsTitle([{ method: raw }, { method: 'Hydrometer' }])).toEqual({
      text: 'Zeving + Hydrometer',
      title: `${raw} + Hydrometer`,
    })
    expect(grainSizeMethodsTitle([{ method: 'Zeving' }, { method: 'Zeving' }])).toEqual({
      text: 'Zeving',
      title: 'Zeving',
    })
    expect(grainSizeMethodsTitle([{ method: null }])).toBeNull()
  })
})
