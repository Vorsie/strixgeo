// The small-lens merge suggestion — assisted-manual, the system points and the
// engineer acts (owner idea, CS1 brainstorm; docs/debt.md #227 tail).
//
// A small enclosed class lens is a THIN band of one packing class sitting
// fully inside a host stack of another: both neighbours exist, both
// boundaries are legal merges (same litho body — ruling 2 for free), both
// hosts carry the SAME non-null class, the lens class differs (a null class
// counts — an unclassifiable sliver between matching hosts is the best absorb
// candidate of all), and the lens is no thicker than the model's own
// "thinnest packing band kept" preference. No new magic number: the model
// already states what "too thin" means.

import { describe, expect, it } from 'vitest'

import {
  enclosedLensAt,
  findSmallEnclosedLenses,
} from './geotechLensSuggestion'
import type { GeotechBandInterval } from './geotechBandEdit'

const MIN_THICKNESS = 0.35

function band(
  layerId: string,
  top: number,
  base: number,
  formationId: string,
): GeotechBandInterval {
  return { layerId, topDepthM: top, baseDepthM: base, formationId, anchorIsCpt: true }
}

/** One litho body 2–8 m; classes come from the formation → class map. */
const LITHO_BODIES = [{ topDepthM: 2, baseDepthM: 8 }]

const CLASSES = new Map<string, number | null>([
  ['f-dense', 8],
  ['f-loose', 5],
  ['f-null', null],
])

describe('what counts as a small enclosed class lens', () => {
  it('LS1 — a thin different-class band between two same-class hosts qualifies', () => {
    const bands = [
      band('host-1', 2, 4.8, 'f-dense'),
      band('lens', 4.8, 5.1, 'f-loose'), // 0.3 m ≤ the 0.35 m pref
      band('host-2', 5.1, 8, 'f-dense'),
    ]
    const lens = enclosedLensAt(bands, 1, LITHO_BODIES, CLASSES)
    expect(lens).not.toBeNull()
    expect(lens?.lens.layerId).toBe('lens')
    expect(lens?.upperHost.layerId).toBe('host-1')
    expect(lens?.lowerHost.layerId).toBe('host-2')
  })

  it('LS2 — an unclassifiable sliver between matching hosts is the best candidate of all', () => {
    const bands = [
      band('host-1', 2, 4.8, 'f-dense'),
      band('sliver', 4.8, 5.1, 'f-null'),
      band('host-2', 5.1, 8, 'f-dense'),
    ]
    expect(enclosedLensAt(bands, 1, LITHO_BODIES, CLASSES)).not.toBeNull()
  })

  it('LS3 — a band as thick as the hosts is a unit, not a lens', () => {
    const bands = [
      band('host-1', 2, 3.5, 'f-dense'),
      band('thick', 3.5, 6.5, 'f-loose'), // 3 m — far past the pref
      band('host-2', 6.5, 8, 'f-dense'),
    ]
    expect(
      findSmallEnclosedLenses(bands, LITHO_BODIES, CLASSES, MIN_THICKNESS),
    ).toHaveLength(0)
  })

  it('LS4 — different host classes enclose nothing (there is no matrix to restore)', () => {
    const bands = [
      band('host-1', 2, 4.8, 'f-dense'),
      band('lens', 4.8, 5.1, 'f-null'),
      band('host-2', 5.1, 8, 'f-loose'),
    ]
    expect(enclosedLensAt(bands, 1, LITHO_BODIES, CLASSES)).toBeNull()
  })

  it('LS5 — a top or bottom band of the body has one neighbour: a pair merge, not a lens', () => {
    const bands = [
      band('top', 2, 2.3, 'f-loose'),
      band('host', 2.3, 8, 'f-dense'),
    ]
    expect(enclosedLensAt(bands, 0, LITHO_BODIES, CLASSES)).toBeNull()
  })

  it('LS6 — a lens whose neighbour sits across a litho contact is structurally excluded', () => {
    const bodies = [
      { topDepthM: 2, baseDepthM: 5.1 },
      { topDepthM: 5.1, baseDepthM: 8 },
    ]
    const bands = [
      band('host-1', 2, 4.8, 'f-dense'),
      band('lens', 4.8, 5.1, 'f-loose'),
      band('host-2', 5.1, 8, 'f-dense'), // other side of the litho contact
    ]
    expect(enclosedLensAt(bands, 1, bodies, CLASSES)).toBeNull()
  })

  it('LS7 — the sweep returns every qualifying lens on the column, and only those', () => {
    const bands = [
      band('host-1', 2, 3.8, 'f-dense'),
      band('lens-a', 3.8, 4.1, 'f-loose'),
      band('host-2', 4.1, 5.8, 'f-dense'),
      band('lens-b', 5.8, 6.05, 'f-null'),
      band('host-3', 6.05, 8, 'f-dense'),
    ]
    const lenses = findSmallEnclosedLenses(bands, LITHO_BODIES, CLASSES, MIN_THICKNESS)
    expect(lenses.map(l => l.lens.layerId)).toEqual(['lens-a', 'lens-b'])
  })

  it('LS8 — an unknown formation resolves to no class, and a no-class HOST suggests nothing', () => {
    // Safe degradation: a nadMeta miss must suppress the badge, never invent one.
    const bands = [
      band('host-1', 2, 4.8, 'f-unknown'),
      band('lens', 4.8, 5.1, 'f-loose'),
      band('host-2', 5.1, 8, 'f-dense'),
    ]
    expect(enclosedLensAt(bands, 1, LITHO_BODIES, CLASSES)).toBeNull()
  })
})
