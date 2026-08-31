/**
 * partitionFillV2.gap0HostSplit.test.ts — the owner-pinned CS1 gap0 acceptance gate for the
 * INTERBED HOST-SPLIT (rulings 8a / 8l / 8m / 8j; design partition-engine-v2.md §8, REWRITE_STATE
 * §29). Real-data, flag-ON.
 *
 * THE OWNER FINDING (§29, first FILL dogfeed 2026-07-18, traced in rule vocabulary): CS1 gap0
 * (leftmost gap) carries a same-formation ZAND SANDWICH on col0 (ZAND / SILT / ZAND around
 * el 1.73..3.52) that the enclosed-lens merge collapses into one ZAND host with the SILT as an
 * interior lens — so the enclosing flood floods the whole host full-width by ZAND and the SILT
 * band's interior reads SAND.
 *
 * THE OWNER-EXPECTED SHAPE (rulings 8a/8l/8m/8j — decoded, NOT re-derived):
 *   - The ``2.27<->2.87`` tie ties the two facing ZAND TOPS; that surface is ALSO each SILT unit's
 *     BASE (col0 SILT base 2.27 = ZAND top 2.27; col1 SILT base 2.87 = ZAND top 2.87). Per ruling
 *     8a a tie on the shared contact ties BOTH units sharing that surface → each SILT is base-tied
 *     → corr 1. Per ruling 8m (follow-the-tie) each SILT samples the facing column above its base
 *     tie → SILT on both sides → SAME litho → NO onlap flank; the fill flows through and ruling 8j
 *     ``mergeTouchingBodies`` WELDS the two silt regions into ONE emergent band (8l: bands are
 *     emergent, never promoted). => ONE SILT band [2.27..3.07]<->[2.87..3.79] spanning the gap.
 *   - The ``3.52<->3.79`` tie ties col0 ZAND top <-> col1 SILT top (cross-litho). The col0 ZAND
 *     piece [3.07..3.52] is corr 1 via that top tie; follow it → facing below 3.79 is col1 SILT →
 *     DIFFERENT → the ZAND ONLAPS into the silt band (one-line flank, apex 0.5, ZAND-labelled).
 *   - The ZAND band sits BELOW the ``2.27<->2.87`` tie.
 *
 * THE CURRENT WRONG SHAPE (this gate is RED against it): SILT as a tiny interior lens [2.27..3.07]
 * + a ZAND full-width quad [0.71..3.52] flooding the silt-band interior with SAND. The three
 * assertions below pin the acceptance shape and each fails on the current merge-floods-full-width
 * engine:
 *   (A) SILT BAND — at mid-gap the silt-band interior elevation is SILT-covered (the band exists
 *       across the gap width, not a lens hugging one column).
 *   (B) ZAND ONLAP WEDGE — a ZAND region exists at the upper-left onlap elevation [3.07..3.52]
 *       with BOUNDED reach (an onlap/lens, NOT a full-width band).
 *   (C) NO ZAND FLOOD OF THE SILT INTERIOR — at mid-gap the silt-band interior elevation is NOT
 *       ZAND-covered (the ``d1bc quad [0.71..3.52]`` full-width leak is gone).
 *
 * Gate: real-data, flag-ON. Skips cleanly if the diag input is absent.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { type CorrelationEdge, type PartitionColumn, type PartitionPoint } from './sectionPartition'
import { type SectionRegion } from './sectionPartition'
import { computeSectionFillV2 } from './partitionFillV2'
import { setTwoSidedTerminations } from './partitionFillV2/tileFlags'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const INPUT = resolve(REPO_ROOT, 'scripts/diag_allsections_input.json')

// Formation ids from the real CS1 gap0 extraction (diag_allsections_input.json), owner-traced.
const SILT = '019e940a-4b4e-7806-aa41-5831b60f2e06'
const ZAND = '019e940a-4b41-7e01-a763-ab030a38d1bc'

// The silt band's shared interior: col0 SILT [2.27..3.07] ∩ col1 SILT [2.87..3.79] = [2.87..3.07].
// Sample its middle (2.97) at mid-gap fraction 0.5 — inside the band on BOTH columns.
const SILT_INTERIOR_ELEV = 2.97
// The upper-left onlap zone: col0 ZAND piece [3.07..3.52].
const ONLAP_ELEV_LO = 3.1
const ONLAP_ELEV_HI = 3.5

interface RawUnit { layerId: string; topDepthM: number; baseDepthM: number; formationId: string; bodyId: string | null }
interface RawCol { investigationId: string; surfaceElevM: number | null; units: RawUnit[] }
interface RawSection { sectionId: string; name: string; columns: RawCol[]; alongM: number[]; edges: { a: string; b: string; aSide?: string; bSide?: string }[] }

/** Does a simple polygon contain the point (f, e)? Ray-cast in fraction×elevation space. */
function polyContains(poly: readonly PartitionPoint[], f: number, e: number): boolean {
  let inside = false
  const n = poly.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i].fraction, yi = poly[i].elevation
    const xj = poly[j].fraction, yj = poly[j].elevation
    if ((yi > e) !== (yj > e)) {
      const xCross = xi + ((e - yi) / (yj - yi)) * (xj - xi)
      if (f < xCross) inside = !inside
    }
  }
  return inside
}

