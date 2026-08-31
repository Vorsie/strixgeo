/**
 * flushSideGrabConfined.rules.test.ts — §113 acceptance gate: a FLUSH-side grab of the clay
 * contact (LEFT of the sand onlap's pinch) bends the clay LOCALLY and leaves the onlap PUT; only a
 * grab on the ONLAP's side of the pinch rides the onlap (S110/S112 preserved).
 *
 * Owner dogfeed 2026-07-25 (confirmed live on real CS1 gap-4 via an in-app click diagnostic): the
 * owner grabs the ``934a78|6bb744`` clay contact WELL LEFT of the sand ``029c52`` pinch — the flush
 * part of the contact, no sand there — intending a local clay-contact reshape. Instead the SAND
 * reshapes and the clay does not. Root cause: ``resolveOnlapInterveningGrab`` /
 * ``routeGrabbedBoundary`` decided "onlap-intervening" from ELEVATION ONLY — never the click's
 * along-x / gap fraction. So a grab ANYWHERE on the contact fired the onlap-ride path as long as
 * the sand existed on the far column. The §112 heterogeneous bend then produced a SINGLE whole-gap
 * apex, so the onlap (reading the bent clay-base line at its own pinch fraction) rode it everywhere
 * — the sand spilled back across its pinch to the flush side.
 *
 * The spec (``docs/design/freedraw-onlap-lens-edit-model.md`` → "Onlap rides along —
 * SEGMENT-CONFINED"): the contact is a polyline ``tie → (markers) → tie``; a control point / an
 * onlap's pinch is a WALL the reshape cannot cross. A grab in the FLUSH segment (left of the pinch)
 * bends the clay LOCALLY within that segment and leaves the onlap alone; the onlap-intervening ride
 * fires ONLY when the grab is on the onlap's side of the pinch.
 *
 * Gated ``CS1_GATE=1`` (real ``scripts/diag_allsections_input.json``); skips in the normal suite.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  type CorrelationEdge,
  type LensApexOverride,
  type PartitionColumn,
  type SectionRegion,
} from '../../utils/sectionPartition'
import { computeSectionFillV2 } from '../../utils/partitionFillV2'
import { setTwoSidedTerminations } from '../../utils/partitionFillV2/tileFlags'
import { buildApexOverridesForGaps } from './apexOverrideWiring'
import { routeGrabbedBoundary } from './correlateOnDrag'

const RUN = process.env.CS1_GATE === '1'
const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../../..')
const INPUT = resolve(REPO_ROOT, 'scripts/diag_allsections_input.json')

// Real CS1 gap-4 body ids (verbatim from the diag input; the owner-live grab).
const CLAY = '019ea170-5cef-73c0-9b3a-5894e9934a78' // full-width upper (the grabbed contact's upper)
const MATRIX = '019ea170-5ce6-7fc6-aa82-eb27fd6bb744' // full-width lower
const ONLAP = '019ea42e-1b7e-7f52-a546-f3d097029c52' // sand onlap — pinches in on col5 (the RIGHT column)

/** The CS1 kept section + the gap index of the col4→col5 gap (the owner-live gap-4). */
function realCs1(): {
  columns: PartitionColumn[]
  edges: CorrelationEdge[]
  alongM: number[]
  gap: number
} {
  const raw = JSON.parse(readFileSync(INPUT, 'utf8'))
  const sec = raw.sections.find((s: { name: string }) => s.name === 'Cross-section 1')
  const keep = sec.columns
    .map((c: { surfaceElevM: number | null; units: unknown[] }, i: number) => ({ c, i }))
    .filter(
      ({ c }: { c: { surfaceElevM: number | null; units: unknown[] } }) =>
        c.surfaceElevM != null && c.units.length > 0,
    )
  const columns: PartitionColumn[] = keep.map(({ c }: { c: PartitionColumn }) => ({
    investigationId: c.investigationId,
    surfaceElevM: c.surfaceElevM,
    units: c.units,
  }))
  const alongM = keep.map(({ i }: { i: number }) => sec.alongM[i])
  const edges: CorrelationEdge[] = sec.edges.map(
    (e: { a: string; b: string; aSide?: string; bSide?: string }) => ({
      a: e.a,
      b: e.b,
      aSide: (e.aSide ?? 'top') as 'top' | 'base',
      bSide: (e.bSide ?? 'top') as 'top' | 'base',
    }),
  )
  const gap = keep.findIndex(({ i }: { i: number }) => i === 4)
  return { columns, edges, alongM, gap }
}

/** The onlap's region polygon in the given gap, as a stable stringified signature. */
function onlapSig(regions: SectionRegion[], gap: number): string {
  return regions
    .filter((r) => r.bodyId === ONLAP && r.gapIndex === gap)
    .map((r) => r.polygon.map((p) => `${p.fraction.toFixed(3)},${p.elevation.toFixed(3)}`).join(';'))
    .sort()
    .join('#')
}

/** The clay's region polygon in the given gap, signature. */
function claySig(regions: SectionRegion[], gap: number): string {
  return regions
    .filter((r) => r.bodyId === CLAY && r.gapIndex === gap)
    .map((r) => r.polygon.map((p) => `${p.fraction.toFixed(3)},${p.elevation.toFixed(3)}`).join(';'))
    .sort()
    .join('#')
}

/**
 * Build the engine override map for a boundaryDrag on the CLAY|MATRIX contact at the given gap
 * fraction + cursor elevation — the exact path ``PartitionFillOverlay.sectionFillData`` uses.
 */
