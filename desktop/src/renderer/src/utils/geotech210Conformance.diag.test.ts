/**
 * THE 2/1/0 CONFORMANCE GATE — owner ask 2026-08-18 ("how are we still making
 * errors against the 2/1/0 rule ... sure get the systematic fix done").
 *
 * The oracle itself lives in ``geotech210Conformance.audit.ts`` — read its
 * docstring for the law, the four violation kinds, and how the two 2026-08-26
 * rulings (the COVER WELD and the LEAST-DENSE LEFTOVER) reach it. This file is
 * the harness around it:
 *
 *  * the RATCHET — audit every section of the real dump, count per kind, and
 *    fail when any count grew against the frozen baseline. Dormant unless
 *    ``GEOTECH_210=1``. Env: ``GEOTECH_AXIS_INPUT`` (input override, same as the
 *    consistency gate), ``GEOTECH_210_RAW=1`` (audit the pre-hierarchical
 *    whole-section geotech partition), ``GEOTECH_210_FREEZE=1`` (re-freeze).
 *    Report: ``scripts/throwaway_geotech_210.txt``.
 *  * the PINS — synthetic scenes, always live, that hold the oracle's own
 *    definitions in place. Each is a MUTATION PAIR: one scene the audit must
 *    stay silent on and its twin, differing in one field, that it must still
 *    report. Without the twin a "green" gate proves only that the audit found
 *    nothing, never that it can still find something.
 *
 * BASELINE, and what is knowingly RED. Frozen 2026-08-21 at all-zero except
 * Cross-section 3 ``nospan=1``. That one is PRE-EXISTING and stays: its band
 * carries a fan of two ties on a SINGLE contact, so this gate counts ties (reads
 * 2 -> must span) while the constructor counts tied contacts (reads 1 ->
 * pinching onlap). The owner's S12 sentence ("it has a top and bottom tie to the
 * right though?") reads as contacts, but he has not ruled; when he does, either
 * the gate re-scopes or the constructor changes. Do not chase it as a defect,
 * and do not absorb it into the baseline either — it is the open question's own
 * marker.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  auditPartition,
  auditSection,
  type AuditBundle,
  type Counts,
  type RawSection,
} from './geotech210Conformance.audit'
import { resolveLeftovers } from './geotechHierarchicalFill/constructive/leastDenseLeftover'
import { buildPackingClassOf } from './geotechHierarchicalFill/packingClassOf'
import type { CorrelationEdge, PartitionColumn, SectionRegion } from './partitionFill'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const INPUT = process.env.GEOTECH_AXIS_INPUT
  ? resolve(REPO_ROOT, process.env.GEOTECH_AXIS_INPUT)
  : resolve(REPO_ROOT, 'scripts/throwaway_geotech_axis_inputs.json')
const OUT = resolve(REPO_ROOT, 'scripts/throwaway_geotech_210.txt')
const BASELINE = resolve(HERE, '__fixtures__/geotech_210_conformance_baseline.json')

// Formation row → canonical class key, lazily from the dump's own nadMeta.
// The gate must compare masses exactly as the fill does — by CLASS (owner
// 2026-08-21: one mass one body) — or it audits a law the fill was not given.
let packingClassCache: Map<string, string> | null = null
function loadPackingClassOf(): Map<string, string> {
  if (packingClassCache === null) {
    const raw = existsSync(INPUT)
      ? (JSON.parse(readFileSync(INPUT, 'utf8')) as {
          refinementBundle?: {
            nadMeta?: Record<string, { nadClass: number | null; soilCode: string | null }>
          }
        })
      : {}
    packingClassCache = buildPackingClassOf(Object.entries(raw.refinementBundle?.nadMeta ?? {}))
  }
  return packingClassCache
}

describe('2/1/0 conformance gate', () => {
  if (process.env.GEOTECH_210 !== '1' || !existsSync(INPUT)) {
    it.skip('dormant (set GEOTECH_210=1)', () => {})
    return
  }
  it('every band obeys 2/1/0, ratcheted against the frozen baseline', () => {
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as { sections: RawSection[] }
    const packingClassOf = loadPackingClassOf()
    const perSection: Record<string, Counts> = {}
    const lines: string[] = []
    for (const sec of raw.sections) {
      const violations = auditSection(sec, packingClassOf, process.env.GEOTECH_210_RAW === '1')
      const counts: Counts = { balloon: 0, missing: 0, nospan: 0, overreach: 0 }
      for (const v of violations) counts[v.kind]++
      perSection[sec.name] = counts
      lines.push(
        `${sec.name.padEnd(18)} balloon=${counts.balloon} missing=${counts.missing} ` +
          `nospan=${counts.nospan} overreach=${counts.overreach}`,
      )
      for (const v of violations) lines.push(`    [${v.kind}] ${v.detail}`)
    }
    writeFileSync(OUT, lines.join('\n') + '\n')
    console.log(lines.filter((l) => !l.startsWith('    ')).join('\n'))

    if (process.env.GEOTECH_210_FREEZE === '1') {
      writeFileSync(BASELINE, JSON.stringify(perSection, null, 1) + '\n')
      console.log(`froze baseline → ${BASELINE}`)
      expect(true).toBe(true)
      return
    }
    if (!existsSync(BASELINE)) {
      console.log('no baseline committed — report-only run (freeze with GEOTECH_210_FREEZE=1)')
      expect(true).toBe(true)
      return
    }
    const frozen = JSON.parse(readFileSync(BASELINE, 'utf8')) as Record<string, Counts>
    const regressions: string[] = []
    for (const [name, counts] of Object.entries(perSection)) {
      const base = frozen[name]
      if (!base) continue // a new section has no baseline yet
      for (const kind of ['balloon', 'missing', 'nospan', 'overreach'] as const) {
        if (counts[kind] > base[kind]) {
          regressions.push(`${name}: ${kind} ${base[kind]} → ${counts[kind]}`)
        }
      }
    }
    expect(regressions, `2/1/0 violations may only shrink; details in ${OUT}`).toEqual([])
  })
})

// ---------------------------------------------------------------- THE PINS --

/** One band of a synthetic column, in metres below the collar. */
interface BandSpec {
  layerId: string
  formationId: string
  top: number
  base: number
}

