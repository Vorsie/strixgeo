/**
 * Ctrl+F on a cross-section — find a column by its header name.
 *
 * Owner, 2026-08-17: *"on crosssections i want a ctrl+f feature so i can go
 * easily to a column header like s8 or so for example"*. His columns are named
 * like ``GEO-10/170-S8`` and ``1411-GEO-23/126-B3``; the thing he types is the
 * short tail (``s8``, ``b3``), so matching is case-insensitive substring.
 *
 * The jump itself is a horizontal PAN of the existing viewport — zoom and
 * vertical window untouched — computed from the column's rendered
 * ``nudgedX``, never its raw ``along``: at packed spacing the two diverge by
 * the whole cumulative-width offset, and centring on ``along`` would land the
 * camera beside the column (the section-view spacing rule).
 */

import { describe, expect, it } from 'vitest'

import { matchColumns, panViewportToScreenX } from './columnFind'

const COLUMNS = [
  { id: 'a', name: 'GEO-10/170-S8', along: 120, nudgedX: 300 },
  { id: 'b', name: '1411-GEO-23/126-B3', along: 60, nudgedX: 180 },
  { id: 'c', name: 'GEO-23/125-S10', along: 200, nudgedX: 450 },
  { id: 'd', name: 'GEO-23/125-S11', along: 240, nudgedX: 520 },
]

describe('matchColumns', () => {
  it('CF1: "s8" finds the S8 column, case-insensitive', () => {
    expect(matchColumns(COLUMNS, 's8').map(c => c.id)).toEqual(['a'])
  })

  it('CF2: several matches come back ordered by along, left to right', () => {
    // "s1" matches S10 and S11; cycling should walk the section
    // left-to-right, not in list order.
    expect(matchColumns(COLUMNS, 'S1').map(c => c.name)).toEqual([
      'GEO-23/125-S10',
      'GEO-23/125-S11',
    ])
  })

  it('CF3: an empty or whitespace query matches nothing', () => {
    expect(matchColumns(COLUMNS, '')).toEqual([])
    expect(matchColumns(COLUMNS, '   ')).toEqual([])
  })

  it('CF4: a query with no hit answers an empty list, not everything', () => {
    expect(matchColumns(COLUMNS, 'xyz')).toEqual([])
  })

  it('CF5: surrounding whitespace in the query is ignored', () => {
    expect(matchColumns(COLUMNS, '  b3 ').map(c => c.id)).toEqual(['b'])
  })
})

describe('panViewportToScreenX', () => {
  const viewport = { xMin: 0, xMax: 100, levelMin: -30, levelMax: 10 }

  it('CF6: shifts the window so the target pixel lands at plot centre', () => {
    // scaleH = 8 px per along-metre; target 80 px right of centre → the
    // window slides 10 m right. Width and the vertical window survive.
    const out = panViewportToScreenX(viewport, 480, 400, 8)
    expect(out.xMin).toBeCloseTo(10)
    expect(out.xMax).toBeCloseTo(110)
    expect(out.levelMin).toBe(-30)
    expect(out.levelMax).toBe(10)
  })

  it('CF7: a target left of centre slides the window left', () => {
    const out = panViewportToScreenX(viewport, 320, 400, 8)
    expect(out.xMin).toBeCloseTo(-10)
    expect(out.xMax).toBeCloseTo(90)
  })

  it('CF8: a target already at centre is a no-op', () => {
    const out = panViewportToScreenX(viewport, 400, 400, 8)
    expect(out.xMin).toBeCloseTo(0)
    expect(out.xMax).toBeCloseTo(100)
  })

  it('CF9: a degenerate scale answers the viewport unchanged', () => {
    // plotWidth 0 before the ResizeObserver fires → scaleH 0. Panning by
    // Infinity would NaN the viewport and blank the section.
    const out = panViewportToScreenX(viewport, 480, 400, 0)
    expect(out).toEqual(viewport)
  })
})