function overridesForGrab(
  columns: PartitionColumn[],
  alongM: number[],
  gap: number,
  fraction: number,
  cursorElev: number,
): Map<string, LensApexOverride> {
  const leftX = alongM[gap]
  const rightX = alongM[gap + 1]
  const alongToScreenX = (a: number): number => a
  const screenToLevel = (y: number): number => -y
  const gapXs = alongM.slice(0, -1).map((_, i) => ({ leftX: alongM[i], rightX: alongM[i + 1] }))
  const cursorX = leftX + fraction * (rightX - leftX)
  const { apexOverrides } = buildApexOverridesForGaps({
    orderedColumns: columns,
    gapXs,
    boundariesByBodyId: new Map(),
    alongToScreenX,
    screenToLevel,
    lensDrag: null,
    boundaryDrag: {
      upperBodyId: CLAY,
      lowerBodyId: MATRIX,
      nodeIndex: 0,
      x: cursorX,
      y: -cursorElev,
      leftX,
      rightX,
      isNew: true,
    },
  })
  return apexOverrides
}

describe.skipIf(!RUN)('§113 — flush-side grab bends the clay locally, the onlap is a WALL', () => {
  // The sand onlap 029c52 pinches from col5 (RIGHT) toward col4 (LEFT); its pinch/apex sits at gap
  // fraction 0.5 (INTERIOR_PINCH_FRACTION). Flush side = [0, 0.5); onlap side = (0.5, 1].
  const FLUSH_FRACTION = 0.2 // well LEFT of the pinch — the flush part of the contact (no sand there)
  const ONLAP_SIDE_FRACTION = 0.8 // on the onlap's side of the pinch (S110/S112 must still ride)

  it('(a) a FLUSH-side clay-contact grab does NOT route onlap-intervening (position-aware)', () => {
    const { columns, alongM, gap } = realCs1()
    const left = columns[gap]
    const right = columns[gap + 1]
    // The clay base grab elevation on the grab column (col4 clay base ~5.21).
    const clayBaseElev = 5.21
    const route = routeGrabbedBoundary(left, right, CLAY, MATRIX, clayBaseElev, FLUSH_FRACTION)
    expect(
      route.kind,
      `a flush-side grab (fraction ${FLUSH_FRACTION}, left of the sand pinch) must NOT route ` +
        `onlap-intervening — the sand is a wall, not a rider`,
    ).not.toBe('onlap-intervening')
  })

  it('(b) after a FLUSH-side reshape, the sand onlap region is UNCHANGED (the onlap is a wall)', () => {
    setTwoSidedTerminations(true)
    try {
      const { columns, edges, alongM, gap } = realCs1()
      const base = computeSectionFillV2(columns, edges, undefined, alongM)
      const onlapBefore = onlapSig(base, gap)
      // A flush-side clay grab dragged UP (el 8.5) — well above the flush contact, left of the pinch.
      const ov = overridesForGrab(columns, alongM, gap, FLUSH_FRACTION, 8.5)
      const after = computeSectionFillV2(columns, edges, ov, alongM)
      const onlapAfter = onlapSig(after, gap)
      expect(
        onlapAfter,
        `the sand onlap must not move when the clay is grabbed on the flush side ` +
          `(before=${onlapBefore} after=${onlapAfter})`,
      ).toBe(onlapBefore)
    } finally {
      setTwoSidedTerminations(false)
    }
  })

  it('(c) after a FLUSH-side reshape, the clay contact DOES bend at the click point', () => {
    setTwoSidedTerminations(true)
    try {
      const { columns, edges, alongM, gap } = realCs1()
      const base = computeSectionFillV2(columns, edges, undefined, alongM)
      const clayBefore = claySig(base, gap)
      const ov = overridesForGrab(columns, alongM, gap, FLUSH_FRACTION, 8.5)
      const after = computeSectionFillV2(columns, edges, ov, alongM)
      const clayAfter = claySig(after, gap)
      expect(clayAfter, 'the clay contact must reshape (the grabbed contact bends)').not.toBe(clayBefore)
    } finally {
      setTwoSidedTerminations(false)
    }
  })

  it('(d) an ONLAP-SIDE grab STILL routes onlap-intervening and the onlap RIDES (S110/S112 preserved)', () => {
    setTwoSidedTerminations(true)
    try {
      const { columns, edges, alongM, gap } = realCs1()
      const left = columns[gap]
      const right = columns[gap + 1]
      const route = routeGrabbedBoundary(left, right, CLAY, MATRIX, 5.21, ONLAP_SIDE_FRACTION)
      expect(
        route.kind,
        'a grab on the onlap side of the pinch still routes onlap-intervening',
      ).toBe('onlap-intervening')

      // And the onlap must actually ride (its region moves) for an onlap-side drag.
      const base = computeSectionFillV2(columns, edges, undefined, alongM)
      const onlapBefore = onlapSig(base, gap)
      const ov = overridesForGrab(columns, alongM, gap, ONLAP_SIDE_FRACTION, 8.5)
      const after = computeSectionFillV2(columns, edges, ov, alongM)
      const onlapAfter = onlapSig(after, gap)
      expect(onlapAfter, 'the onlap rides an onlap-side drag').not.toBe(onlapBefore)
    } finally {
      setTwoSidedTerminations(false)
    }
  })
})
