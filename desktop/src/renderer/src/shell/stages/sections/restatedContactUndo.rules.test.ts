// RU — the restated-contact undo is the inverse the dialog promises (audit F11).
//
// The interesting properties are the ORDER of the merge inverse (move back, THEN
// split — reversed, the split would land on the litho contact and be refused) and the
// re-anchoring across undo/redo cycles, which is where stale-id bugs live.

import { describe, expect, it, vi } from 'vitest'

import { buildRestatedContactUndoCommand } from './restatedContactUndo'

const FACTS = {
  projectId: 'proj',
  modelId: 'model',
  upperBandId: 'upper',
  lowerBandId: 'lower',
  preDragDepthM: 5.0,
  landedDepthM: 7.0,
  belowBandId: 'below',
  aboveBandId: 'above',
}

function apiMocks(splitCreates: string[] = ['n1', 'n2', 'n3']) {
  const created = [...splitCreates]
  return {
    moveRestatedContact: vi.fn().mockResolvedValue({}),
    splitGeotechBand: vi
      .fn()
      .mockImplementation(async () => ({ created_layer_ids: [created.shift() ?? 'nX'] })),
  }
}

describe('the restated-contact undo command', () => {
  it('RU1 — a plain move reverts by moving back and reapplies by moving again', async () => {
    const api = apiMocks()
    const settle = vi.fn().mockResolvedValue(undefined)
    const cmd = buildRestatedContactUndoCommand(FACTS, [], api, settle)
    expect(cmd).not.toBeNull()

    await cmd!.revert()
    expect(api.moveRestatedContact).toHaveBeenCalledWith('proj', 'model', 'upper', 'lower', 5.0)
    expect(api.splitGeotechBand).not.toHaveBeenCalled()

    await cmd!.reapply()
    expect(api.moveRestatedContact).toHaveBeenLastCalledWith('proj', 'model', 'upper', 'lower', 7.0)
    expect(settle).toHaveBeenCalledTimes(2)
  })

  it('RU2 — the merge-down revert moves back FIRST, then splits at the old boundary', async () => {
    // Reversed, the split would try to restore a packing boundary exactly on the
    // litho contact and be refused — the order is the load-bearing part.
    const api = apiMocks()
    const calls: string[] = []
    api.moveRestatedContact.mockImplementation(async () => calls.push('move'))
    api.splitGeotechBand.mockImplementation(async () => {
      calls.push('split')
      return { created_layer_ids: ['n1'] }
    })
    const cmd = buildRestatedContactUndoCommand(FACTS, ['lower'], api, vi.fn())
    expect(cmd).not.toBeNull()

    await cmd!.revert()
    expect(calls).toEqual(['move', 'split'])
    // The contact goes back to the pre-drag depth, addressed at the pair that exists
    // AFTER the merge: the survivor and the band below the landing.
    expect(api.moveRestatedContact).toHaveBeenCalledWith('proj', 'model', 'upper', 'below', 5.0)
    // The split restores the packing boundary where the merge landed.
    expect(api.splitGeotechBand).toHaveBeenCalledWith('proj', 'model', 'below', 7.0)
  })

  it('RU3 — merge-down redo cycles re-anchor onto the rows the reverts created', async () => {
    const api = apiMocks(['n1', 'n2'])
    const cmd = buildRestatedContactUndoCommand(FACTS, ['lower'], api, vi.fn())

    await cmd!.revert() // splits 'below' -> creates n1
    await cmd!.reapply() // merges 'below' away again; the next revert must target n1
    await cmd!.revert()
    expect(api.moveRestatedContact).toHaveBeenLastCalledWith('proj', 'model', 'upper', 'n1', 5.0)
    expect(api.splitGeotechBand).toHaveBeenLastCalledWith('proj', 'model', 'n1', 7.0)

    await cmd!.reapply() // absorbs n1; next cycle targets n2
    await cmd!.revert()
    expect(api.moveRestatedContact).toHaveBeenLastCalledWith('proj', 'model', 'upper', 'n2', 5.0)
  })

  it('RU4 — the merge-up revert addresses the band ABOVE, and redo absorbs the split-off half', async () => {
    const api = apiMocks(['restored-upper'])
    const cmd = buildRestatedContactUndoCommand(FACTS, ['upper'], api, vi.fn())
    expect(cmd).not.toBeNull()

    await cmd!.revert()
    // Contact back down to the pre-drag depth, between the band above and the survivor.
    expect(api.moveRestatedContact).toHaveBeenCalledWith('proj', 'model', 'above', 'lower', 5.0)
    // The split restores the absorbed band as the lower half of 'above'.
    expect(api.splitGeotechBand).toHaveBeenCalledWith('proj', 'model', 'above', 7.0)

    await cmd!.reapply()
    // The redo re-absorbs exactly the row the revert's split created.
    expect(api.moveRestatedContact).toHaveBeenLastCalledWith(
      'proj',
      'model',
      'restored-upper',
      'lower',
      7.0,
    )
  })

  it('RU5 — a merge whose needed neighbour was never captured builds NO command', async () => {
    // A wrong undo is worse than a missing one: guessing a neighbour id would revert
    // somebody else's band. The caller logs the gap and pushes nothing.
    const api = apiMocks()
    expect(
      buildRestatedContactUndoCommand({ ...FACTS, belowBandId: null }, ['lower'], api, vi.fn()),
    ).toBeNull()
    expect(
      buildRestatedContactUndoCommand({ ...FACTS, aboveBandId: null }, ['upper'], api, vi.fn()),
    ).toBeNull()
    // A deletion naming neither of the pair means server and renderer disagree.
    expect(buildRestatedContactUndoCommand(FACTS, ['stranger'], api, vi.fn())).toBeNull()
  })

  it('RU6 — settle runs once per action, after every write of that action', async () => {
    const api = apiMocks()
    const order: string[] = []
    api.moveRestatedContact.mockImplementation(async () => order.push('move'))
    api.splitGeotechBand.mockImplementation(async () => {
      order.push('split')
      return { created_layer_ids: ['n1'] }
    })
    const settle = vi.fn().mockImplementation(async () => order.push('settle'))
    const cmd = buildRestatedContactUndoCommand(FACTS, ['lower'], api, settle)

    await cmd!.revert()
    expect(order).toEqual(['move', 'split', 'settle'])
  })
})
