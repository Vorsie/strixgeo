/**
 * clayBaseFollowsCursorHeterogeneous.rules.test.ts — the RED acceptance gate for the owner's
 * dogfeed "i'm grabbing the boundary of the clay and it doesn't follow my cursor — the sand
 * disappears / the clay vanishes / the wrong thing moves" (CS1 gap-4), the HETEROGENEOUS-BELOW case
 * the locked spec ``docs/design/freedraw-onlap-lens-edit-model.md`` ("ANY BOUNDARY BENDS TO THE
 * CURSOR, gap-free, onlap rides along") does NOT yet satisfy on real data.
 *
 * THE RULE, in the owner's words: "the boundary i grab follows my cursor." When the owner grabs the
 * CLAY's lower boundary and drags it, the CLAY BODY'S OWN base contour must bend to the cursor while
 * the MATRIX beneath the intervening onlap STAYS PUT. The matrix top is NOT the thing the owner
 * grabbed and must NOT move.
 *
 * WHY THIS IS RED TODAY (proven by ``throwaway_cs1_gap4_tie_dump.diag.test.ts`` +
 * ``throwaway_cs1_clay_flood_probe.diag.test.ts``): the clay's base is a HETEROGENEOUS, only-PARTLY-
 * tied line. On CS1 gap-4 the clay ``934a78`` sits on the matrix ``6bb744`` on the LEFT column
 * (clay-base = matrix-top = el 5.21) but on the sand onlap ``029c52`` on the RIGHT column (clay-base
 * = onlap-top = el 6.44). There is NO correlation tie along the clay base line (5.21 → 6.44). The
 * only tie near it is ``tie35`` at 5.21 → 5.73 — the MATRIX TOP (the left clay-base/matrix-top
 * junction ∩ the right onlap-base/matrix-top junction). The app keys ``contact:clay|matrix``; the
 * engine's ``collectContactBends`` matches that key against ``tie35`` (the clay is in the tie's
 * base-candidate set only because clay-base == matrix-top on the LEFT column). So the ONE bent line
 * is the MATRIX TOP, welded to the clay base — bending it drags the matrix top to the cursor in
 * lock-step (measured: matrix-top mid-gap vertex = 4.00 when dragged to el 4, = 7.50 when dragged to
 * el 7.5). Bending UP raises the matrix into the clay → the clay pinches/vanishes (the dogfeed).
 *
 * The pre-existing S110/S111 gate (``onlapInterveningGrabRoutes.rules.test.ts``) drives the ENGINE
 * bend on a SYNTHETIC section whose clay base is FLUSH (el 5 on both columns) and whose onlap laps
 * that flush line — there the bend lands on the clay base and the test is GREEN. It does NOT exercise
 * the real non-flush, heterogeneous-below clay base. THIS gate uses the REAL CS1 fixture (CS1_GATE)
 * so it goes RED where the synthetic passes — the test-after trap the project lessons warn about (a
 * synthetic that encodes the impl shape, not the owner's spec).
 *
 * THE DISCRIMINATOR (RED in BOTH directions): the MATRIX TOP must NOT track the clay-base cursor.
 * Today it does (welded to the same bent tie) → RED. The clay base must move as its OWN contour and
 * the matrix top must hold beneath the onlap.
 *
 * Gated ``CS1_GATE=1`` (real ``scripts/diag_allsections_input.json``); skips in the normal suite.
 * This is an ACCEPTANCE gate — RED on today's engine, GREEN when "grab the clay base → the clay's
 * own base contour follows the cursor, the matrix stays put, gap-free" lands.
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
import { contactApexOverrideKey } from '../../utils/partitionFillV2/contactOverride'
import { setTwoSidedTerminations } from '../../utils/partitionFillV2/tileFlags'

const RUN = process.env.CS1_GATE === '1'
const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../../..')
const INPUT = resolve(REPO_ROOT, 'scripts/diag_allsections_input.json')

/** Build the real CS1 section from the all-sections diag input (drops empty columns; real alongM). */
function realSection(name: string): { columns: PartitionColumn[]; edges: CorrelationEdge[]; alongM: number[] } {
  const raw = JSON.parse(readFileSync(INPUT, 'utf8'))
  const sec = raw.sections.find((s: { name: string }) => s.name === name)
  if (!sec) throw new Error(`section ${name} not in diag input`)
  const keep = sec.columns
    .map((c: { surfaceElevM: number | null; units: unknown[] }, i: number) => ({ c, i }))
    .filter(({ c }: { c: { surfaceElevM: number | null; units: unknown[] } }) => c.surfaceElevM != null && c.units.length > 0)
  const columns: PartitionColumn[] = keep.map(({ c }: { c: { investigationId: string; surfaceElevM: number; units: unknown[] } }) => ({
    investigationId: c.investigationId,
    surfaceElevM: c.surfaceElevM,
    units: c.units as PartitionColumn['units'],
  }))
  const alongM = keep.map(({ i }: { i: number }) => sec.alongM[i])
  const edges: CorrelationEdge[] = sec.edges.map((e: { a: string; b: string; aSide?: string; bSide?: string }) => ({
    a: e.a,
    b: e.b,
    aSide: (e.aSide ?? 'top') as 'top' | 'base',
    bSide: (e.bSide ?? 'top') as 'top' | 'base',
  }))
  return { columns, edges, alongM }
}

