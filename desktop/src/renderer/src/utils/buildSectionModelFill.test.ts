/**
 * Tests for buildModelFillMeshes — written FIRST (TDD red before green).
 *
 * Rules exercised:
 *  1. A non-flagged solid is mapped to a SolidMesh with body_id → bodyId,
 *     formation_id → formationId, vertices + triangles passed through.
 *  2. display_color is used when set; falls back to colorOf(formationId) when
 *     display_color is null or undefined.
 *  3. Solids with is_flagged: true are excluded (flagged = under-constrained;
 *     the sampler requires watertight meshes).
 *  4. Empty input → empty output.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildModelFillMeshes } from './buildSectionModelFill'
import type { LithoBodySolidResponse } from '../api/clients/geology'

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function makeSolid(
  overrides: Partial<LithoBodySolidResponse> = {},
): LithoBodySolidResponse {
  return {
    id: 'solid-1',
    model_id: 'model-1',
    body_id: 'body-1',
    formation_id: 'formation-1',
    body_ordinal: 0,
    method: 'tin',
    vertices: [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ],
    triangles: [[0, 1, 2]],
    is_flagged: false,
    is_stale: false,
    display_color: null,
    ...overrides,
  }
}

const colorOf = vi.fn((fid: string) => `#color-${fid}`)

beforeEach(() => {
  colorOf.mockClear()
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('buildModelFillMeshes', () => {
  it('maps a non-flagged solid to a SolidMesh with ids and geometry carried through', () => {
    const solid = makeSolid({ body_id: 'b-1', formation_id: 'f-1' })
    const result = buildModelFillMeshes([solid], colorOf)

    expect(result).toHaveLength(1)
    expect(result[0].bodyId).toBe('b-1')
    expect(result[0].formationId).toBe('f-1')
    expect(result[0].vertices).toEqual(solid.vertices)
    expect(result[0].triangles).toEqual(solid.triangles)
  })

  it('uses display_color when set', () => {
    const solid = makeSolid({ display_color: '#ff0000', formation_id: 'f-1' })
    const result = buildModelFillMeshes([solid], colorOf)

    expect(result[0].color).toBe('#ff0000')
    // colorOf must NOT be called when display_color is provided
    expect(colorOf).not.toHaveBeenCalled()
  })

  it('falls back to colorOf(formationId) when display_color is null', () => {
    const solid = makeSolid({ display_color: null, formation_id: 'f-abc' })
    const result = buildModelFillMeshes([solid], colorOf)

    expect(result[0].color).toBe('#color-f-abc')
    expect(colorOf).toHaveBeenCalledWith('f-abc')
  })

  it('falls back to colorOf(formationId) when display_color is undefined', () => {
    const solid = makeSolid({ formation_id: 'f-xyz' })
    // strip display_color entirely
    const { display_color: _dc, ...rest } = solid
    const result = buildModelFillMeshes([rest as LithoBodySolidResponse], colorOf)

    expect(result[0].color).toBe('#color-f-xyz')
  })

  it('filters out solids with is_flagged: true', () => {
    const good = makeSolid({ body_id: 'b-good', is_flagged: false })
    const bad = makeSolid({ body_id: 'b-bad', is_flagged: true })
    const result = buildModelFillMeshes([good, bad], colorOf)

    expect(result).toHaveLength(1)
    expect(result[0].bodyId).toBe('b-good')
  })

  it('returns an empty array for empty input', () => {
    const result = buildModelFillMeshes([], colorOf)
    expect(result).toHaveLength(0)
  })
})
