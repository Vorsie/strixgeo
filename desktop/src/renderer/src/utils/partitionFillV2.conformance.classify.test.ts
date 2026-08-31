/**
 * partitionFillV2.conformance.classify.test.ts — unit tests for the CONNECTED-COMPONENT
 * rendered-shape classifier (``renderedShape``) added when hardening the v2 conformance gate
 * (2026-07-16). The classifier is the gate's instrument, not the engine; these tests pin the
 * exact defects the external review flagged:
 *
 *   1. Two DISCONNECTED same-formation side lenses (one hugging the left column, one the right)
 *      must NOT read ``band`` — the aggregate min/max-extent classifier false-GREENed this real
 *      defect. Each lens is its own component; neither spans the gap.
 *   2. A genuine full-width chain (whether one region or several edge-sharing pieces) MUST read
 *      ``band``.
 *   3. A FACING same-formation onlap at the audited unit's elevation must NOT promote the
 *      audited unit's own lens to ``band`` (the Tie-10 gap0 SILT[L] false-POSITIVE class): the
 *      classifier reports the component INCIDENT to the audited unit's own column edge.
 *
 * Synthetic ``SectionRegion`` sets only — no engine call, no I/O. Always runs (no env gate).
 */

import { describe, expect, it } from 'vitest'

import { type PartitionPoint, type SectionRegion } from './sectionPartition'
import { renderedShape } from './partitionFillV2.conformance.classify'

/** Build a SectionRegion from (fraction, elevation) vertex pairs. */
function region(formationId: string, pts: [number, number][], kind: 'quad' | 'pinch' | 'lens' = 'quad'): SectionRegion {
  const polygon: PartitionPoint[] = pts.map(([fraction, elevation]) => ({ fraction, elevation }))
  return { formationId, bodyId: null, kind, polygon, gapIndex: 0 }
}

/** A left-hugging triangle lens over [elevLo,elevHi] reaching to fraction ``reach``. */
function leftLens(fid: string, elevLo: number, elevHi: number, reach: number): SectionRegion {
  return region(fid, [
    [0, elevHi],
    [0, elevLo],
    [reach, (elevLo + elevHi) / 2],
  ], 'lens')
}

/** A right-hugging triangle lens over [elevLo,elevHi] reaching in to fraction ``reach``. */
function rightLens(fid: string, elevLo: number, elevHi: number, reach: number): SectionRegion {
  return region(fid, [
    [1, elevHi],
    [1, elevLo],
    [reach, (elevLo + elevHi) / 2],
  ], 'lens')
}

/** A full-width quad band over [elevLo,elevHi]. */
function fullBand(fid: string, elevLo: number, elevHi: number): SectionRegion {
  return region(fid, [
    [0, elevHi],
    [0, elevLo],
    [1, elevLo],
    [1, elevHi],
  ])
}

describe('renderedShape connected-component classifier', () => {
  it('two disconnected side lenses over the same band do NOT read band (false-green case)', () => {
    // Aggregate min/max extent = [0..1] → the OLD classifier false-GREENed this as a band.
    // Component-wise: two separate lenses, each hugging its own edge, a vacant strip between.
    const band: [number, number] = [3, 4]
    const regs = [
      leftLens('SAND', band[0], band[1], 0.15), // left lens, reaches in to 0.15
      rightLens('SAND', band[0], band[1], 0.85), // right lens, reaches in to 0.85
    ]
    // Audited unit lives on the LEFT column → its incident component is the left lens (onlap).
    const left = renderedShape(regs, 'SAND', band[0], band[1], 'left')
    expect(left.shape).not.toBe('band')
    expect(left.shape).toBe('onlap') // reaches left edge only
    expect(left.reachesLeft).toBe(true)
    expect(left.reachesRight).toBe(false)

    // Audited unit on the RIGHT column → its incident component is the right lens (onlap).
    const right = renderedShape(regs, 'SAND', band[0], band[1], 'right')
    expect(right.shape).not.toBe('band')
    expect(right.shape).toBe('onlap')
    expect(right.reachesRight).toBe(true)
    expect(right.reachesLeft).toBe(false)
  })

  it('a genuine full-width single band reads band', () => {
    const regs = [fullBand('CLAY', 2, 5)]
    const rs = renderedShape(regs, 'CLAY', 2, 5, 'left')
    expect(rs.shape).toBe('band')
    expect(rs.reachesLeft).toBe(true)
    expect(rs.reachesRight).toBe(true)
  })

  it('a full-width chain of several edge-sharing pieces reads band', () => {
    // Two quads meeting at the vertical midpoint seam f=0.5 — one connected full-width face.
    const regs = [
      region('SILT', [
        [0, 5],
        [0, 3],
        [0.5, 3],
        [0.5, 5],
      ]),
      region('SILT', [
        [0.5, 5],
        [0.5, 3],
        [1, 3],
        [1, 5],
      ]),
    ]
    const rs = renderedShape(regs, 'SILT', 3, 5, 'left')
    expect(rs.shape).toBe('band')
    expect(rs.reachesLeft).toBe(true)
    expect(rs.reachesRight).toBe(true)
  })

  it('a facing onlap at the audited elevation does NOT promote the audited unit to band (Tie-10 class)', () => {
    // The audited unit lives on the LEFT and renders as a small left lens (its OWN proper
    // termination). A FACING same-formation onlap on the RIGHT column reaches in past midgap and
    // overlaps the audited unit's elevation band. The OLD aggregate read [0..~0.9] → band → a
    // false-POSITIVE 1corr-not-onlap. The component-wise classifier reports the LEFT-incident
    // component (the audited lens) → onlap.
    const band: [number, number] = [3.57, 4.05]
    const regs = [
      leftLens('SILT', band[0], band[1], 0.05), // audited unit's own tiny left lens
      // facing right onlap spanning a much wider elevation, overlapping the band, reaching to 0.4
      region('SILT', [
        [1, 12],
        [1, 3.55],
        [0.4, 8],
      ], 'lens'),
    ]
    const rs = renderedShape(regs, 'SILT', band[0], band[1], 'left')
    expect(rs.shape).not.toBe('band')
    expect(rs.reachesRight).toBe(false) // the reported (left-incident) component does not reach right
    expect(rs.incident).toBe(true)
  })

  it('reports absent when the formation has no coverage in the band', () => {
    const regs = [fullBand('CLAY', 10, 12)] // wrong elevation
    const rs = renderedShape(regs, 'SAND', 3, 4, 'left')
    expect(rs.shape).toBe('absent')
  })

  it('an all-facing render (nothing on the audited edge) is reported non-incident, not absent', () => {
    // Only a right-column onlap exists; the audited unit lives on the LEFT and has no own render.
    const band: [number, number] = [3, 4]
    const regs = [rightLens('SAND', band[0], band[1], 0.4)]
    const rs = renderedShape(regs, 'SAND', band[0], band[1], 'left')
    expect(rs.shape).not.toBe('absent') // coverage exists in the band
    expect(rs.incident).toBe(false) // but not on the audited (left) edge
    expect(rs.reachesRight).toBe(true)
  })
})