/** One synthetic column. */
function column(
  investigationId: string,
  surfaceElevM: number,
  units: readonly BandSpec[],
): PartitionColumn {
  return {
    investigationId,
    surfaceElevM,
    units: units.map((u) => ({
      layerId: u.layerId,
      formationId: u.formationId,
      topDepthM: u.top,
      baseDepthM: u.base,
      bodyId: null,
    })),
  }
}

/** One axis-aligned loop of a gap, in (fraction, elevation) space. */
function quad(
  formationId: string,
  layerIds: readonly string[],
  f0: number,
  f1: number,
  top: number,
  base: number,
): SectionRegion {
  return {
    gapIndex: 0,
    formationId,
    bodyId: null,
    kind: 'quad',
    polygon: [
      { fraction: f0, elevation: top },
      { fraction: f1, elevation: top },
      { fraction: f1, elevation: base },
      { fraction: f0, elevation: base },
    ],
    layerIds: [...layerIds],
  }
}

/** The same loop, tagged with the role the fill would have stamped on it. */
function loop(
  role: 'construct' | 'fill',
  formationId: string,
  layerIds: readonly string[],
  f0: number,
  f1: number,
  top: number,
  base: number,
): SectionRegion & { role: 'construct' | 'fill' } {
  return { ...quad(formationId, layerIds, f0, f1, top, base), role }
}

/**
 * A two-test scene, 100 m apart, whose two litho units are ONE family.
 *
 * The union is made by the shared litho REGION rather than by a correlation
 * edge, which is the real CS1 gap-19 shape the cover-weld ruling was given on:
 * *"the tops of all tests are connected"* — nobody drew a line there, the litho
 * stage simply painted one cover across the gap.
 */