// The three CS1 gap-4 bodies (full ids; the fixture carries the whole UUID).
const GAP = 4
const CLAY = '019ea170-5cef-73c0-9b3a-5894e9934a78' // the grabbed band — full-width upper
const MATRIX = '019ea170-5ce6-7fc6-aa82-eb27fd6bb744' // full-width lower, on the LEFT column
const ONLAP = '019ea42e-1b7e-7f52-a546-f3d097029c52' // the sand onlap, intervening on the RIGHT column

/** Regions of a body in the gap. */
function bodyRegions(regions: SectionRegion[], bodyId: string): SectionRegion[] {
  return regions.filter((r) => r.bodyId === bodyId && r.gapIndex === GAP)
}

/** The highest MID-GAP (interior, 0.02<f<0.98) vertex of a body — its top contour where it bends. */
function midGapTopElev(regions: SectionRegion[], bodyId: string): number | null {
  let max = -Infinity
  for (const r of bodyRegions(regions, bodyId))
    for (const p of r.polygon) if (p.fraction > 0.02 && p.fraction < 0.98 && p.elevation > max) max = p.elevation
  return Number.isFinite(max) ? max : null
}

/** The lowest MID-GAP (interior) vertex of a body — its base contour where it bends toward the cursor. */
function midGapBaseElev(regions: SectionRegion[], bodyId: string): number | null {
  let min = Infinity
  for (const r of bodyRegions(regions, bodyId))
    for (const p of r.polygon) if (p.fraction > 0.02 && p.fraction < 0.98 && p.elevation < min) min = p.elevation
  return Number.isFinite(min) ? min : null
}

/** The apex the drag must bend the clay base toward (mid-gap). Keyed on the app's clay|matrix key. */
function dragClayBase(
  columns: readonly PartitionColumn[],
  edges: readonly CorrelationEdge[],
  alongM: readonly number[],
  cursorEl: number,
): SectionRegion[] {
  const key = contactApexOverrideKey(CLAY, MATRIX, GAP)
  const ov = new Map<string, LensApexOverride>([[key, { fraction: 0.5, elevation: cursorEl } as LensApexOverride]])
  return computeSectionFillV2(columns, edges, ov, alongM)
}

