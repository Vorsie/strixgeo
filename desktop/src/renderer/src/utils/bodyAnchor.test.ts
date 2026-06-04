import { describe, expect, it } from 'vitest'

import type { LithoLayerResponse } from '../api/client'
import type { PlacedColumn } from '../components/sections/utils'
import { extremeMemberLayerId, neighbourInvBeyondExtreme } from './bodyAnchor'

/** Minimal placed column carrying only the fields the helpers read. */
function col(invId: string, along: number): PlacedColumn {
  return { proj: { item: { id: invId }, along, offset: 0 } } as unknown as PlacedColumn
}

/** Minimal accepted litho layer member of a body, anchored to a CPT. */
function member(id: string, bodyId: string, invId: string): LithoLayerResponse {
  return { id, body_id: bodyId, cpt_id: invId, borehole_id: null } as unknown as LithoLayerResponse
}

// Columns A..D along the section at 0 / 10 / 20 / 30 m.
const COLS = [col('A', 0), col('B', 10), col('C', 20), col('D', 30)]
// A body with members on the two middle columns B and C.
const LAYERS = [member('l-b', 'body-1', 'B'), member('l-c', 'body-1', 'C')]

describe('neighbourInvBeyondExtreme', () => {
  it('left → the column just left of the leftmost member', () => {
    expect(neighbourInvBeyondExtreme('body-1', 'left', LAYERS, COLS)).toBe('A')
  })

  it('right → the column just right of the rightmost member', () => {
    expect(neighbourInvBeyondExtreme('body-1', 'right', LAYERS, COLS)).toBe('D')
  })

  it('returns null when the edge member sits at the section edge', () => {
    // Member on A (leftmost column) → nothing further left to pinch toward.
    const onEdge = [member('l-a', 'body-2', 'A')]
    expect(neighbourInvBeyondExtreme('body-2', 'left', onEdge, COLS)).toBeNull()
  })

  it('returns null when the body has no on-section member', () => {
    expect(neighbourInvBeyondExtreme('ghost', 'left', LAYERS, COLS)).toBeNull()
  })
})

describe('extremeMemberLayerId', () => {
  it('picks the leftmost / rightmost member layer per side', () => {
    expect(extremeMemberLayerId('body-1', 'left', LAYERS, COLS)).toBe('l-b')
    expect(extremeMemberLayerId('body-1', 'right', LAYERS, COLS)).toBe('l-c')
  })
})
