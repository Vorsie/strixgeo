/**
 * Geology stage inspector pane — formation list, drag-reorder, borehole
 * scope, and the surface-crossing banner.
 *
 * Owns the geological model definition UI (formations + reorder + borehole
 * scope) that previously lived in ``InterpretationPane``.  All data and
 * handlers are sourced from ``useShell()`` (no props accepted — matches the
 * StageDescriptor.InspectorComponent contract).
 *
 * **TDZ constraint (Risk 3 in geology-stage-architecture.md §8.1):**
 * ``reorderFormations`` is declared as a ``useCallback`` BEFORE
 * ``visibleFormations`` — the latter is declared further down the component
 * body.  Reading ``visibleFormations`` inside ``reorderFormations`` would
 * trigger a Temporal Dead Zone at runtime.  Instead the callback derives the
 * filtered list inline from ``formations`` + ``manifestFormationIds`` — the
 * same inputs that feed ``visibleFormations``.
 *
 * Formation rows show an amber left-stripe + asterisk when the formation was
 * created in the current session and has not yet been committed to the
 * ``.gmproj`` bundle (``sessionImportFormationIds`` from the coordinator bus).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Drill,
  GripVertical,
  Layers,
  Plus,
  Trash2,
} from 'lucide-react'

import { api } from '../../../api/client'
import type {
  GapIssueResponse,
  GeologicalFormationCreatePayload,
  GeologicalFormationResponse,
  GeologicalFormationUpdatePayload,
} from '../../../api/client'
import { log } from '../../../utils/log'
import Button from '../../../components/ui/Button'
import DirtyAsterisk from '../../../components/ui/DirtyAsterisk'
import Modal from '../../../components/ui/Modal'
import FormationDialog from '../../../components/interpretation/FormationDialog'
import { useShell } from '../../ShellContext'

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Geology stage inspector: formation list, drag-reorder, borehole scope, and
 * the surface-crossing banner.
 *
 * Takes no props — all state is sourced from ``useShell()``.
 *
 * Returns
 * -------
 * JSX.Element
 *     The inspector pane element.
 */
