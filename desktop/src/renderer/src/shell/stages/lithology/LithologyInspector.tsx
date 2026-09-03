// Lithology stage inspector — model picker, flat roster of litho units, and
// workflow guidance footer.
//
// Slice C of #55 litho peer-stage scaffolding.
//
// A2 update: litho units are geo-agnostic (parent_formation_id is always
// null on accept-created rows). Grouping by geological parent produced an
// "Unassigned" bucket for every unit. The roster is now a FLAT list of
// litho units ordered by display_order (ascending — oldest first, matching
// the superposition convention used by all other renderers). The parent-
// group headers and the parentNameById lookup are removed.
//
// Body-model migration (Task 11): instance numbering is now per-body on
// the section (labels QHSa1/QHSa2 render there), NOT per-formation. The
// resolver no longer writes geological_formation.instance_ordinal and the
// per-formation ordinal LOCK machinery was removed from the backend
// resolver. The obsolete per-formation ordinal badge, the lock toggle, and
// the RO-3 stale-ordinal badge (with its correlation-edge-count plumbing)
// were therefore dropped from this inspector.
//
// Design decisions (system-architect):
//   • ModelKindPicker unchanged at top (model select/create lifecycle).
//   • Build lives in LithologyToolbar ("Build model"); solid staleness is
//     surfaced there via the amber "Build model · stale" button. The former
//     read-only stale-surface banner here was removed when the litho TIN
//     surface build was retired (litho-3D plan, Task 8).
//   • Formation roster per unit: colour swatch, name, contact count.
//   • "Resolve instances" action above the roster (refreshes formations).
//   • Guidance footer pointing engineers to Sections.
//   • EmptyState primitive for the no-model / empty-roster branches.
//   • Semantic tokens for chrome — no raw dark: pairs.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Layers3 } from 'lucide-react'

import { api } from '../../../api/client'
import type {
  BodyListItem,
  GeologicalFormationResponse,
} from '../../../api/client'
import Button from '../../../components/ui/Button'
import Modal from '../../../components/ui/Modal'
import { isGeologicalFormation } from '../../../utils/formationKind'
import { log } from '../../../utils/log'
import { EmptyState } from '../../EmptyState'
import { useShell } from '../../ShellContext'
import ConfirmParentDialog from './ConfirmParentDialog'
import LithoBoreholesInModel from './LithoBoreholesInModel'
import LithoCommittedPill from './LithoCommittedPill'
import LithoConfidenceFadeToggle from './LithoConfidenceFadeToggle'
import LithoExcludedBoreholes from './LithoExcludedBoreholes'
import LithoFormationRoster from './LithoFormationRoster'
import LithoResolveAction from './LithoResolveAction'
import LithoSolidLegend from './LithoSolidLegend'
import ModelKindPicker from './ModelKindPicker'
import { useT } from '../../../i18n/translate'

/**
 * Inspector for the Lithology stage.
 *
 * Shows the model-kind picker, an optional stale-surface info banner,
 * a flat formation roster (A2), a Resolve action
 * that refreshes the roster, and workflow guidance.
 *
 * Returns
 * -------
 * JSX.Element
 *     The inspector panel content.
 */
