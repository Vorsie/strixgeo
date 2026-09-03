// The flat index model behind the windowed inspector list (M7b).
//
// buildFlatRows is the pure part: it must reproduce the exact order the
// non-virtualised list rendered — visible rows, then a single "N hidden"
// divider (only when something is hidden), then the hidden rows.

import { describe, expect, it } from 'vitest'

import { buildFlatRows } from './dataInspectorVirtualList'

describe('buildFlatRows (M7b)', () => {
  it('F1 — visible rows, then a divider, then hidden rows', () => {
    const rows = buildFlatRows(['a', 'b'], ['c'])
    expect(rows).toEqual([
      { kind: 'row', item: 'a', hidden: false },
      { kind: 'row', item: 'b', hidden: false },
      { kind: 'separator', count: 1 },
      { kind: 'row', item: 'c', hidden: true },
    ])
  })

  it('F2 — no divider when nothing is hidden', () => {
    const rows = buildFlatRows(['a', 'b'], [])
    expect(rows.some(r => r.kind === 'separator')).toBe(false)
    expect(rows).toHaveLength(2)
  })

  it('F3 — the divider count is the number of hidden rows', () => {
    const rows = buildFlatRows([], ['x', 'y', 'z'])
    const sep = rows.find(r => r.kind === 'separator')
    expect(sep).toEqual({ kind: 'separator', count: 3 })
  })
})
