/**
 * RULING A, THE GEOMETRY HALF: an untied contact that IS the parent litho
 * unit's own boundary follows the accepted LITHO tie's line there — the
 * docstring on ``buildGapConstructs``'s ``coverTies`` parameter already says
 * this ("consulted only for an untied contact that is the parent unit's own
 * boundary"), but the parameter was threaded all the way from ``familyFill``
 * down to this function and never actually read.
 *
 * "A boundary only: 2/1/0 counts packing ties" (module header, rule 3) — this
 * is deliberately a GEOMETRY-ONLY fix. A cover tie must never feed the
 * classification (``emitFor``, ``contested``, the two-tied-contact rule): it
 * only replaces the flat fallback of an already-'nothing'-emitting band's
 * untied cover contact with the litho tie's own line, so the drawn boundary
 * matches the accepted litho correlation instead of floating at the band's
 * own level.
 *
 * Owner code-hunt finding, 2026-08-22.
 */
import { describe, expect, it } from 'vitest'

import { buildGapConstructs, type RunBand, type RunColumn, type RunTie } from './constructive/constructs'

describe('cover-tie geometry — an untied cover contact follows the litho line', () => {
  it('CT1 — a band welded on top but untied on its cover base rides the litho tie, not its own flat level', () => {
    // M carries ONE packing band spanning its whole litho unit (10..0, both
    // contacts are the litho unit's own — atCoverTop/atCoverBase both true).
    // F carries two packing bands inside the SAME litho span: an upper DENSE
    // (litho-top-cover=8..3) and a lower LOOSE (3..litho-base-cover=-2).
    //
    // Packing tie: M's top (10, cover) <-> F's DENSE top (8, cover) — SAME
    // mass, welds. M's base (0, cover) carries NO packing tie at all — but
    // the litho unit's own base line runs from M's litho-base (0) to F's
    // litho-base (-2), and that is a real, accepted litho correlation.
    const stacks = new Map<number, RunBand[]>([
      [
        0,
        [
          {
            layerId: 'M-dense',
            formationId: 'g-dense',
            bodyId: null,
            top: 10,
            base: 0,
            ci: 0,
            x: 0,
            atCoverTop: true,
            atCoverBase: true,
          },
        ],
      ],
      [
        1,
        [
          {
            layerId: 'F-dense',
            formationId: 'g-dense',
            bodyId: null,
            top: 8,
            base: 3,
            ci: 1,
            x: 10,
            atCoverTop: true,
          },
          {
            layerId: 'F-loose',
            formationId: 'g-loose',
            bodyId: null,
            top: 3,
            base: -2,
            ci: 1,
            x: 10,
            atCoverBase: true,
          },
        ],
      ],
    ])
    const left: RunColumn = { ci: 0, x: 0, bands: stacks.get(0) as RunBand[] }
    const right: RunColumn = { ci: 1, x: 10, bands: stacks.get(1) as RunBand[] }
    const packingTies: RunTie[] = [
      { key: 'weld', leftCi: 0, rightCi: 1, leftX: 0, rightX: 10, leftY: 10, rightY: 8 },
    ]
    const coverTies: RunTie[] = [
      // The litho unit's own base line — dips from M's 0 to F's -2.
      { key: 'litho-base', leftCi: 0, rightCi: 1, leftX: 0, rightX: 10, leftY: 0, rightY: -2 },
    ]
    const massOf = (band: RunBand): { litho: string; packing: string } => ({
      litho: 'ZAND',
      packing: band.formationId,
    })
    const constructs = buildGapConstructs(left, right, packingTies, coverTies, stacks, massOf)
    const mBand = constructs.find((c) => c.band.layerId === 'M-dense')
    expect(mBand?.emit, 'sanity: one packing tie, same mass -> nothing (spans)').toBe('nothing')
    // Held flat at M's own base (0) is the bug; riding the litho tie reads the
    // straight-line interpolation between (0,0) and (10,-2).
    const expectedAt5 = 0 + ((5 - 0) / (10 - 0)) * (-2 - 0)
    expect(
      mBand?.baseAt(5),
      "an untied cover contact must ride the litho tie, not M's own flat level",
    ).toBeCloseTo(expectedAt5, 6)
  })

  it('CT2 — an untied contact that is NOT a cover boundary still holds flat (no litho tie applies)', () => {
    // Same shape, but M's base is an INTERNAL packing subdivision, not the
    // litho unit's own edge (atCoverBase absent) — a litho tie existing at
    // that elevation must not leak into a packing subdivision boundary.
    const stacks = new Map<number, RunBand[]>([
      [
        0,
        [
          {
            layerId: 'M-dense',
            formationId: 'g-dense',
            bodyId: null,
            top: 10,
            base: 0,
            ci: 0,
            x: 0,
            atCoverTop: true,
            // no atCoverBase — this is an internal packing boundary, not litho's own
          },
        ],
      ],
      [
        1,
        [
          {
            layerId: 'F-dense',
            formationId: 'g-dense',
            bodyId: null,
            top: 8,
            base: -2,
            ci: 1,
            x: 10,
            atCoverTop: true,
            atCoverBase: true,
          },
        ],
      ],
    ])
    const left: RunColumn = { ci: 0, x: 0, bands: stacks.get(0) as RunBand[] }
    const right: RunColumn = { ci: 1, x: 10, bands: stacks.get(1) as RunBand[] }
    const packingTies: RunTie[] = [
      { key: 'weld', leftCi: 0, rightCi: 1, leftX: 0, rightX: 10, leftY: 10, rightY: 8 },
    ]
    const coverTies: RunTie[] = [
      { key: 'litho-base', leftCi: 0, rightCi: 1, leftX: 0, rightX: 10, leftY: 0, rightY: -2 },
    ]
    const massOf = (band: RunBand): { litho: string; packing: string } => ({
      litho: 'ZAND',
      packing: band.formationId,
    })
    const constructs = buildGapConstructs(left, right, packingTies, coverTies, stacks, massOf)
    const mBand = constructs.find((c) => c.band.layerId === 'M-dense')
    expect(mBand?.baseAt(5), 'no atCoverBase -> holds its own flat level, untouched').toBe(0)
  })
})
