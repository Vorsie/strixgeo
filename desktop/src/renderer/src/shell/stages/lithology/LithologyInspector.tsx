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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Circle, Eye, EyeOff, RefreshCw, RotateCcw, Trash2 } from 'lucide-react'
import { Layers3 } from 'lucide-react'

import { api } from '../../../api/client'
import type {
  BodyListItem,
  FormationContactResponse,
  GeologicalFormationResponse,
  LithoBodySolidResponse,
} from '../../../api/client'
import Button from '../../../components/ui/Button'
import Modal from '../../../components/ui/Modal'
import { isGeologicalFormation } from '../../../utils/formationKind'
import { lithoDisplayName } from '../../../utils/lithoLabels'
import { log } from '../../../utils/log'
import { EmptyState } from '../../EmptyState'
import { useShell } from '../../ShellContext'
import ConfirmParentDialog from './ConfirmParentDialog'
import LithoBoreholesInModel from './LithoBoreholesInModel'
import LithoExcludedBoreholes from './LithoExcludedBoreholes'
import ModelKindPicker from './ModelKindPicker'
import { useT, type Translator } from '../../../i18n/translate'

/**
 * Inspector for the Lithology stage.
 *
 * Shows the model-kind picker, an optional stale-surface info banner,
 * a formation roster grouped under geological parents, a Resolve action
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

      {/* Confidence-fade toggle. The litho 3D pane (LithologyCanvas →
          Geology3DViewer) already honors ``showConfidenceFade``, but the only
          control used to live in GeologyInspector — so a litho-only user could
          not flip it without switching stages. It reads/writes the SAME
          project-wide ``view_state.show_confidence_fade``, so it stays in sync
          with the geology toggle. */}
      <div
        className="flex items-center justify-between gap-2 text-[11px] text-text-secondary border-t border-border-subtle pt-2"
        title={t('litho.confidenceFadeHint')}
      >
        <span>{t('geology.showConfidenceFade')}</span>
        <button
          type="button"
          role="switch"
          aria-checked={showConfidenceFade}
          onClick={() => void handleSetShowConfidenceFade(!showConfidenceFade)}
          data-testid="litho-confidence-fade-toggle"
          className={[
            'inline-flex h-4 w-7 items-center rounded-full transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            showConfidenceFade ? 'bg-accent' : 'bg-surface-page border border-border-default',
          ].join(' ')}
        >
          <span
            className={[
              'inline-block h-3 w-3 transform rounded-full bg-white transition-transform',
              showConfidenceFade ? 'translate-x-3.5' : 'translate-x-0.5',
            ].join(' ')}
          />
        </button>
      </div>

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
            <div
              className="flex items-center justify-between gap-2 rounded px-2 py-1.5 bg-surface-sunken border border-border-subtle"
              data-testid="litho-committed-pill"
            >
              <span className="text-[11px] leading-snug text-text-secondary">
                {/* Debt #147 — "unit" count is now distinct
                    ``formation_id`` over THIS model's contacts (the
                    units that actually have a placed contact here),
                    not the project-scoped ``lithoFormations`` count
                    (which includes orphan/shared vocabulary kept by
                    the delete cascade and read as "this model has 30
                    units" even on a freshly-created empty model).
                    The pill still surfaces when either count is non-
                    zero so the Clear button stays reachable for the
                    orphan-formation recovery case. */}
                {t('litho.pillCounts', {
                  c: lithoContacts.length,
                  cw: t(
                    lithoContacts.length === 1
                      ? 'litho.contactWordOne'
                      : 'litho.contactWordMany',
                  ),
                  u: new Set(lithoContacts.map(c => c.formation_id)).size,
                  uw: t(
                    new Set(lithoContacts.map(c => c.formation_id)).size === 1
                      ? 'litho.unitWordOne'
                      : 'litho.unitWordMany',
                  ),
                })}
              </span>
              <button
                type="button"
                onClick={() => setWipeConfirmOpen(true)}
                disabled={wiping}
                className="flex items-center gap-1 text-[11px] text-text-secondary hover:text-red-600 dark:hover:text-red-400 disabled:opacity-40 transition-colors flex-shrink-0"
                title={t('litho.clearModel')}
                data-testid="wipe-litho-contacts-btn"
              >
                <Trash2 size={11} aria-hidden="true" />
                {wiping ? t('litho.clearing') : t('litho.clearShort')}
              </button>
            </div>
          )}

          {/* Phase-2 Slice 2: Resolve instances action.
              Appears when a litho model is active; always visible so the
              engineer can explicitly re-run the resolver after drawing edges
              on the section canvas (Slice 4). Quiet busy-spinner during the
              async call. */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-text-muted uppercase tracking-wide font-semibold">
              {t('litho.instances')}
            </span>
            <button
              type="button"
              onClick={() => void handleResolve()}
              disabled={resolving}
              className="flex items-center gap-1 text-[11px] text-text-secondary hover:text-text-primary disabled:opacity-40 transition-colors"
              title={t('litho.renumberBodies')}
              data-testid="resolve-instances-btn"
            >
              <RefreshCw
                size={11}
                className={resolving ? 'animate-spin' : ''}
                aria-hidden="true"
              />
              {resolving ? t('litho.resolving') : t('litho.resolveInstances')}
            </button>
          </div>

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

// ---------------------------------------------------------------------------
// LithoUnitRow — one litho-unit row (module scope, NOT defined inside
// LithoFormationRoster: an inner component re-identifies every parent
// render and React unmount/remounts it — review C-1).
// ---------------------------------------------------------------------------

interface LithoUnitRowProps {
  f: GeologicalFormationResponse
  lithoContacts: readonly FormationContactResponse[]
  /** #101 Slice 6: number of lenses whose parent_formation_id === f.id. */
  lensCount: number
  /** Debt #87: opens the confirm-parent dialog for an extrapolated or
   *  orphan unit. Click target is the amber dot on the left of the row. */
  onReviewParent: (formation: GeologicalFormationResponse) => void
  t: Translator
}

function LithoUnitRow({
  f,
  lithoContacts,
  lensCount,
  onReviewParent,
  t,
}: LithoUnitRowProps): JSX.Element {
  const contactCount = lithoContacts.filter(c => c.formation_id === f.id).length
  // Debt #87: amber dot when the parent needs engineer review.
  // Either the AcceptLitho path stamped parent_extrapolated=true, or the
  // unit is orphan (no parent at all — usually grouped under "Unassigned"
  // but the dot makes the per-row affordance discoverable from any group).
  const needsParentReview = f.parent_extrapolated || f.parent_formation_id == null
  const reviewTooltip = f.parent_extrapolated
    ? t('litho.parentExtrapolatedReview')
    : t('litho.noParentReview')

  return (
    <li
      className="flex items-center gap-2 px-1 py-0.5 rounded text-xs text-text-primary"
      data-testid={`litho-formation-row-${f.id}`}
    >
      <span
        className="h-3 w-3 flex-shrink-0 rounded-sm border border-border-subtle"
        // Litho formations carry their lithology colour in the stored
        // ``color`` (stamped at create + backfilled, #145).
        style={{ backgroundColor: f.color }}
        aria-hidden="true"
      />
      {/* Translate at the presentation boundary — a litho unit's stored
          ``name`` is the raw token ("KLEI (KL:Z)"); the roster shows the
          English pipe label (debt #96). */}
      <span className="flex-1 truncate">
        {f.litho_main_soil_code != null
          ? lithoDisplayName(f.litho_main_soil_code, f.litho_admixtures)
          : f.name}
      </span>

      {/* Debt #87: parent-review affordance — amber filled circle on the
          right edge of the name region (before the metadata column). */}
      {needsParentReview && (
        <button
          type="button"
          onClick={() => onReviewParent(f)}
          className="flex-shrink-0 text-amber-500 hover:text-amber-600 transition-colors"
          title={reviewTooltip}
          aria-label={reviewTooltip}
          data-testid={`parent-review-${f.id}`}
        >
          <Circle size={9} fill="currentColor" aria-hidden="true" />
        </button>
      )}

      {/* Contact count */}
      <span
        className="text-[10px] tabular-nums text-text-muted"
        title={t(contactCount === 1 ? 'geotech.contactLabel' : 'geotech.contactsLabel', {
          count: contactCount,
        })}
      >
        {contactCount}
      </span>

      {/* #101 Slice 6: lens count badge — only visible when ≥1 lens. */}
      {lensCount > 0 && (
        <span
          className="text-[10px] tabular-nums rounded px-1 py-0 bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
          title={t(lensCount === 1 ? 'litho.lensDefinedOne' : 'litho.lensDefinedMany', {
            n: lensCount,
          })}
          data-testid={`lens-count-badge-${f.id}`}
        >
          {lensCount}L
        </span>
      )}
    </li>
  )
}

// ---------------------------------------------------------------------------
// LithoFormationRoster — flat roster of litho units
// ---------------------------------------------------------------------------

interface LithoFormationRosterProps {
  /** Litho units in the active litho model. */
  lithoFormations: readonly GeologicalFormationResponse[]
  /** All contacts in the active litho model — used for per-unit count. */
  lithoContacts: readonly FormationContactResponse[]
  /**
   * Per-formation lens count (#101 Slice 6).
   * Key = formation id; value = number of lenses whose
   * ``parent_formation_id`` equals that key.  Absent key → 0.
   */
  lensCountByFormationId: ReadonlyMap<string, number>
  /** Debt #87: called when the user clicks a unit's parent-review dot. */
  onReviewParent: (formation: GeologicalFormationResponse) => void
  t: Translator
}

/**
 * Renders lithostratigraphic units as a flat list ordered ascending by
 * ``display_order`` (oldest first — superposition convention used by all
 * renderers).
 *
 * Under A2 litho units are geo-agnostic (``parent_formation_id`` is always
 * ``null`` on accept-created rows), so parent-group headers would only
 * produce a single "Unassigned" bucket for every unit. The flat list is
 * simpler and honest: the engineer sees the units in stratigraphic order
 * without misleading group structure.
 *
 * Each unit row shows: colour swatch, name, and contact count.
 *
 * Parameters
 * ----------
 * lithoFormations
 *     Litho units to display, ordered by ``display_order`` (caller sorts).
 * lithoContacts
 *     All contacts in the litho model for per-unit contact counting.
 * lensCountByFormationId
 *     Per-formation lens count map.
 * onReviewParent
 *     Callback when the user clicks a unit's parent-review dot.
 *
 * Returns
 * -------
 * JSX.Element
 *     The flat roster element.
 */
function LithoFormationRoster({
  lithoFormations,
  lithoContacts,
  lensCountByFormationId,
  onReviewParent,
  t,
}: LithoFormationRosterProps): JSX.Element {
  // Sort ascending by display_order (oldest first — superposition convention).
  const sorted = [...lithoFormations].sort((a, b) => a.display_order - b.display_order)

  return (
    <ul className="flex flex-col gap-0.5" aria-label={t('litho.formations')}>
      {sorted.map(f => (
        <LithoUnitRow
          key={f.id}
          f={f}
          lithoContacts={lithoContacts}
          lensCount={lensCountByFormationId.get(f.id) ?? 0}
          onReviewParent={onReviewParent}
          t={t}
        />
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// LithoSolidLegend — per-body colour pickers grouped by lithology
// ---------------------------------------------------------------------------

// Collapse threshold: groups with more than this many bodies are collapsed
// by default to avoid a wall of rows on larger models.
const LEGEND_COLLAPSE_THRESHOLD = 8

interface LithoSolidLegendProps {
  /** All built body solids for the active litho model. */
  lithoSolids: readonly LithoBodySolidResponse[]
  /** All litho formations for the active model — used for group metadata. */
  lithoFormations: readonly GeologicalFormationResponse[]
  /**
   * Set or clear a per-body display colour.
   * Forwarded from ``useLithoSolids`` — optimistic + debounced.
   */
  setBodyColor: (bodyId: string, color: string | null) => void
  /**
   * When ``true``, per-body rows for marker bodies (``is_flagged === true``)
   * are hidden from the legend.  Group headers remain visible and show a
   * "(N markers hidden)" note so the user knows they exist.
   */
  hideMarkers: boolean
  /** Toggle the ``hideMarkers`` state. */
  onToggleHideMarkers: (value: boolean) => void
  t: Translator
}

/**
 * Inspector section that renders built body solids grouped by lithology.
 *
 * Each group header shows the formation colour swatch, translated name, body
 * count, and (when any flagged) a marker count.  Per-body rows show a colour
 * picker, the ordinal handle, a stale dot, a flagged icon, and a Reset button
 * when a custom colour is set.  Large groups (> ``LEGEND_COLLAPSE_THRESHOLD``
 * bodies) are collapsed by default to keep the panel scannable.
 *
 * When ``hideMarkers`` is true, per-body rows for flagged bodies are hidden.
 * Group headers remain visible and report "(N markers hidden)" so the user
 * knows the markers exist but are suppressed.  A group whose ALL bodies are
 * markers keeps its header with the "(N markers hidden)" note — vanishing
 * the header entirely would suggest the lithology does not exist, which is
 * misleading.
 *
 * When no solids have been built yet, renders a brief empty-state prompt.
 *
 * Parameters
 * ----------
 * lithoSolids
 *     Built body solids for the active model.
 * lithoFormations
 *     Litho formations for group metadata + sorting by display_order.
 * setBodyColor
 *     Colour setter from ``useLithoSolids`` (optimistic + debounced).
 * hideMarkers
 *     When ``true``, suppress flagged-body rows from the legend.
 * onToggleHideMarkers
 *     Called with the new boolean value when the toggle is clicked.
 *
 * Returns
 * -------
 * JSX.Element
 *     The body solids legend section.
 */
function LithoSolidLegend({
  lithoSolids,
  lithoFormations,
  setBodyColor,
  hideMarkers,
  onToggleHideMarkers,
  t,
}: LithoSolidLegendProps): JSX.Element {
  // Only solids that have actual geometry.
  const builtSolids = lithoSolids.filter(s => s.triangles.length > 0)

  // Formation lookup for colour + display name.
  const formationById = useMemo(() => {
    const m = new Map<string, GeologicalFormationResponse>()
    for (const f of lithoFormations) m.set(f.id, f)
    return m
  }, [lithoFormations])

  // Build groups: formation_id → solids[], sorted by body_ordinal.
  // Groups ordered by formation display_order (oldest first).
  const groups = useMemo<
    {
      formation: GeologicalFormationResponse | undefined
      formationId: string
      solids: LithoBodySolidResponse[]
    }[]
  >(() => {
    const byFormation = new Map<string, LithoBodySolidResponse[]>()
    for (const s of builtSolids) {
      const arr = byFormation.get(s.formation_id) ?? []
      arr.push(s)
      byFormation.set(s.formation_id, arr)
    }

    // Sort each group's solids by body_ordinal ascending.
    for (const arr of byFormation.values()) {
      arr.sort((a, b) => a.body_ordinal - b.body_ordinal)
    }

    // Sort groups by formation display_order; formations not in the map
    // go last (stable so UUIDs are the tiebreaker).
    const formationOrder = new Map<string, number>()
    for (const f of lithoFormations) formationOrder.set(f.id, f.display_order)

    return [...byFormation.entries()]
      .sort(([aId], [bId]) => {
        const aOrd = formationOrder.get(aId) ?? Number.MAX_SAFE_INTEGER
        const bOrd = formationOrder.get(bId) ?? Number.MAX_SAFE_INTEGER
        return aOrd - bOrd
      })
      .map(([formationId, solids]) => ({
        formation: formationById.get(formationId),
        formationId,
        solids,
      }))
  }, [builtSolids, lithoFormations, formationById])

  // Per-group expand/collapse state.
  //
  // Why not lazy-init from groups: lithoSolids arrives ASYNC — on the first
  // render groups is empty, so a lazy () => new Set(...) captures an empty Set
  // and never updates when solids load (useState ignores subsequent renders).
  // Instead: start empty, then open small groups ONCE when groups first
  // transitions from empty to non-empty (the prevGroupsLengthRef guard).
  // Subsequent renders where groups is already populated do NOT re-run the
  // expansion so the user's manual collapse/expand is preserved.
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(() => new Set<string>())
  const prevGroupsLengthRef = useRef(0)
  useEffect(() => {
    if (groups.length > 0 && prevGroupsLengthRef.current === 0) {
      setExpandedGroups(
        new Set(groups.filter(g => g.solids.length <= LEGEND_COLLAPSE_THRESHOLD).map(g => g.formationId)),
      )
    }
    prevGroupsLengthRef.current = groups.length
  }, [groups])

  function toggleGroup(formationId: string): void {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(formationId)) next.delete(formationId)
      else next.add(formationId)
      return next
    })
  }

  // Total marker (flagged) count across all built solids — used by the
  // toggle title so the user knows how many are being hidden.
  const totalMarkerCount = builtSolids.filter(s => s.is_flagged === true).length

  if (builtSolids.length === 0) {
    return (
      <div data-testid="litho-solid-legend" className="flex flex-col gap-1">
        <div className="text-[10px] uppercase tracking-wide text-text-muted">
          {t('litho.bodySolids')}
        </div>
        <p className="text-[11px] leading-snug text-text-muted">{t('litho.buildToSeeBodies')}</p>
      </div>
    )
  }

  return (
    <div data-testid="litho-solid-legend" className="flex flex-col gap-1">
      {/* Section header + hide-markers toggle on the same row.
          The toggle is a reversible action (show/hide is local UI state)
          so it fires immediately — no confirm dialog (UX convention). */}
      <div className="flex items-center justify-between gap-1">
        <div className="text-[10px] uppercase tracking-wide text-text-muted">
          {t('litho.bodySolids')}
        </div>
        {totalMarkerCount > 0 && (
          <button
            type="button"
            data-testid="hide-markers-toggle"
            aria-pressed={hideMarkers}
            onClick={() => onToggleHideMarkers(!hideMarkers)}
            className="flex items-center gap-1 text-[10px] text-text-muted hover:text-text-secondary transition-colors flex-shrink-0"
            title={t(hideMarkers ? 'litho.showMarkersN' : 'litho.hideMarkersN', {
              n: totalMarkerCount,
              bodies: t(totalMarkerCount === 1 ? 'litho.bodyWordOne' : 'litho.bodyWordMany'),
            })}
          >
            {hideMarkers
              ? <Eye size={11} aria-hidden="true" />
              : <EyeOff size={11} aria-hidden="true" />}
            {hideMarkers ? t('litho.showMarkers') : t('litho.hideMarkers')}
          </button>
        )}
      </div>

      {groups.map(({ formation, formationId, solids }) => {
        const displayName = formation
          ? (formation.litho_main_soil_code != null
              ? lithoDisplayName(formation.litho_main_soil_code, formation.litho_admixtures)
              : formation.name)
          : formationId
        const flaggedCount = solids.filter(s => s.is_flagged === true).length
        const isExpanded = expandedGroups.has(formationId)

        // When hideMarkers is on, show only non-flagged bodies in the rows.
        // The header stays visible regardless so the user knows the lithology
        // exists — a group where every body is a marker renders its header
        // with "(N markers hidden)" and an empty body list under it.
        const visibleGroupSolids = hideMarkers
          ? solids.filter(s => s.is_flagged !== true)
          : solids
        const hiddenMarkerCount = hideMarkers ? flaggedCount : 0

        return (
          <div key={formationId} className="flex flex-col gap-0.5">
            {/* Group header row — click to expand/collapse */}
            <button
              type="button"
              data-testid={`solid-group-header-${formationId}`}
              onClick={() => toggleGroup(formationId)}
              className="flex items-center gap-1.5 w-full text-left px-1 py-0.5 rounded hover:bg-surface-sunken transition-colors"
              aria-expanded={isExpanded}
              title={isExpanded ? t('litho.collapseGroup') : t('litho.expandGroup')}
            >
              {/* Formation colour swatch */}
              <span
                className="h-2.5 w-2.5 flex-shrink-0 rounded-sm border border-border-subtle"
                style={{ backgroundColor: formation?.color ?? '#888' }}
                aria-hidden="true"
              />
              <span className="flex-1 truncate text-[11px] font-medium text-text-primary">
                {displayName}
              </span>
              <span className="text-[10px] text-text-muted tabular-nums flex-shrink-0">
                {t('litho.bodyCount', {
                  n: solids.length,
                  bodies: t(solids.length === 1 ? 'litho.bodyWordOne' : 'litho.bodyWordMany'),
                })}
                {hiddenMarkerCount > 0 ? (
                  // hideMarkers on: replace "(N markers)" with "(N markers hidden)"
                  <span className="ml-1 text-text-muted" data-testid={`solid-group-markers-hidden-${formationId}`}>
                    {t('litho.markersHidden', {
                      n: hiddenMarkerCount,
                      markers: t(
                        hiddenMarkerCount === 1 ? 'litho.markerWordOne' : 'litho.markerWordMany',
                      ),
                    })}
                  </span>
                ) : flaggedCount > 0 && (
                  // hideMarkers off: show "(N markers)" as before
                  <span className="ml-1 text-text-muted">
                    {t('litho.markers', {
                      n: flaggedCount,
                      markers: t(flaggedCount === 1 ? 'litho.markerWordOne' : 'litho.markerWordMany'),
                    })}
                  </span>
                )}
              </span>
            </button>

            {/* Per-body rows — visible only when group is expanded.
                When hideMarkers is on, marker rows are omitted here;
                the header's "(N markers hidden)" note covers them. */}
            {isExpanded && (
              <ul
                className="flex flex-col gap-0.5 pl-3"
                aria-label={t('litho.bodiesForName', { name: displayName })}
              >
                {visibleGroupSolids.map(solid => {
                  const resolvedColor = solid.display_color ?? formation?.color ?? '#888888'
                  return (
                    <li
                      key={solid.id}
                      data-testid={`solid-legend-row-${solid.body_id}`}
                      className="flex items-center gap-1 px-1 py-0.5 rounded text-xs text-text-secondary"
                    >
                      {/* Colour picker — reversible (fire immediately) */}
                      <input
                        type="color"
                        data-testid={`solid-color-input-${solid.body_id}`}
                        value={resolvedColor.startsWith('#') ? resolvedColor : `#${resolvedColor}`}
                        onChange={e => setBodyColor(solid.body_id, e.target.value)}
                        title={t('litho.pickBodyColour')}
                        className="w-4 h-4 p-0 border border-border-subtle rounded cursor-pointer flex-shrink-0"
                        aria-label={t('litho.colourForBody', {
                          name: displayName,
                          ordinal: solid.body_ordinal,
                        })}
                      />
                      {/* Ordinal handle */}
                      <span className="tabular-nums text-text-muted">
                        #{solid.body_ordinal}
                      </span>
                      <span className="flex-1" />
                      {/* Stale indicator — amber dot, title explains */}
                      {solid.is_stale === true && (
                        <span
                          className="text-amber-500 leading-none text-[10px]"
                          title={t('litho.staleHint')}
                          aria-label={t('litho.stale')}
                        >
                          •
                        </span>
                      )}
                      {/* Flagged icon */}
                      {solid.is_flagged === true && (
                        <span
                          className="shrink-0"
                          title={t('litho.underConstrained')}
                        >
                          <AlertTriangle size={10} className="text-amber-500" />
                        </span>
                      )}
                      {/* Reset to formation colour — shown only when overridden */}
                      {solid.display_color != null && (
                        <button
                          type="button"
                          data-testid={`solid-color-reset-${solid.body_id}`}
                          onClick={() => setBodyColor(solid.body_id, null)}
                          title={t('litho.resetBodyColour')}
                          className="p-1 -m-1 text-text-muted hover:text-text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent flex-shrink-0"
                        >
                          <RotateCcw size={9} />
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )
      })}
    </div>
  )
}
