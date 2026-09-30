/**
 * Save / delete a borehole track from the Tracks panel (owner 2026-09-29: "i
 * want to be able to add or change any track").
 *
 * Mirrors the elevation-PATCH template (``patchInvestigationElevation``):
 * mutate on the server, refresh the local copy, push an undo command whose
 * closures capture plain ids. Adding and editing are UNDOABLE (reversible,
 * docs/ux.md); deleting a whole track is confirmed in the dialog instead and
 * pushes no undo step (an imported track cannot be recreated as DOV data).
 *
 * Reset to DOV (owner 2026-09-30) rewrites the DOV tracks from the cached DOV
 * XML. It pushes NO undo step either: the dialog's confirmation is the guard,
 * and the hand edits it discards are not kept anywhere to restore.
 *
 * After every change: the borehole detail is refetched (the borelog and the
 * Tracks list redraw), the track revision bumps (an open section refetches its
 * columns), and the project is marked mutated (unsaved marker, File -> Save).
 */
import { useCallback } from 'react'

import { api } from '../api/client'
import type {
  BoreholeTrackResetResponse,
  BoreholeTrackResponse,
  TrackIntervalBody,
} from '../api/client'
import { log } from '../utils/log'
import { bumpBoreholeTracksRevision } from './boreholeTracksRevision'
import type { UndoCommand } from './useUndoStack'

/** The editor's save request. */
export interface TrackSaveDraft {
  /** ``null`` = a new track; otherwise the track being edited. */
  trackId: string | null
  kind: string
  /** The full new interval list. */
  intervals: TrackIntervalBody[]
  /** The intervals before the edit (the undo target); ``null`` for a new track. */
  before: TrackIntervalBody[] | null
}

/** The track mutations the borelog's Tracks panel calls. */
export interface BoreholeTrackEditing {
  /** Create or replace a track; rejects with the server error (e.g. the 422). */
  saveTrack: (boreholeId: string, draft: TrackSaveDraft) => Promise<BoreholeTrackResponse>
  /** Delete a whole track (the caller has confirmed). */
  deleteTrack: (boreholeId: string, trackId: string) => Promise<void>
  /** Reset every DOV track (``trackId = null``) or one to DOV (the caller has
   *  confirmed); rejects with the server error (e.g. the 409 no-source). */
  resetToDov: (boreholeId: string, trackId: string | null) => Promise<BoreholeTrackResetResponse>
}

/** The three client calls the hook uses (injectable for tests). */
export type BoreholeTrackClient = Pick<
  typeof api.borehole,
  'createTrack' | 'replaceTrack' | 'deleteTrack' | 'resetTracksToDov'
>

interface Args {
  projectId: string | null
  pushUndo: (cmd: UndoCommand) => void
  markMutated: () => void
  /** Refetch one borehole's detail, bypassing the cache. */
  reloadBoreholeDetail: (boreholeId: string) => Promise<void>
  client?: BoreholeTrackClient
}

/**
 * The track-editing handlers for the active project.
 *
 * @param args.projectId - Active project id (captured into the undo closures).
 * @param args.pushUndo - The undo-stack push.
 * @param args.markMutated - Marks the project dirty.
 * @param args.reloadBoreholeDetail - Forced refetch of one borehole's detail.
 * @param args.client - Client override (tests); defaults to ``api.borehole``.
 * @returns ``saveTrack``, ``deleteTrack`` and ``resetToDov``.
 */
export function useBoreholeTrackEdits({
  projectId,
  pushUndo,
  markMutated,
  reloadBoreholeDetail,
  client,
}: Args): BoreholeTrackEditing {
  const c: BoreholeTrackClient = client ?? api.borehole

  const settle = useCallback(
    async (boreholeId: string) => {
      bumpBoreholeTracksRevision()
      markMutated()
      await reloadBoreholeDetail(boreholeId)
    },
    [markMutated, reloadBoreholeDetail],
  )

  const saveTrack = useCallback(
    async (boreholeId: string, draft: TrackSaveDraft): Promise<BoreholeTrackResponse> => {
      if (!projectId) throw new Error('no active project')
      const pid = projectId
      const { kind, intervals, before } = draft
      if (draft.trackId === null) {
        const created = await c.createTrack(boreholeId, pid, kind, intervals)
        log.info(
          'borehole',
          `track created: ${boreholeId} ${kind} -> ${created.track_id} ` +
            `(${created.intervals.length} intervals, ${created.warnings.length} warnings)`,
        )
        await settle(boreholeId)
        // The undo closures re-target the freshly created id after a redo.
        let liveId = created.track_id
        pushUndo({
          descriptionKey: 'undo.addBoreholeTrack',
          revert: async () => {
            await c.deleteTrack(boreholeId, pid, liveId)
            await settle(boreholeId)
          },
          reapply: async () => {
            const again = await c.createTrack(boreholeId, pid, kind, intervals)
            liveId = again.track_id
            await settle(boreholeId)
          },
        })
        return created
      }
      const trackId = draft.trackId
      const saved = await c.replaceTrack(boreholeId, pid, trackId, intervals)
      log.info(
        'borehole',
        `track replaced: ${boreholeId} ${trackId} (${kind}, source=${saved.source}, ` +
          `${saved.intervals.length} intervals, ${saved.warnings.length} warnings)`,
      )
      await settle(boreholeId)
      if (before !== null) {
        pushUndo({
          descriptionKey: 'undo.editBoreholeTrack',
          revert: async () => {
            await c.replaceTrack(boreholeId, pid, trackId, before)
            await settle(boreholeId)
          },
          reapply: async () => {
            await c.replaceTrack(boreholeId, pid, trackId, intervals)
            await settle(boreholeId)
          },
        })
      }
      return saved
    },
    [c, projectId, pushUndo, settle],
  )

  const deleteTrack = useCallback(
    async (boreholeId: string, trackId: string): Promise<void> => {
      if (!projectId) throw new Error('no active project')
      await c.deleteTrack(boreholeId, projectId, trackId)
      log.info('borehole', `track deleted: ${boreholeId} ${trackId}`)
      await settle(boreholeId)
    },
    [c, projectId, settle],
  )

  const resetToDov = useCallback(
    async (boreholeId: string, trackId: string | null): Promise<BoreholeTrackResetResponse> => {
      if (!projectId) throw new Error('no active project')
      const outcome = await c.resetTracksToDov(boreholeId, projectId, trackId)
      log.info(
        'borehole',
        `tracks reset to DOV: ${boreholeId} ${trackId ?? 'all'} -> ${outcome.tracks.length} track(s), ` +
          `${outcome.discarded_edits} hand edit(s) discarded, ${outcome.kept_manual} manual kept`,
      )
      await settle(boreholeId)
      return outcome
    },
    [c, projectId, settle],
  )

  return { saveTrack, deleteTrack, resetToDov }
}
