/**
 * Which drawn boundaries on the geotech axis are LOCKED litho contacts.
 *
 * The approved design leads with weight, not with glyphs: a litho contact is a heavy
 * solid line, an internal packing boundary a thin dashed one. The renderer needs one
 * flat answer per drawn contact to do that, and this is where it comes from.
 *
 * The classification itself is ``boundaryRestatesLithoContact`` and is already tested;
 * what is tested here is the sweep over a whole section — which id each verdict lands
 * on, and the column boundaries it must not cross.
 */
import { describe, expect, it } from 'vitest'

import { restatingContactIds } from './geotechBoundaryKinds'

/** A geotech band row, in the shape the layers endpoint returns. */
function band(
  id: string,
  cptId: string | null,
  top: number,
  base: number,
  formationId = 'f-nad',
): {
  id: string
  formation_id: string
  cpt_id: string | null
  borehole_id: string | null
  depth_top_m: number
  depth_base_m: number
} {
  return {
    id,
    formation_id: formationId,
    cpt_id: cptId,
    borehole_id: cptId === null ? 'BH1' : null,
    depth_top_m: top,
    depth_base_m: base,
  }
}

describe('restatingContactIds', () => {
  it('BK1 — a boundary between two bands in DIFFERENT litho units is keyed by the band below it', () => {
    // Litho: KLEI 0–5, ZAND 5–10. Bands cut at 5 → that boundary restates the contact.
    const bands = [band('b1', 'C1', 0, 5), band('b2', 'C1', 5, 10)]
    const litho = [band('L-klei', 'C1', 0, 5), band('L-zand', 'C1', 5, 10)]
    // Keyed by the LOWER band: a contact IS that band's top, which is the same id the
    // drag hit strip and the band-edit strips are keyed by.
    expect(restatingContactIds(bands, litho)).toEqual(new Set(['b2']))
  })

  it('BK2 — a boundary INSIDE one litho unit is not a litho contact', () => {
    // One KLEI unit subdivided by qc into two packing bands. The 3 m boundary is the
    // engineer's own subdivision — the draggable kind, so it must NOT be reported.
    const bands = [band('b1', 'C1', 0, 3), band('b2', 'C1', 3, 5)]
    const litho = [band('L-klei', 'C1', 0, 5)]
    expect(restatingContactIds(bands, litho)).toEqual(new Set())
  })

  it('BK3 — both kinds on one column are told apart', () => {
    // KLEI 0–5 split at 3 (packing), then ZAND 5–10 split at 7 (packing).
    // Only the 5 m boundary crosses litho units.
    const bands = [
      band('b1', 'C1', 0, 3),
      band('b2', 'C1', 3, 5),
      band('b3', 'C1', 5, 7),
      band('b4', 'C1', 7, 10),
    ]
    const litho = [band('L-klei', 'C1', 0, 5), band('L-zand', 'C1', 5, 10)]
    expect(restatingContactIds(bands, litho)).toEqual(new Set(['b3']))
  })

  it('BK4 — a column is judged against its OWN litho stack, never a neighbour’s', () => {
    // C1 and C2 carry bands at identical depths but different litho stacks: on C1 the
    // 5 m boundary is inside one unit, on C2 it crosses two. Reading the wrong column's
    // litho would lock C1's boundary and free C2's — the exact inversion.
    const bands = [
      band('a1', 'C1', 0, 5),
      band('a2', 'C1', 5, 10),
      band('b1', 'C2', 0, 5),
      band('b2', 'C2', 5, 10),
    ]
    const litho = [
      band('L1', 'C1', 0, 10),
      band('L2', 'C2', 0, 5),
      band('L3', 'C2', 5, 10),
    ]
    expect(restatingContactIds(bands, litho)).toEqual(new Set(['b2']))
  })

  it('BK5 — the shallowest band has no boundary above it', () => {
    // The top of the first band is where the sounding starts, not a contact between
    // two bands. Reporting it would draw a locked line at the ground surface.
    const bands = [band('b1', 'C1', 0, 5), band('b2', 'C1', 5, 10)]
    const litho = [band('L-klei', 'C1', 0, 5), band('L-zand', 'C1', 5, 10)]
    expect(restatingContactIds(bands, litho).has('b1')).toBe(false)
  })

  it('BK6 — rows arriving out of depth order are still paired by depth', () => {
    // The endpoint gives no ordering guarantee, and pairing unsorted rows would compare
    // bands that are not neighbours at all.
    const bands = [band('b2', 'C1', 5, 10), band('b1', 'C1', 0, 5)]
    const litho = [band('L-zand', 'C1', 5, 10), band('L-klei', 'C1', 0, 5)]
    expect(restatingContactIds(bands, litho)).toEqual(new Set(['b2']))
  })

  it('BK7 — bands that do not touch bound nothing between them', () => {
    // A gap between two bands is not a boundary; there is no single depth to draw.
    const bands = [band('b1', 'C1', 0, 4), band('b2', 'C1', 5, 10)]
    const litho = [band('L-klei', 'C1', 0, 5), band('L-zand', 'C1', 5, 10)]
    expect(restatingContactIds(bands, litho)).toEqual(new Set())
  })

  it('BK8 — borehole columns are classified too', () => {
    // A borehole is refused every band-edit VERB (no qc to re-derive from), but its
    // boundaries still are what they are, and a locked one must still read as locked.
    const bands = [band('h1', null, 0, 5), band('h2', null, 5, 10)]
    const litho = [band('LH1', null, 0, 5), band('LH2', null, 5, 10)]
    expect(restatingContactIds(bands, litho)).toEqual(new Set(['h2']))
  })
})
