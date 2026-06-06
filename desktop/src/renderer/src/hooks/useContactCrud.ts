/**
 * Contact-CRUD handler cluster for {@link useGeologicalModel} (debt #201
 * Move 5). Extracted as a focused sub-hook so the composer stays a thin owner
 * of shared state. A leaf cluster: the only intra-cluster call is
 * ``handleCreateContact`` → ``handleUpdateContactDepth`` (both live here); no
 * handler outside this cluster calls any of these.
 *
 * The shared state (contacts list + setter, litho contacts/layers, the refetch
 * helpers, the undo stack, the dirty/manifest signals) lives in the composer
 * and is passed in; this hook owns only the create/update/delete callbacks.
 *
 * Dep-array convention (carried verbatim from the composer): ``setContacts``
 * (a ``useState`` setter) and ``toast`` (a ref-only plain function from
 * ``useToasts`` that never goes stale) are intentionally omitted from the
 * ``useCallback`` dep arrays — both are stable-by-construction references, so
 * listing them would only churn callback identities. Varying values
 * (``project``, ``contacts``, ``lithoContacts``, ``lithoLayers``) ARE listed.
 */
import { useCallback, type Dispatch, type SetStateAction } from 'react'

import { api, DuplicateContactError } from '../api/client'
import type {
  FormationContactBatchUpdateEntry,
  FormationContactResponse,
  GeologicalModelResponse,
  LithoLayerBatchUpdateItem,
  LithoLayerResponse,
  ProjectResponse,
} from '../api/client'
import type { ContactCopyPayload } from '../components/sections/ContactsLayer'
import type { UndoCommand } from './useUndoStack'
import { log } from '../utils/log'

/** Project a {@link FormationContactBatchUpdateEntry} onto the layer
 * batch-update shape. Used by handleBatchUpdateContacts (A4 slice 4b)
 * for both the immediate call and its undo/reapply lambdas.
 *
 * Strips null/undefined optional fields so the LithoLayerBatchUpdateItem
 * type (which requires `number` not `number | null`) is satisfied; the
 * BE applies only fields present in the body (`model_dump(exclude_unset)`).
 */
function formationContactBatchToLayerItem(
  u: FormationContactBatchUpdateEntry,
): LithoLayerBatchUpdateItem {
  const out: LithoLayerBatchUpdateItem = { layer_id: u.contact_id }
  if (u.depth_top_m != null) out.depth_top_m = u.depth_top_m
  if (u.source != null) {
    // Map FC source enum back to LL source enum (inverse of the trigger's
    // forward mapping; observation_layer ↔ borehole_observation; the
    // 'manual' / 'interpolated' / 'geological_model_seed' contact sources
    // collapse into LL 'manual').
    out.source = u.source === 'borehole_observation' ? 'observation_layer' : 'manual'
  }
  if (u.confidence != null) out.confidence = u.confidence
  // Anchor XOR — only included when the batch is doing a cross-column
  // MOVE (the schema rejects half-anchor patches). Both fields must
  // appear together with exactly one non-null.
  if (u.borehole_id !== undefined && u.cpt_id !== undefined) {
    out.borehole_id = u.borehole_id
    out.cpt_id = u.cpt_id
  }
  return out
}

/** Inputs for {@link useContactCrud}. */
export interface UseContactCrudParams {
  /** The open project, or null when none is loaded. */
  project: ProjectResponse | null
  /** The active geological model (target for new geological contacts). */
  activeGeologicalModel: GeologicalModelResponse | null
  /** Composer-owned geological contacts list. */
  contacts: FormationContactResponse[]
  /** Setter for the geological contacts list (optimistic patches). */
  setContacts: Dispatch<SetStateAction<FormationContactResponse[]>>
  /** Derived litho contacts (read-only here — drives the litho-vs-geo fork). */
  lithoContacts: FormationContactResponse[]
  /** Litho layers (source of truth for the litho axis). */
  lithoLayers: LithoLayerResponse[]
  /** Resync the geological contacts list from the server. */
  refetchContacts: () => void
  /** Resync the litho layers (and the derived litho contacts) from the server. */
  refetchLithoContacts: () => void
  /** Add contact ids to the session-import (dirty) set. */
  addToSessionImports: (kind: 'formation' | 'contact', ids: string[]) => void
  /** Push an undo command onto the stack. */
  pushUndo: (cmd: UndoCommand) => void
  /** Mark the project dirty after a mutation of pre-existing rows (#160). */
  markMutated: () => void
  /** Surface a toast to the user. */
  toast: (type: 'success' | 'error' | 'warning', message: string) => void
}

/** Handlers returned by {@link useContactCrud}. */
export interface UseContactCrudResult {
  handleCreateContact: (
    anchorKind: 'cpt' | 'borehole',
    anchorId: string,
    depth_m: number,
    formationId: string,
    snapped: boolean,
    sectionId?: string | null,
  ) => Promise<void>
  handleUpdateContactDepth: (
    contactId: string,
    newDepthM: number,
    snapped: boolean,
    field?: 'top' | 'base',
  ) => Promise<void>
  handleBatchCreateContacts: (
    creates: readonly ContactCopyPayload[],
    sectionId?: string | null,
  ) => Promise<void>
  handleBatchUpdateContacts: (
    updates: readonly FormationContactBatchUpdateEntry[],
  ) => Promise<void>
  handleDeleteContact: (contactId: string) => Promise<void>
  handleUnlinkLithoFromGeo: (contactId: string) => Promise<void>
  handleLinkLithoToGeo: (contactId: string) => Promise<void>
}

