// Saving / deleting a borehole track from the Tracks panel (owner 2026-09-29).
//
// Rules (session main): adding and editing a track are UNDOABLE through the
// app's undo stack; after any change the borehole detail is refetched, the
// section view redraws (the track revision bumps), and the project is marked
// mutated (the unsaved marker + File -> Save prompt).
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { BoreholeTrackResponse, TrackIntervalBody } from '../api/client'
import type { UndoCommand } from './useUndoStack'
import { getBoreholeTracksRevision } from './boreholeTracksRevision'
import { useBoreholeTrackEdits } from './useBoreholeTrackEdits'

const BEFORE: TrackIntervalBody[] = [{ top_m: 0, base_m: 2, main_soil_codes: ['FZ'] }]
const AFTER: TrackIntervalBody[] = [{ top_m: 0, base_m: 2.5, main_soil_codes: ['FZ'] }]

function response(trackId: string, kind = 'coded_lithology'): BoreholeTrackResponse {
  return {
    track_id: trackId,
    kind,
    family: 'observation',
    source: 'manual',
    edited_manually_at: '2026-09-29T12:00:00Z',
    dov_permkey: null,
    intervals: AFTER,
    warnings: [],
  }
}

function setup() {
  const client = {
    createTrack: vi.fn(async () => response('obs-new')),
    replaceTrack: vi.fn(async (_b: string, _p: string, trackId: string) => response(trackId)),
    deleteTrack: vi.fn(async () => undefined),
    resetTracksToDov: vi.fn(async () => ({ tracks: [], discarded_edits: 1, kept_manual: 0 })),
  }
  const pushed: UndoCommand[] = []
  const markMutated = vi.fn()
  const reloadBoreholeDetail = vi.fn(async () => undefined)
  const { result } = renderHook(() =>
    useBoreholeTrackEdits({
      projectId: 'proj-1',
      pushUndo: cmd => pushed.push(cmd),
      markMutated,
      reloadBoreholeDetail,
      client,
    }),
  )
  return { result, client, pushed, markMutated, reloadBoreholeDetail }
}

describe('useBoreholeTrackEdits', () => {
  beforeEach(() => vi.clearAllMocks())

  it('adds a track, refetches the borehole, redraws the sections and marks the project', async () => {
    const s = setup()
    const revision = getBoreholeTracksRevision()
    await act(async () => {
      await s.result.current.saveTrack('bh-1', {
        trackId: null,
        kind: 'coded_lithology',
        intervals: AFTER,
        before: null,
      })
    })
    expect(s.client.createTrack).toHaveBeenCalledWith('bh-1', 'proj-1', 'coded_lithology', AFTER)
    expect(s.reloadBoreholeDetail).toHaveBeenCalledWith('bh-1')
    expect(getBoreholeTracksRevision()).toBeGreaterThan(revision)
    expect(s.markMutated).toHaveBeenCalled()
    expect(s.pushed).toHaveLength(1)
    expect(s.pushed[0].descriptionKey).toBe('undo.addBoreholeTrack')
  })

  it('undoing an added track deletes it; redoing adds it again and the next undo targets the new id', async () => {
    const s = setup()
    await act(async () => {
      await s.result.current.saveTrack('bh-1', {
        trackId: null,
        kind: 'coded_lithology',
        intervals: AFTER,
        before: null,
      })
    })
    await s.pushed[0].revert()
    expect(s.client.deleteTrack).toHaveBeenLastCalledWith('bh-1', 'proj-1', 'obs-new')
    s.client.createTrack.mockResolvedValueOnce(response('obs-again'))
    await s.pushed[0].reapply()
    await s.pushed[0].revert()
    expect(s.client.deleteTrack).toHaveBeenLastCalledWith('bh-1', 'proj-1', 'obs-again')
  })

  it('editing a track is undone by writing the previous intervals back', async () => {
    const s = setup()
    await act(async () => {
      await s.result.current.saveTrack('bh-1', {
        trackId: 'obs-dov',
        kind: 'coded_lithology',
        intervals: AFTER,
        before: BEFORE,
      })
    })
    expect(s.client.replaceTrack).toHaveBeenCalledWith('bh-1', 'proj-1', 'obs-dov', AFTER)
    expect(s.pushed[0].descriptionKey).toBe('undo.editBoreholeTrack')
    await s.pushed[0].revert()
    expect(s.client.replaceTrack).toHaveBeenLastCalledWith('bh-1', 'proj-1', 'obs-dov', BEFORE)
    await s.pushed[0].reapply()
    expect(s.client.replaceTrack).toHaveBeenLastCalledWith('bh-1', 'proj-1', 'obs-dov', AFTER)
    expect(s.reloadBoreholeDetail).toHaveBeenCalledTimes(3)
  })

  it('a refused save pushes no undo step and marks nothing', async () => {
    const s = setup()
    s.client.replaceTrack.mockRejectedValueOnce(new Error('422'))
    await expect(
      s.result.current.saveTrack('bh-1', {
        trackId: 'obs-dov',
        kind: 'coded_lithology',
        intervals: AFTER,
        before: BEFORE,
      }),
    ).rejects.toThrow('422')
    expect(s.pushed).toHaveLength(0)
    expect(s.markMutated).not.toHaveBeenCalled()
  })

  it('deleting a track (confirmed in the dialog) refetches and marks, with no undo step', async () => {
    const s = setup()
    await act(async () => {
      await s.result.current.deleteTrack('bh-1', 'field_log:color')
    })
    expect(s.client.deleteTrack).toHaveBeenCalledWith('bh-1', 'proj-1', 'field_log:color')
    expect(s.reloadBoreholeDetail).toHaveBeenCalledWith('bh-1')
    expect(s.markMutated).toHaveBeenCalled()
    expect(s.pushed).toHaveLength(0)
  })
})

describe('useBoreholeTrackEdits — Reset to DOV (owner 2026-09-30)', () => {
  // "there needs to be a per borehole button to reset to dov defaults": the
  // reset is confirmed in the dialog and pushes NO undo step (the confirm is
  // the guard); the borehole is refetched and the sections redraw like any edit.
  it('resets the whole borehole, refetches it, marks the project and pushes no undo', async () => {
    const s = setup()
    const revision = getBoreholeTracksRevision()
    let outcome: unknown
    await act(async () => {
      outcome = await s.result.current.resetToDov('bh-1', null)
    })
    expect(s.client.resetTracksToDov).toHaveBeenCalledWith('bh-1', 'proj-1', null)
    expect(outcome).toEqual({ tracks: [], discarded_edits: 1, kept_manual: 0 })
    expect(s.reloadBoreholeDetail).toHaveBeenCalledWith('bh-1')
    expect(getBoreholeTracksRevision()).toBeGreaterThan(revision)
    expect(s.markMutated).toHaveBeenCalled()
    expect(s.pushed).toHaveLength(0)
  })

  it('resets one track when given its id', async () => {
    const s = setup()
    await act(async () => {
      await s.result.current.resetToDov('bh-1', 'field_log:color')
    })
    expect(s.client.resetTracksToDov).toHaveBeenCalledWith('bh-1', 'proj-1', 'field_log:color')
  })
})