export default function GeologyInspector(): JSX.Element {
  const {
    project,
    geoModel: {
      activeGeologicalModel,
      formations: busFormations,
      visibleFormations: busVisibleFormations,
      formationsRefreshCounter,
      crossingsRefreshCounter,
      staleSurfaceCount,
      handleFormationCreated,
      handleFormationUpdated,
      handleFormationDeleted,
      handleToggleBoreholeInModel,
      refetchFormations,
    },
    sections: { handleFocusContacts },
    // manifestFormationIds is still needed by reorderFormations' inline
    // derivation (cannot read visibleFormations there — TDZ; see §8.1 Risk 3).
    coordinator: { manifestFormationIds, sessionImportFormationIds },
    undo: { push: pushUndoCommand },
    visibleBoreholes,
  } = useShell()

  const projectId = project.id

  // ---------------------------------------------------------------------------
  // Local state
  // ---------------------------------------------------------------------------

  // Local formation list — sorted copy of the bus formations.
  // Initialised from the bus; kept in sync via formationsRefreshCounter effect.
  const [formations, setFormations] = useState<GeologicalFormationResponse[]>(() =>
    sortFormations(busFormations),
  )

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<GeologicalFormationResponse | null>(null)
  const [pendingDelete, setPendingDelete] = useState<GeologicalFormationResponse | null>(
    null,
  )
  const [deleteBusy, setDeleteBusy] = useState(false)

  // Drag-to-reorder state.
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | 'end' | null>(null)
  const [reorderBusy, setReorderBusy] = useState(false)

  // Borehole scope sub-section collapse state.
  const [scopeOpen, setScopeOpen] = useState(false)

  // Cross-formation crossing-validator results.
  const [crossingIssues, setCrossingIssues] = useState<readonly GapIssueResponse[]>([])

  // ---------------------------------------------------------------------------
  // Sync from bus on formationsRefreshCounter change.
  // This covers auto-populate runs and any mutation that bypasses the local
  // state. The initial seed above covers the first mount.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    setFormations(sortFormations(busFormations))
  }, [busFormations, formationsRefreshCounter])

  // ---------------------------------------------------------------------------
  // Crossings validator — re-fetch on active model change or contact mutation.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!activeGeologicalModel) {
      setCrossingIssues([])
      return
    }
    const modelId = activeGeologicalModel.id
    let cancelled = false
    api.geology
      .validateCrossings(projectId, modelId)
      .then(resp => {
        if (cancelled) return
        setCrossingIssues(resp.issues)
      })
      .catch(err => {
        log.warn('geology', `validateCrossings failed for ${modelId}`, err)
        if (!cancelled) setCrossingIssues([])
      })
    return () => {
      cancelled = true
    }
  }, [projectId, activeGeologicalModel, crossingsRefreshCounter])

  // ---------------------------------------------------------------------------
  // Excluded borehole set — derived from the active model's exclusion list.
  // ---------------------------------------------------------------------------
  const excludedSet = useMemo(
    () => new Set(activeGeologicalModel?.excluded_borehole_ids ?? []),
    [activeGeologicalModel],
  )

  // ---------------------------------------------------------------------------
  // reorderFormations — MUST be declared BEFORE visibleFormations to avoid TDZ.
  //
  // Derives the filtered list inline from ``formations`` + ``manifestFormationIds``
  // rather than reading ``visibleFormations`` (declared further down the body).
  // See docs/geology-stage-architecture.md §8.1 Risk 3.
  // ---------------------------------------------------------------------------
  const reorderFormations = useCallback(
    async (sourceId: string, targetId: string | 'end') => {
      if (sourceId === targetId) return
      setReorderBusy(true)
      // Derive visible list inline — cannot close over ``visibleFormations`` (TDZ).
      const previous =
        manifestFormationIds === undefined
          ? formations
          : formations.filter(f => manifestFormationIds.has(f.id))
      // The inspector presents formations YOUNGEST-first (borehole-log /
      // stratigraphic-column reading order), which is the REVERSE of
      // ``display_order`` (ascending = older = the section/3D paint order;
      // see CLAUDE.md "Stratigraphic order"). Run the reorder in this
      // displayed space, then map the displayed index back to
      // ``display_order = (N-1 - i)`` so the data contract and every
      // renderer are unchanged — only the human-facing list flips.
      const displayed = [...previous].reverse()
      const sourceIndex = displayed.findIndex(f => f.id === sourceId)
      if (sourceIndex < 0) {
        setReorderBusy(false)
        return
      }
      const without = displayed.filter(f => f.id !== sourceId)
      const insertAt =
        targetId === 'end'
          ? without.length
          : without.findIndex(f => f.id === targetId)
      if (insertAt < 0) {
        setReorderBusy(false)
        return
      }
      const reordered = [
        ...without.slice(0, insertAt),
        displayed[sourceIndex],
        ...without.slice(insertAt),
      ]
      const total = reordered.length
      const changes = reordered
        .map((f, i) => ({
          id: f.id,
          oldOrder: f.display_order,
          newOrder: total - 1 - i,
          // Debt #35: remember the pre-drag pin state so undo can
          // restore it exactly (a formation that was NOT pinned must
          // go back to unpinned on undo, so Build can re-infer it).
          wasPinned: f.pinned_order,
        }))
        .filter(c => c.oldOrder !== c.newOrder)
      if (changes.length === 0) {
        setReorderBusy(false)
        return
      }
      // Optimistic local update (same displayed→display_order
      // inversion). Reordered rows are also pinned locally (debt #35)
      // so the UI matches what the PATCH persists.
      const changedIds = new Set(changes.map(c => c.id))
      setFormations(prev => {
        const byId = new Map(reordered.map((f, i) => [f.id, total - 1 - i]))
        return sortFormations(
          prev.map(f => {
            const idx = byId.get(f.id)
            if (idx === undefined) return f
            return {
              ...f,
              display_order: idx,
              pinned_order: changedIds.has(f.id) ? true : f.pinned_order,
            }
          }),
        )
      })
      try {
        await Promise.all(
          changes.map(c =>
            // Debt #35: pin every reordered formation so the next
            // "Build 3D model" leaves this deliberate ordering intact
            // instead of reverting it via age inference.
            api.geology.updateFormation(projectId, c.id, {
              display_order: c.newOrder,
              pinned_order: true,
            }),
          ),
        )
        for (const c of changes) handleFormationUpdated()
        log.success('geology', `reorderFormations ok updates=${changes.length}`)
        const snapshot = changes.slice()
        pushUndoCommand({
          description: `Reorder ${snapshot.length} formation${snapshot.length === 1 ? '' : 's'}`,
          revert: async () => {
            // Restore BOTH order and the pre-drag pin state (debt #35):
            // a formation that wasn't pinned before the drag must go
            // back to unpinned so Build can re-infer its age order.
            await Promise.all(
              snapshot.map(c =>
                api.geology.updateFormation(projectId, c.id, {
                  display_order: c.oldOrder,
                  pinned_order: c.wasPinned,
                }),
              ),
            )
            setFormations(prev => {
              const byId = new Map(
                snapshot.map(c => [
                  c.id,
                  { order: c.oldOrder, pinned: c.wasPinned },
                ]),
              )
              return sortFormations(
                prev.map(f => {
                  const s = byId.get(f.id)
                  return s === undefined
                    ? f
                    : { ...f, display_order: s.order, pinned_order: s.pinned }
                }),
              )
            })
            handleFormationUpdated()
          },
          reapply: async () => {
            // Redo re-applies the reorder, so re-pin (mirrors forward).
            await Promise.all(
              snapshot.map(c =>
                api.geology.updateFormation(projectId, c.id, {
                  display_order: c.newOrder,
                  pinned_order: true,
                }),
              ),
            )
            setFormations(prev => {
              const byId = new Map(snapshot.map(c => [c.id, c.newOrder]))
              return sortFormations(
                prev.map(f => {
                  const ord = byId.get(f.id)
                  return ord === undefined
                    ? f
                    : { ...f, display_order: ord, pinned_order: true }
                }),
              )
            })
            handleFormationUpdated()
          },
        })
      } catch (err) {
        log.error('geology', 'reorderFormations failed — refetching', err)
        refetchFormations()
      } finally {
        setReorderBusy(false)
      }
    },
    // reason: manifestFormationIds is stable across renders within the same
    // project; it changes only when the manifest is persisted. Including it
    // here is correct — reorderFormations reads it to derive the visible list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectId, formations, manifestFormationIds, handleFormationUpdated, pushUndoCommand, refetchFormations],
  )

  // ---------------------------------------------------------------------------
  // visibleFormations — sourced from the geoModel bus (single source of truth).
  //
  // Previously computed inline via useMemo([formations, manifestFormationIds]).
  // Now the bus value (computed once in App.tsx) is used directly so the
  // inspector, the Geology badge, and any future reader all see the same count.
  //
  // TDZ note: reorderFormations (declared above) STILL derives the filtered
  // list inline from ``formations + manifestFormationIds`` — it cannot close
  // over ``visibleFormations`` because of the declaration order constraint
  // documented in §8.1 Risk 3. That inline derivation is intentional and
  // correct; this assignment is purely for the render path below.
  // ---------------------------------------------------------------------------
  const visibleFormations = busVisibleFormations

  // Reading order for the list UI: youngest-first, like a borehole log /
  // stratigraphic column. ``visibleFormations`` is ascending display_order
  // (oldest-first — the section/3D paint order). Reverse ONLY for the
  // human-facing list; reorder math inverts back to display_order in
  // reorderFormations so the data contract is untouched.
  const displayedFormations = useMemo(
    () => [...visibleFormations].reverse(),
    [visibleFormations],
  )

  // ---------------------------------------------------------------------------
  // Create / update handlers
  // ---------------------------------------------------------------------------

  const handleCreate = useCallback(
    async (
      payload: GeologicalFormationCreatePayload | GeologicalFormationUpdatePayload,
    ) => {
      try {
        const created = await api.geology.createFormation(
          projectId,
          payload as GeologicalFormationCreatePayload,
        )
        setFormations(prev => sortFormations([...prev, created]))
        handleFormationCreated(created.id)
        setDialogOpen(false)
        setEditing(null)
        let currentId = created.id
        pushUndoCommand({
          description: 'Create formation',
          revert: async () => {
            await api.geology.deleteFormation(projectId, currentId)
            setFormations(prev => prev.filter(f => f.id !== currentId))
            handleFormationDeleted(currentId)
          },
          reapply: async () => {
            const recreated = await api.geology.createFormation(
              projectId,
              payload as GeologicalFormationCreatePayload,
            )
            currentId = recreated.id
            setFormations(prev => sortFormations([...prev, recreated]))
            handleFormationCreated(recreated.id)
          },
        })
      } catch (err) {
        log.error('geology', 'createFormation failed', err)
      }
    },
    [projectId, handleFormationCreated, handleFormationDeleted, pushUndoCommand],
  )

  const handleUpdate = useCallback(
    async (
      payload: GeologicalFormationCreatePayload | GeologicalFormationUpdatePayload,
    ) => {
      if (!editing) return
      try {
        const before = editing
        const updated = await api.geology.updateFormation(
          projectId,
          editing.id,
          payload as GeologicalFormationUpdatePayload,
        )
        setFormations(prev =>
          sortFormations(prev.map(f => (f.id === updated.id ? updated : f))),
        )
        handleFormationUpdated()
        setDialogOpen(false)
        setEditing(null)
        const beforePayload: GeologicalFormationUpdatePayload = {
          name: before.name,
          color: before.color,
          code: before.code,
          regional_ref: before.regional_ref,
          description: before.description,
          display_order: before.display_order,
        }
        pushUndoCommand({
          description: 'Edit formation',
          revert: async () => {
            const back = await api.geology.updateFormation(
              projectId,
              before.id,
              beforePayload,
            )
            setFormations(prev =>
              sortFormations(prev.map(f => (f.id === back.id ? back : f))),
            )
            handleFormationUpdated()
          },
          reapply: async () => {
            const fwd = await api.geology.updateFormation(
              projectId,
              before.id,
              payload as GeologicalFormationUpdatePayload,
            )
            setFormations(prev =>
              sortFormations(prev.map(f => (f.id === fwd.id ? fwd : f))),
            )
            handleFormationUpdated()
          },
        })
      } catch (err) {
        log.error('geology', 'updateFormation failed', err)
      }
    },
    [projectId, editing, handleFormationUpdated, pushUndoCommand],
  )

  // ---------------------------------------------------------------------------
  // Delete handler
  // ---------------------------------------------------------------------------

  const handleDelete = useCallback(async () => {
    if (!pendingDelete) return
    setDeleteBusy(true)
    try {
      const snapshot = pendingDelete
      await api.geology.deleteFormation(projectId, snapshot.id)
      setFormations(prev => prev.filter(f => f.id !== snapshot.id))
      handleFormationDeleted(snapshot.id)
      setPendingDelete(null)
      const recreatePayload: GeologicalFormationCreatePayload = {
        name: snapshot.name,
        color: snapshot.color,
        code: snapshot.code ?? undefined,
        regional_ref: snapshot.regional_ref ?? undefined,
        description: snapshot.description ?? undefined,
        display_order: snapshot.display_order,
      }
      let currentId: string | null = null
      pushUndoCommand({
        description: 'Delete formation',
        revert: async () => {
          const recreated = await api.geology.createFormation(
            projectId,
            recreatePayload,
          )
          currentId = recreated.id
          setFormations(prev => sortFormations([...prev, recreated]))
          handleFormationCreated(recreated.id)
        },
        reapply: async () => {
          if (!currentId) return
          await api.geology.deleteFormation(projectId, currentId)
          const deletedId = currentId
          setFormations(prev => prev.filter(f => f.id !== deletedId))
          handleFormationDeleted(deletedId)
          currentId = null
        },
      })
    } catch (err) {
      log.error('geology', 'deleteFormation failed', err)
    } finally {
      setDeleteBusy(false)
    }
  }, [
    projectId,
    pendingDelete,
    handleFormationCreated,
    handleFormationDeleted,
    pushUndoCommand,
  ])

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-3 px-3 py-4">
      {/* Header */}
      <div className="flex flex-col gap-0.5 text-text-secondary min-w-0">
        <div className="flex items-center gap-2">
          <Layers size={14} className="text-status-amber" />
          <span className="text-xs font-medium">Formations</span>
          <span className="text-[10px] text-text-muted tabular-nums">
            {visibleFormations.length}
          </span>
        </div>
        {activeGeologicalModel && (
          <div
            className="text-[10px] text-text-muted pl-5 truncate"
            title="Active stratigraphy — every formation pick belongs to this model"
          >
            Stratigraphy{' '}
            <span className="text-text-secondary">· {activeGeologicalModel.name}</span>
          </div>
        )}
      </div>

      {/* Add formation entry button */}
      <div className="flex items-center">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setEditing(null)
            setDialogOpen(true)
          }}
          title="Add a new formation to this project"
          className="ml-auto"
        >
          <Plus size={12} className="mr-1" />
          Add formation
        </Button>
      </div>

      {/* Surface crossings banner — amber warning, refetched on every contact
          mutation (crossingsRefreshCounter bumps). Click an issue row to
          highlight the offending contacts on the section canvas. */}
      {crossingIssues.length > 0 && (
        <div
          className="rounded border border-status-amber bg-amber-50 dark:bg-amber-950/30 px-2 py-1.5 text-[11px] text-text-primary"
          role="alert"
          aria-label="Surface crossing warnings"
          data-testid="crossings-banner"
        >
          <div className="flex items-center gap-1.5 font-medium">
            <AlertTriangle size={12} />
            <span>
              {crossingIssues.length} surface crossing
              {crossingIssues.length === 1 ? '' : 's'} detected
              {staleSurfaceCount > 0 ? (
                <span className="font-normal italic">
                  {' '}
                  (as of last build — click Build in the toolbar to refresh)
                </span>
              ) : null}
            </span>
          </div>
          <ul className="mt-1 ml-5 list-disc space-y-0.5">
            {crossingIssues.map((issue, idx) => {
              const hasContacts = issue.contact_ids.length > 0
              const canFocus = hasContacts && handleFocusContacts !== undefined
              return (
                <li key={`${issue.formation_ids.join('-')}-${idx}`}>
                  {canFocus ? (
                    <button
                      type="button"
                      className="w-full cursor-pointer rounded px-1 py-0.5 text-left hover:bg-amber-100 dark:hover:bg-amber-950/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-status-amber"
                      onClick={() => handleFocusContacts(issue.contact_ids)}
                      title="Navigate to the cross-section containing one of the offending contacts."
                      data-testid="crossings-banner-item"
                    >
                      {issue.detail}
                    </button>
                  ) : (
                    issue.detail
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* Empty-state guidance */}
      {visibleFormations.length === 0 && (
        <div className="text-[11px] text-text-muted leading-snug">
          No formations yet — Fill from boreholes or add one, then build the
          3D model.
        </div>
      )}

      {/* Formation list with drag-reorder */}
      {visibleFormations.length > 0 && (
        <ul className="flex flex-col gap-1">
          {displayedFormations.map(f => (
            <FormationRow
              key={f.id}
              formation={f}
              unsaved={sessionImportFormationIds?.has(f.id) ?? false}
              isDragging={draggedId === f.id}
              isDragOver={
                dragOverId === f.id && draggedId !== null && draggedId !== f.id
              }
              reorderBusy={reorderBusy}
              onEdit={() => {
                setEditing(f)
                setDialogOpen(true)
              }}
              onDelete={() => setPendingDelete(f)}
              onDragStart={() => setDraggedId(f.id)}
              onDragOver={() => setDragOverId(f.id)}
              onDragLeave={() => {
                setDragOverId(prev => (prev === f.id ? null : prev))
              }}
              onDrop={() => {
                if (draggedId && draggedId !== f.id) {
                  void reorderFormations(draggedId, f.id)
                }
                setDraggedId(null)
                setDragOverId(null)
              }}
              onDragEnd={() => {
                setDraggedId(null)
                setDragOverId(null)
              }}
            />
          ))}
          {draggedId !== null && (
            // End-of-list drop zone — visible only during a drag.
            <li
              onDragOver={e => {
                e.preventDefault()
                setDragOverId('end')
              }}
              onDrop={() => {
                if (draggedId) void reorderFormations(draggedId, 'end')
                setDraggedId(null)
                setDragOverId(null)
              }}
              className={[
                'h-3 mx-2 rounded-sm border-t-2 border-dashed transition-colors',
                dragOverId === 'end' ? 'border-accent' : 'border-border-default',
              ].join(' ')}
              aria-label="Drop here to place at the bottom (oldest)"
            />
          )}
        </ul>
      )}

      {/* Boreholes in model — collapsible. Toggling PATCHes the model's
          excluded_borehole_ids. Excluded boreholes still render lithology
          on the section but do not anchor contacts. */}
      {visibleBoreholes.length > 0 && (
        <div className="border-t border-border-subtle pt-3 mt-1">
          <button
            type="button"
            onClick={() => setScopeOpen(prev => !prev)}
            className="flex items-center gap-1.5 w-full text-left text-text-secondary hover:text-text-primary"
            title="Show / hide the per-borehole scope toggles"
          >
            {scopeOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <Drill size={12} className="text-text-muted" />
            <span className="text-xs font-medium">Boreholes in model</span>
            <span className="text-[10px] text-text-muted tabular-nums ml-auto">
              {visibleBoreholes.length - excludedSet.size}/{visibleBoreholes.length}
            </span>
          </button>
          {scopeOpen && (
            <ul className="flex flex-col mt-2 max-h-64 overflow-y-auto pr-1">
              {visibleBoreholes.map(b => {
                const included = !excludedSet.has(b.id)
                return (
                  <li
                    key={b.id}
                    className={[
                      'flex items-center gap-2 px-1 py-1 rounded text-xs transition-colors',
                      included
                        ? 'text-text-secondary hover:bg-surface-card'
                        : 'text-text-muted hover:bg-surface-card',
                    ].join(' ')}
                  >
                    <input
                      type="checkbox"
                      checked={included}
                      onChange={e =>
                        void handleToggleBoreholeInModel(b.id, e.target.checked)
                      }
                      className="cursor-pointer shrink-0"
                      aria-label={`${b.name} in model`}
                    />
                    <span
                      className={[
                        'truncate flex-1',
                        included ? '' : 'line-through',
                      ].join(' ')}
                      title={b.name}
                    >
                      {b.name}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      {/* Create / edit formation dialog */}
      <FormationDialog
        open={dialogOpen}
        initialValue={editing}
        onSubmit={editing ? handleUpdate : handleCreate}
        onCancel={() => {
          setDialogOpen(false)
          setEditing(null)
        }}
      />

      {/* Delete-formation confirm modal */}
      <Modal
        open={pendingDelete !== null}
        onCancel={() => setPendingDelete(null)}
        labelledBy="delete-formation-title"
        busy={deleteBusy}
      >
        <div className="p-5">
          <h2
            id="delete-formation-title"
            className="text-base font-semibold text-text-primary mb-2"
          >
            Delete formation?
          </h2>
          <p className="text-xs text-text-secondary mb-4">
            <strong>{pendingDelete?.name}</strong> and every contact + geotech
            unit pointing at it will be removed from the geological model.
            This can&apos;t be undone (until File → Save the change isn&apos;t
            in the .gmproj yet — closing without saving reverts).
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              size="md"
              // reason: autoFocus on Cancel is the safe default for a
              // destructive-confirm modal — the user must actively choose
              // the destructive action, not accidentally confirm it on
              // Enter. Matches the delete-model + FormationSelectionDialog
              // confirms (docs/ux.md "default-focus on Cancel").
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              onClick={() => setPendingDelete(null)}
              disabled={deleteBusy}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="md"
              onClick={() => void handleDelete()}
              disabled={deleteBusy}
            >
              Delete
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface FormationRowProps {
  formation: GeologicalFormationResponse
  /** True when this formation was created in the current session and has not
   *  yet been persisted to the .gmproj bundle.  Renders the amber left-stripe
   *  and asterisk matching the CPT / borehole unsaved convention. */
  unsaved: boolean
  isDragging: boolean
  isDragOver: boolean
  reorderBusy: boolean
  onEdit: () => void
  onDelete: () => void
  onDragStart: () => void
  onDragOver: () => void
  onDragLeave: () => void
  onDrop: () => void
  onDragEnd: () => void
}

/**
 * One formation row in the list — colour swatch, name, drag handle, delete.
 *
 * Parameters
 * ----------
 * formation
 *     The formation data.
 * unsaved
 *     True when this formation was created in the current session and has not
 *     yet been committed to the .gmproj bundle. Renders an amber left-stripe
 *     and asterisk so the user can see which formations need a save.
 * isDragging
 *     True when this row is the drag source (dims it).
 * isDragOver
 *     True when the cursor hovers this row as a drop target.
 * reorderBusy
 *     When true the drag handle is disabled (a reorder is in-flight).
 * onEdit / onDelete / onDragStart / onDragOver / onDragLeave / onDrop / onDragEnd
 *     Event callbacks forwarded from the list.
 *
 * Returns
 * -------
 * JSX.Element
 *     The list-item element.
 */
function FormationRow({
  formation,
  unsaved,
  isDragging,
  isDragOver,
  reorderBusy,
  onEdit,
  onDelete,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
}: FormationRowProps): JSX.Element {
  return (
    <li
      onDragOver={e => {
        // ``preventDefault`` is required to mark the row as a drop target;
        // without it the browser fires no drop event.
        e.preventDefault()
        onDragOver()
      }}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={[
        // Unsaved rows get a 4 px amber left-stripe + tinted background,
        // matching the CPT / borehole unsaved convention in Sidebar.tsx.
        // A 2 px transparent border keeps layout stable in the saved state.
        'group flex items-center gap-2 px-2 py-1.5 rounded transition-colors',
        isDragOver
          ? 'border-t-2 border-t-accent border-l-2 border-l-transparent'
          : unsaved
            ? 'border-l-4 border-l-status-amber bg-amber-50/60 dark:bg-amber-950/30 hover:bg-amber-50/90 dark:hover:bg-amber-950/40'
            : 'border-l-2 border-l-transparent hover:bg-surface-card',
        isDragging ? 'opacity-40' : '',
      ].join(' ')}
    >
      <button
        type="button"
        draggable={!reorderBusy}
        onDragStart={e => {
          // Without text/plain payload Firefox refuses to start the drag.
          e.dataTransfer.setData('text/plain', formation.id)
          e.dataTransfer.effectAllowed = 'move'
          onDragStart()
        }}
        onDragEnd={onDragEnd}
        title="Drag to reorder (lower = older)"
        className="cursor-grab active:cursor-grabbing text-text-muted hover:text-text-secondary shrink-0 -ml-1 px-0.5"
        aria-label={`Drag to reorder ${formation.name}`}
      >
        <GripVertical size={12} />
      </button>
      <span
        className="inline-block w-3.5 h-3.5 rounded border border-border-default shrink-0"
        style={{ backgroundColor: formation.color }}
        title={formation.color}
      />
      <button
        onClick={onEdit}
        className="flex-1 text-left min-w-0"
        title="Edit formation"
      >
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-text-primary truncate">
            {formation.name}
          </span>
          {unsaved && (
            <DirtyAsterisk title="Created since last save — File → Save to commit" />
          )}
        </div>
        {formation.regional_ref && (
          <div className="text-[10px] text-text-muted truncate">
            {formation.regional_ref}
          </div>
        )}
      </button>
      <button
        onClick={onDelete}
        title="Delete formation"
        className="p-1 rounded text-text-muted hover:text-status-danger hover:bg-surface-app opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
      >
        <Trash2 size={11} />
      </button>
    </li>
  )
}

/**
 * Sort formations by ``display_order`` ascending then name ascending.
 *
 * Parameters
 * ----------
 * rows
 *     Unsorted formation list.
 *
 * Returns
 * -------
 * GeologicalFormationResponse[]
 *     Sorted copy.
 */
function sortFormations(
  rows: GeologicalFormationResponse[],
): GeologicalFormationResponse[] {
  return [...rows].sort((a, b) => {
    if (a.display_order !== b.display_order) return a.display_order - b.display_order
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
}