describe.skipIf(!RUN)('ACCEPTANCE (RED today) — grab the clay base on CS1 gap-4 → the CLAY follows the cursor, the MATRIX stays put', () => {
  it('dragging the clay boundary UP raises the CLAY base — the matrix top does NOT ride up into the clay', () => {
    setTwoSidedTerminations(true)
    try {
      const { columns, edges, alongM } = realSection('Cross-section 1')
      const base = computeSectionFillV2(columns, edges, undefined, alongM)
      // Baseline matrix top mid-gap (where the onlap sits above the matrix on the right). The matrix
      // top beneath the onlap is ~5.73; this is the reference it must HOLD.
      const matrixTop0 = midGapTopElev(base, MATRIX) ?? Math.max(...bodyRegions(base, MATRIX).flatMap((r) => r.polygon.map((p) => p.elevation)))

      // Grab the clay's lower boundary and drag it UP to el 7.5.
      const after = dragClayBase(columns, edges, alongM, 7.5)
      const matrixTopAfter = midGapTopElev(after, MATRIX)
      const clayBaseAfter = midGapBaseElev(after, CLAY)
      expect(clayBaseAfter, 'the clay still has a mid-gap base contour after the drag').not.toBeNull()

      // (1) THE MATRIX MUST NOT MOVE. Today the matrix top rides the same welded bent line up to the
      //     cursor (mid-gap = 7.50) and eats the clay. The matrix top beneath the onlap must HOLD at
      //     its baseline (~5.73), never track the clay-base cursor. RED today.
      expect(
        Math.abs((matrixTopAfter ?? 0) - matrixTop0) < 0.75,
        `the matrix top must NOT ride the clay-base cursor UP (baseline ${matrixTop0.toFixed(2)}, now ${(matrixTopAfter ?? NaN).toFixed(2)})`,
      ).toBe(true)

      // (2) THE CLAY BASE FOLLOWS THE CURSOR: the clay's own base contour bends up toward el 7.5.
      expect(
        Math.abs(clayBaseAfter! - 7.5) < 1.0,
        `the grabbed clay base must follow the cursor UP toward el 7.5 (now ${clayBaseAfter!.toFixed(2)})`,
      ).toBe(true)
    } finally {
      setTwoSidedTerminations(false)
    }
  })

  it('dragging the clay boundary DOWN lowers the CLAY base — the matrix top does NOT ride down with it', () => {
    setTwoSidedTerminations(true)
    try {
      const { columns, edges, alongM } = realSection('Cross-section 1')
      const base = computeSectionFillV2(columns, edges, undefined, alongM)
      const matrixTop0 = midGapTopElev(base, MATRIX) ?? Math.max(...bodyRegions(base, MATRIX).flatMap((r) => r.polygon.map((p) => p.elevation)))

      // Grab the clay's lower boundary and drag it DOWN to el 4.5 (just below the baseline clay base).
      const after = dragClayBase(columns, edges, alongM, 4.5)
      const matrixTopAfter = midGapTopElev(after, MATRIX)
      const clayBaseAfter = midGapBaseElev(after, CLAY)
      expect(clayBaseAfter, 'the clay still has a mid-gap base contour after the drag').not.toBeNull()

      // (1) THE MATRIX MUST NOT MOVE. Today the matrix top rides the welded bent line DOWN to el 4.5
      //     (mid-gap = 4.50) — the matrix top is squeezed at mid-gap when the owner grabbed the CLAY.
      //     The matrix top must hold at its baseline (~5.73), not follow the clay-base cursor. RED today.
      expect(
        Math.abs((matrixTopAfter ?? 0) - matrixTop0) < 0.75,
        `the matrix top must NOT ride the clay-base cursor DOWN (baseline ${matrixTop0.toFixed(2)}, now ${(matrixTopAfter ?? NaN).toFixed(2)})`,
      ).toBe(true)

      // (2) THE CLAY BASE FOLLOWS THE CURSOR DOWN toward el 4.5.
      expect(
        Math.abs(clayBaseAfter! - 4.5) < 1.0,
        `the grabbed clay base must follow the cursor DOWN toward el 4.5 (now ${clayBaseAfter!.toFixed(2)})`,
      ).toBe(true)
    } finally {
      setTwoSidedTerminations(false)
    }
  })

  it('the fill stays a true partition (no gap / no overlap) through the reflow zone below the moved clay', () => {
    setTwoSidedTerminations(true)
    try {
      const { columns, edges, alongM } = realSection('Cross-section 1')
      const after = dragClayBase(columns, edges, alongM, 4.5)

      // Even-odd coverage: exactly one region covers every interior sample through the reflow band
      // (el 3.5 .. 7 — where the clay base, the onlap, and the matrix top all live). Whatever the
      // reflow answer (onlap rides / matrix compresses), the partition must hold — the gap-free half
      // of the owner's spec. This currently PASSES (the welded bend keeps a partition) — it is the
      // regression guard the reflow fix must not break, not the RED signal.
      const g = after.filter((r) => r.gapIndex === GAP)
      const inPoly = (poly: { fraction: number; elevation: number }[], f: number, e: number): boolean => {
        let inside = false
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          const fi = poly[i].fraction
          const ei = poly[i].elevation
          const fj = poly[j].fraction
          const ej = poly[j].elevation
          const hit = ei > e !== ej > e && f < ((fj - fi) * (e - ei)) / (ej - ei) + fi
          if (hit) inside = !inside
        }
        return inside
      }
      for (let ei = 0; ei <= 10; ei++) {
        const e = 3.5 + (7 - 3.5) * (ei / 10)
        for (let fi = 1; fi < 10; fi++) {
          const f = fi / 10
          let cover = 0
          for (const r of g) if (inPoly(r.polygon, f, e)) cover++
          expect(cover, `coverage at f=${f.toFixed(1)} el=${e.toFixed(2)} must be exactly 1 (true partition)`).toBe(1)
        }
      }
    } finally {
      setTwoSidedTerminations(false)
    }
  })
})
