// Which standing unions a right-clicked body can Disjoin (debt #278, Join verb).
//
// A union ties two anchors that (once resolved) sit in one merged body; right-
// clicking that body offers "Disjoin {the other side's label}". These pins fix
// the filter (only unions touching this body) and the label source (the OTHER
// anchor's server-resolved display info: its body name, else its formation
// label). Mirrors buildRejoinOptions for the Separate verb.

import { describe, expect, it } from 'vitest'

import type { BodyUnionListItem } from '../../api/client'
import { buildDisjoinOptions } from './disjoinOptions'

function union(
  id: string,
  aBody: string | null,
  bBody: string | null,
  overrides: Partial<BodyUnionListItem> = {},
): BodyUnionListItem {
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
  fid === 'fa' ? 'Za2' : fid === 'fb' ? 'Za5' : undefined

describe('buildDisjoinOptions', () => {
  it('DJ1 — a union with THIS body on side A offers the OTHER (side B) label', () => {
    const unions = [union('u1', 'body-X', 'body-Y')]
    expect(buildDisjoinOptions('body-X', unions, label)).toEqual([{ unionId: 'u1', label: 'Za5' }])
  })

  it('DJ2 — this body on side B offers side A', () => {
    const unions = [union('u1', 'body-Y', 'body-X')]
    expect(buildDisjoinOptions('body-X', unions, label)).toEqual([{ unionId: 'u1', label: 'Za2' }])
  })

  it("DJ3 — the other anchor's body NAME wins over its formation label", () => {
    const unions = [
      union('u1', 'body-X', 'body-Y', {
        anchor_b: { layer_id: 'u1-b', body_id: 'body-Y', body_name: 'North lens', body_ordinal: 3, formation_id: 'fb' },
      }),
    ]
    expect(buildDisjoinOptions('body-X', unions, label)).toEqual([
      { unionId: 'u1', label: 'North lens' },
    ])
  })

  it('DJ4 — unions not touching this body are dropped', () => {
    const unions = [union('u1', 'body-A', 'body-B')]
    expect(buildDisjoinOptions('body-X', unions, label)).toEqual([])
  })

  it('DJ5 — undefined unions → no options', () => {
    expect(buildDisjoinOptions('body-X', undefined, label)).toEqual([])
  })
})
