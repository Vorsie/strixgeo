/**
 * Owner dogfeed, 2026-08-22 (the vertical white line on the right edge of
 * 1411-GEO-23/126-B3 — *"I thought this would disappear through the merging
 * process"*): on the geotech axis the subdivide keeps one formation ROW per
 * (nad_class, litho parent, geological parent) — provenance by design — so
 * one packing class lives under several row ids. Both render passes that ask
 * "is my neighbour the same thing as me" compared the raw ROW: the seam
 * pass (``computeSeamStrokePaths``, whose field is documented as an
 * *identity*, "same id on both sides of an edge ⇒ no stroke") and the fill
 * dissolve (``buildFillGroups``). At B3's column the whole stack matched row
 * for row EXCEPT the top SILT·SF, which is row ``e16d82…`` on B3's own litho
 * parent and row ``49c071…`` on GEO-23/125-S9's — same class, same colour,
 * two ids — so the shared edge kept its doubled self-colour stroke and the
 * two fills stayed separate translucent elements.
 *
 * Colour is safe to collapse on: geotech colour is ``nadClassColor(nad_class)``,
 * a pure function of the class, so two rows of one class are always the same
 * colour.
 */
import { describe, expect, it } from 'vitest'

import { fillIdentityOf } from './sectionFillIdentity'

const PACKING = new Map<string, string>([
  ['row-silt-sf-under-b3', 'SILT|13'],
  ['row-silt-sf-under-s9', 'SILT|13'],
  ['row-silt-mf-under-b3', 'SILT|14'],
])

describe('fillIdentityOf', () => {
  it('FI1 — two rows of ONE packing class share an identity (the B3 seam)', () => {
    expect(fillIdentityOf('row-silt-sf-under-b3', PACKING)).toBe(
      fillIdentityOf('row-silt-sf-under-s9', PACKING),
    )
  })

  it('FI2 — different packing classes stay distinct', () => {
    expect(fillIdentityOf('row-silt-sf-under-b3', PACKING)).not.toBe(
      fillIdentityOf('row-silt-mf-under-b3', PACKING),
    )
  })

  it('FI3 — a formation the map does not know (the litho axis) keeps its own id', () => {
    expect(fillIdentityOf('litho-formation-x', PACKING)).toBe('litho-formation-x')
  })

  it('FI4 — no map at all (no litho frame) keeps every id as it was', () => {
    expect(fillIdentityOf('anything', undefined)).toBe('anything')
  })

  it('FI5 — two DIFFERENT litho formations never collapse just because the map is absent', () => {
    expect(fillIdentityOf('litho-a', undefined)).not.toBe(fillIdentityOf('litho-b', undefined))
  })
})
