// The geometry the unified geotech menu re-aims with (owner installer #39 —
// "one right-click on a test gives one menu"). Precedence mirrors the rendered
// stack: strip over band, band over the bare column card, nothing off every
// column.

import { describe, expect, it } from 'vitest'

import { geotechMenuTargetAt } from './geotechMenuTargetAt'

const CPT = {
  x0: 180,
  x1: 220,
  // band-1 0..20, band-2 20..40, band-3 40..60 (px)
  bands: [
    { topY: 0, baseY: 20 },
    { topY: 20, baseY: 40 },
    { topY: 40, baseY: 60 },
  ],
  // one strip on the 20 px boundary between band-1 and band-2
  strips: [{ top: 16, bottom: 24 }],
}
const CARDS = [{ x0: 180, x1: 220 }]
const base = {
  cptColumns: [CPT],
  boreholeColumns: [],
  cards: CARDS,
  plotTop: 0,
  plotBottom: 1000,
}

describe('geotechMenuTargetAt picks the surface under the pointer', () => {
  it('MT1 — a point in a band interior resolves to that band', () => {
    expect(geotechMenuTargetAt({ ...base, svgX: 200, svgY: 30 })).toEqual({
      kind: 'cptBand',
      columnIndex: 0,
      bandIndex: 1,
    })
  })

  it('MT2 — a point on a boundary strip resolves to the strip, not the band under it', () => {
    // svgY 20 is inside band-1 (0..20) AND on the strip (16..24) — the strip wins.
    expect(geotechMenuTargetAt({ ...base, svgX: 200, svgY: 20 })).toEqual({
      kind: 'boundary',
      columnIndex: 0,
      pairIndex: 0,
    })
  })

  it('MT3 — a point in the column but off every band resolves to the column card', () => {
    // svgY 500 is below the deepest band (60) but inside the plot — the collar
    // gap / below-TD escape the column-only menu lives on.
    expect(geotechMenuTargetAt({ ...base, svgX: 200, svgY: 500 })).toEqual({
      kind: 'column',
      cardIndex: 0,
    })
  })

  it('MT4 — a point off every column resolves to null', () => {
    expect(geotechMenuTargetAt({ ...base, svgX: 1000, svgY: 30 })).toBeNull()
  })

  it('MT5 — a borehole band resolves to bhBand', () => {
    const target = geotechMenuTargetAt({
      cptColumns: [],
      boreholeColumns: [{ x0: 380, x1: 420, bands: [{ topY: 0, baseY: 50 }] }],
      cards: [{ x0: 380, x1: 420 }],
      svgX: 400,
      svgY: 25,
      plotTop: 0,
      plotBottom: 1000,
    })
    expect(target).toEqual({ kind: 'bhBand', columnIndex: 0, bandIndex: 0 })
  })
})
