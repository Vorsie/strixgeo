/**
 * Pins for ``executeLithoContactSplitCopy`` — the "split at each boundary +
 * recompose the between-units" executor behind a multi-boundary litho copy onto a
 * target that already has layers (installer #40).
 *
 * The tricky invariant: a ``splitLayer`` keeps the original row as the top half
 * and mints a fresh bottom row, so several boundaries inside ONE target layer must
 * re-find the spanning layer after each cut (the second boundary falls inside the
 * fresh bottom row of the first). And only split-created rows are recomposed, so
 * the copy is undoable by deleting the created rows alone.
 */

import { describe, expect, it, vi } from 'vitest'

import { executeLithoContactSplitCopy } from './executeLithoContactSplitCopy'

function makeApi() {
  let bottomCounter = 0
  return {
    splitLayer: vi.fn(async (_p: string, _m: string, layerId: string, _depthM: number) => ({
      top: { id: layerId }, // the original row is kept as the top half.
      bottom: { id: `bottom-${bottomCounter++}` },
    })),
    batchUpdateLayers: vi.fn(
      async (
        _p: string,
        _m: string,
        _updates: readonly { layer_id: string; formation_id?: string }[],
      ) => ({ updated_count: 1 }),
    ),
  }
}

describe('executeLithoContactSplitCopy', () => {
  it('cuts two boundaries inside ONE target layer and recomposes the unit between', async () => {
    const api = makeApi()
    const result = await executeLithoContactSplitCopy(
      api,
      'p',
      'm',
      [{ id: 'b-only', depth_top_m: 0, depth_base_m: 12, formation_id: 'f-target' }],
      [{ depthM: 3 }, { depthM: 6 }],
      [{ formation_id: 'f-sand', depthTopM: 3, depthBaseM: 6 }],
    )
    // First cut on the original row, second cut on the bottom the first produced.
    expect(api.splitLayer.mock.calls.map(c => [c[2], c[3]])).toEqual([
      ['b-only', 3],
      ['bottom-0', 6],
    ])
    // The between-unit [3, 6] is the bottom row of the FIRST split → repointed once.
    expect(api.batchUpdateLayers).toHaveBeenCalledTimes(1)
    expect(api.batchUpdateLayers.mock.calls[0][2]).toEqual([
      { layer_id: 'bottom-0', formation_id: 'f-sand' },
    ])
    expect(result.recomposedCount).toBe(1)
    // Both fresh bottom rows are captured for a delete-only undo, tagged by cut depth.
    expect(result.createdLayers).toEqual([
      { id: 'bottom-0', depthTopM: 3 },
      { id: 'bottom-1', depthTopM: 6 },
    ])
  })

  it('never recomposes a pre-existing target row (keeps undo delete-only)', async () => {
    const api = makeApi()
    // The target already has a boundary at 6, so [3, 6] is a pre-existing row (id
    // 'pre') plus, after cutting 3, a fresh bottom. Only the fresh created rows are
    // recomposed; the pre-existing row is left alone.
    const result = await executeLithoContactSplitCopy(
      api,
      'p',
      'm',
      [
        { id: 'pre-top', depth_top_m: 0, depth_base_m: 6, formation_id: 'f-target' },
        { id: 'pre-bottom', depth_top_m: 6, depth_base_m: 12, formation_id: 'f-target' },
      ],
      [{ depthM: 3 }], // 6 is already a boundary → not in the split list.
      [{ formation_id: 'f-sand', depthTopM: 3, depthBaseM: 6 }],
    )
    // The between-unit [3, 6] = the fresh bottom of the 3 m cut (created), recomposed.
    expect(api.batchUpdateLayers).toHaveBeenCalledTimes(1)
    expect(api.batchUpdateLayers.mock.calls[0][2]).toEqual([
      { layer_id: 'bottom-0', formation_id: 'f-sand' },
    ])
    expect(result.createdLayers).toEqual([{ id: 'bottom-0', depthTopM: 3 }])
  })
})
