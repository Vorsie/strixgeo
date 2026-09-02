import { describe, expect, it } from 'vitest'
import { regionPathD, regionBounds } from './regionPath'

const columnX = [100, 300, 600]                          // px, along-order
const levelToY = (level: number): number => 50 + (10 - level) * 4  // levelMax 10 at y=50, 4 px/m

describe('regionPathD — a fraction polygon of gap g lands between column g and g+1', () => {
  it('fraction 0 is the left column, 1 the right column, elevation is absolute level', () => {
    const d = regionPathD({ gap_index: 1, polygon: [[0, 10], [1, 10], [1, 0], [0, 0]] }, columnX, levelToY)
    expect(d).toBe('M300 50L600 50L600 90L300 90Z')
  })
  it('an empty polygon yields an empty path', () => {
    expect(regionPathD({ gap_index: 0, polygon: [] }, columnX, levelToY)).toBe('')
  })
  it('bounds are the bbox of the resolved points', () => {
    expect(regionBounds({ gap_index: 0, polygon: [[0.5, 5], [1, 0]] }, columnX, levelToY))
      .toEqual({ minX: 200, maxX: 300, minY: 70, maxY: 90 })
  })
})
