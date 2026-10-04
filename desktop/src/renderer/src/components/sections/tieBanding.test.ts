// Identity follows the drawing — owner ruling 2026-10-04.
//
// Verbatim: "b, identity follows the drawing". Bands are one body ONLY where the
// section fill paints them as one mass. An accepted tie that the fill does not
// paint as a band joins nothing: it stays a surface statement. The CS4 case: two
// ZAND (SL:M) bands on S20 / S21 joined by one top tie in the sub-TD zone — no
// base tie, no band, two bodies.
//
// The section must say so on the tie: "accepted, not banded: the bands stay
// separate bodies". These pins speak the ruling's words; the helper reads the
// stamped body ids the resolver wrote, never re-derives identity.

import { describe, expect, it } from 'vitest'

import { massKeyOfFormation, tieBandingStatus } from './tieBanding'

const SLM = { id: 'f-zand-slm', nad_class: null, source_litho_formation_id: null }
const ZAND = { id: 'f-zand', nad_class: null, source_litho_formation_id: null }

describe('tieBandingStatus — an accepted tie the fill does not band joins nothing', () => {
  it('TB1 — accepted, same unit, two bodies: accepted, not banded', () => {
    expect(
      tieBandingStatus({
        approved: true,
        bodyA: 'body-s20',
        bodyB: 'body-s21',
        massA: massKeyOfFormation(SLM),
        massB: massKeyOfFormation(SLM),
      }),
    ).toBe('not_banded')
  })

  it('TB2 — accepted, same unit, one body (the fill painted the band): banded', () => {
    expect(
      tieBandingStatus({
        approved: true,
        bodyA: 'body-1',
        bodyB: 'body-1',
        massA: massKeyOfFormation(SLM),
        massB: massKeyOfFormation(SLM),
      }),
    ).toBe('banded')
  })

  it('TB3 — a pending proposal makes no statement about bodies', () => {
    expect(
      tieBandingStatus({
        approved: false,
        bodyA: 'body-s20',
        bodyB: 'body-s21',
        massA: massKeyOfFormation(SLM),
        massB: massKeyOfFormation(SLM),
      }),
    ).toBeNull()
  })

  it('TB4 — a tie across two units is never one body by design (never weld), so no statement', () => {
    expect(
      tieBandingStatus({
        approved: true,
        bodyA: 'body-zand',
        bodyB: 'body-slm',
        massA: massKeyOfFormation(ZAND),
        massB: massKeyOfFormation(SLM),
      }),
    ).toBeNull()
  })

  it('TB5 — an unstamped band (body unknown) makes no statement', () => {
    expect(
      tieBandingStatus({
        approved: true,
        bodyA: null,
        bodyB: 'body-s21',
        massA: massKeyOfFormation(SLM),
        massB: massKeyOfFormation(SLM),
      }),
    ).toBeNull()
    expect(
      tieBandingStatus({
        approved: true,
        bodyA: undefined,
        bodyB: undefined,
        massA: massKeyOfFormation(SLM),
        massB: massKeyOfFormation(SLM),
      }),
    ).toBeNull()
  })
})

describe('massKeyOfFormation — the mass a band belongs to (mirrors the resolver)', () => {
  it('MK1 — a litho unit is its own formation row', () => {
    expect(massKeyOfFormation(ZAND)).not.toBe(massKeyOfFormation(SLM))
  })

  it('MK2 — a packing band is its litho unit + NAD class, whatever the row', () => {
    const rowGeoA = { id: 'row-a', nad_class: 6, source_litho_formation_id: 'f-zand' }
    const rowGeoB = { id: 'row-b', nad_class: 6, source_litho_formation_id: 'f-zand' }
    const dense = { id: 'row-c', nad_class: 7, source_litho_formation_id: 'f-zand' }
    const slm = { id: 'row-d', nad_class: 6, source_litho_formation_id: 'f-zand-slm' }
    expect(massKeyOfFormation(rowGeoA)).toBe(massKeyOfFormation(rowGeoB))
    expect(massKeyOfFormation(rowGeoA)).not.toBe(massKeyOfFormation(dense))
    expect(massKeyOfFormation(rowGeoA)).not.toBe(massKeyOfFormation(slm))
  })

  it('MK3 — no formation, no key', () => {
    expect(massKeyOfFormation(undefined)).toBeNull()
  })
})