function scene(spec: {
  litho: [PartitionColumn, PartitionColumn]
  geotech: [PartitionColumn, PartitionColumn]
  regions: SectionRegion[]
  preMerge: (SectionRegion & { role: 'construct' | 'fill' })[]
  lithoEdges?: CorrelationEdge[]
  /** The cover's own ring, when the scene needs it to be something other than
   *  the trapezoid between the two units — a KINKED base, say (CWA5/CWA6). */
  cover?: { fraction: number; elevation: number }[]
}): AuditBundle {
  const lithoLayerIds = spec.litho.flatMap((c) => c.units.map((u) => u.layerId))
  const [left, right] = spec.litho
  // The cover is DRAWN, not a bounding box: the oracle opens a welded band's
  // envelope to this ring, so a scene that handed it a huge box would prove
  // nothing about the chord or the ring.
  const trapezoid = [
    { fraction: 0, elevation: left.surfaceElevM - left.units[0].topDepthM },
    { fraction: 1, elevation: right.surfaceElevM - right.units[0].topDepthM },
    { fraction: 1, elevation: right.surfaceElevM - right.units[0].baseDepthM },
    { fraction: 0, elevation: left.surfaceElevM - left.units[0].baseDepthM },
  ]
  return {
    columns: spec.geotech,
    alongM: [0, 100],
    edges: [],
    regions: spec.regions,
    preMerge: spec.preMerge,
    lithoColumns: spec.litho,
    lithoEdges: spec.lithoEdges ?? [],
    lithoRegions: [
      {
        gapIndex: 0,
        formationId: left.units[0].formationId,
        bodyId: null,
        kind: 'quad',
        polygon: spec.cover ?? trapezoid,
        layerIds: lithoLayerIds,
      },
    ],
  }
}

/** Identity class keys — a synthetic scene carries no nadMeta. */
const RAW_CLASSES = new Map<string, string>()

