/**
 * THE SIXTH REPORT MUST NOT BE POSSIBLE — the onlap-closure tripwire.
 *
 * Owner, 2026-08-25, on Cross-section 3: *"again i see 2 onlaps ending in a
 * vertical edge"* — the fifth time this shape reached him. The rule it breaks
 * is his own, 2026-08-22: an onlap *"should be a triangle and not a quad"*.
 *
 * These pins are in two halves, deliberately:
 *
 *  * the DETECTOR is proved against the owner's own failing coordinates —
 *    the exact ring the engine emitted for his loose sand before the fix, so
 *    a tripwire that silently stopped detecting would fail here;
 *  * the ENGINE is then swept and must be clean.
 *
 * The verification contract is his too, same day: *"if you draw the onlap into
 * a triangle onto the tie, you just have to verify by coordinates, midpoint tie
 * coordinate is end of onlap coordinate and you have a closed loop?"*
 */
import { describe, expect, it } from 'vitest'

import { computeHierarchicalGeotechFill } from '../index'
import { column, tie } from '../scene.test-helpers'
import { fillGapProbe } from './fillGapProbe'
import { interiorVerticals, onlapClosureViolations, onlapTerminationsByGap } from './onlapClosure'
import { computeSectionFillActive } from '../../partitionEngineSelect'
import type { SectionRegion } from '../../partitionFill'

const SAND = 'f-sand'
const N5 = 'g-zand-5'
const N6 = 'g-zand-6'
const N7 = 'g-zand-7'
const PACKING = new Map<string, string>([
  [N5, 'ZAND|5'],
  [N6, 'ZAND|6'],
  [N7, 'ZAND|7'],
])
const PAIR = [0, 100]

/** A ring literal, in (fraction, elevation). */
const ring = (...points: [number, number][]): SectionRegion['polygon'] =>
  points.map(([fraction, elevation]) => ({ fraction, elevation }))

describe('the onlap-closure tripwire', () => {
  it('OC1 — it fires on the owner\'s own CS3 quad, coordinates verbatim', () => {
    // The ring the engine emitted for his loose sand in CS3 gap 1 before the
    // fix: the wedge rides its top tie from +7.63 and its base should close
    // onto that tie at the middle (+6.165) — instead it ran flat to the middle
    // and cut down, leaving the 0.83 m riser he circled.
    const quad = ring([0, 5.34], [0.5, 5.34], [0.5, 6.165], [0, 7.63])
    const found = interiorVerticals(quad)
    expect(found).toHaveLength(1)
    expect(found[0].fraction).toBe(0.5)
    expect(found[0].hi - found[0].lo).toBeCloseTo(0.825, 3)
  })

  it('OC2 — and it stays quiet on the triangle that replaced it', () => {
    // *"a triangle and not a quad"*: three vertices, the far end a single
    // point on the tie. Nothing vertical anywhere inside the gap.
    const triangle = ring([0, 7.63], [0, 5.34], [0.5, 6.165])
    expect(interiorVerticals(triangle)).toEqual([])
  })

  it('OC3 — a gap-edge vertical is not a stub: a band standing at its own test', () => {
    // Every band has a vertical face at the column it was measured on. The
    // invariant is about the ground BETWEEN the tests, so f = 0 and f = 1 are
    // never violations.
    const bandAtItsTest = ring([0, 8], [0, 5], [1, 5], [1, 8])
    expect(interiorVerticals(bandAtItsTest)).toEqual([])
  })

  it('OC4 — the engine emits no onlap that ends in a vertical face', () => {
    // THE SCENE. Two tests 100 m apart. The left reads medium over LOOSE over
    // dense; the right reads medium over dense over medium, with its own
    // contact 2.08 m deeper. One tie joins the loose sand's TOP contact to the
    // right test's contact, so the loose sand has one tied contact, reads a
    // different mass at its far end, and the law emits the onlap.
    const lithoColumns = [
      column('A', 10, [{ layerId: 'LA', formationId: SAND, top: 0, base: 15 }]),
      column('B', 10, [{ layerId: 'LB', formationId: SAND, top: 0, base: 15 }]),
    ]
    const lithoEdges = [tie('LA', 'LB', 'top', 'top'), tie('LA', 'LB', 'base', 'base')]
    fillGapProbe.enabled = true
    fillGapProbe.entries.length = 0
    let out!: ReturnType<typeof computeHierarchicalGeotechFill>
    let probes: (typeof fillGapProbe)['entries']
    try {
      out = computeHierarchicalGeotechFill({
        lithoColumns,
        lithoEdges,
        lithoRegions: computeSectionFillActive(lithoColumns, lithoEdges, undefined, PAIR),
        geotechColumns: [
          column('A', 10, [
            { layerId: 'GA1', formationId: N6, top: 0, base: 6 },
            { layerId: 'GA2', formationId: N5, top: 6, base: 8.98 },
            { layerId: 'GA3', formationId: N7, top: 8.98, base: 15 },
          ]),
          column('B', 10, [
            { layerId: 'GB1', formationId: N6, top: 0, base: 3.92 },
            { layerId: 'GB2', formationId: N7, top: 3.92, base: 9 },
            { layerId: 'GB3', formationId: N6, top: 9, base: 15 },
          ]),
        ],
        geotechEdges: [tie('GA2', 'GB2', 'top', 'top')],
        alongM: PAIR,
        packingClassOf: PACKING,
      })
    } finally {
      probes = [...fillGapProbe.entries]
      fillGapProbe.entries.length = 0
      fillGapProbe.enabled = false
    }
    const terminations = onlapTerminationsByGap(probes)
    // The scene has to actually produce the construct it is pinning, or the
    // sweep below passes by being empty.
    expect([...(terminations.get(0)?.keys() ?? [])], 'the scene emitted no onlap').toContain('GA2')
    // ...and it terminates at the middle — *"at 0.5 Distance approximately"*.
    expect(terminations.get(0)?.get('GA2')).toBeCloseTo(0.5, 6)
    expect(onlapClosureViolations(out.regions, terminations)).toEqual([])
  })
})
