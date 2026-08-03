// The Ic band palette must match the CROSS-BOUNDARY Robertson contract.
//
// Audit 2026-08-02: the chart's IC_ZONES labelled every band one step too
// coarse and invented a "Sensitive" band at Ic 3.60–4.00. A CPT through Boom
// Clay (Ic ≈ 3.2) read "Clay" in the per-test table and "Organic" in the chart
// rendered directly below it — a materially different soil.
//
// The first version of this file compared IC_ZONES (derived from
// SBT_IC_BANDS) against sbtZoneFromIc (which iterates SBT_IC_BANDS): one table
// agreeing with itself, structurally incapable of going red. The drift that
// can actually happen is renderer↔backend, so the assertions below run against
// an arbiter NEITHER side owns —
// ``tests/fixtures/contracts/robertson_sbt_bands.json`` — which
// ``tests/unit/domain/services/test_robertson_sbt_band_contract.py`` holds the
// backend to as well. Moving a breakpoint or a label means moving it there
// first, and watching both suites go red.
//
// The rule, in the rule's own words: the band the chart draws around an Ic
// value must carry the same soil name the classifier gives that Ic value —
// on both sides of the wire.
//
// The bands moved out of ``CptIcSbtChart`` (deleted 2026-08-03 — the owner
// killed the squished inline chart) into ``icBands.ts``; the guard travelled
// with them because the drift it catches is renderer↔backend, not chart-shaped.

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { IC_ZONES, SBT_ZONE_FILL } from './icBands'
import {
  sbtZoneFromIc,
  sbtZoneSpec,
  SBT_IC_BANDS,
  ROBERTSON_SBT_ZONES,
  IC_AXIS_MAX,
} from '../../../utils/robertsonSbt'

/** One band of the shared contract file. */
interface ContractBand {
  zone: number
  ic_min: number
  /** null = unbounded above (Ic has no ceiling; only the chart axis does). */
  ic_max: number | null
  renderer_label: string
  backend_label: string
}

/** One Robertson chart ZONE of the shared contract file (strip half). */
interface ContractZone {
  zone: number
  strip_label: string
  strip_fill: string
}

// .../desktop/src/renderer/src/shell/stages/parameters → repo root is 7 up.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../'.repeat(7))
const CONTRACT_PATH = resolve(REPO_ROOT, 'tests/fixtures/contracts/robertson_sbt_bands.json')

const contract = JSON.parse(readFileSync(CONTRACT_PATH, 'utf-8')) as {
  ic_axis_max: number
  bands: ContractBand[]
  zones: ContractZone[]
}

/** The band label covering ``ic`` (bands are [x1, x2)). */
function chartLabelForIc(ic: number): string | undefined {
  return IC_ZONES.find(z => ic >= z.x1 && ic < z.x2)?.label
}

/**
 * Ic values that must land inside ``band``.
 *
 * The lower breakpoint IS part of the band and the upper one is not, so a
 * midpoint alone would miss an off-by-one at either edge.
 */
function samplePoints(band: ContractBand): number[] {
  if (band.ic_max === null) return [band.ic_min, band.ic_min + 0.2]
  return [band.ic_min, (band.ic_min + band.ic_max) / 2, band.ic_max - 0.001]
}

describe('icBands — SBT1: the chart agrees with the shared Robertson contract', () => {
  it('reads a contract with bands (a missing/empty file must not pass silently)', () => {
    expect(contract.bands.length).toBeGreaterThan(0)
  })

  for (const band of contract.bands) {
    it(`labels the ${band.renderer_label} band exactly as the contract does`, () => {
      for (const ic of samplePoints(band)) {
        expect(chartLabelForIc(ic) ?? sbtZoneFromIc(ic)).toBe(band.renderer_label)
      }
    })
  }

  it('carries the contract’s breakpoints, in order', () => {
    expect(SBT_IC_BANDS.map(b => b.icMin)).toEqual(contract.bands.map(b => b.ic_min))
    // The last band is unbounded in the contract; the chart closes it at the
    // axis maximum, which is a DRAWING limit, not a classification one.
    expect(SBT_IC_BANDS.slice(0, -1).map(b => b.icMax)).toEqual(
      contract.bands.slice(0, -1).map(b => b.ic_max),
    )
    expect(SBT_IC_BANDS[SBT_IC_BANDS.length - 1].icMax).toBe(IC_AXIS_MAX)
    expect(IC_AXIS_MAX).toBe(contract.ic_axis_max)
  })

  it('classifies above the axis maximum as the contract’s top band', () => {
    // Ic has no ceiling — a value past the chart's axis is still organic.
    const top = contract.bands[contract.bands.length - 1]
    expect(sbtZoneFromIc(IC_AXIS_MAX + 1)).toBe(top.renderer_label)
  })
})

