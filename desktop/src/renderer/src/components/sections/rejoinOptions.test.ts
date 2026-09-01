// Which standing separations a right-clicked body can Rejoin (debt #278 R5).
//
// A separation ties two anchors that now live in DIFFERENT bodies; right-clicking
// one body offers "Rejoin with <the other body>". These pins fix the filter (only
// separations touching this body) and the label source (the OTHER anchor's
// server-resolved display info: its body name, else its formation label).

import { describe, expect, it } from 'vitest'

import type { BodySeparationListItem } from '../../api/client'
import { buildRejoinOptions } from './rejoinOptions'

function sep(
  id: string,
  aBody: string | null,
  bBody: string | null,
  overrides: Partial<BodySeparationListItem> = {},
): BodySeparationListItem {
  return {
    id,
    model_id: 'm1',
    layer_a_id: `${id}-a`,
    layer_b_id: `${id}-b`,
    anchor_a: { layer_id: `${id}-a`, body_id: aBody, body_name: null, body_ordinal: 0, formation_id: 'fa' },
    anchor_b: { layer_id: `${id}-b`, body_id: bBody, body_name: null, body_ordinal: 0, formation_id: 'fb' },
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

const label = (fid: string | null): string | undefined =>
  fid === 'fa' ? 'Za2' : fid === 'fb' ? 'Kl1' : undefined

describe('buildRejoinOptions', () => {
  it('RJ1 — a separation with THIS body on side A offers the OTHER (side B) label', () => {
    const seps = [sep('s1', 'body-X', 'body-Y')]
    expect(buildRejoinOptions('body-X', seps, label)).toEqual([{ separationId: 's1', label: 'Kl1' }])
  })

  it('RJ2 — this body on side B offers side A', () => {
    const seps = [sep('s1', 'body-Y', 'body-X')]
    expect(buildRejoinOptions('body-X', seps, label)).toEqual([{ separationId: 's1', label: 'Za2' }])
  })

  it('RJ3 — the other anchor\'s body NAME wins over its formation label', () => {
    const seps = [
      sep('s1', 'body-X', 'body-Y', {
        anchor_b: { layer_id: 's1-b', body_id: 'body-Y', body_name: 'North lens', body_ordinal: 3, formation_id: 'fb' },
      }),
    ]
    expect(buildRejoinOptions('body-X', seps, label)).toEqual([
      { separationId: 's1', label: 'North lens' },
    ])
  })

  it('RJ4 — separations not touching this body are dropped', () => {
    const seps = [sep('s1', 'body-A', 'body-B')]
    expect(buildRejoinOptions('body-X', seps, label)).toEqual([])
  })

  it('RJ5 — undefined separations → no options', () => {
    expect(buildRejoinOptions('body-X', undefined, label)).toEqual([])
  })
})
