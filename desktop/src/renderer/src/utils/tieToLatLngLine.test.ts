import { describe, expect, it } from 'vitest'
import { tieToLatLngLine } from './tieToLatLngLine'
import type { SuggestedTie } from './tieAutoSuggest'

describe('tieToLatLngLine', () => {
  it("converts a tie's projected endpoints to [lat,lng] pairs in EPSG 31370", () => {
    const tie: SuggestedTie = {
      members: [],
      strikeSpread: 0,
      bufferM: 5,
      start: { x: 88018, y: 164330 },
      end: { x: 88438, y: 165023 },
    }
    const line = tieToLatLngLine(tie, 31370)
    expect(line).toHaveLength(2)
    // Belgium Lambert72 → WGS84 lands near lat ~51, lng ~4-5.
    expect(line[0][0]).toBeGreaterThan(50)
    expect(line[0][0]).toBeLessThan(52)
    expect(line[0][1]).toBeGreaterThan(3)
    expect(line[0][1]).toBeLessThan(6)
  })
})