export default function LithologyInspector(): JSX.Element {
  const {
    project,
    visibleBoreholes,
    geoModel: {
      activeGeologicalModel,
      activeLithoModel,
      formations,
      lithoFormations,
      lithoContacts,
      refetchFormations,
      handleClearLithoModel,
      handleToggleBoreholeInLithoModel,
      lithoSolids,
      setBodyColor,
      hideMarkers,
      setHideMarkers,
    },
    overlays: { showConfidenceFade, handleSetShowConfidenceFade },
  } = useShell()
  const t = useT()

  // Debt #65: id → name lookup for the excluded-boreholes list. Built from the
  // visible boreholes; a since-removed borehole falls back to a generic label
  // in the child so it stays recoverable.
  const boreholeNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const b of visibleBoreholes) m.set(b.id, b.name)
    return m
  }, [visibleBoreholes])

  // Debt #94 fix: clear-model confirm dialog state.
  const [wipeConfirmOpen, setWipeConfirmOpen] = useState(false)
  const [wiping, setWiping] = useState(false)

  // Debt #94 fix: execute the clear after the user confirms.
  const confirmWipe = useCallback(async () => {
    setWipeConfirmOpen(false)
    setWiping(true)
    try {
      await handleClearLithoModel()
    } finally {
      setWiping(false)
    }
  }, [handleClearLithoModel])

  // #101 Slice 6: lens list for per-formation lens-count badges.
  const [lenses, setLenses] = useState<BodyListItem[]>([])

  const [resolving, setResolving] = useState(false)

  // #101 Slice 6: fetch lenses whenever the active model changes so the
  // per-formation lens-count badges stay current.
  useEffect(() => {
    if (project === null || activeLithoModel === null) {
      setLenses([])
      return
    }
    const pid = project.id
    const mid = activeLithoModel.id
    log.debug('[LithologyInspector] fetching lenses for model', mid)
    void api.geology
      .listLenses(pid, mid)
      .then(setLenses)
      .catch((err: unknown) =>
        log.error('[LithologyInspector] listLenses failed', err),
      )
  // reason: activeLithoModel?.id is the stable identity key.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, activeLithoModel?.id])

  // Explicit resolve: refetch formations so the roster reflects the
  // latest server state. Instance ordinals are resolved server-side on
  // accept (per-body, on the section) — this button is now a roster
  // refresh, not a re-numbering trigger.
  const handleResolve = useCallback(async () => {
    if (project === null || activeLithoModel === null) return
    const mid = activeLithoModel.id
    log.info('[LithologyInspector] refreshing litho roster for model', mid)
    setResolving(true)
    try {
      // Ordinals are now auto-resolved server-side on accept (per-body).
      refetchFormations()
    } catch (err) {
      log.error('[LithologyInspector] resolve failed:', err)
    } finally {
      setResolving(false)
    }
  }, [project, activeLithoModel, refetchFormations])

  // Debt #87: ConfirmParentDialog state — opened from the amber dot on
  // extrapolated/orphan unit rows. ``confirmTarget`` carries the unit
  // being reviewed; null = dialog closed.
  const [confirmTarget, setConfirmTarget] = useState<GeologicalFormationResponse | null>(
    null,
  )
  const [confirmBusy, setConfirmBusy] = useState(false)

  // Project geological formations — used as the parent options in the
  // dialog. Pure useMemo derived from formations (debt #89 shape: one
  // source of truth, derive views).
  const geoParents = useMemo(
    () => formations.filter(isGeologicalFormation),
    [formations],
  )

  const handleConfirmParent = useCallback(
    async (nextParentId: string | null) => {
      if (project === null || confirmTarget === null) return
      setConfirmBusy(true)
      try {
        await api.geology.updateFormation(project.id, confirmTarget.id, {
          parent_formation_id: nextParentId,
          parent_extrapolated: false,
        })
        refetchFormations()
        setConfirmTarget(null)
      } catch (err) {
        log.error('[LithologyInspector] confirm parent failed:', err)
      } finally {
        setConfirmBusy(false)
      }
    },
    [project, confirmTarget, refetchFormations],
  )

  // Debt #147 follow-up (2026-05-27): the roster reflects the ACTIVE
  // MODEL, not the project-wide vocabulary.  ``lithoFormations`` is
  // derived from the project's ``formations`` list (debt #89) and so
  // includes every litho row in the project — including units used
  // only by sibling/old models.  After deleting model A + creating
  // empty model B the pill correctly read "0 contacts, 0 units" yet
  // the roster still listed A's ~30 formations.  Filter to formations
  // that have at least one contact in this model so the two surfaces
  // tell the same story.  The Clear pill still uses the raw
  // ``lithoFormations`` so orphan-vocabulary recovery stays reachable.
  const lithoFormationsInModel = useMemo(() => {
    const usedIds = new Set(lithoContacts.map(c => c.formation_id))
    return lithoFormations.filter(f => usedIds.has(f.id))
  }, [lithoFormations, lithoContacts])

  // Position 4: per-formation lens count map for the roster badges.
  const lensCountByFormationId = useMemo(() => {
    const out = new Map<string, number>()
    for (const lens of lenses) {
      out.set(lens.formation_id, (out.get(lens.formation_id) ?? 0) + 1)
    }
    return out
  }, [lenses])

  // No geological backbone — the litho model requires one as a parent.
  if (activeGeologicalModel === null) {
    return (
      <div className="flex flex-col gap-3 p-3">
        <div className="text-xs font-semibold text-text-primary">{t('litho.model')}</div>
        <p className="text-[11px] leading-snug text-text-muted">{t('litho.createGeoFirst')}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="text-xs font-semibold text-text-primary">{t('litho.model')}</div>

      {/* Model select / create lifecycle — relocated from GeologyInspector
          header per #55 re-scope.  Same component + hook layer. */}
      <ModelKindPicker />

      {/* Confidence-fade toggle — reads/writes the project-wide
          ``view_state.show_confidence_fade`` shared with the geology toggle. */}
      <LithoConfidenceFadeToggle
        showConfidenceFade={showConfidenceFade}
        onToggle={next => void handleSetShowConfidenceFade(next)}
        t={t}
      />

      {activeLithoModel === null ? (
        /* No active litho model: compact guidance */
        <EmptyState
          icon={<Layers3 />}
          title={t('litho.noModel')}
          hint={t('litho.createThenSections')}
          compact
        />
      ) : (
        <>
          {/* Debt #94 fix: clear-model pill + action.
              Surfaces the persistent state so the user understands why
              there are polylines on section before they have clicked
              Suggest.  Also visible when litho formations exist but
              contacts are empty (the "orphan units" broken state that
              the old contact-only wipe left behind — the user needs an
              affordance to recover even when contacts = 0).
              The clear is irreversible and opens a confirm dialog — not
              triggered directly here.  Hidden when the model is truly
              empty (no contacts AND no formations). */}
          {(lithoContacts.length > 0 || lithoFormations.length > 0) && (
            <LithoCommittedPill
              lithoContacts={lithoContacts}
              wiping={wiping}
              onWipe={() => setWipeConfirmOpen(true)}
              t={t}
            />
          )}

          {/* Phase-2 Slice 2: Resolve instances action — always visible when a
              litho model is active so the engineer can explicitly re-run the
              resolver after drawing edges on the section canvas (Slice 4). */}
          <LithoResolveAction resolving={resolving} onResolve={handleResolve} t={t} />

          {/* Read-only flat formation roster, ordered ascending by
              display_order (oldest first — superposition convention).
              Under A2 all litho units are geo-agnostic
              (parent_formation_id=null), so grouping by parent would
              put every unit in "Unassigned". Flat list is honest.
              Formations are project-scoped shared vocabulary; CRUD
              stays in GeologyInspector. */}
          {lithoFormationsInModel.length === 0 ? (
            <EmptyState
              icon={<Layers3 />}
              title={t('litho.noUnits')}
              hint={t('litho.emptyInspector')}
              compact
            />
          ) : (
            <LithoFormationRoster
              lithoFormations={lithoFormationsInModel}
              lithoContacts={lithoContacts}
              lensCountByFormationId={lensCountByFormationId}
              onReviewParent={setConfirmTarget}
              t={t}
            />
          )}

          {/* Body solids legend — grouped by lithology, always visible when a
              litho model is active.  Empty state when no solids have been
              built yet.  testid preserved from the old canvas overlay so the
              e2e spec still finds it.
              Groups sorted by formation display_order (oldest first —
              superposition convention); within a group sorted by body_ordinal. */}
          <LithoSolidLegend
            lithoSolids={lithoSolids}
            lithoFormations={lithoFormations}
            setBodyColor={setBodyColor}
            hideMarkers={hideMarkers}
            onToggleHideMarkers={setHideMarkers}
            t={t}
          />

          {/* Debt #65: the "Boreholes in model" scope roster — the in-UI
              gesture to EXCLUDE a borehole from the litho build (mirrors the
              geological inspector's roster). Unchecking excludes, re-checking
              includes; both are reversible and fire immediately (Ctrl+Z undo +
              a toast). */}
          <LithoBoreholesInModel
            boreholes={visibleBoreholes}
            excludedBoreholeIds={activeLithoModel.excluded_borehole_ids}
            onToggle={(id, included) => void handleToggleBoreholeInLithoModel(id, included)}
            t={t}
          />

          {/* Debt #65: boreholes excluded from the litho build, surfaced as a
              compact callout with an "Include again" undo. Renders only when the
              model has exclusions; the reversible include fires immediately
              (Ctrl+Z undo + a toast). */}
          <LithoExcludedBoreholes
            excludedBoreholeIds={activeLithoModel.excluded_borehole_ids}
            boreholeNameById={boreholeNameById}
            onIncludeAgain={id => void handleToggleBoreholeInLithoModel(id, true)}
            t={t}
          />

          {/* Workflow guidance footer — always visible when a model is active. */}
          <p className="text-[11px] leading-snug text-text-muted">{t('litho.drawThenBuild')}</p>
        </>
      )}

      {/* Debt #87: confirm / reassign / detach dialog for extrapolated
          or orphan parents. Driven by the amber dot on unit rows. */}
      <ConfirmParentDialog
        open={confirmTarget !== null}
        formation={confirmTarget}
        geoFormations={geoParents}
        onSubmit={handleConfirmParent}
        onCancel={() => setConfirmTarget(null)}
        busy={confirmBusy}
      />

      {/* Debt #94 fix: clear litho model confirm dialog.
          Irreversible action — default focus on Cancel per docs/ux.md. */}
      <Modal
        open={wipeConfirmOpen}
        onCancel={() => setWipeConfirmOpen(false)}
        labelledBy="wipe-litho-contacts-title"
        busy={wiping}
        cardClassName="w-80"
      >
        <div className="p-5">
          <h2
            id="wipe-litho-contacts-title"
            className="text-sm font-semibold text-text-primary mb-1"
          >
            {t('litho.clearModelConfirm')}
          </h2>
          <p className="text-xs text-text-muted mb-4">{t('litho.clearModelBody')}</p>
          <div className="flex justify-end gap-2">
            {/* Cancel has default focus — the safe default for an
                irreversible confirm dialog per docs/ux.md. */}
            <Button
              variant="secondary"
              size="md"
              // reason: autoFocus on Cancel is the safe default for a
              // destructive-confirm modal — the user must actively choose
              // the destructive action, not accidentally confirm it.
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              onClick={() => setWipeConfirmOpen(false)}
              disabled={wiping}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              size="md"
              onClick={() => void confirmWipe()}
              disabled={wiping}
              data-testid="wipe-litho-contacts-confirm-btn"
            >
              {wiping ? t('litho.clearing') : t('litho.clearModelButton')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