describe('the 2/1/0 oracle knows the cover weld', () => {
  // Both tests read the same SAND unit, top to bottom, as one packing class.
  // Every contact of both bands is the cover's own boundary, so both weld and
  // both bands have two tied contacts: the law says "emit nothing" and the mass
  // spans. CWA1/CWA2 differ in ONE field — the far band's packing class.
  const weldScene = (farClass: string): AuditBundle =>
    scene({
      litho: [
        column('t1', 10, [{ layerId: 'L1', formationId: 'SAND', top: 0, base: 10 }]),
        column('t2', 10, [{ layerId: 'L2', formationId: 'SAND', top: 0, base: 10 }]),
      ],
      geotech: [
        column('t1', 10, [{ layerId: 'g1', formationId: 'n6', top: 0, base: 10 }]),
        column('t2', 10, [{ layerId: 'g2', formationId: farClass, top: 0, base: 10 }]),
      ],
      regions:
        farClass === 'n6'
          ? [quad('n6', ['g1', 'g2'], 0, 1, 10, 0)]
          : [quad('n6', ['g1'], 0, 1, 10, 0), quad(farClass, ['g2'], 0, 1, 10, 0)],
      preMerge: [
        loop('construct', 'n6', ['g1'], 0, 1, 10, 0),
        loop('construct', farClass, ['g2'], 0, 1, 10, 0),
      ],
    })

  it('CWA1 — a same-mass cover boundary is a tied contact, so the mass may span the gap', () => {
    // *"follow the tie, same nad class, emit nothing"* (owner, 2026-08-26). Two
    // welded contacts is a BAND: it emits nothing, stays open, and its ground
    // runs the whole way. Before the oracle was told, this exact shape was the
    // ruling's own target reported as a violation — CS1 col20 gap19.
    expect(auditPartition('WELD', weldScene('n6'), RAW_CLASSES)).toEqual([])
  })

  it('CWA2 — STRICTNESS: the identical shape without the weld is still overreach', () => {
    // One field changes: the facing band is a different packing. Nothing welds,
    // both bands are untied, and a construct that paints its whole gap is the
    // termination clause broken — *"an onlap can't paint over ground near test
    // itself, it terminates at 0.5 Distance approximately"*.
    const violations = auditPartition('NO-WELD', weldScene('n9'), RAW_CLASSES)
    expect(violations.map((v) => v.kind)).toEqual(['overreach', 'overreach'])
    expect(violations[0].detail).toContain('reaches 1.00 past the middle 0.50')
    expect(violations[1].detail).toContain('reaches 0.00 past the middle 0.50')
  })

  // A DIPPING cover edge: t2's collar is 6 m lower, so the welded boundary the
  // top sand follows falls from +10 to +4 across the gap. Its construct rides
  // that line down, which is inside its envelope only if the oracle carries the
  // line — the engine's own ``ridesCover``.
  const dipScene = (farClass: string): AuditBundle =>
    scene({
      litho: [
        column('t1', 10, [{ layerId: 'L1', formationId: 'SAND', top: 0, base: 10 }]),
        column('t2', 4, [{ layerId: 'L2', formationId: 'SAND', top: 0, base: 4 }]),
      ],
      geotech: [
        column('t1', 10, [
          { layerId: 'g1', formationId: 'n6', top: 0, base: 3 },
          { layerId: 'g2', formationId: 'n7', top: 3, base: 10 },
        ]),
        column('t2', 4, [{ layerId: 'g3', formationId: farClass, top: 0, base: 4 }]),
      ],
      regions: [
        quad('n6', ['g1'], 0, 1, 10, 2),
        quad('n7', ['g2'], 0, 0.5, 7, 0),
        quad(farClass, ['g3'], 0.5, 1, 4, 0),
      ],
      preMerge: [
        loop('construct', 'n6', ['g1'], 0, 1, 10, 2),
        loop('construct', 'n7', ['g2'], 0, 0.5, 7, 0),
        loop('construct', farClass, ['g3'], 0.5, 1, 4, 0),
      ],
    })

  it('CWA3 — a construct riding its welded cover edge stays inside its envelope', () => {
    // The band is 10.00..7.00 and its loop reaches down to +2.00 — 1.95 m below
    // the flat-level cap. It is lawful because the boundary it follows lands at
    // +4.00 on the facing test, and a ridden line is part of the envelope
    // exactly as a packing tie's line is.
    expect(auditPartition('DIP-WELD', dipScene('n6'), RAW_CLASSES)).toEqual([])
  })

  it('CWA4 — STRICTNESS: the identical loop without the weld is still a balloon', () => {
    // One field changes again. With no weld there is no ridden line, the
    // envelope falls back to the band's own extent plus the slack, and the same
    // 8 m loop under a 3 m band is the balloon family this gate was written for.
    const violations = auditPartition('DIP-NO-WELD', dipScene('n9'), RAW_CLASSES)
    expect(violations.map((v) => v.kind)).toEqual(['balloon'])
    expect(violations[0].detail).toContain('region 2.00..10.00 vs envelope 3.95..13.05')
  })

  // THE COVER RING, not the chord. Both tests carry the same sand at the BASE of
  // one cover, so the deep band welds there — and a welded contact draws no line
  // of its own, it defers to the cover ring the arrangement already carries. The
  // ring's base KINKS to −4 at mid-gap while the straight chord between its two
  // ends reads +2 there, so a face following the ring sits 6 m below the chord.
  // This is CS1 gap 11 in miniature.
  const kinkScene = (floor: number): AuditBundle =>
    scene({
      litho: [
        column('t1', 10, [{ layerId: 'L1', formationId: 'SAND', top: 0, base: 10 }]),
        column('t2', 10, [{ layerId: 'L2', formationId: 'SAND', top: 0, base: 6 }]),
      ],
      cover: [
        { fraction: 0, elevation: 10 },
        { fraction: 1, elevation: 10 },
        { fraction: 1, elevation: 4 },
        { fraction: 0.5, elevation: -4 },
        { fraction: 0, elevation: 0 },
      ],
      geotech: [
        column('t1', 10, [
          { layerId: 'gTop1', formationId: 'n5', top: 0, base: 8 },
          { layerId: 'gDeep1', formationId: 'n6', top: 8, base: 10 },
        ]),
        column('t2', 10, [
          { layerId: 'gTop2', formationId: 'n5', top: 0, base: 2 },
          { layerId: 'gDeep2', formationId: 'n6', top: 2, base: 6 },
        ]),
      ],
      regions: [
        quad('n5', ['gTop1'], 0, 0.5, 10, 2),
        quad('n5', ['gTop2'], 0.5, 1, 10, 8),
        quad('n6', ['gDeep1', 'gDeep2'], 0, 1, 2, floor),
      ],
      preMerge: [
        loop('construct', 'n5', ['gTop1'], 0, 0.5, 10, 2),
        loop('construct', 'n5', ['gTop2'], 0.5, 1, 10, 8),
        loop('construct', 'n6', ['gDeep1'], 0, 1, 2, floor),
      ],
    })

  it('CWA5 — a welded band may follow the cover RING down past the straight chord', () => {
    // Chord at mid-gap: +2.00. Cover ring at mid-gap: −4.00. The face reaches
    // −4.00, which the chord alone would call a balloon on a 2 m band.
    expect(auditPartition('KINK-RING', kinkScene(-4), RAW_CLASSES)).toEqual([])
  })

  it('CWA6 — STRICTNESS: a loop below the cover ring itself is still a balloon', () => {
    // The relaxation is the ring and nothing beyond it: 3 m below the cover's
    // own floor is past the slack and still reported.
    const violations = auditPartition('KINK-BELOW-RING', kinkScene(-7), RAW_CLASSES)
    expect(violations.map((v) => v.kind)).toEqual(['balloon'])
    expect(violations[0].detail).toContain('region -7.00..2.00 vs envelope -6.05..')
  })

  it('CWA7 — STRICTNESS: a TOP-riding weld does not open the band’s floor', () => {
    // The cover ring widens the RIDDEN SIDE and no other. This 2 m crust welds
    // its TOP to the facing crust, and the cover it belongs to runs 20 m deep;
    // its loop dipping 4 m below its own base is still a balloon, because
    // nothing it rides says anything about where its base may go. Drop the side
    // scoping and the whole 20 m cover becomes its allowance.
    const crust = scene({
      litho: [
        column('t1', 10, [{ layerId: 'L1', formationId: 'SAND', top: 0, base: 20 }]),
        column('t2', 10, [{ layerId: 'L2', formationId: 'SAND', top: 0, base: 20 }]),
      ],
      geotech: [
        column('t1', 10, [
          { layerId: 'cA', formationId: 'n6', top: 0, base: 2 },
          { layerId: 'dA', formationId: 'n7', top: 2, base: 20 },
        ]),
        column('t2', 10, [
          { layerId: 'cB', formationId: 'n6', top: 0, base: 2 },
          { layerId: 'dB', formationId: 'n8', top: 2, base: 20 },
        ]),
      ],
      regions: [
        quad('n6', ['cA', 'cB'], 0, 1, 10, 4),
        quad('n7', ['dA'], 0, 0.5, 8, -10),
        quad('n8', ['dB'], 0.5, 1, 8, -10),
      ],
      preMerge: [
        loop('construct', 'n6', ['cA'], 0, 1, 10, 4),
        loop('construct', 'n6', ['cB'], 0.5, 1, 10, 8),
        loop('construct', 'n7', ['dA'], 0, 0.5, 8, -10),
        loop('construct', 'n8', ['dB'], 0.5, 1, 8, -10),
      ],
    })
    const violations = auditPartition('TOP-RIDE', crust, RAW_CLASSES)
    expect(violations.map((v) => v.kind)).toEqual(['balloon'])
    expect(violations[0].detail).toContain('region 4.00..10.00 vs envelope 5.95..12.05')
  })
})

