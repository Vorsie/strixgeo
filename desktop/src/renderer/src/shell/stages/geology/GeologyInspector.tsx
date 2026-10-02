/**
 * Stratigraphy stage inspector pane — formation list, drag-reorder, borehole
 * scope, and the surface-crossing banner.
 *
 * Owns the geological model definition UI (formations + reorder + borehole
 * scope) that previously lived in ``InterpretationPane``.  All data and
 * handlers are sourced from ``useShell()`` (no props accepted — matches the
 * StageDescriptor.InspectorComponent contract).
 *
 * **Composition (debt #201 decomposition round).** This orchestrator is a thin
 * composer: the formation-roster CRUD + drag-reorder block lives in the
 * ``useGeologyFormations`` hook (with the intricate reorder logic in
 * ``reorderFormationsCommand.ts``), and the panel sections are presentational
 * siblings in this folder — ``GeologyInspectorHeader``,
 * ``GeologyConfidenceFadeToggle``, ``GeologyCrossingsBanner``,
 * ``GeologyFormationList`` (+ its module-scope ``GeologyFormationRow``), and
 * ``GeologyBoreholesInModel`` (which owns its own collapse state). Props flow
 * down, callbacks up; the extracted pieces hold no shared state.
 *
 * Formation rows show an amber left-stripe + asterisk when the formation was
 * created in the current session and has not yet been committed to the
 * ``.gmproj`` bundle (``sessionImportFormationIds`` from the coordinator bus).
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import { Plus } from 'lucide-react'

import type { CrossSectionResponse, GapIssueResponse } from '../../../api/client'
import { useCrossingsValidation } from '../../../hooks/useCrossingsValidation'
import Button from '../../../components/ui/Button'
import Modal from '../../../components/ui/Modal'
import CrossingSectionPickerDialog from '../../../components/CrossingSectionPickerDialog'
import FormationDialog from '../../../components/interpretation/FormationDialog'
import { resolveCandidateCrossingSections } from '../../../utils/crossingFocus'
import { crossingIssueTests, describeCrossingIssue } from '../../../utils/crossingIssueText'
import { sectionLineThroughPoint } from '../../../utils/sectionLineThroughPoint'
import { isGeologicalFormation } from '../../../utils/formationKind'
import { useShell } from '../../ShellContext'
import { useT } from '../../../i18n/translate'
import { useGeologyFormations } from './useGeologyFormations'
import GeologyInspectorHeader from './GeologyInspectorHeader'
import GeologyConfidenceFadeToggle from './GeologyConfidenceFadeToggle'
import GeologyCrossingsBanner from './GeologyCrossingsBanner'
import GeologyFormationList from './GeologyFormationList'
import GeologyBoreholesInModel from './GeologyBoreholesInModel'

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Stratigraphy stage inspector: formation list, drag-reorder, borehole scope, and
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
      // Geological contacts — fed to the crossing-banner click handler
      // so the issue's contact ids resolve to anchor coordinates.
      contacts: geoContacts,
    },
    sections: { sections, handleSectionLineDrawn, effectiveHorizontalEpsg },
    investigations: { cpts, boreholes },
    toasts: { toast },
    // manifestFormationIds is still needed by reorderFormations' inline
    // derivation (cannot read visibleFormations there — TDZ; see §8.1 Risk 3).
    coordinator: {
      manifestFormationIds,
      sessionImportFormationIds,
      setSectionsDeepLinkTarget,
    },
    undo: { push: pushUndoCommand },
    visibleBoreholes,
    overlays: { showConfidenceFade, handleSetShowConfidenceFade },
  } = useShell()

  const t = useT()
  const projectId = project.id

  // ---------------------------------------------------------------------------
  // Formation roster CRUD + drag-reorder — all formation state + handlers live
  // in the useGeologyFormations hook (extracted in the #201 round).
  // ---------------------------------------------------------------------------
  const {
    dialogOpen,
    setDialogOpen,
    editing,
    setEditing,
    pendingDelete,
    setPendingDelete,
    deleteBusy,
    draggedId,
    setDraggedId,
    dragOverId,
    setDragOverId,
    reorderBusy,
    reorderFormations,
    handleCreate,
    handleUpdate,
    handleUpdateFormationColor,
    handleDelete,
  } = useGeologyFormations({
    projectId,
    busFormations,
    formationsRefreshCounter,
    manifestFormationIds,
    handleFormationCreated,
    handleFormationUpdated,
    handleFormationDeleted,
    refetchFormations,
    pushUndoCommand,
  })

  // The "Edit in Stratigraphy stage" deep-link (#156) is consumed in AppShell now:
  // it opens the SECTION VIEW (Sections stage, geological axis) and pulses the
  // contact there, because the stratigraphic model is edited on cross-sections,
  // not on this stage's 3D viewer. This inspector no longer reads the payload.

  // Cross-formation crossing-validator results. Gated on surface
  // freshness (debt #18): a stale cache is not validated — the hook
  // exposes pendingBuild instead so the banner says "Build to check"
  // rather than showing an untrustworthy amber warning.
  const {
    crossingIssues,
    pendingBuild: crossingsPendingBuild,
    validationFailed: crossingsValidationFailed,
  } = useCrossingsValidation(
    projectId,
    activeGeologicalModel?.id ?? null,
    crossingsRefreshCounter,
    staleSurfaceCount,
  )

  // Crossing-issue → sections-stage navigation flow (dogfeed 2026-05-30).
  // Click an LI in the surface-crossings banner: resolve the issue's
  // contacts to candidate sections, then either deep-link directly (1
  // candidate) or open the picker (>1).  Empty candidate set → toast.
  const [crossingPicker, setCrossingPicker] = useState<{
    contactIds: readonly string[]
    candidates: CrossSectionResponse[]
  } | null>(null)
  // Always the latest section list, for the draw-through flow above that
  // waits for its new row across renders.
  const sectionsRef = useRef(sections)
  sectionsRef.current = sections
  const describeIssue = useCallback(
    (issue: GapIssueResponse) =>
      describeCrossingIssue(
        issue,
        busFormations,
        crossingIssueTests(issue, geoContacts, boreholes, cpts),
        t,
      ),
    [busFormations, geoContacts, boreholes, cpts, t],
  )
  const handleClickCrossingIssue = useCallback(
    (issue: GapIssueResponse) => {
      const candidates = resolveCandidateCrossingSections(
        issue.contact_ids,
        geoContacts,
        sections,
        boreholes,
        cpts,
      )
      if (candidates.length === 0) {
        // No section holds the offending contact. The old answer was a toast
        // telling the engineer to draw one, without saying where (dogfeed
        // 2026-09-22). Draw it for him: an east-west line through the first
        // offending test, then open it on those contacts. Creating a section
        // is undoable, so this fires without a dialog (docs/ux.md).
        const anchor = crossingIssueTests(issue, geoContacts, boreholes, cpts)[0]
        if (!anchor || effectiveHorizontalEpsg == null) {
          toast('error', t('geology.noSectionForContact'))
          return
        }
        const line = sectionLineThroughPoint(anchor.x, anchor.y, effectiveHorizontalEpsg)
        void (async () => {
          await handleSectionLineDrawn(line.start, line.end)
          toast('success', t('geology.sectionDrawnThrough', { test: anchor.name }))
          // The new row reaches ``sections`` on a later render; look for it briefly.
          for (let attempt = 0; attempt < 20; attempt += 1) {
            await new Promise(resolve => setTimeout(resolve, 25))
            const created = resolveCandidateCrossingSections(
              issue.contact_ids,
              geoContacts,
              sectionsRef.current,
              boreholes,
              cpts,
            )
            if (created.length > 0) {
              setSectionsDeepLinkTarget({ sectionId: created[0].id, contactIds: issue.contact_ids })
              return
            }
          }
        })()
        return
      }
      if (candidates.length === 1) {
        setSectionsDeepLinkTarget({
          sectionId: candidates[0].id,
          contactIds: issue.contact_ids,
        })
        return
      }
      setCrossingPicker({ contactIds: issue.contact_ids, candidates })
    },
    [
      geoContacts,
      sections,
      boreholes,
      cpts,
      setSectionsDeepLinkTarget,
      toast,
      t,
      handleSectionLineDrawn,
      effectiveHorizontalEpsg,
    ],
  )

  // ---------------------------------------------------------------------------
  // visibleFormations — sourced from the geoModel bus (single source of truth).
  // Computed once in App.tsx so the inspector, the Geology badge, and any
  // future reader all see the same count.
  // ---------------------------------------------------------------------------
  const visibleFormations = busVisibleFormations

  // The Stratigrafie roster ALWAYS lists the GEOLOGICAL formations, whatever
  // the Sections axis (owner ruling B(a), 2026-10-02 — it reverses the #55
  // litho-Seed axis filter, which swapped this roster to the litho units after
  // a litho build while GeologyCanvas kept drawing the geological formations).
  // Formations are one project-wide vocabulary shared by the geological + litho
  // + geotech models, so litho units and geotech units live in the same list
  // and would otherwise leak in once the visibility manifest admits them (e.g.
  // after "Fill from boreholes" or a .gmproj reload). The canvas applies the
  // same filter — the roster must match it.
  const filteredVisibleFormations = useMemo(
    () => visibleFormations.filter(isGeologicalFormation),
    [visibleFormations],
  )

  // Reading order for the list UI: youngest-first, like a borehole log /
  // stratigraphic column. ``visibleFormations`` is ascending display_order
  // (oldest-first — the section/3D paint order). Reverse ONLY for the
  // human-facing list; reorder math inverts back to display_order in
  // reorderFormations so the data contract is untouched.
  const displayedFormations = useMemo(
    () => [...filteredVisibleFormations].reverse(),
    [filteredVisibleFormations],
  )

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-3 px-3 py-4">
      <GeologyInspectorHeader
        // The count is what the roster LISTS (it counted every kind before).
        formationCount={filteredVisibleFormations.length}
        activeModelName={activeGeologicalModel?.name ?? null}
        t={t}
      />

      {/* Add formation entry button */}
      <div className="flex items-center">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setEditing(null)
            setDialogOpen(true)
          }}
          title={t('geology.addFormationHint')}
          className="ml-auto"
          data-testid="geology-create-formation-button"
        >
          <Plus size={12} className="mr-1" />
          {t('geology.addFormation')}
        </Button>
      </div>

      {/* Debt #94 follow-up — confidence-fade toggle (per-project). */}
      <GeologyConfidenceFadeToggle
        showConfidenceFade={showConfidenceFade}
        onToggle={next => void handleSetShowConfidenceFade(next)}
        t={t}
      />

      {/* Surface-crossing validation banners (debt #18 / audit F10). */}
      <GeologyCrossingsBanner
        pendingBuild={crossingsPendingBuild}
        validationFailed={crossingsValidationFailed}
        crossingIssues={crossingIssues}
        onClickIssue={handleClickCrossingIssue}
        describeIssue={describeIssue}
        t={t}
      />

      <CrossingSectionPickerDialog
        open={crossingPicker !== null}
        candidates={crossingPicker?.candidates ?? []}
        onPick={sectionId => {
          if (crossingPicker !== null) {
            setSectionsDeepLinkTarget({
              sectionId,
              contactIds: crossingPicker.contactIds,
            })
          }
          setCrossingPicker(null)
        }}
        onCancel={() => setCrossingPicker(null)}
      />

      {/* Empty-state guidance */}
      {filteredVisibleFormations.length === 0 && (
        <div className="text-[11px] text-text-muted leading-snug">
          {t('geology.emptyRosterHint')}
        </div>
      )}

      {/* Formation list with drag-reorder */}
      {filteredVisibleFormations.length > 0 && (
        <GeologyFormationList
          formations={displayedFormations}
          sessionImportFormationIds={sessionImportFormationIds}
          draggedId={draggedId}
          dragOverId={dragOverId}
          reorderBusy={reorderBusy}
          onEditFormation={f => {
            setEditing(f)
            setDialogOpen(true)
          }}
          onDeleteFormation={f => setPendingDelete(f)}
          onColorChange={handleUpdateFormationColor}
          onReorder={reorderFormations}
          setDraggedId={setDraggedId}
          setDragOverId={setDragOverId}
          t={t}
        />
      )}

      {/* Boreholes in model — collapsible. Toggling PATCHes the model's
          excluded_borehole_ids. Excluded boreholes still render lithology
          on the section but do not anchor contacts. */}
      <GeologyBoreholesInModel
        boreholes={visibleBoreholes}
        excludedBoreholeIds={activeGeologicalModel?.excluded_borehole_ids ?? []}
        onToggle={(id, included) => void handleToggleBoreholeInModel(id, included)}
        t={t}
      />

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
            {t('geology.deleteFormationConfirm')}
          </h2>
          <p className="text-xs text-text-secondary mb-4">
            <strong>{pendingDelete?.name}</strong> {t('geology.deleteFormationBody')}
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
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              size="md"
              onClick={() => void handleDelete()}
              disabled={deleteBusy}
            >
              {t('common.deletePermanently')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
