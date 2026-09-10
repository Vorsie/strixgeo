import { describe, expect, it } from 'vitest'
import { columnsNeedingRederive } from './geotechParentFit'

const PARENT = { formationId: 'f-A', topDepthM: 2, baseDepthM: 8 }

describe('a packing band must sit inside the litho unit it subdivides', () => {
  it('PF1 — bands within their parent are not stale', () => {
    expect(columnsNeedingRederive([
      { columnId: 'cpt-1', topDepthM: 2, baseDepthM: 5, parentMissingOnColumn: false, parent: PARENT },
      { columnId: 'cpt-1', topDepthM: 5, baseDepthM: 8, parentMissingOnColumn: false, parent: PARENT },
    ])).toEqual([])
  })

  it('PF2 — a band overhanging its parent marks that column stale', () => {
    // The contact moved to 4 m; the band still claims 2–5 m, so it now pokes
    // into the unit above. Nothing is stored — the overhang IS the staleness.
    expect(columnsNeedingRederive([
      { columnId: 'cpt-1', topDepthM: 2, baseDepthM: 5, parentMissingOnColumn: false, parent: { ...PARENT, topDepthM: 4 } },
    ])).toEqual(['cpt-1'])
  })

  it('PF3 — each column is reported once however many bands overhang', () => {
    expect(columnsNeedingRederive([
      { columnId: 'cpt-1', topDepthM: 2, baseDepthM: 5, parentMissingOnColumn: false, parent: { ...PARENT, topDepthM: 4 } },
      { columnId: 'cpt-1', topDepthM: 5, baseDepthM: 9, parentMissingOnColumn: false, parent: { ...PARENT, topDepthM: 4 } },
    ])).toEqual(['cpt-1'])
  })

  it('PF4 — a band with no parent is not evidence of staleness', () => {
    // A missing parent is a data-integrity problem, not "re-derive me". Saying
    // stale here would send the engineer to a verb that cannot fix it.
    expect(columnsNeedingRederive([
      { columnId: 'cpt-1', topDepthM: 2, baseDepthM: 5, parentMissingOnColumn: false, parent: null },
    ])).toEqual([])
  })

  // PF5 exists because deleting the base-side half of the check keeps PF1-PF4 green:
  // every overhang above only pokes out of the TOP. A contact drag moves one boundary,
  // and the unit BELOW it shrinks from its top exactly as often as the unit above grows
  // — so half the real staleness in the owner's model is a band hanging past its
  // parent's base, and half the rule was untested.
  it('PF5 — a band hanging below its parent base marks that column stale', () => {
    expect(columnsNeedingRederive([
      { columnId: 'cpt-1', topDepthM: 2, baseDepthM: 9, parentMissingOnColumn: false, parent: PARENT },
    ])).toEqual(['cpt-1'])
  })

  // PF6-PF9 straddle the tolerance, one case on each side of it, on both the top and the
  // base. Without them the constant is undefended: every band above either fits its
  // parent exactly or misses it by whole metres, so ANY threshold from zero upwards
  // keeps this suite green — including no threshold at all. The band materialiser rounds
  // depths to a millimetre while litho contacts keep full float precision, so on the
  // owner's real database boundaries that genuinely coincide differ by up to a
  // millimetre. Compare exactly and those columns all report stale, sending him to
  // Subdivide on ground where nothing has moved — silently, with the suite still green.
  it('PF6 — a top overhang of 1.0 mm is inside the rounding, not staleness', () => {
    expect(columnsNeedingRederive([
      { columnId: 'cpt-1', topDepthM: 1.999, baseDepthM: 5, parentMissingOnColumn: false, parent: PARENT },
    ])).toEqual([])
  })

  it('PF7 — a top overhang of 1.2 mm is a real overhang', () => {
    expect(columnsNeedingRederive([
      { columnId: 'cpt-1', topDepthM: 1.9988, baseDepthM: 5, parentMissingOnColumn: false, parent: PARENT },
    ])).toEqual(['cpt-1'])
  })

  it('PF8 — a base overhang of 1.0 mm is inside the rounding, not staleness', () => {
    expect(columnsNeedingRederive([
      { columnId: 'cpt-1', topDepthM: 5, baseDepthM: 8.001, parentMissingOnColumn: false, parent: PARENT },
    ])).toEqual([])
  })

  it('PF9 — a base overhang of 1.2 mm is a real overhang', () => {
    expect(columnsNeedingRederive([
      { columnId: 'cpt-1', topDepthM: 5, baseDepthM: 8.0012, parentMissingOnColumn: false, parent: PARENT },
    ])).toEqual(['cpt-1'])
  })

  // PF10 pins the ORDER. Sorting the ids instead keeps every case above green, because
  // no case above has two stale columns. The tag this feeds reads "N columns need
  // re-deriving" and names them; the engineer scans that list against the section he is
  // looking at, left to right, so the order has to be the order the bands arrived in.
  it('PF10 — stale columns are reported in the order they are first seen', () => {
    expect(columnsNeedingRederive([
      { columnId: 'cpt-2', topDepthM: 2, baseDepthM: 5, parentMissingOnColumn: false, parent: { ...PARENT, topDepthM: 4 } },
      { columnId: 'cpt-1', topDepthM: 2, baseDepthM: 5, parentMissingOnColumn: false, parent: PARENT },
      { columnId: 'cpt-1', topDepthM: 5, baseDepthM: 9, parentMissingOnColumn: false, parent: PARENT },
    ])).toEqual(['cpt-2', 'cpt-1'])
  })
})