/**
 * Contact create / update / delete callbacks (geological + litho axes).
 *
 * Parameters
 * ----------
 * params
 *     See {@link UseContactCrudParams}.
 *
 * Returns
 * -------
 * UseContactCrudResult
 *     The seven contact-CRUD handlers.
 */
export function useContactCrud({
  project,
  activeGeologicalModel,
  contacts,
  setContacts,
  lithoContacts,
  lithoLayers,
  refetchContacts,
  refetchLithoContacts,
  addToSessionImports,
  pushUndo,
  markMutated,
  toast,
}: UseContactCrudParams): UseContactCrudResult {
  // Re-pick an existing contact's depth — the commit handler for
  // the drag interaction on the section's ContactsLayer. Updates the
  // local contacts list optimistically on success so the polyline
  // settles at the dragged Y without a refetch round-trip.
  //
  // Declared first so ``handleCreateContact``'s 409-recovery path can
  // call it directly without a forward-ref.
  const handleUpdateContactDepth = useCallback(
    async (
      contactId: string,
      newDepthM: number,
      snapped: boolean,
      field: 'top' | 'base' = 'top',
    ): Promise<void> => {
      if (!project) return
      log.debug(
        'geology',
        `updateContactDepth entry id=${contactId} newDepth=${newDepthM.toFixed(3)}m snapped=${snapped} field=${field}`,
      )
      try {
        // Snapshot the pre-update contact so undo can restore depth
        // + source + confidence in one PATCH (debt #22 / #23 rule:
        // source/confidence ride along with depth changes).
        // The contact carries its own model_id — derive the model +
        // the target contact-set from the contact so this works on the
        // litho axis too (the contact-edit handlers were hard-wired to
        // the geological model — dogfeed 2026-05-22).
        const previous =
          contacts.find(c => c.id === contactId) ??
          lithoContacts.find(c => c.id === contactId)
        if (!previous) return
        const modelId = previous.model_id
        const isLitho = lithoContacts.some(c => c.id === contactId)
        // applyPatch only fires in the geo `else` branch (litho path
        // early-returns into refetchLithoContacts before reaching
        // any applyPatch call). The variable is geo-only by
        // construction — the historical noop-on-litho ternary was
        // dead code.
        const applyPatch = setContacts
        // Diagnostic: drag-up cross-merge regression repro (2026-05-26).
        // Records the FE→BE handoff so the user can see exactly what
        // depth+axis the hook dispatched on a buggy drag.
        log.debug('geology', '[handleUpdateContactDepth]', {
          contactId,
          modelId,
          previousDepthM: previous.depth_top_m,
          newDepthM,
          field,
          delta: previous.depth_top_m - newDepthM,
          direction: newDepthM < previous.depth_top_m ? 'UP' : 'DOWN',
          snapped,
          axis: isLitho ? 'litho' : 'geological',
          refetchPath: isLitho ? 'refetchLithoContacts' : 'refetchContacts',
        })
        // A4 slice 3 — litho writers target /layers; updateLayer hits
        // PATCH /layers/{lid} and the LL→FC trigger mirrors the depth
        // move into formation_contact. Litho cross-merge is disabled
        // at the BE (owner directive 2026-05-27, commit 9d4a01db) so
        // the null-response branch below is geo-only by construction
        // — updateLayer can't return null for a row that exists.
        // The source enum maps differently: snap='observation_layer'
        // ↔ FC 'borehole_observation'; unsnapped='manual' ↔ 'manual_pick'.
        //
        // field='top' → depth_top_m (the shared-boundary-as-TOP case:
        //   pending BASE dragged DOWN past the accepted layer below).
        // field='base' → depth_base_m (the shared-boundary-as-BASE case:
        //   pending TOP dragged UP into the accepted layer above — the
        //   accepted layer's BASE must shrink, not its top).
        const lithoDepthPatch =
          field === 'base'
            ? { depth_base_m: newDepthM, source: snapped ? 'observation_layer' as const : 'manual' as const, confidence: snapped ? 'high' as const : 'medium' as const }
            : { depth_top_m: newDepthM, source: snapped ? 'observation_layer' as const : 'manual' as const, confidence: snapped ? 'high' as const : 'medium' as const }
        const updated = isLitho
          ? await api.geology.updateLayer(project.id, modelId, contactId, lithoDepthPatch)
          : await api.geology.updateContact(project.id, modelId, contactId, {
              depth_top_m: newDepthM,
              source: snapped ? 'borehole_observation' : 'manual_pick',
              confidence: snapped ? 'high' : 'medium',
            })
        // Mutation of a pre-existing contact — mark dirty so the close
        // prompt fires and a close-without-save reverts it (#160).
        markMutated()

        // null = drag-down cross-merge: dragger was absorbed by the formation
        // above.  The BE deleted the dragger + all crossed contacts in one
        // atomic transaction.  We don't know which peer IDs were deleted, so
        // we do a full refetch rather than optimistic filtering — the refetch
        // is cheap (one GET for the model's contacts) and is the only way to
        // keep local state consistent with DB truth after a multi-delete.
        if (updated === null) {
          log.success(
            'geology',
            `updateContactDepth absorbed id=${contactId} (drag-down cross-merge) — refetching`,
          )
          log.debug('geology', '[handleUpdateContactDepth] absorbed-204', {
            contactId,
            axis: isLitho ? 'litho' : 'geological',
          })
          if (isLitho) {
            refetchLithoContacts()
          } else {
            refetchContacts()
          }
          return
        }

        // Full refetch on every successful drag commit (200 response).
        //
        // Previous approach: optimistic client-side prune of peers in
        // [newDepthM, oldDepthM) for drag-up cross-merges. That prune was
        // buggy: when contacts span multiple formations the half-open interval
        // condition sometimes missed peers, leaving ghost bands in the section
        // view even though the BE had already deleted them (dogfeed 2026-05-26).
        // Drag-down already did a full refetch (null response → 204 branch
        // above). Aligning drag-up to the same refetch path eliminates the
        // optimistic-prune bug at the cost of ~50 ms extra latency per commit
        // — negligible compared to the drag gesture duration.
        log.debug('geology', '[handleUpdateContactDepth] ok-200', {
          contactId,
          returnedId: updated.id,
          returnedDepthM: updated.depth_top_m,
          returnedFormationId: updated.formation_id,
          returnedSource: updated.source,
          axis: isLitho ? 'litho' : 'geological',
        })
        if (isLitho) {
          refetchLithoContacts()
        } else {
          refetchContacts()
        }
        log.success(
          'geology',
          `updateContactDepth ok id=${contactId} depth=${updated.depth_top_m.toFixed(3)}m source=${updated.source} — refetching`,
        )
        // Undo: PATCH the row back to its pre-drag state. A4 slice 3
        // forks litho vs geological — litho hits /layers, geological
        // stays on /contacts. The refetch path keeps lithoLayers +
        // lithoContacts in lockstep for the litho branch.
        const projectId = project.id
        const beforePayload = {
          depth_top_m: previous.depth_top_m,
          source: previous.source as
            | 'borehole_observation'
            | 'manual_pick'
            | 'interpolated',
          confidence: previous.confidence as 'high' | 'medium' | 'low',
        }
        const afterPayload = {
          depth_top_m: updated.depth_top_m,
          source: updated.source as
            | 'borehole_observation'
            | 'manual_pick'
            | 'interpolated',
          confidence: updated.confidence as 'high' | 'medium' | 'low',
        }
        // Layer-shape payloads for the litho path. Status stays as-is
        // (the drag doesn't change accept/reject); source maps the
        // same way as the main update above.
        // For field='base': the before/after payloads write depth_base_m
        // back (undo restores the original depth_base_m; reapply re-applies
        // the dragged depth_base_m). For field='top': the original path.
        const lithoSource = (src: string) =>
          (src === 'borehole_observation' || src === 'observation_layer'
            ? 'observation_layer'
            : 'manual') as 'observation_layer' | 'manual'
        const beforeLayerPayload =
          field === 'base'
            ? {
                // Undo a BASE edit: restore the layer's depth_base_m to the
                // pre-drag value. previous.depth_top_m is unchanged — only
                // the base was touched — so a pure depth_base_m PATCH suffices.
                // source/confidence carry along for audit-log completeness.
                depth_base_m: lithoLayers.find(l => l.id === contactId)?.depth_base_m ?? newDepthM,
                source: lithoSource(previous.source),
                confidence: previous.confidence as 'high' | 'medium' | 'low',
              }
            : {
                depth_top_m: previous.depth_top_m,
                source: lithoSource(previous.source),
                confidence: previous.confidence as 'high' | 'medium' | 'low',
              }
        const afterLayerPayload =
          field === 'base'
            ? {
                depth_base_m: newDepthM,
                source: lithoSource(updated.source),
                confidence: updated.confidence as 'high' | 'medium' | 'low',
              }
            : {
                depth_top_m: updated.depth_top_m,
                source: lithoSource(updated.source),
                confidence: updated.confidence as 'high' | 'medium' | 'low',
              }
        pushUndo({
          description: 'Move contact',
          revert: async () => {
            if (isLitho) {
              await api.geology.updateLayer(projectId, modelId, contactId, beforeLayerPayload)
              refetchLithoContacts()
              return
            }
            const reverted = await api.geology.updateContact(
              projectId,
              modelId,
              contactId,
              beforePayload,
            )
            if (reverted !== null) {
              applyPatch(prev => prev.map(c => (c.id === contactId ? reverted : c)))
            }
          },
          reapply: async () => {
            if (isLitho) {
              await api.geology.updateLayer(projectId, modelId, contactId, afterLayerPayload)
              refetchLithoContacts()
              return
            }
            const reapplied = await api.geology.updateContact(
              projectId,
              modelId,
              contactId,
              afterPayload,
            )
            if (reapplied !== null) {
              applyPatch(prev => prev.map(c => (c.id === contactId ? reapplied : c)))
            }
          },
        })
      } catch (err) {
        log.error('geology', 'updateContact failed', err)
        toast('error', 'Could not update the contact depth.')
      }
    },
    [
      project,
      contacts,
      lithoContacts,
      lithoLayers,
      pushUndo,
      refetchContacts,
      refetchLithoContacts,
      markMutated,
    ],
  )

  // Create a formation contact at a specific depth on a specific
  // investigation. Wired from SectionPanel — the user clicks on a
  // borehole's lithology strip or commits a CPT's slider depth,
  // picks a formation in the modal, and this fires with the
  // (anchorKind, anchorId, depth, formation) tuple. The new
  // contact lands in DB AND in App's contacts state so the
  // ContactsLayer overlay updates without a refetch.
  const handleCreateContact = useCallback(
    async (
      anchorKind: 'cpt' | 'borehole',
      anchorId: string,
      depth_m: number,
      formationId: string,
      snapped: boolean,
      sectionId?: string | null,
    ): Promise<void> => {
      if (!project || !activeGeologicalModel) return
      log.debug(
        'geology',
        `createContact entry kind=${anchorKind} anchor=${anchorId} depth=${depth_m.toFixed(3)}m formation=${formationId} snapped=${snapped}` +
          (sectionId ? ` section=${sectionId}` : ''),
      )
      try {
        // Snap-placed contacts: depth came from a stratigraphy
        // observation boundary on the borehole, so source =
        // 'borehole_observation' and confidence = 'high'.
        // Free-placed: engineer's manual call, source = 'manual_pick',
        // confidence stays at the schema default 'medium'.
        // Debt #22 / #23.
        const payload = {
          formation_id: formationId,
          depth_top_m: depth_m,
          borehole_id: anchorKind === 'borehole' ? anchorId : null,
          cpt_id: anchorKind === 'cpt' ? anchorId : null,
          source: (snapped ? 'borehole_observation' : 'manual_pick') as
            | 'borehole_observation'
            | 'manual_pick',
          confidence: (snapped ? 'high' : 'medium') as 'high' | 'medium',
          // P2 explicit-content: when drawn on a section, tell the backend
          // so it unions this contact's id into seeded_formation_contact_ids
          // (else SectionsCanvas's P2-F filter hides it). Reused verbatim by
          // the undo reapply path below (same `payload` object).
          ...(sectionId ? { section_id: sectionId } : {}),
        }
        const created = await api.geology.createContact(
          project.id,
          activeGeologicalModel.id,
          payload,
        )
        setContacts(prev => [...prev, created])
        addToSessionImports('contact', [created.id])
        log.success(
          'geology',
          `createContact ok id=${created.id} depth=${created.depth_top_m.toFixed(3)}m source=${created.source}`,
        )
        // Undo command — captures the created id in a closure
        // variable so the reapply path can overwrite it on
        // redo (the re-POST gets a new server-assigned id).
        const projectId = project.id
        const modelId = activeGeologicalModel.id
        let currentId = created.id
        pushUndo({
          description: 'Create contact',
          revert: async () => {
            await api.geology.deleteContact(projectId, modelId, currentId)
            setContacts(prev => prev.filter(c => c.id !== currentId))
          },
          reapply: async () => {
            const recreated = await api.geology.createContact(
              projectId,
              modelId,
              payload,
            )
            currentId = recreated.id
            setContacts(prev => [...prev, recreated])
            addToSessionImports('contact', [recreated.id])
          },
        })
      } catch (err) {
        // 409 = a contact for this (borehole, formation) already
        // exists. Backend returns the existing id in detail.existing_contact_id;
        // we treat the click as "move that one to the new depth"
        // rather than refusing — the user clearly wants Boom Klei
        // at the depth they just clicked, and the geological rule
        // is one top per formation per borehole. PATCH the existing
        // contact's depth to the new location.
        //
        // Both functions are in the same module, so we can call
        // handleUpdateContactDepth directly — no forward-ref needed.
        const existingId =
          err instanceof DuplicateContactError ? err.existingContactId : null
        if (existingId) {
          log.info(
            'geology',
            `createContact 409 — moving existing ${existingId} to ${depth_m.toFixed(3)}m instead`,
          )
          try {
            await handleUpdateContactDepth(existingId, depth_m, snapped)
          } catch (moveErr) {
            log.error('geology', 'duplicate-contact move failed', moveErr)
            toast('error', 'Could not move the existing contact to the new depth.')
          }
          return
        }
        log.error('geology', 'createContact failed', err)
        toast('error', 'Could not place the formation contact.')
      }
    },
    [project, activeGeologicalModel, addToSessionImports, pushUndo, handleUpdateContactDepth],
  )

  // Cross-column COPY commit — fired by plain-drag onto a different
  // column. Each entry becomes a new contact at the target anchor;
  // originals stay where they were. The "stamp my interpretation
  // onto a nearby test" workflow that dogfooding identified as the
  // dominant cross-column use case.
  //
  // Implementation: N parallel POSTs via the existing single-create
  // endpoint. Acceptable for v1 (typical stack ≤6 contacts; partial-
  // failure risk small in absolute terms). Promote to a dedicated
  // ``POST /contacts/batch-create`` endpoint when failure rates
  // start to bite.
  const handleBatchCreateContacts = useCallback(
    async (
      creates: readonly ContactCopyPayload[],
      sectionId?: string | null,
    ): Promise<void> => {
      if (!project || !activeGeologicalModel) return
      if (creates.length === 0) return
      // P2 explicit-content: when the copy happens on a section, every
      // created id must be seeded into seeded_formation_contact_ids or
      // SectionsCanvas's P2-F filter hides the whole copy. Threaded into
      // both the main POST and the undo-redo re-POST below; the caller
      // (sectionAwareBatchCreateContacts) refreshes the section once after.
      const withSection = <T extends object>(p: T): T =>
        sectionId ? { ...p, section_id: sectionId } : p
      log.debug(
        'geology',
        `batchCreateContacts entry count=${creates.length}`,
      )
      const projectId = project.id
      const modelId = activeGeologicalModel.id

      // Per-entry result: either a fresh POST (newly-created) OR a
      // PATCH of an already-existing (target_borehole, formation)
      // contact whose pre-PATCH state we snapshot for undo. The COPY
      // workflow's intent on collision is "stamp the source's depth
      // onto the target" — so a 409 from the new uniqueness rule
      // becomes a "move existing to here" instead of a hard failure.
      type PatchedItem = {
        kind: 'patched'
        before: FormationContactResponse
        after: FormationContactResponse
      }
      const created: FormationContactResponse[] = []
      const patched: PatchedItem[] = []
      let failed = 0
      // Local index of "everything currently in the model on the
      // server side" — seeded from React state, then live-updated
      // as this batch progresses. Authoritative for in-batch 409
      // PATCH lookups: a row created earlier in this loop hasn't
      // landed in React state yet (we flush ``setContacts`` at the
      // end), so checking ``contacts`` alone would miss it.
      const idIndex = new Map<string, FormationContactResponse>(
        contacts.map(c => [c.id, c]),
      )
      // Sequential, NOT parallel. Two source CPTs landing on one
      // target produces N picks for the same (formation, anchor)
      // triple; the backend's uniqueness check is application-layer
      // (no DB unique index — see create_formation_contact.py), so
      // parallel POSTs race and each transaction sees "no existing"
      // → all of them insert. Serialising lets the second POST for
      // a given triple hit a real 409 and fall into the PATCH path,
      // which IS the "stamp the source's depth onto the target"
      // semantic. Throughput trade-off is negligible at copy-shape
      // batch sizes (~10 rows worst case).
      for (let i = 0; i < creates.length; i += 1) {
        const payload = creates[i]
        try {
          const row = await api.geology.createContact(
            projectId,
            modelId,
            withSection(payload),
          )
          created.push(row)
          idIndex.set(row.id, row)
        } catch (err) {
          if (err instanceof DuplicateContactError) {
            // 409: target already has a contact for this formation
            // (either pre-existing OR just inserted earlier in this
            // same batch). PATCH it to the new depth — "stamp on
            // target" semantic, latest-copy-wins.
            const before = idIndex.get(err.existingContactId)
            if (!before) {
              // Defensive: existing contact id missing from both the
              // server-state cache and the in-batch index. Refetch
              // would slow the path; skip + count.
              failed += 1
              log.warn(
                'geology',
                `batchCreateContacts 409 but existing id ${err.existingContactId} not in local cache, skipped`,
              )
              continue
            }
            try {
              const after = await api.geology.updateContact(
                projectId,
                modelId,
                err.existingContactId,
                {
                  depth_top_m: payload.depth_top_m,
                  source: payload.source,
                  confidence: payload.confidence,
                },
              )
              // null = absorbed by drag-down cross-merge; cannot happen on a
              // plain depth PATCH without a cross-merge, but guard defensively.
              if (after === null) {
                failed += 1
                log.warn(
                  'geology',
                  `batchCreateContacts PATCH-on-409 returned absorbed for ${err.existingContactId} — skipping`,
                )
                continue
              }
              patched.push({ kind: 'patched', before, after })
              idIndex.set(after.id, after)
            } catch (patchErr) {
              failed += 1
              log.error(
                'geology',
                `batchCreateContacts PATCH-on-409 failed for existing ${err.existingContactId}`,
                patchErr,
              )
            }
            continue
          }
          // Non-409 failure (network, validation, etc.) — count +
          // log, keep going so the rest of the batch still commits.
          failed += 1
          log.error('geology', 'batchCreateContacts entry failed', err)
        }
      }

      // Apply local-state changes from BOTH lanes at once.
      if (created.length > 0) {
        setContacts(prev => [...prev, ...created])
        addToSessionImports('contact', created.map(c => c.id))
      }
      if (patched.length > 0) {
        const byId = new Map(patched.map(p => [p.after.id, p.after]))
        setContacts(prev => prev.map(c => byId.get(c.id) ?? c))
      }
      const total = created.length + patched.length
      log.success(
        'geology',
        `batchCreateContacts ok created=${created.length} ` +
          `moved-existing=${patched.length} failed=${failed}`,
      )
      if (total === 0) {
        toast(
          'error',
          'Could not copy any contacts to the target — see console for details.',
        )
        return
      }
      if (failed > 0) {
        toast(
          'error',
          `Copied ${total} contact(s); ${failed} failed — some may be missing.`,
        )
      }

      // Undo: revert BOTH lanes — DELETE everything we created, PATCH
      // everything we moved back to its pre-move state. Redo replays
      // the same shape (re-POSTs the creates with fresh ids,
      // re-PATCHes the moves to the post state).
      let currentCreatedIds = created.map(c => c.id)
      const createdPayloads = creates.slice()
      const patchedSnapshots = patched.slice()
      pushUndo({
        description:
          patched.length > 0
            ? `Copy ${created.length}, move ${patched.length} contact(s)`
            : `Copy ${created.length} contact(s)`,
        revert: async () => {
          await Promise.all(
            currentCreatedIds.map(id =>
              api.geology.deleteContact(projectId, modelId, id),
            ),
          )
          const deleted = new Set(currentCreatedIds)
          setContacts(prev => prev.filter(c => !deleted.has(c.id)))
          // PATCH each "moved" contact back to its pre-move state.
          // Run in parallel; per-(model, anchor, formation)
          // uniqueness can't be violated here because we're shrinking
          // toward the previous state.
          await Promise.all(
            patchedSnapshots.map(p =>
              api.geology
                .updateContact(projectId, modelId, p.after.id, {
                  depth_top_m: p.before.depth_top_m,
                  source: p.before.source,
                  confidence: p.before.confidence,
                })
                .then(reverted => {
                  if (reverted === null) return
                  setContacts(prev =>
                    prev.map(c => (c.id === reverted.id ? reverted : c)),
                  )
                }),
            ),
          )
        },
        reapply: async () => {
          // POST fresh creates — capture new server ids for the
          // next revert.
          const recreated: FormationContactResponse[] = []
          // We may NOT 409 this time around (the previous revert
          // deleted them), so a plain POST is safe.
          for (let j = 0; j < createdPayloads.length; j += 1) {
            const r = await api.geology.createContact(
              projectId,
              modelId,
              withSection(createdPayloads[j]),
            )
            recreated.push(r)
          }
          currentCreatedIds = recreated.map(c => c.id)
          if (recreated.length > 0) {
            setContacts(prev => [...prev, ...recreated])
            addToSessionImports('contact', recreated.map(c => c.id))
          }
          // PATCH each previously-moved contact back to the
          // post-move state.
          await Promise.all(
            patchedSnapshots.map(p =>
              api.geology
                .updateContact(projectId, modelId, p.after.id, {
                  depth_top_m: p.after.depth_top_m,
                  source: p.after.source,
                  confidence: p.after.confidence,
                })
                .then(reapplied => {
                  if (reapplied === null) return
                  setContacts(prev =>
                    prev.map(c => (c.id === reapplied.id ? reapplied : c)),
                  )
                }),
            ),
          )
        },
      })
    },
    [
      project,
      activeGeologicalModel,
      addToSessionImports,
      pushUndo,
      contacts,
    ],
  )

  // All-or-nothing batch UPDATE commit — fired by the section
  // editor's same-column multi-drag (depth shift) and the explicit
  // Alt+drag cross-column MOVE (re-anchor). Sends one PUT and
  // patches local state with the returned rows so the section
  // overlay updates without a refetch.
  // The single-contact same-anchor depth-only drag still goes
  // through ``handleUpdateContactDepth`` to keep the existing PATCH
  // tests pinned and to avoid a server round-trip per pixel.
  const handleBatchUpdateContacts = useCallback(
    async (
      updates: readonly FormationContactBatchUpdateEntry[],
    ): Promise<void> => {
      if (!project) return
      if (updates.length === 0) return
      log.debug(
        'geology',
        `batchUpdateContacts entry count=${updates.length}`,
      )
      try {
        // Snapshot the pre-update state for every contact in the
        // batch so undo can PUT them back in one call.
        const updateIds = updates.map(u => u.contact_id)
        const idSet = new Set(updateIds)
        // A batch is always within one model; derive it (+ the target
        // contact-set) from the contacts themselves so this works on
        // the litho axis too — dogfeed 2026-05-22: was hard-wired to
        // the geological model, so a litho-contact batch 404'd.
        const firstContact =
          contacts.find(c => c.id === updateIds[0]) ??
          lithoContacts.find(c => c.id === updateIds[0])
        if (!firstContact) {
          log.error(
            'geology',
            `batchUpdateContacts: contact ${updateIds[0]} not in local state`,
          )
          return
        }
        const modelId = firstContact.model_id
        const isLitho = lithoContacts.some(c => c.id === updateIds[0])
        // applyPatch only fires in the geo `else` branch (litho path
        // early-returns into refetchLithoContacts before reaching
        // any applyPatch call). The variable is geo-only by
        // construction — the historical noop-on-litho ternary was
        // dead code.
        const applyPatch = setContacts
        const beforeById = new Map(
          [...contacts, ...lithoContacts]
            .filter(c => idSet.has(c.id))
            .map(c => [c.id, c]),
        )
        // A4 slice 4b — litho branch routes to the new layer batch-update
        // endpoint; geological stays on /contacts. The LL→FC mirror
        // trigger keeps formation_contact + correlation FKs coherent on
        // the litho path. Atomicity is preserved (the endpoint is
        // all-or-nothing on the layer side, same contract as contacts).
        if (isLitho) {
          await api.geology.batchUpdateLayers(
            project.id,
            modelId,
            updates.map(formationContactBatchToLayerItem),
          )
          refetchLithoContacts()
        } else {
          const res = await api.geology.updateContactsBatch(project.id, modelId, updates)
          const byId = new Map(res.contacts.map(c => [c.id, c]))
          applyPatch(prev => prev.map(c => byId.get(c.id) ?? c))
        }
        // Batch depth/anchor mutation of pre-existing contacts — mark dirty
        // so a close-without-save reverts it (#160).
        markMutated()
        log.success('geology', `batchUpdateContacts ok count=${updateIds.length}`)
        // Undo: PUT/PATCH the snapshot back. Redo: re-apply.
        // A4 slice 4b — fork undo lambdas on isLitho. Litho hits the
        // layer batch endpoint; geological stays on /contacts/batch.
        const projectId = project.id
        const beforeUpdates: FormationContactBatchUpdateEntry[] = updateIds
          .map(id => beforeById.get(id))
          .filter((c): c is FormationContactResponse => Boolean(c))
          .map(c => ({
            contact_id: c.id,
            depth_top_m: c.depth_top_m,
            borehole_id: c.borehole_id,
            cpt_id: c.cpt_id,
            source: c.source as 'borehole_observation' | 'manual_pick' | 'interpolated',
            confidence: c.confidence as 'high' | 'medium' | 'low',
          }))
        const afterUpdates = updates.slice()
        const toLayerUpdates = (
          entries: readonly FormationContactBatchUpdateEntry[],
        ): LithoLayerBatchUpdateItem[] => entries.map(formationContactBatchToLayerItem)
        pushUndo({
          description: `Update ${updateIds.length} contact(s)`,
          revert: async () => {
            if (isLitho) {
              await api.geology.batchUpdateLayers(
                projectId,
                modelId,
                toLayerUpdates(beforeUpdates),
              )
              refetchLithoContacts()
              return
            }
            const back = await api.geology.updateContactsBatch(
              projectId,
              modelId,
              beforeUpdates,
            )
            const map = new Map(back.contacts.map(c => [c.id, c]))
            applyPatch(prev => prev.map(c => map.get(c.id) ?? c))
          },
          reapply: async () => {
            if (isLitho) {
              await api.geology.batchUpdateLayers(
                projectId,
                modelId,
                toLayerUpdates(afterUpdates),
              )
              refetchLithoContacts()
              return
            }
            const fwd = await api.geology.updateContactsBatch(
              projectId,
              modelId,
              afterUpdates,
            )
            const map = new Map(fwd.contacts.map(c => [c.id, c]))
            applyPatch(prev => prev.map(c => map.get(c.id) ?? c))
          },
        })
      } catch (err) {
        log.error('geology', 'batchUpdateContacts failed', err)
        toast('error', 'Could not update the selected contacts.')
      }
    },
    [project, contacts, lithoContacts, pushUndo, markMutated],
  )

  // Right-click → confirm → delete an existing contact. ContactsLayer
  // pops the native confirm; we only land here on a user-confirmed
  // destructive action, so no extra gate. Optimistically prune the
  // local contacts list + the session-import id set so the overlay
  // updates without a refetch and the discard-on-close flow doesn't
  // try to re-delete an already-deleted row.
  const handleDeleteContact = useCallback(
    async (contactId: string): Promise<void> => {
      if (!project) return
      log.debug('geology', `deleteContact entry id=${contactId}`)
      try {
        // Snapshot the contact before deletion so undo can re-POST
        // an equivalent row (server assigns a new id on the re-create
        // — captured in the closure for redo).
        // The contact carries its own model_id — derive the model +
        // the target contact-set from it so this works on the litho
        // axis too (dogfeed 2026-05-22 — was hard-wired to the
        // geological model, so a litho contact could not be deleted).
        const snapshot =
          contacts.find(c => c.id === contactId) ??
          lithoContacts.find(c => c.id === contactId)
        if (!snapshot) return
        const modelId = snapshot.model_id
        const isLitho = lithoContacts.some(c => c.id === contactId)
        // applyPatch only fires in the geo `else` branch (litho path
        // early-returns into refetchLithoContacts before reaching
        // any applyPatch call). The variable is geo-only by
        // construction — the historical noop-on-litho ternary was
        // dead code.
        const applyPatch = setContacts
        // A4 slice 3 — litho writers target /layers; the LL→FC
        // mirror trigger keeps formation_contact + correlation FKs
        // coherent. Geological models stay on /contacts (no Shape A
        // for the geological axis). The layer snapshot is captured
        // BEFORE the call so the undo's recreate has the depth_base_m
        // the bulk-create endpoint requires.
        const layerSnap = isLitho ? lithoLayers.find(l => l.id === contactId) : null
        if (isLitho) {
          await api.geology.deleteLayer(project.id, modelId, contactId)
        } else {
          await api.geology.deleteContact(project.id, modelId, contactId)
        }
        applyPatch(prev => prev.filter(c => c.id !== contactId))
        // Keep lithoLayers + lithoContacts in lockstep after the
        // optimistic prune. The trigger deleted the FC mirror; the
        // refetch propagates that into FE state.
        if (isLitho) refetchLithoContacts()
        // Deletion of a pre-existing contact — mark dirty so a
        // close-without-save reverts it (#160). NOT added to the session-
        // import manifest: a delete has no created row to discard; the
        // replace-restore brings the row back instead.
        markMutated()
        // No setSessionImportContactIds here — the session-imports set
        // is owned by useProjectLifecycle. The deleteContact callback
        // reaches the session set via the addToSessionImports injected
        // dep only for additions; for removals the
        // discardSessionImports path handles the full flush.
        log.success('geology', `deleteContact ok id=${contactId}`)
        const projectId = project.id
        const recreatePayload = {
          formation_id: snapshot.formation_id,
          depth_top_m: snapshot.depth_top_m,
          borehole_id: snapshot.borehole_id,
          cpt_id: snapshot.cpt_id,
          source: snapshot.source as
            | 'borehole_observation'
            | 'manual_pick'
            | 'interpolated',
          confidence: snapshot.confidence as 'high' | 'medium' | 'low',
        }
        // currentId tracks the most-recently-created id so the
        // next revert (delete) targets the latest row. Starts at
        // null because the contact was JUST deleted; the first
        // revert call re-creates it.
        let currentId: string | null = null
        pushUndo({
          description: 'Delete contact',
          revert: async () => {
            // A4 slice 3 — litho undo recreates via /layers, taking
            // depth_base_m from the snapshot the layer side captured
            // before the delete. Geological undo stays on /contacts
            // (no depth_base_m to recreate from).
            if (isLitho && layerSnap !== null && layerSnap !== undefined) {
              const created = await api.geology.bulkCreateLayers(projectId, modelId, [
                {
                  formation_id: layerSnap.formation_id,
                  depth_top_m: layerSnap.depth_top_m,
                  depth_base_m: layerSnap.depth_base_m,
                  status: layerSnap.status,
                  source: layerSnap.source,
                  confidence: layerSnap.confidence,
                  borehole_id: layerSnap.borehole_id,
                  cpt_id: layerSnap.cpt_id,
                  observation_id: layerSnap.observation_id,
                  observation_layer_id: layerSnap.observation_layer_id,
                  parent_geo_contact_id: layerSnap.parent_geo_contact_id,
                  notes: layerSnap.notes,
                },
              ])
              currentId = created[0].id
              addToSessionImports('contact', [created[0].id])
              refetchLithoContacts()
              return
            }
            const recreated = await api.geology.createContact(
              projectId,
              modelId,
              recreatePayload,
            )
            currentId = recreated.id
            applyPatch(prev => [...prev, recreated])
            addToSessionImports('contact', [recreated.id])
          },
          reapply: async () => {
            if (!currentId) return
            if (isLitho) {
              await api.geology.deleteLayer(projectId, modelId, currentId)
              currentId = null
              refetchLithoContacts()
              return
            }
            await api.geology.deleteContact(projectId, modelId, currentId)
            const deletedId = currentId
            applyPatch(prev => prev.filter(c => c.id !== deletedId))
            currentId = null
          },
        })
      } catch (err) {
        log.error('geology', `deleteContact failed id=${contactId}`, err)
        toast('error', 'Could not delete the contact.')
      }
    },
    [
      project,
      addToSessionImports,
      contacts,
      lithoContacts,
      lithoLayers,
      pushUndo,
      refetchLithoContacts,
      markMutated,
    ],
  )

  // Break the litho↔geo coupling on a single lithostratigraphic contact.
  // Nulls parent_geo_contact_id.  Does NOT touch the geo contact or rebuild
  // surfaces — geometry is unchanged, only the coupling label is cleared.
  // Refetches litho contacts so the link glyph disappears without a page reload.
  const handleUnlinkLithoFromGeo = useCallback(
    async (contactId: string): Promise<void> => {
      if (!project) return
      const snapshot =
        lithoContacts.find(c => c.id === contactId) ?? contacts.find(c => c.id === contactId)
      if (!snapshot) return
      const modelId = snapshot.model_id
      log.debug('geology', `unlinkLithoFromGeo entry id=${contactId}`)
      try {
        // A4 remaining-writer cut — unlink is a single-field PATCH on the
        // layer (parent_geo_contact_id → null). The LL→FC trigger mirrors
        // the null back into the formation_contact row so legacy consumers
        // (bundle restore, link-glyph readers on /contacts) stay coherent.
        await api.geology.updateLayer(project.id, modelId, contactId, {
          parent_geo_contact_id: null,
        })
        // A5 — lithoContacts is a derived memo; the optimistic patch
        // that used to apply here is redundant. refetchLithoContacts
        // refreshes lithoLayers, the memo re-derives, the UI updates.
        refetchLithoContacts()
        markMutated()
        log.success('geology', `unlinkLithoFromGeo ok id=${contactId}`)
      } catch (err) {
        log.error('geology', `unlinkLithoFromGeo failed id=${contactId}`, err)
        toast('error', 'Could not unlink the contact from geology.')
      }
    },
    [project, contacts, lithoContacts, refetchLithoContacts, markMutated],
  )

  // Establish the litho↔geo coupling on a single uncoupled lithostratigraphic
  // contact.  The backend finds the nearest geological contact within the
  // snap tolerance, sets parent_geo_contact_id, and snaps geo→litho depth.
  // Returns null (not an error) when no geological contact is in range —
  // we toast and skip the refetch in that case.
  const handleLinkLithoToGeo = useCallback(
    async (contactId: string): Promise<void> => {
      if (!project) return
      const snapshot =
        lithoContacts.find(c => c.id === contactId) ?? contacts.find(c => c.id === contactId)
      if (!snapshot) return
      const modelId = snapshot.model_id
      log.debug('geology', `linkLithoToGeo entry id=${contactId}`)
      try {
        // A4 cleanup — link-geo on /layers (contactId == layerId by UUID
        // preservation). The BE delegates to the same LinkLithoToGeo
        // use case; the FC→LL trigger mirrors parent_geo_contact_id
        // back into the FC row so legacy /contacts readers stay coherent.
        const result = await api.geology.linkLayerToGeo(project.id, modelId, contactId)
        if (result == null) {
          // No geological contact within tolerance — inform the user.
          toast('warning', 'No geological contact within snap tolerance to link.')
          log.warn('geology', `linkLithoToGeo no geo contact in range id=${contactId}`)
          return
        }
        // A5 — lithoContacts is a derived memo; refetch is the
        // canonical update path (lithoLayers refresh → memo re-derives).
        refetchLithoContacts()
        // Coupling established (result != null only) — a real edit. The
        // no-geo-in-range branch returned above without mutating.
        markMutated()
        log.success('geology', `linkLithoToGeo ok id=${contactId}`)
      } catch (err) {
        log.error('geology', `linkLithoToGeo failed id=${contactId}`, err)
        toast('error', 'Could not link the contact to geology.')
      }
    },
    [project, contacts, lithoContacts, refetchLithoContacts, markMutated],
  )

  return {
    handleUpdateContactDepth,
    handleCreateContact,
    handleBatchCreateContacts,
    handleBatchUpdateContacts,
    handleDeleteContact,
    handleUnlinkLithoFromGeo,
    handleLinkLithoToGeo,
  }
}
