import { describe, expect, it, vi } from 'vitest'

import {
  buildSplitLayerUndoCommand,
  type SplitLayerUndoApi,
  type SplitLayerUndoFacts,
} from './splitLayerUndo'

// Owner ruling (installer #26, 2026-09-08): "hier splitsen ... should be
// revertible with ctrl z or the button". A split cut one accepted layer into a
// kept top half + a new bottom row; undo must put the two halves back into the
// original layer, and redo must split it again.

const FACTS: SplitLayerUndoFacts = {
  projectId: 'proj-1',
  modelId: 'model-1',
  topLayerId: 'top-1',
  bottomLayerId: 'bottom-1',
  splitDepthM: 4.25,
}

function makeApi(): SplitLayerUndoApi & {
  splitLayer: ReturnType<typeof vi.fn>
  deleteLayer: ReturnType<typeof vi.fn>
} {
  let n = 1
  return {
    // Each re-split returns a NEW bottom id so the test can prove the command
    // re-anchors (the "mutate captured ids in reapply" contract).
    splitLayer: vi.fn(async (_p: string, _m: string, layerId: string) => ({
      top: { id: layerId },
      bottom: { id: `bottom-redo-${n++}` },
    })),
    deleteLayer: vi.fn(async () => undefined),
  }
}

describe('buildSplitLayerUndoCommand', () => {
  it('undo re-merges the two halves by deleting the bottom row', async () => {
    const api = makeApi()
    const settle = vi.fn(async () => undefined)
    const cmd = buildSplitLayerUndoCommand(FACTS, api, settle)

    await cmd.revert()

    // The merge is a single delete of the bottom half; the mirror closes the
    // column back onto the top layer's original base.
    expect(api.deleteLayer).toHaveBeenCalledTimes(1)
    expect(api.deleteLayer).toHaveBeenCalledWith('proj-1', 'model-1', 'bottom-1')
    expect(api.splitLayer).not.toHaveBeenCalled()
    expect(settle).toHaveBeenCalledTimes(1)
  })

  it('redo splits the same top layer again at the same depth', async () => {
    const api = makeApi()
    const settle = vi.fn(async () => undefined)
    const cmd = buildSplitLayerUndoCommand(FACTS, api, settle)

    await cmd.revert()
    await cmd.reapply()

    expect(api.splitLayer).toHaveBeenCalledTimes(1)
    expect(api.splitLayer).toHaveBeenCalledWith('proj-1', 'model-1', 'top-1', 4.25)
  })

  it('after redo, the NEXT undo deletes the freshly-created bottom row', async () => {
    const api = makeApi()
    const settle = vi.fn(async () => undefined)
    const cmd = buildSplitLayerUndoCommand(FACTS, api, settle)

    await cmd.revert() // deletes bottom-1
    await cmd.reapply() // re-splits -> new bottom-redo-1
    await cmd.revert() // must delete the NEW row, not the stale bottom-1

    expect(api.deleteLayer).toHaveBeenLastCalledWith(
      'proj-1',
      'model-1',
      'bottom-redo-1',
    )
  })
})