describe('the 2/1/0 oracle exempts the least-dense leftover', () => {
  // Owner, 2026-08-26: *"if 2 lenses are pointed to eachother and there is
  // nothing else to fill the gap, no open band above or below, then you fill
  // with the lowest density"*. The ground between the two bands is ladder-
  // declined leftover; ``resolveLeftovers`` — the engine's own module, asked
  // here rather than second-guessed — hands it to the LEAST DENSE mass that
  // bounds it, and ``fillGap`` stamps it ``role: 'fill'``.
  const upper = { fraction: 0, elevation: 10 }
  const rings = [
    // the top sand's own loop (n6, the least dense of the two walls)
    [upper, { fraction: 1, elevation: 10 }, { fraction: 1, elevation: 7 }, { fraction: 0, elevation: 7 }],
    // the deep sand's own loop (n7)
    [
      { fraction: 0, elevation: 3 },
      { fraction: 1, elevation: 3 },
      { fraction: 1, elevation: 0 },
      { fraction: 0, elevation: 0 },
    ],
    // the leftover between them, walled by both
    [
      { fraction: 0, elevation: 7 },
      { fraction: 1, elevation: 7 },
      { fraction: 1, elevation: 3 },
      { fraction: 0, elevation: 3 },
    ],
  ]
  const owners = resolveLeftovers([
    { key: 'SAND|n6', rank: 6, ring: rings[0] },
    { key: 'SAND|n7', rank: 7, ring: rings[1] },
    { key: null, rank: null, ring: rings[2] },
  ])

  it('LD-OWNER — the leftover takes the least dense mass that walls it', () => {
    // The pin's own premise, asserted rather than assumed: without this the two
    // pins below would be testing a ring nobody owns.
    expect(owners[2]).toBe(0)
  })

  const leftoverScene = (role: 'construct' | 'fill'): AuditBundle =>
    scene({
      litho: [
        column('t1', 10, [{ layerId: 'L1', formationId: 'SAND', top: 0, base: 10 }]),
        column('t2', 10, [{ layerId: 'L2', formationId: 'SAND', top: 0, base: 10 }]),
      ],
      geotech: [
        column('t1', 10, [
          { layerId: 'g1', formationId: 'n6', top: 0, base: 3 },
          { layerId: 'g2', formationId: 'n7', top: 7, base: 10 },
        ]),
        column('t2', 10, [{ layerId: 'gX', formationId: 'n9', top: 0, base: 10 }]),
      ],
      regions: [
        quad('n6', ['g1'], 0, 0.5, 10, 7),
        quad('n7', ['g2'], 0, 0.5, 3, 0),
        quad('n9', ['gX'], 0.5, 1, 10, 0),
      ],
      preMerge: [
        loop('construct', 'n6', ['g1'], 0, 0.5, 10, 7),
        loop('construct', 'n7', ['g2'], 0, 0.5, 3, 0),
        loop('construct', 'n9', ['gX'], 0.5, 1, 10, 0),
        // The leftover, owned by g1 per ``resolveLeftovers`` above: it spans the
        // whole gap and reaches 4 m below its owner's base.
        loop(role, 'n6', ['g1'], 0, 1, 7, 3),
      ],
    })

  it('LDA1 — leftover ground carries no pinch demand', () => {
    // Ownership, not a shape the law drew. ``fillGap`` can only ever stamp it
    // ``'fill'`` (``answeredByConstruct`` is set by ``constructOwner`` alone),
    // and both pinch demands read construct loops only.
    expect(auditPartition('LEFTOVER', leftoverScene('fill'), RAW_CLASSES)).toEqual([])
  })

  it('LDA2 — STRICTNESS: the identical ring as a CONSTRUCT is still reported twice', () => {
    // One field changes: the role. The exemption is the role tag and nothing
    // else — a construct loop of that shape is both a balloon and an overreach,
    // which is what the audit must keep saying about any shape the law DID draw.
    const kinds = auditPartition('LEFTOVER-AS-CONSTRUCT', leftoverScene('construct'), RAW_CLASSES)
      .map((v) => v.kind)
      .sort()
    expect(kinds).toEqual(['balloon', 'overreach'])
  })
})
