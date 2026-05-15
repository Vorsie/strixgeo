import { describe, it, expect } from 'vitest'
import {
  selectVisibleLabels,
  FULL_HEADER_THRESHOLD_PX,
  ROTATED_THRESHOLD_PX,
} from './columnLabelLod'

const col = (id: string, nudgedX: number, selected = false, hovered = false) => ({
  id,
  nudgedX,
  selected,
  hovered,
})

describe('selectVisibleLabels', () => {
  it('returns empty for empty input', () => {
    expect(selectVisibleLabels([])).toEqual([])
  })

  it('returns full for a single column', () => {
    const [r] = selectVisibleLabels([col('a', 100)])
    expect(r.mode).toBe('full')
    expect(r.callout).toBe(false)
  })

  it('returns full when spacing is above the full threshold', () => {
    const spacing = FULL_HEADER_THRESHOLD_PX + 10
    const results = selectVisibleLabels([col('a', 0), col('b', spacing)])
    expect(results.every(r => r.mode === 'full')).toBe(true)
  })

  it('returns rotated when spacing is between rotated and full thresholds', () => {
    const spacing = (ROTATED_THRESHOLD_PX + FULL_HEADER_THRESHOLD_PX) / 2
    const results = selectVisibleLabels([col('a', 0), col('b', spacing)])
    expect(results.every(r => r.mode === 'rotated')).toBe(true)
  })

  it('returns none for dense middle columns', () => {
    // Three tightly spaced columns: first, middle, last
    const dx = ROTATED_THRESHOLD_PX / 2 // well below rotated threshold
    const cols = [col('first', 0), col('mid', dx), col('last', dx * 2)]
    const results = selectVisibleLabels(cols)
    const byId = Object.fromEntries(results.map(r => [r.id, r]))
    expect(byId['first'].mode).toBe('rotated') // first is guaranteed
    expect(byId['last'].mode).toBe('rotated')  // last is guaranteed
    expect(byId['mid'].mode).toBe('none')       // middle suppressed
  })

  it('selected column always gets full regardless of spacing', () => {
    const dx = 5 // far below any threshold
    const cols = [col('a', 0, true), col('b', dx)]
    const results = selectVisibleLabels(cols)
    const byId = Object.fromEntries(results.map(r => [r.id, r]))
    expect(byId['a'].mode).toBe('full')
  })

  it('hovered column always gets full regardless of spacing', () => {
    const dx = 5
    const cols = [col('a', 0, false, true), col('b', dx)]
    const results = selectVisibleLabels(cols)
    const byId = Object.fromEntries(results.map(r => [r.id, r]))
    expect(byId['a'].mode).toBe('full')
  })

  it('sets callout=true for selected column when spacing is below full threshold', () => {
    const dx = ROTATED_THRESHOLD_PX + 5 // above rotated but below full
    const cols = [col('a', 0, true), col('b', dx)]
    const results = selectVisibleLabels(cols)
    const byId = Object.fromEntries(results.map(r => [r.id, r]))
    expect(byId['a'].mode).toBe('full')
    expect(byId['a'].callout).toBe(true)
  })

  it('sets callout=false for selected column when spacing is above full threshold', () => {
    const dx = FULL_HEADER_THRESHOLD_PX + 20
    const cols = [col('a', 0, true), col('b', dx)]
    const results = selectVisibleLabels(cols)
    const byId = Object.fromEntries(results.map(r => [r.id, r]))
    expect(byId['a'].callout).toBe(false)
  })

  it('preserves input order in the result', () => {
    const spacing = FULL_HEADER_THRESHOLD_PX + 10
    const input = [col('z', 200), col('a', 0), col('m', spacing)]
    const results = selectVisibleLabels(input)
    expect(results.map(r => r.id)).toEqual(['z', 'a', 'm'])
  })

  it('many tightly-packed columns — only first + last + selected survive', () => {
    const dx = 2 // 2 px apart — tiny
    const count = 10
    const cols = Array.from({ length: count }, (_, i) =>
      col(`c${i}`, i * dx, i === 5 /* one selected */),
    )
    const results = selectVisibleLabels(cols)
    const byId = Object.fromEntries(results.map(r => [r.id, r]))
    expect(byId['c0'].mode).toBe('rotated')  // first
    expect(byId[`c${count - 1}`].mode).toBe('rotated') // last
    expect(byId['c5'].mode).toBe('full')     // selected
    // Everything else is none
    for (let i = 1; i < count - 1; i += 1) {
      if (i !== 5) expect(byId[`c${i}`].mode).toBe('none')
    }
  })

  it('accepts custom thresholds', () => {
    const results = selectVisibleLabels([col('a', 0), col('b', 50)], 40, 10)
    const byId = Object.fromEntries(results.map(r => [r.id, r]))
    // spacing=50 > fullThreshold=40 → both full
    expect(byId['a'].mode).toBe('full')
    expect(byId['b'].mode).toBe('full')
  })
})