describe('icBands — SBT2: no invented band', () => {
  it('never labels a band "Sensitive" — zone 1 is not an Ic band', () => {
    expect(IC_ZONES.map(z => z.label)).not.toContain('Sensitive')
  })
})

// The Tier-5 domain-hue rule (ux.md) protects the LABEL↔HUE pairing, not the
// hue's numeric Ic range: blue reads as clay everywhere in the app. Correcting
// the labels shifted every soil down one band, and an index-keyed fill list
// left the hues behind — painting "Clay" amber and "Silt mix" blue.
describe('icBands — SBT3: each soil keeps its own hue', () => {
  const fillFor = (label: string): string | undefined =>
    IC_ZONES.find(z => z.label === label)?.fill

  it('paints Clay blue and Silt mix green, whatever Ic range they sit in', () => {
    expect(fillFor('Clay')).toBe('#dbeafe')
    expect(fillFor('Silt mix')).toBe('#dcfce7')
  })

  it('gives every band a distinct fill', () => {
    const fills = IC_ZONES.map(z => z.fill)
    expect(new Set(fills).size).toBe(fills.length)
  })
})

// The two SBT strips draw from ROBERTSON_SBT_ZONES (labels) and SBT_ZONE_FILL
// (hues). Before this block both were held to NOTHING: a hue nudge or a
// reworded soil name was invisible to every suite, in a surface whose entire
// job is naming a soil correctly. They are now arbitrated by the same contract
// file the Ic bands are, so drift on either side goes red before it ships.
//
// This also retires the "mirrors the backend docstring verbatim" claim in
// robertsonSbt.ts: two of the nine labels were deliberately reworded, and a
// machine-checked fixture beats prose that a later reader will trust instead of
// checking.
describe('icBands — SBT4: the zone strips agree with the shared contract', () => {
  it('reads a contract with zones (a missing/empty key must not pass silently)', () => {
    expect(contract.zones.length).toBe(9)
    expect(contract.zones.map(z => z.zone)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  for (const zone of contract.zones) {
    it(`names and paints zone ${zone.zone} exactly as the contract does`, () => {
      expect(sbtZoneSpec(zone.zone)?.label).toBe(zone.strip_label)
      expect(SBT_ZONE_FILL[zone.zone]).toBe(zone.strip_fill)
    })
  }

  it('carries no zone the contract does not name', () => {
    expect(ROBERTSON_SBT_ZONES.map(z => z.zone)).toEqual(contract.zones.map(z => z.zone))
    expect(Object.keys(SBT_ZONE_FILL).map(Number).sort((a, b) => a - b)).toEqual(
      contract.zones.map(z => z.zone),
    )
  })

  // A strip is read by colour before it is read by tooltip. Two adjacent zones
  // sharing a hue would make a contact between them invisible.
  it('gives every zone a distinct fill', () => {
    const fills = contract.zones.map(z => SBT_ZONE_FILL[z.zone])
    expect(new Set(fills).size).toBe(fills.length)
  })

  // Owner call, recorded in the contract file: zone 2 keeps peat brown even
  // though the Ic band for the same soil is amber. Pinned so the exception
  // stays a decision instead of becoming an accident.
  it('keeps zone 2 the deliberate peat brown, not the Ic band’s amber', () => {
    expect(SBT_ZONE_FILL[2]).toBe('#92400e')
    expect(IC_ZONES.find(z => z.label === 'Organic')?.fill).toBe('#fef3c7')
  })
})