/** The fraction span [min..max] a region's polygon covers (its lateral reach). */
function fracSpan(r: SectionRegion): [number, number] {
  const fs = r.polygon.map((p) => p.fraction)
  return [Math.min(...fs), Math.max(...fs)]
}

afterEach(() => setTwoSidedTerminations(false))

describe('CS1 gap0 host-split (rulings 8a/8l/8m/8j) — the owner-pinned acceptance case', () => {
  const has = existsSync(INPUT)
  ;(has ? describe : describe.skip)('real CS1 gap0', () => {
    let g0: SectionRegion[] = []
    {
      const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as { sections: RawSection[] }
      const sec = raw.sections.find((s) => s.name === 'Cross-section 1')!
      const keep = sec.columns
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => c.surfaceElevM != null && c.units.length > 0)
      const columns: PartitionColumn[] = keep.map(({ c }) => ({
        investigationId: c.investigationId,
        surfaceElevM: c.surfaceElevM as number,
        units: c.units,
      }))
      const alongM = keep.map(({ i }) => sec.alongM[i])
      const edges: CorrelationEdge[] = sec.edges.map((e) => ({
        a: e.a,
        b: e.b,
        aSide: (e.aSide ?? 'top') as 'top' | 'base',
        bSide: (e.bSide ?? 'top') as 'top' | 'base',
      }))
      const prev = setTwoSidedTerminations(true)
      try {
        g0 = computeSectionFillV2(columns, edges, undefined, alongM).filter((r) => r.gapIndex === 0)
      } finally {
        setTwoSidedTerminations(prev)
      }
    }

    it('(A) the SILT band spans the gap: mid-gap silt-interior elevation is SILT-covered', () => {
      // At fraction 0.5, elevation 2.97 (inside the silt band on both columns) some SILT region
      // covers the point — the two base-tied silts merged into one band flowing across the gap.
      const siltCovers = g0.some(
        (r) => r.formationId === SILT && polyContains(r.polygon, 0.5, SILT_INTERIOR_ELEV),
      )
      expect(siltCovers, 'SILT band covers mid-gap silt interior (2.97 @ f=0.5)').toBe(true)
    })

    it('(C) NO ZAND floods the silt-band interior at mid-gap', () => {
      // The current wrong shape has a ZAND full-width quad [0.71..3.52] covering 2.97 @ f=0.5.
      // The correct shape has the ZAND band BELOW 2.27 — nothing ZAND at the silt interior.
      const zandCovers = g0.some(
        (r) => r.formationId === ZAND && polyContains(r.polygon, 0.5, SILT_INTERIOR_ELEV),
      )
      expect(zandCovers, 'ZAND must NOT cover mid-gap silt interior (no full-width ZAND flood)').toBe(false)
    })

    // (B) THE ZAND ONLAP WEDGE — the §29 "label-correctness is only HALF" refinement. col0's upper
    // ZAND [3.07..3.52] onlaps into the silt band (apex 0.5, ZAND-labelled) rather than being absorbed
    // into the SILT band. SESSION-28 (ruling 8n): FIXED by the ``intersect.ts`` NEAR-COLLINEAR
    // T-JUNCTION snap (``nearInteriorT`` / ``T_JUNCTION_PERP_TOL``, flag-ON only). The sweep DOES emit
    // the ZAND onlap flank (``oflankterm0``, corr-1 top-tied); its apex is COMPUTED exactly on the
    // ``3.52<->3.79`` tie (coincident with the bandc base contour) in floating point, but the endpoint's
    // x and y snap INDEPENDENTLY to the 1 mm grid and a sloped line rarely passes through a lattice
    // point — the snapped apex landed 1.8 µm off the snapped tie's integer supporting line
    // (integer-cross = −135), so the exact-``cross===0`` collinear test missed the T-junction and the
    // flank dead-ended as a stripped spur → the ZAND triangle never closed. The 1-grid-unit
    // perpendicular tolerance snaps the apex ONTO the tie as a shared split vertex, closing the onlap
    // face. Measured: flag-ON holes 20/0 (all CS2-g17 baseline, ZERO new), overlaps 0. See
    // REWRITE_STATE §33.
    it('(B) a ZAND onlap wedge exists in the upper-left with bounded reach (intersect.ts near-T split)', () => {
      // col0 ZAND [3.07..3.52] onlaps the silt band riding the 3.52<->3.79 tie: a ZAND region
      // present in the onlap elevation zone AND NOT spanning the full gap width (bounded reach).
      const zandOnlaps = g0.filter((r) => {
        if (r.formationId !== ZAND) return false
        const [eLo, eHi] = [
          Math.min(...r.polygon.map((p) => p.elevation)),
          Math.max(...r.polygon.map((p) => p.elevation)),
        ]
        // Overlaps the onlap elevation zone.
        return eHi > ONLAP_ELEV_LO && eLo < ONLAP_ELEV_HI
      })
      expect(zandOnlaps.length, 'a ZAND region exists in the onlap zone [3.07..3.52]').toBeGreaterThan(0)
      // Bounded reach: at least one such ZAND region does NOT span the full width (an onlap/lens,
      // not a full-width band flooding the interval).
      const bounded = zandOnlaps.some((r) => {
        const [fLo, fHi] = fracSpan(r)
        return fHi - fLo < 0.9
      })
      expect(bounded, 'the ZAND onlap wedge has bounded lateral reach (< full width)').toBe(true)
    })
  })
})
