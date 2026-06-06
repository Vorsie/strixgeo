// Sub-hook: litho-suggestion handlers extracted from useGeologicalModel
// (debt #201 Move 5 — god-component decomposition).
//
// Owns every handler that reads or writes the ghost-overlay state
// (ghostsByAnchor / focusedSuggestAnchorId) plus the suggest/accept/
// reject lifecycle: handleSuggestLitho, handleAcceptLithoSuggestion,
// handleAcceptAllLithoSuggestions, handleSuggestAllLitho, the bulk
// accept variants, reject/unreject, edit, insert/split/merge/absorb,
// auto-correlate, and clear-suggestions.
//
// Dep-array convention:
//   Stable React setState setters (setGhostsByAnchor, setFocusedSuggestAnchorId,
//   setLithoSuggesting, setBulkLithoSuggesting, setLithoCrossingPinchOuts,
//   setLithoStaleTinSessionCount) are intentionally omitted from dep arrays —
//   React guarantees their identity is stable across renders. The same applies
//   to ``toast`` and other stable callbacks passed by reference; individual
//   handlers carry verbatim dep arrays from the composer, including any
//   ``// eslint-disable-next-line`` annotations and the ``// reason:`` blocks
//   that accompany them.
//
// Internal helper:
//   ``_updateGhostEntry`` is a shared useCallback used by several handlers.
//   It is NOT exported (not in the return type) — it is defined inside the
//   sub-hook and referenced by the handlers that need it.

