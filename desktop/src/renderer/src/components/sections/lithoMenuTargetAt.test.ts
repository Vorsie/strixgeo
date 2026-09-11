// What the second right-click lands on while the litho menu is open.
//
// The dismiss backdrop covers the canvas, so the browser can no longer
// hit-test the band underneath it. These cases pin the pick the backdrop does
// instead, so a second right-click re-opens the SAME menu the first did
// (owner dogfeed 2026-09-11: "i get two different menus if i right click once
// or right click twice").

import { describe, expect, it } from 'vitest'

import { lithoMenuTargetAt } from './lithoMenuTargetAt'

/** One column card, 40 px wide, centred on x = 100. */
const COLUMNS = [{ nudgedX: 100, width: 40 }]

/** Two stacked accepted-unit bands on that card, with a donated hit strip. */
const BANDS = [
  { key: 'upper', x: 80, y: 50, width: 40, height: 30, growTop: 0, growBottom: 0 },
  // A thin band topped up by 6 px borrowed from the band above (debt #158).
  { key: 'lower', x: 80, y: 80, width: 40, height: 4, growTop: 6, growBottom: 0 },
]

/**
 * Run the pick with the standard fixture.
 *
 * @param svgX - Point x in SVG coordinates.
 * @param svgY - Point y in SVG coordinates.
 * @returns The resolved target.
 */
function pick(svgX: number, svgY: number): ReturnType<typeof lithoMenuTargetAt> {
  return lithoMenuTargetAt({
    bands: BANDS,
    columns: COLUMNS,
    svgX,
    svgY,
    plotTop: 20,
    plotBottom: 400,
  })
}

describe('lithoMenuTargetAt — what the pointer is over while the menu covers the canvas', () => {
  it('LMT1 — a point on an accepted unit resolves that unit, so the same menu re-opens', () => {
    const hit = pick(100, 60)
    expect(hit).toEqual({ kind: 'band', band: BANDS[0] })
  })

  it('LMT2 — the visible band wins over a neighbour that merely donated hit area', () => {
    // y = 78 is inside the upper band AND inside the strip the lower band was
    // donated. What the engineer sees is the upper band, so that is the answer.
    const hit = pick(100, 78)
    expect(hit).toEqual({ kind: 'band', band: BANDS[0] })
  })

  it('LMT3 — a thin band stays reachable through its donated hit strip', () => {
    // Just below the upper band's own rect, inside the lower band's growTop.
    const hit = pick(100, 81)
    expect(hit).toEqual({ kind: 'band', band: BANDS[1] })
  })

  it('LMT4 — a point on the card but on no unit resolves the column, which is the Add escape', () => {
    const hit = pick(100, 300)
    expect(hit).toEqual({ kind: 'column', column: COLUMNS[0] })
  })

  it('LMT5 — a point beside the card resolves nothing, so the menu simply dismisses', () => {
    expect(pick(160, 60)).toBeNull()
  })

  it('LMT6 — a point outside the plot resolves nothing', () => {
    expect(pick(100, 450)).toBeNull()
  })
})
