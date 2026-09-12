// Unit tests for buildRemoveFromSectionCommand (dogfeed 2026-05-23 —
// Ctrl+Z to undo a remove-test-from-section gesture).
//
// Claims:
//   R1  CPT remove: firstApply PATCHes the next excluded_cpt_ids; the
//       command's revert PATCHes back to the pre-remove snapshot;
//       reapply PATCHes forward again.
//   R2  Borehole remove: same contract on excluded_borehole_ids.
//   R3  Dedup: removing an id that's already in the excluded list is
//       idempotent (next === prev — no duplicate id appears).
//   R4  Description: human-readable, names the removed id (drives the
//       Edit menu's "Undo X" label).
//   R5  Snapshot isolation: mutating the caller's section object after
//       building the command does NOT affect the captured prev list
//       (the helper takes a defensive copy).

import { describe, expect, it, vi } from 'vitest'

import { buildRemoveFromSectionCommand } from './removeFromSectionCommand'

describe('buildRemoveFromSectionCommand', () => {
  it('R1 — CPT: firstApply adds the id; revert restores prev; reapply re-adds', async () => {
    const onPatch = vi.fn().mockResolvedValue(undefined)
    const cmd = buildRemoveFromSectionCommand(
      'cpt',
      'cpt-new',
      {
        excluded_cpt_ids: ['cpt-pre'],
        excluded_borehole_ids: [],
      },
      onPatch,
    )
    await cmd.firstApply()
    expect(onPatch).toHaveBeenCalledWith({
      excluded_cpt_ids: ['cpt-pre', 'cpt-new'],
    })

    onPatch.mockClear()
    await cmd.undoCmd.revert()
    expect(onPatch).toHaveBeenCalledWith({ excluded_cpt_ids: ['cpt-pre'] })

    onPatch.mockClear()
    await cmd.undoCmd.reapply()
    expect(onPatch).toHaveBeenCalledWith({
      excluded_cpt_ids: ['cpt-pre', 'cpt-new'],
    })
  })

  it('R2 — Borehole: same contract on excluded_borehole_ids', async () => {
    const onPatch = vi.fn().mockResolvedValue(undefined)
    const cmd = buildRemoveFromSectionCommand(
      'borehole',
      'bh-new',
      {
        excluded_cpt_ids: [],
        excluded_borehole_ids: ['bh-pre'],
      },
      onPatch,
    )
    await cmd.firstApply()
    expect(onPatch).toHaveBeenCalledWith({
      excluded_borehole_ids: ['bh-pre', 'bh-new'],
    })

    onPatch.mockClear()
    await cmd.undoCmd.revert()
    expect(onPatch).toHaveBeenCalledWith({ excluded_borehole_ids: ['bh-pre'] })
  })

  it('R3 — re-removing an already-excluded id is idempotent (Set dedup)', async () => {
    const onPatch = vi.fn().mockResolvedValue(undefined)
    const cmd = buildRemoveFromSectionCommand(
      'cpt',
      'cpt-dup',
      {
        excluded_cpt_ids: ['cpt-dup'],
        excluded_borehole_ids: [],
      },
      onPatch,
    )
    await cmd.firstApply()
    // No duplicate — Set dedup keeps the list at length 1.
    expect(onPatch).toHaveBeenCalledWith({ excluded_cpt_ids: ['cpt-dup'] })
  })

  it('R4 — description names the removed id (drives future Edit-menu labels)', () => {
    const cmd = buildRemoveFromSectionCommand(
      'cpt',
      'cpt-42',
      { excluded_cpt_ids: [], excluded_borehole_ids: [] },
      () => Promise.resolve(),
    )
    expect(cmd.undoCmd.descriptionKey).toBe('undo.removeFromSection')
    expect(cmd.undoCmd.descriptionParams).toEqual({ id: 'cpt-42' })
  })

  it('R5 — snapshot isolation: mutating the caller\'s list after build does not change the captured prev', async () => {
    const onPatch = vi.fn().mockResolvedValue(undefined)
    const mutableSection = {
      excluded_cpt_ids: ['cpt-pre'],
      excluded_borehole_ids: [] as string[],
    }
    const cmd = buildRemoveFromSectionCommand(
      'cpt',
      'cpt-new',
      mutableSection,
      onPatch,
    )
    // Caller mutates the live list after building — e.g. another
    // exclude landed between build and revert. The captured prev list
    // must NOT see this mutation; revert restores the snapshot.
    mutableSection.excluded_cpt_ids.push('cpt-meanwhile')
    await cmd.undoCmd.revert()
    // Snapshot's pre-remove list was ['cpt-pre'] — that is what revert
    // PATCHes back to (NOT the post-mutation ['cpt-pre','cpt-meanwhile']).
    expect(onPatch).toHaveBeenCalledWith({ excluded_cpt_ids: ['cpt-pre'] })
  })
})