import { useCallback, useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'

import { api } from '../api/client'
import type {
  AcceptLithoSuggestionsResponse,
  BatchAcceptLithoSuggestionsResponse,
  CrossingPinchOut,
  CrossSectionResponse,
  FormationContactResponse,
  GeologicalFormationResponse,
  GeologicalModelResponse,
  LithoLayerSuggestion,
  ProjectResponse,
} from '../api/client'
import type { BulkAnchorGhost, LithoSuggestionEdit } from './useGeologicalModel'
import type { UndoCommand } from './useUndoStack'
import { log } from '../utils/log'
import {
  buildLithoAcceptBody,
  lithoAcceptTuningParams,
  recordCreatedRows,
} from '../utils/lithoAccept'
import { readLithoSegmenterPrefs } from '../utils/lithoSegmenterPrefs'
import { formatAcceptParentSummary, formatStraddleSummary } from '../utils/acceptLithoSummary'
import { extendGhostToNearest } from '../utils/extendGhostToNearest'
import { absorbLithoLayer, applyCrossMergeOnDrag, mergeLithoLayers } from '../utils/lithoLayerMerge'
import { insertLithoLayer } from '../utils/lithoLayerInsert'
import { splitLithoLayer } from '../utils/lithoLayerSplit'
import { insertManualGhostLayer } from '../utils/insertManualGhostLayer'

// ---- Parameter interface ---------------------------------------------------

export interface UseLithoSuggestionsParams {
  project: ProjectResponse | null
  activeLithoModelRef: MutableRefObject<GeologicalModelResponse | null>
  lithoContacts: FormationContactResponse[]
  activeLithoModel: GeologicalModelResponse | null
  /** All geological formations in the active project (used to resolve litho codes). */
  formations: GeologicalFormationResponse[]
  addToSessionImports: (kind: 'formation' | 'contact', ids: string[]) => void
  pushUndo: (cmd: UndoCommand) => void
  markMutated: () => void
  requestCorrelationEdgesRefetch: () => void
  refetchLithoContacts: () => void
  refetchFormations: () => void
  toast: (type: 'success' | 'error' | 'warning', message: string) => void
  setGhostsByAnchor: Dispatch<SetStateAction<ReadonlyMap<string, BulkAnchorGhost>>>
  setFocusedSuggestAnchorId: Dispatch<SetStateAction<string | null>>
  setLithoSuggesting: Dispatch<SetStateAction<boolean>>
  setBulkLithoSuggesting: Dispatch<SetStateAction<boolean>>
  setLithoCrossingPinchOuts: Dispatch<SetStateAction<CrossingPinchOut[]>>
  setLithoStaleTinSessionCount: Dispatch<SetStateAction<number>>
  ghostsByAnchor: ReadonlyMap<string, BulkAnchorGhost>
  focusedSuggestAnchorId: string | null
  focusedSuggestAnchorIdRef: MutableRefObject<string | null>
  lithoSuggestions: LithoLayerSuggestion[]
  lithoSuggestionEdits: ReadonlyMap<number, LithoSuggestionEdit>
  lithoSuggestionRejected: ReadonlySet<number>
  lithoSuggestionAnchorKind: 'cpt' | 'borehole' | null
  lithoSuggestionInvestigationId: string | null
  bulkGhostsByAnchor: ReadonlyMap<string, BulkAnchorGhost>
}

// ---- Return type -----------------------------------------------------------

export interface UseLithoSuggestionsResult {
  handleAutoCorrelate: (sectionId?: string | null) => Promise<void>
  handleClearSuggestions: () => Promise<void>
  handleEditLithoSuggestion: (idx: number, edit: LithoSuggestionEdit) => void
  effectiveLithoSuggestionAt: (idx: number) => LithoLayerSuggestion | null
  clearLithoSuggestions: () => void
  clearBulkLithoGhosts: () => void
  handleStripLithoAdmixtures: (scope: 'cpt' | 'borehole' | 'all') => void
  handleReseedLithoAdmixtures: () => void
  handleRejectBulkLitho: (anchorId: string, idx: number) => void
  handleUnrejectBulkLitho: (anchorId: string, idx: number) => void
  handleEditBulkLitho: (anchorId: string, idx: number, edit: LithoSuggestionEdit) => void
  handleInsertLithoLayer: (
    anchorId: string,
    afterIdx: number,
    composition: {
      suggested_lithology: string
      suggested_admixtures: readonly { soil_code: string; amount: string; locally: boolean }[]
    },
  ) => void
  handleSplitLithoLayer: (anchorId: string, idx: number) => void
  handleMergeLithoLayers: (anchorId: string, upperIdx: number) => void
  handleAbsorbLithoLayer: (anchorId: string, draggerIdx: number, direction: 'up' | 'down') => void
  handleCreateManualLithoGhost: (
    anchorKind: 'cpt' | 'borehole',
    anchorId: string,
    surfaceElevationM: number | null,
    depth_m: number,
    formationId: string,
  ) => void
  handleExtendLithoGhostToNearestContacts: (
    anchorId: string,
    idx: number,
    investigationMaxDepthM: number,
  ) => { ok: boolean; reason?: string }
  handleSuggestLitho: (anchorKind: 'cpt' | 'borehole', anchorId: string) => Promise<void>
  pushAcceptLithoUndo: (
    description: string,
    lithoModelId: string,
    ops: AcceptLithoUndoOp[],
    onSectionUpdated?: ((s: CrossSectionResponse) => void) | null,
  ) => void
  handleAcceptLithoSuggestion: (
    idx: number,
    sectionId?: string | null,
    onSectionUpdated?: (s: CrossSectionResponse) => void,
  ) => Promise<AcceptLithoSuggestionsResponse | null>
  handleAcceptAllLithoSuggestions: (
    sectionId?: string | null,
    onSectionUpdated?: (s: CrossSectionResponse) => void,
  ) => Promise<void>
  handleRejectLithoSuggestion: (idx: number) => void
  handleUnrejectLithoSuggestion: (idx: number) => void
  handleSuggestAllLitho: (
    anchors: readonly {
      kind: 'cpt' | 'borehole'
      id: string
      surfaceElevationM: number | null
    }[],
  ) => Promise<void>
  handleAcceptBulkLitho: (
    anchorId: string,
    idx: number,
    sectionId?: string | null,
    onSectionUpdated?: (s: CrossSectionResponse) => void,
  ) => Promise<void>
  handleAcceptAllBulkLitho: (
    sectionId?: string | null,
    onSectionUpdated?: (s: CrossSectionResponse) => void,
  ) => Promise<void>
}

// ---- Local type (stays inside the sub-hook, also in return type) -----------

/** One accept operation captured for undo/redo. */
export type AcceptLithoUndoOp = {
  body: Parameters<typeof api.geology.acceptLithoSuggestions>[2]
  createdContactIds: string[]
  createdFormationIds: string[]
  acceptedEntries: ReadonlyArray<{ anchorId: string; idx: number }>
}

// ---- Hook ------------------------------------------------------------------

/**
 * Litho-suggestion lifecycle handlers.
 *
 * Parameters
 * ----------
 * params : UseLithoSuggestionsParams
 *     All state atoms, setters, and stable callbacks the handlers need.
 *     See ``UseLithoSuggestionsParams`` for field-level documentation.
 *
 * Returns
 * -------
 * UseLithoSuggestionsResult
 *     Every handler and helper the composer previously owned inline, except
 *     the internal ``_updateGhostEntry`` helper which is not exported.
 */
export function useLithoSuggestions(params: UseLithoSuggestionsParams): UseLithoSuggestionsResult {
  const {
    project,
    activeLithoModelRef,
    lithoContacts,
    activeLithoModel,
    formations,
    addToSessionImports,
    pushUndo,
    markMutated,
    requestCorrelationEdgesRefetch,
    refetchLithoContacts,
    refetchFormations,
    toast,
    setGhostsByAnchor,
    setFocusedSuggestAnchorId,
    setLithoSuggesting,
    setBulkLithoSuggesting,
    setLithoCrossingPinchOuts,
    setLithoStaleTinSessionCount,
    ghostsByAnchor,
    focusedSuggestAnchorId,
    focusedSuggestAnchorIdRef,
    lithoSuggestions,
    lithoSuggestionEdits,
    lithoSuggestionRejected,
    lithoSuggestionAnchorKind,
    lithoSuggestionInvestigationId,
    bulkGhostsByAnchor,
  } = params

  // #127 — auto-correlate: fire the domain algorithm across the model,
  // persist net-new edges with source='auto', re-run the resolver, and
  // trigger inference per formation — all in one server-side transaction.
  const handleAutoCorrelate = useCallback(
    async (sectionId?: string | null): Promise<void> => {
    const model = activeLithoModelRef.current
    if (!project || !model) return
    log.info('geology', `autoCorrelate entry model=${model.id} section=${sectionId ?? 'model-wide'}`)
    try {
      // #163b: pass the user-tuned depth-match window from Settings.
      const depthWindowM = readLithoSegmenterPrefs(project.view_state).autoCorrelateDepthWindowM
      // sectionId (dogfeed 2026-05-29): gate adjacency to consecutive columns
      // along the section, not map-plane RNG. The Sections toolbar passes the
      // selected section; null/undefined keeps model-wide behaviour.
      const result = await api.geology.autoCorrelateContacts(
        project.id,
        model.id,
        depthWindowM,
        sectionId ?? null,
      )
      // Defensive: tolerate a response without the auto-lens fields (older API
      // / test mocks) — never let a missing field abort the refetch below.
      const pinchOuts = result.crossing_pinch_outs ?? []
      log.success(
        'geology',
        `autoCorrelate ok edges_created=${result.edges_created} ` +
          `skipped=${result.edges_skipped_existing} ` +
          `dropped_crossing=${result.edges_dropped_crossing ?? 0} ` +
          `pinch_outs=${pinchOuts.length}`,
      )
      // Auto-lens: surface the crossing-derived pinch-out candidates (and clear
      // any stale ones from a prior run that found none).
      setLithoCrossingPinchOuts(pinchOuts)
      // New edges persisted — mark dirty so a close-without-save reverts.
      if (result.edges_created > 0) markMutated()
      // Refetch so ordinal badges update (formations re-resolved server-side).
      refetchFormations()
      // #163c: the correlation-edge state lives in SectionsCanvas (a sibling
      // of the toolbar that fired this), so signal it to refetch — otherwise
      // the new edges/banners don't render until a manual section reselect.
      requestCorrelationEdgesRefetch()
      if (result.edges_created === 0 && result.edges_skipped_existing === 0) {
        // No contacts with a valid litho code + parent formation — the model
        // is empty or has no correlatable units yet. Guide the user toward
        // accepting litho suggestions first.
        toast(
          'success',
          'Auto-correlate: no correlatable units found — accept litho suggestions first.',
        )
      } else if (result.edges_created === 0) {
        toast('success', 'Auto-correlate: model already fully correlated — no new edges.')
      } else {
        toast(
          'success',
          `Auto-correlate: ${result.edges_created} edge${result.edges_created === 1 ? '' : 's'} created, ` +
            // TODO Task 19: formations_recomputed removed from autoCorrelateContacts response.
          `${result.edges_skipped_existing} edge(s) already existed.`,
        )
      }
      // Auto-lens: tell the user the crossings became lens candidates, not edges.
      if (pinchOuts.length > 0) {
        const n = pinchOuts.length
        toast(
          'success',
          `${n} pinch-out lens candidate${n === 1 ? '' : 's'} from crossings — ` +
            'shown as amber diamonds; the crossing edges were not drawn.',
        )
      }
    } catch (err) {
      log.error('geology', 'autoCorrelate failed', err)
      toast('error', 'Auto-correlate failed — see console.')
    }
  }, [project, refetchFormations, toast, requestCorrelationEdgesRefetch, markMutated])

  // #179 — Clear suggestions: remove all unapproved (auto) correlation edges
  // for the model without re-running auto-correlate. Approved manual
  // correlations are kept (the backend deletes user_approved=false only).
  // Reversible: re-run Auto-correlate to regenerate them. Mirrors
  // handleAutoCorrelate's sibling-refetch signal (#163c).
  const handleClearSuggestions = useCallback(async (): Promise<void> => {
    const model = activeLithoModelRef.current
    if (!project || !model) return
    log.info('geology', `clearSuggestions entry model=${model.id}`)
    try {
      const result = await api.geology.deleteAutoCorrelations(project.id, model.id)
      log.success('geology', `clearSuggestions ok deleted=${result.deleted}`)
      // Edges deleted — mark dirty so a close-without-save reverts.
      if (result.deleted > 0) markMutated()
      requestCorrelationEdgesRefetch()
      toast(
        'success',
        result.deleted === 0
          ? 'No correlation suggestions to clear.'
          : `Cleared ${result.deleted} correlation suggestion${result.deleted === 1 ? '' : 's'}.`,
      )
    } catch (err) {
      log.error('geology', 'clearSuggestions failed', err)
      toast('error', 'Could not clear suggestions — see console.')
    }
  }, [project, toast, requestCorrelationEdgesRefetch, markMutated])

  // Apply a user edit to one suggestion's top and/or base depth. Partial:
  // pass just { depth_top_m } to move only the top, just { depth_base_m }
  // for the base. The edit is merged with any prior edit on the same idx
  // so dragging the same layer twice composes. Writes to the focused
  // anchor's entry in the unified Map (debt #77).
  const handleEditLithoSuggestion = useCallback(
    (idx: number, edit: LithoSuggestionEdit): void => {
      setGhostsByAnchor(prev => {
        const focusedId = focusedSuggestAnchorIdRef.current
        if (focusedId === null) return prev
        const existing = prev.get(focusedId)
        if (!existing) return prev
        // applyCrossMergeOnDrag detects whether the depth edit crossed a
        // pending neighbour's boundary (plain-drag cross-merge — no Shift
        // required). When a cross occurred it returns absorbLithoLayer's
        // result (neighbour removed, dragger extended); when not, it
        // returns a plain depth-edit ghost identical to the prior merge.
        const updated = applyCrossMergeOnDrag(existing, idx, edit)
        const next = new Map(prev)
        next.set(focusedId, updated)
        return next
      })
    },
    [],
  )

  /**
   * Returns the depth-effective layer for a suggestion index — original
   * suggestion with any user edits applied. Used at accept time so the
   * committed contact lands at the edited depth, AND by the ghost
   * renderer so the layer rect matches the user's drag.
   */
  const effectiveLithoSuggestionAt = useCallback(
    (idx: number): LithoLayerSuggestion | null => {
      const layer = lithoSuggestions[idx]
      if (layer === undefined) return null
      const edit = lithoSuggestionEdits.get(idx)
      if (!edit) return layer
      return {
        ...layer,
        depth_top_m: edit.depth_top_m ?? layer.depth_top_m,
        depth_base_m: edit.depth_base_m ?? layer.depth_base_m,
        // Composition overrides (Phase 2.5 / debt #72). Lithology
        // cast safe — the editor's dropdown is constrained to
        // BaseLithology codes (ZAND / KLEI / SILT / GRIND / VEEN).
        suggested_lithology:
          (edit.suggested_lithology as LithoLayerSuggestion['suggested_lithology']) ??
          layer.suggested_lithology,
        suggested_admixtures: edit.suggested_admixtures
          ? edit.suggested_admixtures.map(a => ({ ...a }))
          : layer.suggested_admixtures,
      }
    },
    [lithoSuggestions, lithoSuggestionEdits],
  )

  const clearLithoSuggestions = useCallback((): void => {
    // Delete the focused anchor's entry from the unified Map (debt
    // #77). Other entries (the bulk set) survive — Clear is the
    // single-anchor clear gesture, not a "wipe all ghosts" verb.
    const focusedId = focusedSuggestAnchorIdRef.current
    if (focusedId !== null) {
      setGhostsByAnchor(prev => {
        if (!prev.has(focusedId)) return prev
        const next = new Map(prev)
        next.delete(focusedId)
        return next
      })
    }
    setFocusedSuggestAnchorId(null)
    // S-1 (senior-review): also release the Suggest button — if Clear
    // is hit while a suggest fetch is in flight, the spinner would
    // otherwise stay stuck until the orphaned fetch settles.
    setLithoSuggesting(false)
    // Stale-TIN diagnostic: clearing the suggestions ends the session,
    // so reset the cumulative counter for the inspector pill.
    setLithoStaleTinSessionCount(0)
    // The old burst-safe refs (acceptedFormationByLithoRef,
    // lithoFormationInFlightRef) were removed in Phase 1 — the bulk
    // endpoint is idempotent server-side (find-or-create), so the
    // client no longer needs per-session formation caches.
  }, [])

  // ---------- Bulk-suggest (debt #73 / Phase 3) ----------
  // Multi-anchor handlers. The Map is the source of truth; each
  // handler is anchor-scoped via the anchorId arg.

  const clearBulkLithoGhosts = useCallback((): void => {
    // After unification (debt #77) the Map holds both single + bulk.
    // ``clearBulkLithoGhosts`` is the bulk-clear verb — preserve any
    // focused (single) entry, drop everything else.
    setGhostsByAnchor(prev => {
      const focusedId = focusedSuggestAnchorIdRef.current
      if (focusedId === null) return new Map()
      const entry = prev.get(focusedId)
      if (!entry) return new Map()
      return new Map([[focusedId, entry]])
    })
    setBulkLithoSuggesting(false)
  }, [])

  /**
   * Strip admixtures from ghost suggestions (dogfeed 2026-05-22).
   *
   * Sets ``suggested_admixtures: []`` as an edit on every ghost layer
   * whose anchor matches ``scope`` ('cpt' / 'borehole' / 'all'). The
   * CPT segmenter's Robertson-derived admixtures are noisier than the
   * borehole observation-log admixtures, so the common workflow is
   * "strip all, then reseed boreholes" — see ``handleReseedLithoAdmixtures``.
   * Operates on the ephemeral ghost edit map only; accept commits
   * whatever the ghost is currently showing.
   */
  const handleStripLithoAdmixtures = useCallback(
    (scope: 'cpt' | 'borehole' | 'all'): void => {
      const targets = Array.from(ghostsByAnchor.entries()).filter(
        ([, g]) =>
          (scope === 'all' || g.kind === scope) && g.suggestions.length > 0,
      )
      if (targets.length === 0) {
        toast(
          'error',
          `No ${scope === 'all' ? '' : `${scope} `}ghost suggestions to strip.`,
        )
        return
      }
      const layerCount = targets.reduce((n, [, g]) => n + g.suggestions.length, 0)
      const targetIds = new Set(targets.map(([id]) => id))
      setGhostsByAnchor(prev => {
        const next = new Map(prev)
        for (const anchorId of targetIds) {
          const ghost = next.get(anchorId)
          if (!ghost) continue
          const nextEdits = new Map(ghost.edits)
          for (let i = 0; i < ghost.suggestions.length; i++) {
            nextEdits.set(i, {
              ...(nextEdits.get(i) ?? {}),
              suggested_admixtures: [],
            })
          }
          next.set(anchorId, { ...ghost, edits: nextEdits })
        }
        return next
      })
      log.info(
        'geology',
        `stripLithoAdmixtures scope=${scope} layers=${layerCount} anchors=${targets.length}`,
      )
      toast(
        'success',
        `Stripped admixtures from ${layerCount} layer${layerCount === 1 ? '' : 's'}.`,
      )
    },
    [ghostsByAnchor, toast],
  )

  /**
   * Reseed admixtures on borehole ghost suggestions (dogfeed 2026-05-22).
   *
   * Drops the ``suggested_admixtures`` override from every borehole
   * ghost's edit map so the layers fall back to the segmenter's raw
   * admixtures (which, for boreholes, come from the ObservationLayer
   * descriptions and are trustworthy). The inverse of a prior
   * ``handleStripLithoAdmixtures('borehole')`` / strip-all. Depth and
   * lithology edits on the same layer are preserved.
   */
  const handleReseedLithoAdmixtures = useCallback((): void => {
    const targets = Array.from(ghostsByAnchor.entries()).filter(
      ([, g]) =>
        g.kind === 'borehole' &&
        Array.from(g.edits.values()).some(
          e => e.suggested_admixtures !== undefined,
        ),
    )
    if (targets.length === 0) {
      toast('error', 'No overridden borehole admixtures to restore.')
      return
    }
    const layerCount = targets.reduce(
      (n, [, g]) =>
        n +
        Array.from(g.edits.values()).filter(
          e => e.suggested_admixtures !== undefined,
        ).length,
      0,
    )
    const targetIds = new Set(targets.map(([id]) => id))
    setGhostsByAnchor(prev => {
      const next = new Map(prev)
      for (const anchorId of targetIds) {
        const ghost = next.get(anchorId)
        if (!ghost) continue
        const nextEdits = new Map<number, LithoSuggestionEdit>()
        for (const [idx, edit] of ghost.edits) {
          if (edit.suggested_admixtures === undefined) {
            nextEdits.set(idx, edit)
            continue
          }
          // Drop only the admixture override; keep depth/lithology edits.
          const rest: LithoSuggestionEdit = { ...edit }
          delete rest.suggested_admixtures
          if (Object.keys(rest).length > 0) nextEdits.set(idx, rest)
        }
        next.set(anchorId, { ...ghost, edits: nextEdits })
      }
      return next
    })
    log.info(
      'geology',
      `reseedLithoAdmixtures boreholes layers=${layerCount} anchors=${targets.length}`,
    )
    toast(
      'success',
      `Restored segmenter admixtures on ${layerCount} borehole layer${
        layerCount === 1 ? '' : 's'
      }.`,
    )
  }, [ghostsByAnchor, toast])

  // Shared helper — apply a partial update to one entry in the
  // unified Map. Used by every per-anchor update site (single accept,
  // single reject, bulk accept, bulk reject, edit, ...). The closure
  // reads no external state besides the setter — stable dep list.
  //
  // Two call forms:
  //   _updateGhostEntry(anchorId, partial)
  //     — when the new partial is known before the setState call (no
  //       dependency on existing entry fields).
  //   _updateGhostEntry(anchorId, existing => partial)
  //     — when the new partial must be derived from the existing entry
  //       (e.g. adding an index to an existing Set). The updater runs
  //       inside setState so it always sees the latest Map snapshot.
  const _updateGhostEntry = useCallback(
    (
      anchorId: string,
      updater:
        | Partial<BulkAnchorGhost>
        | ((existing: BulkAnchorGhost) => Partial<BulkAnchorGhost>),
    ): void => {
      setGhostsByAnchor(prev => {
        const existing = prev.get(anchorId)
        if (!existing) return prev
        const partial = typeof updater === 'function' ? updater(existing) : updater
        const next = new Map(prev)
        next.set(anchorId, { ...existing, ...partial })
        return next
      })
    },
    [],
  )

  const handleRejectBulkLitho = useCallback(
    (anchorId: string, idx: number): void => {
      _updateGhostEntry(anchorId, existing => {
        const nextRejected = new Set(existing.rejected)
        nextRejected.add(idx)
        return { rejected: nextRejected }
      })
    },
    [_updateGhostEntry],
  )

  /**
   * Undo a prior bulk reject — debt #80 mirror of the single-anchor
   * variant. No-op when idx wasn't rejected on the anchor.
   */
  const handleUnrejectBulkLitho = useCallback(
    (anchorId: string, idx: number): void => {
      // Direct setState (not _updateGhostEntry): the guard `!rejected.has(idx)`
      // returns `prev` unchanged, preserving Map identity and skipping a re-render.
      // _updateGhostEntry always produces a new Map so it cannot short-circuit here.
      setGhostsByAnchor(prev => {
        const existing = prev.get(anchorId)
        if (!existing || !existing.rejected.has(idx)) return prev
        const nextRejected = new Set(existing.rejected)
        nextRejected.delete(idx)
        const next = new Map(prev)
        next.set(anchorId, { ...existing, rejected: nextRejected })
        return next
      })
    },
    [],
  )

  const handleEditBulkLitho = useCallback(
    (
      anchorId: string,
      idx: number,
      edit: LithoSuggestionEdit,
    ): void => {
      setGhostsByAnchor(prev => {
        const existing = prev.get(anchorId)
        if (!existing) return prev
        // Same cross-merge logic as the focused-anchor path — plain drag
        // on a bulk-suggest ghost also auto-absorbs on release when the
        // dragged edge crosses a pending neighbour's boundary.
        const updated = applyCrossMergeOnDrag(existing, idx, edit)
        const next = new Map(prev)
        next.set(anchorId, updated)
        return next
      })
    },
    [],
  )

  // Debt #85: insert a new pending litho layer at the shared boundary
  // between layers ``afterIdx`` and ``afterIdx+1``. The mutation is a
  // pure helper (insertLithoLayer) so the index-shift math has its own
  // unit test; this hook just plugs it into setGhostsByAnchor.
  const handleInsertLithoLayer = useCallback(
    (
      anchorId: string,
      afterIdx: number,
      composition: {
        suggested_lithology: string
        suggested_admixtures: readonly { soil_code: string; amount: string; locally: boolean }[]
      },
    ): void => {
      setGhostsByAnchor(prev => {
        const existing = prev.get(anchorId)
        if (!existing) return prev
        const updated = insertLithoLayer(existing, afterIdx, composition)
        const next = new Map(prev)
        next.set(anchorId, updated)
        return next
      })
    },
    [],
  )

  // Debt #98: split a pending litho ghost layer in two at its midpoint.
  // Mirrors handleInsertLithoLayer — the mutation is the pure helper
  // splitLithoLayer; the hook only plugs it into setGhostsByAnchor.
  const handleSplitLithoLayer = useCallback(
    (anchorId: string, idx: number): void => {
      setGhostsByAnchor(prev => {
        const existing = prev.get(anchorId)
        if (!existing) return prev
        const updated = splitLithoLayer(existing, idx)
        const next = new Map(prev)
        next.set(anchorId, updated)
        return next
      })
    },
    [],
  )

  // Debt #102: merge two adjacent same-lithology pending layers into
  // one. Mirrors handleSplitLithoLayer — pure helper mergeLithoLayers
  // does the index-shift math; the component-level menu only offers
  // the action when canMergeAt returns true.
  const handleMergeLithoLayers = useCallback(
    (anchorId: string, upperIdx: number): void => {
      setGhostsByAnchor(prev => {
        const existing = prev.get(anchorId)
        if (!existing) return prev
        const updated = mergeLithoLayers(existing, upperIdx)
        const next = new Map(prev)
        next.set(anchorId, updated)
        return next
      })
    },
    [],
  )

  // Dogfeed 2026-05-25: Shift+drag absorb gesture. Mirrors
  // handleMergeLithoLayers — pure helper absorbLithoLayer does the
  // index-shift math; the drag handler gates on cursor past midpoint.
  const handleAbsorbLithoLayer = useCallback(
    (anchorId: string, draggerIdx: number, direction: 'up' | 'down'): void => {
      setGhostsByAnchor(prev => {
        const existing = prev.get(anchorId)
        if (!existing) return prev
        const updated = absorbLithoLayer(existing, draggerIdx, direction)
        const next = new Map(prev)
        next.set(anchorId, updated)
        return next
      })
    },
    [],
  )

  // Left-click on the LITHO axis creates a zero-thickness ghost layer
  // instead of a committed contact.  The pure helper insertManualGhostLayer
  // does the array build/sort; this callback plugs it into setGhostsByAnchor
  // and sets the focused anchor so the overlay renders immediately.
  //
  // The picker returns a formation_id; we need its litho_main_soil_code +
  // litho_admixtures.  Both live in the ``formations`` state atom that is
  // always populated before the picker can open (the picker only offers
  // litho formations from the active model).  If the formation is not
  // found (race with a concurrent delete) the ghost is still created with
  // an empty lithology string — the user can edit via the composition
  // editor before accepting.
  const handleCreateManualLithoGhost = useCallback(
    (
      anchorKind: 'cpt' | 'borehole',
      anchorId: string,
      surfaceElevationM: number | null,
      depth_m: number,
      formationId: string,
    ): void => {
      // Resolve lithology from the active formation list.
      const formation = formations.find(f => f.id === formationId)
      const lithology = formation?.litho_main_soil_code ?? ''
      const admixtures: readonly { soil_code: string; amount: string; locally: boolean }[] =
        formation?.litho_admixtures?.map(a => ({
          soil_code: a.soil_code,
          amount: a.amount,
          locally: a.locally,
        })) ?? []

      log.debug(
        'geology',
        `handleCreateManualLithoGhost anchor=${anchorId} depth=${depth_m.toFixed(3)}m litho=${lithology || '(not found)'}`,
      )

      setGhostsByAnchor(prev => {
        const existing = prev.get(anchorId)
        const updated = insertManualGhostLayer(
          existing,
          anchorKind,
          surfaceElevationM,
          depth_m,
          lithology,
          admixtures,
        )
        const next = new Map(prev)
        next.set(anchorId, updated)
        return next
      })
      // Show the ghost immediately by focusing this anchor.
      setFocusedSuggestAnchorId(anchorId)

      log.success(
        'geology',
        `handleCreateManualLithoGhost placed ghost at depth=${depth_m.toFixed(3)}m anchor=${anchorId}`,
      )
    },
    // reason: formations identity changes when server sync completes;
    // we must read the latest list to look up litho_main_soil_code.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [formations],
  )

  // Extend ghost layer at (anchorId, idx) to the nearest committed litho
  // contacts above and below its midpoint.  Delegates to the pure helper
  // extendGhostToNearest; returns ok/reason so the caller can toast on
  // overlap.  Synchronous — no network call.
  const handleExtendLithoGhostToNearestContacts = useCallback(
    (
      anchorId: string,
      idx: number,
      investigationMaxDepthM: number,
    ): { ok: boolean; reason?: string } => {
      const ghost = ghostsByAnchor.get(anchorId)
      if (!ghost) return { ok: false, reason: 'No ghost found for this investigation.' }

      // Collect committed contacts for this anchor.
      const contactsOnAnchor = lithoContacts.filter(c =>
        ghost.kind === 'cpt' ? c.cpt_id === anchorId : c.borehole_id === anchorId,
      )

      const result = extendGhostToNearest(
        ghost,
        idx,
        contactsOnAnchor,
        investigationMaxDepthM,
      )

      if (!result.ok) {
        log.debug(
          'geology',
          `handleExtendLithoGhostToNearestContacts overlap: anchor=${anchorId} idx=${idx} reason="${result.reason}"`,
        )
        return { ok: false, reason: result.reason }
      }

      setGhostsByAnchor(prev => {
        const next = new Map(prev)
        next.set(anchorId, result.next)
        return next
      })

      log.success(
        'geology',
        `handleExtendLithoGhostToNearestContacts ok anchor=${anchorId} idx=${idx}`,
      )
      return { ok: true }
    },
    // reason: ghostsByAnchor and lithoContacts change by reference on mutations;
    // listing them keeps the callback fresh without identity churn on renders
    // that don't touch these atoms.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ghostsByAnchor, lithoContacts],
  )

  // B-1 (senior-review, data-integrity): a ghost overlay left showing
  // when the active litho model SWITCHES would accept onto the new
  // model (activeLithoModelRef points at the new one) while the
  // suggestion/anchor still reference the old investigation — a
  // contact written to the wrong model. The litho-data effect in the
  // composer calls setGhostsByAnchor/setFocusedSuggestAnchorId directly
  // (bypassing clearLithoSuggestions) to avoid the TDZ that motivated
  // this guard being placed here. Keyed on the model ID (a primitive) NOT the object, so a
  // refreshModels that returns a new-but-same model object does not
  // wipe an in-progress overlay; only a real model change clears it.
  const activeLithoModelId = activeLithoModel?.id ?? null
  useEffect(() => {
    clearLithoSuggestions()
  }, [activeLithoModelId, clearLithoSuggestions])

  // Fetch suggestions for one investigation against the active litho model.
  // Replaces any prior single-anchor focus + writes the new entry into
  // the unified Map (debt #77).
  const handleSuggestLitho = useCallback(
    async (anchorKind: 'cpt' | 'borehole', anchorId: string): Promise<void> => {
      const model = activeLithoModelRef.current
      if (!project || !model) return
      log.debug(
        'geology',
        `handleSuggestLitho entry kind=${anchorKind} anchor=${anchorId} model=${model.id}`,
      )
      setLithoSuggesting(true)
      // Clear prior single-anchor focus before the fetch so stale data
      // never shows. Bulk entries on OTHER anchors survive.
      clearLithoSuggestions()
      try {
        // Pull the per-project segmenter prefs out of view_state (set
        // via File → Settings…). Falls back to defaults when unset.
        // γunsat + Dr factor only ride along on the CPT path — the
        // borehole segmenter ignores stress-derived parameters (no qc).
        const prefs = readLithoSegmenterPrefs(project.view_state)
        const body =
          anchorKind === 'cpt'
            ? {
                cpt_id: anchorId,
                minimum_layer_thickness_m: prefs.minimumLayerThicknessM,
                gunsat_kNm3: prefs.gunsatKNm3,
                dr_compression_factor: prefs.drCompressionFactor,
                merge_same_lithology: prefs.mergeSameLithology,
                use_normalised_qc: prefs.useNormalisedQc,
              }
            : {
                borehole_id: anchorId,
                minimum_layer_thickness_m: prefs.minimumLayerThicknessM,
              }
        const resp = await api.geology.suggestLitho(project.id, model.id, body)
        log.success(
          'geology',
          `suggestLitho ok ${resp.layers.length} layers for ${anchorKind} ${anchorId}`,
        )
        // Write a fresh entry under anchorId and set it as the focused
        // (single) one. If a bulk entry already existed for this anchor,
        // it is replaced — matches the prior semantics where a Suggest
        // cleared and overwrote single state.
        setGhostsByAnchor(prev => {
          const next = new Map(prev)
          next.set(anchorId, {
            kind: anchorKind,
            suggestions: resp.layers,
            surfaceElevationM: null,
            accepted: new Set<number>(),
            rejected: new Set<number>(),
            edits: new Map<number, LithoSuggestionEdit>(),
          })
          return next
        })
        setFocusedSuggestAnchorId(anchorId)
      } catch (err) {
        log.error('geology', `handleSuggestLitho failed for ${anchorId}`, err)
        toast('error', 'Could not fetch lithostratigraphic suggestions.')
      } finally {
        setLithoSuggesting(false)
      }
    },
    [project, clearLithoSuggestions, toast],
  )

  // ---- Undo support for the accept-litho-suggestions paths ----------
  // Accept commits contacts (and possibly formations) immediately, like
  // an import. Until 2026-05-22 it was the one mutation NOT on the undo
  // stack, so Ctrl+Z silently skipped past a mis-accepted layer. This
  // helper builds + pushes the UndoCommand; all four accept handlers
  // call it on success.
  //
  // One "op" = one acceptLithoSuggestions call: the request body
  // (replayed verbatim on redo), the created contact/formation ids the
  // revert deletes, and the (anchorId, idx) ghost entries to flip back
  // to pending. The accept-all-across-anchors sweep passes N ops so one
  // Ctrl+Z reverses the whole sweep.
  const pushAcceptLithoUndo = useCallback(
    (
      description: string,
      lithoModelId: string,
      ops: AcceptLithoUndoOp[],
      onSectionUpdated?: ((s: CrossSectionResponse) => void) | null,
    ): void => {
      if (!project) return
      // Accepting an already-accepted layer returns only found_* ids —
      // nothing was created, so there is nothing to undo.
      const hasWork = ops.some(
        o => o.createdContactIds.length > 0 || o.createdFormationIds.length > 0,
      )
      if (!hasWork) return
      const projectId = project.id
      // Flip the ghost overlay's accepted set for every captured entry:
      // accepted=false on revert (back to pending), true on redo.
      const setAccepted = (accepted: boolean): void => {
        setGhostsByAnchor(prev => {
          const next = new Map(prev)
          let changed = false
          for (const op of ops) {
            for (const { anchorId, idx } of op.acceptedEntries) {
              const existing = next.get(anchorId)
              if (!existing) continue
              if (existing.accepted.has(idx) === accepted) continue
              const nextAccepted = new Set(existing.accepted)
              if (accepted) nextAccepted.add(idx)
              else nextAccepted.delete(idx)
              next.set(anchorId, { ...existing, accepted: nextAccepted })
              changed = true
            }
          }
          return changed ? next : prev
        })
      }
      pushUndo({
        description,
        revert: async () => {
          // Contacts first — contact.formation_id FK references formation.
          for (const op of ops) {
            await Promise.all(
              op.createdContactIds.map(id =>
                api.geology.deleteContact(projectId, lithoModelId, id),
              ),
            )
            await Promise.all(
              op.createdFormationIds.map(id =>
                api.geology.deleteFormation(projectId, id),
              ),
            )
          }
          setAccepted(false)
          refetchLithoContacts()
          refetchFormations()
        },
        reapply: async () => {
          // Re-POST each body; the server mints fresh ids, so capture
          // them back onto the op for the next revert.
          for (const op of ops) {
            const res = await api.geology.acceptLithoSuggestions(
              projectId,
              lithoModelId,
              op.body,
            )
            op.createdContactIds = res.created_contact_ids.slice()
            op.createdFormationIds = res.created_formation_ids.slice()
            // Re-seed the section so the re-created contacts pass the
            // explicit-content filter (#57 invariant).
            if (res.updated_section != null && onSectionUpdated != null) {
              onSectionUpdated(res.updated_section)
            }
          }
          setAccepted(true)
          refetchLithoContacts()
          refetchFormations()
        },
      })
    },
    [project, pushUndo, refetchLithoContacts, refetchFormations],
  )

  // Accept one suggestion layer via the bulk endpoint (one-item payload).
  // The server handles formation find-or-create, straddle splits, and
  // section seeding atomically. The caller MUST forward onSectionUpdated
  // with the response's updated_section — explicit-content invariant (#57).
  const handleAcceptLithoSuggestion = useCallback(
    async (
      idx: number,
      sectionId?: string | null,
      onSectionUpdated?: (s: CrossSectionResponse) => void,
    ): Promise<AcceptLithoSuggestionsResponse | null> => {
      const model = activeLithoModelRef.current
      const layers = lithoSuggestions
      if (!project || !model || idx < 0 || idx >= layers.length) return null
      // Apply user edits (drag-resized depths) before sending. effectiveLayer
      // has the user's modified top/base; the original is still in layers[idx]
      // for the future ML training log (#4).
      const layer = effectiveLithoSuggestionAt(idx) ?? layers[idx]
      const anchorKind = lithoSuggestionAnchorKind
      const anchorId = lithoSuggestionInvestigationId
      if (!anchorKind || !anchorId) return null
      log.debug(
        'geology',
        `acceptLithoSuggestion idx=${idx} lithology=${layer.suggested_lithology} depth=${layer.depth_top_m.toFixed(2)}m sectionId=${sectionId ?? 'none'}`,
      )
      try {
        // (Previous accept-time restoration logic removed 2026-05-27
        // — owner directive: "how about we don't wire it through the
        // suggestion and it immediately becomes an accepted litho
        // layer".  Restoration now happens at INSERT time in
        // SectionsCanvas.handleManualLithoUnitCreate, so this accept
        // path stays clean for the bulk-segmenter suggest-and-accept
        // flow where restoration is not needed — adjacent suggestions
        // already tile the column.)
        const body = buildLithoAcceptBody({
          anchorKind,
          anchorId,
          sectionId,
          suggestions: [layer],
          viewState: project.view_state,
        })
        const result = await api.geology.acceptLithoSuggestions(
          project.id,
          model.id,
          body,
        )
        log.success(
          'geology',
          `acceptLithoSuggestion ok idx=${idx} created=${result.created_formation_ids.length} found=${result.found_formation_ids.length} contacts=${result.created_contact_ids.length + result.found_contact_ids.length} straddle=${result.straddle_split_count}`,
        )

        // Debt #144: an accept writes to the DB immediately but must also
        // land its created rows in the session-imports manifest, or the amber
        // dirty flag never lights and the .gmproj goes silently stale on close.
        recordCreatedRows(addToSessionImports, result)
        // Debt #87: surface a warning toast when any created unit needs
        // engineer review (TIN-extrapolated parent or fully unassigned).
        const summary = formatAcceptParentSummary(result)
        if (summary !== null) toast(summary.kind, summary.message)
        // Stale-TIN diagnostic: aggregate the response's count into
        // the session counter so the inspector pill picks it up.
        if (result.stale_tin_fallback_count > 0) {
          setLithoStaleTinSessionCount(c => c + result.stale_tin_fallback_count)
        }
        // Forward updated_section so the section's explicit-content filter
        // includes the newly seeded contacts — #57 class trap.
        if (result.updated_section != null && onSectionUpdated != null) {
          onSectionUpdated(result.updated_section)
        }
        // Mark accepted so the ghost overlay shows the tick — updates
        // the focused entry in the unified Map (debt #77).
        //
        // Robust-fix (dogfeed 2026-05-30 follow-up to Slice 3): also
        // stash the contact ids the API returned for this suggestion
        // so the cross-store dispatch in ``useBoundaryDrag`` can look
        // up the matching contact by identity (not by depth match).
        // The single-suggestion accept path is the simplest case —
        // every returned contact id belongs to THIS suggestion.
        const allContactIds = [
          ...result.created_contact_ids,
          ...result.found_contact_ids,
        ]
        const focusedAcceptId = focusedSuggestAnchorIdRef.current
        if (focusedAcceptId !== null) {
          _updateGhostEntry(focusedAcceptId, existing => {
            const nextAccepted = new Set(existing.accepted)
            nextAccepted.add(idx)
            const nextContactIds = new Map(existing.contactIdsByAcceptedIdx ?? [])
            nextContactIds.set(idx, allContactIds)
            return { accepted: nextAccepted, contactIdsByAcceptedIdx: nextContactIds }
          })
        }
        // Refetch litho contacts so the committed contact lands in
        // local state. Without this the section view keeps rendering
        // off stale `lithoContacts` — when the user focuses a
        // different investigation and re-suggests, the previous
        // CPT's accepted contacts vanish from view (dogfeed bug
        // 2026-05-20). The contact IS in the DB; only local state
        // was stale.
        refetchLithoContacts()
        // Refresh the global formations list so newly-created units land
        // in the inspector + picker dialog + overlays. lithoFormations
        // is a useMemo derived from formations (debt #89) so this single
        // call updates both.
        refetchFormations()
        // Record the accept on the undo stack (dogfeed 2026-05-22 —
        // accept was the one mutation Ctrl+Z couldn't reach).
        // Re-uses focusedAcceptId (same ref, same call frame).
        pushAcceptLithoUndo(
          `Accept litho layer (${layer.suggested_lithology})`,
          model.id,
          [
            {
              body,
              createdContactIds: result.created_contact_ids.slice(),
              createdFormationIds: result.created_formation_ids.slice(),
              acceptedEntries:
                focusedAcceptId !== null ? [{ anchorId: focusedAcceptId, idx }] : [],
            },
          ],
          onSectionUpdated ?? null,
        )
        // Debt #134-C — return the API result so the caller (the
        // SectionsCanvas wrapper) can run the post-accept litho-geo
        // snap check: scan the new contact ids against the geological
        // backdrop on the same investigation and open the snap dialog
        // if any landed within tolerance.  Pre-#134-C the handler
        // returned void; consumers that ignore the return value are
        // unaffected.
        return result
      } catch (err) {
        log.error('geology', `acceptLithoSuggestion failed idx=${idx}`, err)
        toast('error', 'Could not accept the litho suggestion.')
        return null
      }
    },
    // reason: lithoSuggestions / lithoSuggestionAnchorKind / lithoSuggestionInvestigationId
    // are read synchronously inside the callback body via closure. They are listed as deps
    // so the callback identity refreshes when the active suggestion set changes (a new
    // suggest replaces all three at once). activeLithoModelRef is a ref (stable identity).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      project,
      lithoSuggestions,
      lithoSuggestionAnchorKind,
      lithoSuggestionInvestigationId,
      effectiveLithoSuggestionAt,
      _updateGhostEntry,
      refetchLithoContacts,
      refetchFormations,
      toast,
      pushAcceptLithoUndo,
      addToSessionImports,
    ],
  )

  // Accept ALL non-rejected suggestion layers in one bulk call.
  // Filters out already-accepted and rejected indices, then calls
  // the same endpoint with the remaining layers.  The server's
  // find-or-create is idempotent — re-accepting an already-accepted
  // layer is safe and returns found_* ids.
  const handleAcceptAllLithoSuggestions = useCallback(
    async (
      sectionId?: string | null,
      onSectionUpdated?: (s: CrossSectionResponse) => void,
    ): Promise<void> => {
      const model = activeLithoModelRef.current
      const layers = lithoSuggestions
      const anchorKind = lithoSuggestionAnchorKind
      const anchorId = lithoSuggestionInvestigationId
      if (!project || !model || !anchorKind || !anchorId || layers.length === 0) return
      // Collect every non-rejected layer. Already-accepted layers ARE
      // re-sent (we keep no per-layer accepted state on the client); the
      // server is idempotent — find-or-create keyed on
      // model+formation+depth+anchor — so a repeat is a cheap no-op.
      const pendingIndices = layers
        .map((_, i) => i)
        .filter(i => !lithoSuggestionRejected.has(i))
      // Apply user edits (drag-resized depths) per index so the bulk
      // commit honours the same depth modifications the per-layer
      // accept handler would have sent.
      const pendingLayers = pendingIndices.map(
        i => effectiveLithoSuggestionAt(i) ?? layers[i],
      )
      if (pendingLayers.length === 0) return
      log.debug(
        'geology',
        `acceptAllLithoSuggestions ${pendingLayers.length}/${layers.length} layers sectionId=${sectionId ?? 'none'}`,
      )
      try {
        const body = buildLithoAcceptBody({
          anchorKind,
          anchorId,
          sectionId,
          suggestions: pendingLayers,
          viewState: project.view_state,
        })
        const result = await api.geology.acceptLithoSuggestions(
          project.id,
          model.id,
          body,
        )
        log.success(
          'geology',
          `acceptAllLithoSuggestions ok created=${result.created_formation_ids.length} found=${result.found_formation_ids.length} contacts=${result.created_contact_ids.length + result.found_contact_ids.length} straddle=${result.straddle_split_count} stale_tin_fallback=${result.stale_tin_fallback_count}`,
        )
        // Debt #144: record created rows so accept-all lights the dirty flag.
        recordCreatedRows(addToSessionImports, result)
        // Debt #87: see acceptLithoSuggestion site above.
        const summary = formatAcceptParentSummary(result)
        if (summary !== null) toast(summary.kind, summary.message)
        // Debt #76: surface straddle-split count so the user understands why
        // "accept all" produced more contacts than ghost layers were visible.
        const straddleMsg = formatStraddleSummary(result)
        if (straddleMsg !== null) toast('warning', straddleMsg)
        // Stale-TIN diagnostic: aggregate the response's count into
        // the session counter so the inspector pill picks it up.
        if (result.stale_tin_fallback_count > 0) {
          setLithoStaleTinSessionCount(c => c + result.stale_tin_fallback_count)
        }
        // Forward updated_section — #57 invariant.
        if (result.updated_section != null && onSectionUpdated != null) {
          onSectionUpdated(result.updated_section)
        }
        // Mark all pending layers accepted in the focused entry
        // (debt #77 — single + bulk now share the unified Map).
        const focusedAllId = focusedSuggestAnchorIdRef.current
        if (focusedAllId !== null) {
          _updateGhostEntry(focusedAllId, existing => {
            const nextAccepted = new Set(existing.accepted)
            for (const i of pendingIndices) nextAccepted.add(i)
            return { accepted: nextAccepted }
          })
        }
        // Refetch litho contacts so the committed contacts land in
        // local state — without this the previous investigation's
        // committed contacts vanish from the section view when the
        // user re-focuses (dogfeed bug 2026-05-20, see handler above).
        refetchLithoContacts()
        // Single global-formations refresh — lithoFormations derives
        // from it (debt #89), so the inspector roster + picker dialog
        // update automatically.
        refetchFormations()
        // One undo entry for the whole accept-all (dogfeed 2026-05-22).
        // Re-uses focusedAllId (same ref, same call frame).
        pushAcceptLithoUndo(
          `Accept all litho layers (${pendingLayers.length})`,
          model.id,
          [
            {
              body,
              createdContactIds: result.created_contact_ids.slice(),
              createdFormationIds: result.created_formation_ids.slice(),
              acceptedEntries:
                focusedAllId !== null
                  ? pendingIndices.map(i => ({ anchorId: focusedAllId, idx: i }))
                  : [],
            },
          ],
          onSectionUpdated ?? null,
        )
      } catch (err) {
        log.error('geology', 'acceptAllLithoSuggestions failed', err)
        toast('error', 'Could not accept all litho suggestions.')
      }
    },
    // reason: all suggestion state (lithoSuggestions / lithoSuggestionAnchorKind /
    // lithoSuggestionInvestigationId / lithoSuggestionRejected) is read
    // synchronously from the closure and listed as deps so the callback
    // identity refreshes on each new suggestion set. activeLithoModelRef is a
    // ref (stable identity) and intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      project,
      lithoSuggestions,
      lithoSuggestionAnchorKind,
      lithoSuggestionInvestigationId,
      lithoSuggestionRejected,
      effectiveLithoSuggestionAt,
      _updateGhostEntry,
      refetchLithoContacts,
      refetchFormations,
      toast,
      pushAcceptLithoUndo,
      addToSessionImports,
    ],
  )

  const handleRejectLithoSuggestion = useCallback((idx: number): void => {
    // Update the focused entry in the unified Map (debt #77).
    const focusedId = focusedSuggestAnchorIdRef.current
    if (focusedId !== null) {
      _updateGhostEntry(focusedId, existing => {
        const nextRejected = new Set(existing.rejected)
        nextRejected.add(idx)
        return { rejected: nextRejected }
      })
    }
    log.debug('geology', `rejectLithoSuggestion idx=${idx}`)
  // reason: focusedSuggestAnchorIdRef is a ref (always current); _updateGhostEntry
  // is a stable useCallback with an empty dep array.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [_updateGhostEntry])

  /**
   * Undo a prior reject — return the ghost layer to pending state.
   * Debt #80 (2026-05-20 dogfeed). No-op when idx wasn't rejected.
   */
  const handleUnrejectLithoSuggestion = useCallback((idx: number): void => {
    // Direct setState (not _updateGhostEntry): the guard `!rejected.has(idx)`
    // returns `prev` unchanged, preserving Map identity and skipping a re-render.
    // _updateGhostEntry always produces a new Map so it cannot short-circuit here.
    setGhostsByAnchor(prev => {
      const focusedId = focusedSuggestAnchorIdRef.current
      if (focusedId === null) return prev
      const existing = prev.get(focusedId)
      if (!existing || !existing.rejected.has(idx)) return prev
      const nextRejected = new Set(existing.rejected)
      nextRejected.delete(idx)
      const next = new Map(prev)
      next.set(focusedId, { ...existing, rejected: nextRejected })
      return next
    })
    log.debug('geology', `unrejectLithoSuggestion idx=${idx}`)
  }, [])

  // ---------- Bulk-suggest fan-out + accept (debt #73) ----------

  /**
   * Fan out segmenter calls across N investigations in parallel
   * (capped to 5 concurrent). Replaces any prior bulk ghost state.
   * Per-anchor results stream into bulkLithoGhosts as they arrive
   * — partial state is visible mid-fetch so the user sees columns
   * fill in incrementally.
   *
   * Surface elevations come from the existing cpts/boreholes
   * lists (closures over the latest refs).
   */
  const handleSuggestAllLitho = useCallback(
    async (
      anchors: readonly {
        kind: 'cpt' | 'borehole'
        id: string
        surfaceElevationM: number | null
      }[],
    ): Promise<void> => {
      const model = activeLithoModelRef.current
      if (!project || !model || anchors.length === 0) return
      log.debug(
        'geology',
        `handleSuggestAllLitho fan-out anchors=${anchors.length}`,
      )
      // Wipe prior bulk state — confirmation dialog warned the user.
      // Preserve any focused (single) entry so a Suggest-all alongside
      // a focused single doesn't drop the focus (matches prior intent;
      // previously single + bulk were independent states).
      setGhostsByAnchor(prev => {
        const focusedId = focusedSuggestAnchorIdRef.current
        if (focusedId === null) return new Map()
        const entry = prev.get(focusedId)
        if (!entry) return new Map()
        return new Map([[focusedId, entry]])
      })
      setBulkLithoSuggesting(true)
      // Snapshot prefs once per fan-out so every anchor in the same bulk
      // call uses the same min-thickness — avoids race where the user
      // adjusts the slider mid-fan-out.
      const prefs = readLithoSegmenterPrefs(project.view_state)
      const CONCURRENCY = 5
      let cursor = 0
      const failures: string[] = []
      async function worker(): Promise<void> {
        while (cursor < anchors.length) {
          const anchorIdx = cursor++
          if (anchorIdx >= anchors.length) return
          const { kind, id, surfaceElevationM } = anchors[anchorIdx]
          try {
            const body =
              kind === 'cpt'
                ? {
                    cpt_id: id,
                    minimum_layer_thickness_m: prefs.minimumLayerThicknessM,
                    gunsat_kNm3: prefs.gunsatKNm3,
                    dr_compression_factor: prefs.drCompressionFactor,
                    merge_same_lithology: prefs.mergeSameLithology,
                    use_normalised_qc: prefs.useNormalisedQc,
                  }
                : {
                    borehole_id: id,
                    minimum_layer_thickness_m: prefs.minimumLayerThicknessM,
                  }
            const resp = await api.geology.suggestLitho(project!.id, model!.id, body)
            setGhostsByAnchor(prev => {
              const next = new Map(prev)
              next.set(id, {
                kind,
                suggestions: resp.layers,
                surfaceElevationM,
                accepted: new Set(),
                rejected: new Set(),
                edits: new Map(),
              })
              return next
            })
          } catch (err) {
            log.warn('geology', `bulk suggest failed anchor=${id}`, err)
            failures.push(id)
          }
        }
      }
      const workers = Array.from(
        { length: Math.min(CONCURRENCY, anchors.length) },
        () => worker(),
      )
      try {
        await Promise.all(workers)
        log.success(
          'geology',
          `handleSuggestAllLitho done anchors=${anchors.length} failures=${failures.length}`,
        )
        if (failures.length > 0) {
          toast(
            'error',
            `Suggested ${anchors.length - failures.length}/${anchors.length} — ${failures.length} failed.`,
          )
        }
      } finally {
        setBulkLithoSuggesting(false)
      }
    },
    // reason: activeLithoModelRef is a ref (stable). Project + toast
    // are the true deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project, toast],
  )

  /**
   * Accept one suggestion layer for one bulk anchor — single-item call.
   * Uses the same backend endpoint as ``handleAcceptLithoSuggestion``
   * but pulls the layer out of the bulk Map instead of the single-anchor
   * state. The accepted layer's idx is added to the anchor's accepted set
   * so the ghost overlay marks it.
   *
   * Refetches litho contacts on success so the section renders the
   * committed contact immediately (same fix shape as the single-anchor
   * path — dogfeed 2026-05-20).
   */
  const handleAcceptBulkLitho = useCallback(
    async (
      anchorId: string,
      idx: number,
      sectionId?: string | null,
      onSectionUpdated?: (s: CrossSectionResponse) => void,
    ): Promise<void> => {
      const model = activeLithoModelRef.current
      if (!project || !model) return
      // Read from the unified Map — debt #77 Phase 2. anchorId
      // discriminates whether this is a bulk entry or the focused
      // single; the accept logic is identical either way.
      const ghost = ghostsByAnchor.get(anchorId)
      if (!ghost || idx < 0 || idx >= ghost.suggestions.length) return
      const raw = ghost.suggestions[idx]
      const edit = ghost.edits.get(idx)
      const layer = edit
        ? {
            ...raw,
            depth_top_m: edit.depth_top_m ?? raw.depth_top_m,
            depth_base_m: edit.depth_base_m ?? raw.depth_base_m,
            suggested_lithology:
              (edit.suggested_lithology as LithoLayerSuggestion['suggested_lithology']) ??
              raw.suggested_lithology,
            suggested_admixtures: edit.suggested_admixtures
              ? edit.suggested_admixtures.map(a => ({ ...a }))
              : raw.suggested_admixtures,
          }
        : raw
      try {
        const body = buildLithoAcceptBody({
          anchorKind: ghost.kind,
          anchorId,
          sectionId,
          suggestions: [layer],
          viewState: project.view_state,
        })
        const result = await api.geology.acceptLithoSuggestions(
          project.id,
          model.id,
          body,
        )
        log.success(
          'geology',
          `acceptBulkLitho ok anchor=${anchorId} idx=${idx} contacts=${result.created_contact_ids.length + result.found_contact_ids.length}`,
        )
        // Debt #144: record created rows so this bulk accept lights the dirty flag.
        recordCreatedRows(addToSessionImports, result)
        // Debt #87: warn when this single bulk accept produced any unit
        // needing review.
        const summary = formatAcceptParentSummary(result)
        if (summary !== null) toast(summary.kind, summary.message)
        // Stale-TIN diagnostic: aggregate the response's count into
        // the session counter so the inspector pill picks it up.
        if (result.stale_tin_fallback_count > 0) {
          setLithoStaleTinSessionCount(c => c + result.stale_tin_fallback_count)
        }
        if (result.updated_section != null && onSectionUpdated != null) {
          onSectionUpdated(result.updated_section)
        }
        // Mark this idx accepted on the anchor (unified Map — debt #77).
        _updateGhostEntry(anchorId, existing => {
          const nextAccepted = new Set(existing.accepted)
          nextAccepted.add(idx)
          return { accepted: nextAccepted }
        })
        refetchLithoContacts()
        refetchFormations()
        // Record the accept on the undo stack (dogfeed 2026-05-22).
        pushAcceptLithoUndo(
          `Accept litho layer (${layer.suggested_lithology})`,
          model.id,
          [
            {
              body,
              createdContactIds: result.created_contact_ids.slice(),
              createdFormationIds: result.created_formation_ids.slice(),
              acceptedEntries: [{ anchorId, idx }],
            },
          ],
          onSectionUpdated ?? null,
        )
      } catch (err) {
        log.error('geology', `acceptBulkLitho failed anchor=${anchorId} idx=${idx}`, err)
        toast('error', 'Could not accept the litho suggestion.')
      }
    },
    // reason: activeLithoModelRef is a ref (stable identity); not listed.
    // ghostsByAnchor is in deps so the callback refreshes when the user
    // suggests/accepts/edits — the read of ghostsByAnchor.get(anchorId)
    // must see the latest map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      project,
      ghostsByAnchor,
      _updateGhostEntry,
      refetchLithoContacts,
      refetchFormations,
      toast,
      pushAcceptLithoUndo,
      addToSessionImports,
    ],
  )

  /**
   * Accept ALL non-rejected layers across ALL bulk anchors. One
   * accept-litho-suggestions call per anchor (sequential to keep the
   * section's seeded_formation_contact_ids update ordering coherent).
   * Edited depths are applied per anchor; failures per anchor are
   * surfaced via a single warning toast at the end.
   */
  const handleAcceptAllBulkLitho = useCallback(
    async (
      sectionId?: string | null,
      onSectionUpdated?: (s: CrossSectionResponse) => void,
    ): Promise<void> => {
      const model = activeLithoModelRef.current
      // Bulk = unified Map minus the focused (single) entry. The focused
      // anchor has its own Accept-all-pending verb; this verb only
      // sweeps non-focused anchors.
      if (!project || !model || bulkGhostsByAnchor.size === 0) return
      log.debug('geology', `acceptAllBulkLitho anchors=${bulkGhostsByAnchor.size} (batch endpoint)`)
      // Snapshot the Map entries so subsequent setState calls don't mutate
      // what we iterate.
      const entries = Array.from(bulkGhostsByAnchor.entries())

      // Build one batch payload covering every anchor with pending layers.
      // Each anchor keeps a single-accept-shaped ``body`` so the undo's
      // reapply (which re-POSTs via the single endpoint) stays unchanged.
      type AnchorPlan = {
        anchorId: string
        pendingIndices: number[]
        body: AcceptLithoUndoOp['body']
      }
      const plans: AnchorPlan[] = []
      for (const [anchorId, ghost] of entries) {
        const pendingIndices = ghost.suggestions
          .map((_, i) => i)
          .filter(i => !ghost.rejected.has(i))
        if (pendingIndices.length === 0) continue
        // Apply per-index edits — depth + composition overrides (#72).
        const pendingLayers = pendingIndices.map(i => {
          const raw = ghost.suggestions[i]
          const edit = ghost.edits.get(i)
          return edit
            ? {
                ...raw,
                depth_top_m: edit.depth_top_m ?? raw.depth_top_m,
                depth_base_m: edit.depth_base_m ?? raw.depth_base_m,
                suggested_lithology:
                  (edit.suggested_lithology as LithoLayerSuggestion['suggested_lithology']) ??
                  raw.suggested_lithology,
                suggested_admixtures: edit.suggested_admixtures
                  ? edit.suggested_admixtures.map(a => ({ ...a }))
                  : raw.suggested_admixtures,
              }
            : raw
        })
        plans.push({
          anchorId,
          pendingIndices,
          body: {
            ...(ghost.kind === 'cpt' ? { cpt_id: anchorId } : { borehole_id: anchorId }),
            section_id: sectionId ?? null,
            suggestions: pendingLayers,
            defer_inference: true,
          },
        })
      }
      if (plans.length === 0) return

      // ONE call: all anchors committed in a single transaction, the section
      // seeded once, and inference recomputed once — server-side (#153 batch
      // lever). Replaces the per-anchor accept loop + the separate recompute
      // call. Auto-correlate stays a separate call (its on-accept behaviour is
      // still under review — #140).
      let resp: BatchAcceptLithoSuggestionsResponse
      try {
        resp = await api.geology.batchAcceptLithoSuggestions(project.id, model.id, {
          anchors: plans.map(p => ({
            ...(p.body.cpt_id != null ? { cpt_id: p.body.cpt_id } : {}),
            ...(p.body.borehole_id != null ? { borehole_id: p.body.borehole_id } : {}),
            suggestions: p.body.suggestions,
          })),
          section_id: sectionId ?? null,
          run_inference: true,
          ...lithoAcceptTuningParams(project.view_state),
        })
      } catch (err) {
        log.error('geology', 'acceptAllBulkLitho batch call failed', err)
        toast('error', 'Could not accept litho layers.')
        return
      }

      // Index the per-anchor results by anchor id (= cpt_id or borehole_id).
      const resultByAnchor = new Map(
        resp.anchors.map(a => [(a.cpt_id ?? a.borehole_id) as string, a]),
      )
      if (resp.updated_section != null && onSectionUpdated != null) {
        onSectionUpdated(resp.updated_section)
      }
      if (resp.total_stale_tin_fallbacks > 0) {
        setLithoStaleTinSessionCount(c => c + resp.total_stale_tin_fallbacks)
      }

      // Mark accepted indices for every committed anchor in a single setState,
      // and collect one undo op per committed anchor.
      const collectedOps: AcceptLithoUndoOp[] = []
      const acceptedByAnchor = new Map<string, number[]>()
      const failures: string[] = []
      // Debt #144: aggregate every committed anchor's created rows so the
      // whole bulk accept marks the project dirty in two manifest calls
      // (one per kind), not N. Mirrors the single-accept handlers.
      const createdContactIdsAll: string[] = []
      const createdFormationIdsAll: string[] = []
      for (const plan of plans) {
        const r = resultByAnchor.get(plan.anchorId)
        if (r == null || r.error != null) {
          failures.push(plan.anchorId)
          continue
        }
        acceptedByAnchor.set(plan.anchorId, plan.pendingIndices)
        createdContactIdsAll.push(...r.created_contact_ids)
        createdFormationIdsAll.push(...r.created_formation_ids)
        collectedOps.push({
          body: plan.body,
          createdContactIds: r.created_contact_ids.slice(),
          createdFormationIds: r.created_formation_ids.slice(),
          acceptedEntries: plan.pendingIndices.map(idx => ({ anchorId: plan.anchorId, idx })),
        })
      }
      recordCreatedRows(addToSessionImports, {
        created_formation_ids: createdFormationIdsAll,
        created_contact_ids: createdContactIdsAll,
      })
      setGhostsByAnchor(prev => {
        const next = new Map(prev)
        let changed = false
        for (const [anchorId, indices] of acceptedByAnchor) {
          const existing = next.get(anchorId)
          if (!existing) continue
          const nextAccepted = new Set(existing.accepted)
          for (const i of indices) nextAccepted.add(i)
          next.set(anchorId, { ...existing, accepted: nextAccepted })
          changed = true
        }
        return changed ? next : prev
      })

      const committedCount = plans.length - failures.length
      log.success(
        'geology',
        `acceptAllBulkLitho done anchors=${plans.length} committed=${committedCount} ` +
          `contacts=${resp.total_created_contacts} failures=${failures.length} ` +
          `inference_ran=${resp.inference_ran} extrapolated=${resp.total_extrapolated_formations} ` +
          `orphan=${resp.total_orphan_formations}`,
      )
      toast(
        'success',
        `Accepted ${committedCount} anchor${committedCount === 1 ? '' : 's'}` +
          (resp.inference_ran ? ' — inference updated.' : '.'),
      )

      // #140 (owner directive 2026-05-28): auto-correlate is DECOUPLED from
      // accept-all. Bulk accept no longer silently creates correlation edges —
      // the user runs Auto-correlate explicitly from the correlation toolbar
      // when they want it, so accepting suggestions never surprises them with
      // amber edges. (handleAutoCorrelate remains the manual entry point.)

      // Debt #87: ONE aggregated warning naming the total units needing review.
      const aggSummary = formatAcceptParentSummary({
        created_formation_ids: [],
        found_formation_ids: [],
        created_contact_ids: [],
        found_contact_ids: [],
        straddle_split_count: 0,
        stale_tin_fallback_count: 0,
        extrapolated_formation_ids: new Array(resp.total_extrapolated_formations).fill(''),
        orphan_formation_ids: new Array(resp.total_orphan_formations).fill(''),
        updated_section: null,
      })
      if (aggSummary !== null) toast(aggSummary.kind, aggSummary.message)
      if (failures.length > 0) {
        toast('error', `Accepted ${committedCount}/${plans.length} — ${failures.length} failed.`)
      }
      refetchLithoContacts()
      refetchFormations()
      pushAcceptLithoUndo(
        `Accept all litho layers (${collectedOps.length} investigation${
          collectedOps.length === 1 ? '' : 's'
        })`,
        model.id,
        collectedOps,
        onSectionUpdated ?? null,
      )
    },
    // reason: activeLithoModelRef is a ref. bulkGhostsByAnchor is in
    // deps so the snapshot the loop iterates is always the latest
    // (a stale closure would iterate yesterday's anchors).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      project,
      bulkGhostsByAnchor,
      refetchLithoContacts,
      refetchFormations,
      toast,
      pushAcceptLithoUndo,
      addToSessionImports,
    ],
  )

  return {
    handleAutoCorrelate,
    handleClearSuggestions,
    handleEditLithoSuggestion,
    effectiveLithoSuggestionAt,
    clearLithoSuggestions,
    clearBulkLithoGhosts,
    handleStripLithoAdmixtures,
    handleReseedLithoAdmixtures,
    handleRejectBulkLitho,
    handleUnrejectBulkLitho,
    handleEditBulkLitho,
    handleInsertLithoLayer,
    handleSplitLithoLayer,
    handleMergeLithoLayers,
    handleAbsorbLithoLayer,
    handleCreateManualLithoGhost,
    handleExtendLithoGhostToNearestContacts,
    handleSuggestLitho,
    pushAcceptLithoUndo,
    handleAcceptLithoSuggestion,
    handleAcceptAllLithoSuggestions,
    handleRejectLithoSuggestion,
    handleUnrejectLithoSuggestion,
    handleSuggestAllLitho,
    handleAcceptBulkLitho,
    handleAcceptAllBulkLitho,
  }
}
