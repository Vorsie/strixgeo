// Lithology stage inspector — model picker, stale-surface banner,
// formation roster with ordinal display + lock toggle + Resolve action,
// read-only formation roster grouped under geological parents, and
// workflow guidance footer.
//
// Slice C of #55 litho peer-stage scaffolding.
// Slice 2 of Phase-2 litho correlation: ordinal display, lock toggle,
// Resolve instances action, and the RO-3 inline amber stale-ordinal badge.
//
// Phase 1 update: lithoFormations roster is now grouped under parent
// geological formations ordered ascending by display_order (oldest
// first, matching the geological superposition convention used by all
// other renderers). Litho units without a parent_formation_id are
// collected under an "Unassigned" group at the bottom.
//
// Design decisions (system-architect):
//   • ModelKindPicker unchanged at top (model select/create lifecycle).
//   • Stale-surface info banner when lithoStaleSurfaceCount > 0 —
//     READ-ONLY status; no Build button here.  Build lives in
//     LithologyToolbar (moved from SectionsToolbar in Phase 1).
//     Mirrors how GeologyInspector's crossings banner has no action.
//   • Formation roster per unit: colour swatch, name, contact count,
//     ordinal badge ("body N" / "body ?"), lock toggle, RO-3 amber badge.
//   • "Resolve instances" action above the roster (Phase-2 Slice 2).
//   • RO-3 amber badge (owner-locked): inline amber "!" on locked
//     formations when the edge set changed since the last resolve.
//     Quiet when nothing is locked / no edges.
//   • Guidance footer pointing engineers to Sections.
//   • EmptyState primitive for the no-model / empty-roster branches.
//   • Semantic tokens for chrome — no raw dark: pairs.
//
// Slice 4: // connect-gesture UI on the section canvas (not here)
// Slice 5: parent_formation_name server-resolved (debt #67) — consumed
//           in LithoFormationRoster group labels below.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Circle, Lock, LockOpen, RefreshCw } from 'lucide-react'
import { Layers3 } from 'lucide-react'

import { api } from '../../../api/client'
import type {
  FormationContactResponse,
  GeologicalFormationResponse,
  LithoCorrelationEdge,
} from '../../../api/client'
import { isGeologicalFormation } from '../../../utils/formationKind'
import { log } from '../../../utils/log'
import { EmptyState } from '../../EmptyState'
import { useShell } from '../../ShellContext'
import ConfirmParentDialog from './ConfirmParentDialog'
import ModelKindPicker from './ModelKindPicker'
import { computeOrdinalStale } from './ordinalStaleness'

/**
 * Inspector for the Lithology stage.
 *
 * Shows the model-kind picker, an optional stale-surface info banner,
 * a formation roster with ordinal display + lock toggle + Resolve action,
 * the RO-3 inline amber stale-ordinal badge on locked formations whose
 * edge set changed since the last explicit resolve, and workflow guidance.
 *
 * Returns
 * -------
 * JSX.Element
 *     The inspector panel content.
 */
export default function LithologyInspector(): JSX.Element {
  const {
    project,
    geoModel: {
      activeGeologicalModel,
      activeLithoModel,
      formations,
      lithoFormations,
      lithoContacts,
      lithoStaleSurfaceCount,
      lithoStaleTinSessionCount,
      refetchFormations,
    },
  } = useShell()

  // Phase-2 Slice 2: correlation edge state for RO-3 stale-ordinal badge.
  // Fetched when the active litho model changes; refreshed after Resolve.
  const [correlationEdges, setCorrelationEdges] = useState<LithoCorrelationEdge[]>([])
  // The edge count at the time of the most recent explicit Resolve call
  // (or at mount — treated as a resolved baseline). Used to detect whether
  // the edge set changed since the locked ordinals were last confirmed.
  const lastResolvedEdgeCountRef = useRef<number | null>(null)
  const [lastResolvedEdgeCount, setLastResolvedEdgeCount] = useState<number | null>(null)

  const [resolving, setResolving] = useState(false)

  // Fetch the current edge list whenever the active litho model changes.
  useEffect(() => {
    if (project === null || activeLithoModel === null) {
      setCorrelationEdges([])
      lastResolvedEdgeCountRef.current = null
      setLastResolvedEdgeCount(null)
      return
    }
    const pid = project.id
    const mid = activeLithoModel.id
    log.debug('[LithologyInspector] fetching correlations for model', mid)
    void api.geology.listCorrelations(pid, mid).then(edges => {
      setCorrelationEdges(edges)
      // Treat the initial load as the resolved baseline only if it has
      // not been set yet (i.e. this is the first fetch for this model).
      if (lastResolvedEdgeCountRef.current === null) {
        lastResolvedEdgeCountRef.current = edges.length
        setLastResolvedEdgeCount(edges.length)
      }
    })
  // reason: activeLithoModel?.id is the stable identity key; using the
  // full object would re-fire on every parent re-render that reconstructs
  // the model object reference even when the id is unchanged.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, activeLithoModel?.id])

  // Explicit resolve: re-run the ordinal resolver, refetch formations and
  // edges, then update the resolved-edge-count baseline.
  const handleResolve = useCallback(async () => {
    if (project === null || activeLithoModel === null) return
    const pid = project.id
    const mid = activeLithoModel.id
    log.info('[LithologyInspector] resolving litho instances for model', mid)
    setResolving(true)
    try {
      const result = await api.geology.resolveLithoInstances(pid, mid)
      log.info(
        '[LithologyInspector] resolve complete:',
        result.updated.length,
        'formation(s) updated',
      )
      // Refetch formations so ordinal badges update.
      refetchFormations()
      // Refetch edges; update the resolved-count baseline so amber
      // badges clear on locked formations that are now in sync.
      const edges = await api.geology.listCorrelations(pid, mid)
      setCorrelationEdges(edges)
      lastResolvedEdgeCountRef.current = edges.length
      setLastResolvedEdgeCount(edges.length)
    } catch (err) {
      log.error('[LithologyInspector] resolve failed:', err)
    } finally {
      setResolving(false)
    }
  }, [project, activeLithoModel, refetchFormations])

  // Lock-toggle: PATCH instance_ordinal_locked on a formation, then
  // refetch formations so the badge updates immediately.
  const handleToggleLock = useCallback(
    async (formation: GeologicalFormationResponse) => {
      if (project === null) return
      const newLocked = !formation.instance_ordinal_locked
      log.debug(
        '[LithologyInspector] toggling lock on formation',
        formation.id,
        '→',
        newLocked,
      )
      try {
        await api.geology.updateFormation(project.id, formation.id, {
          instance_ordinal_locked: newLocked,
        })
        refetchFormations()
      } catch (err) {
        log.error('[LithologyInspector] lock toggle failed:', err)
      }
    },
    [project, refetchFormations],
  )

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

  // RO-3 stale-ordinal badge: locked formation + edge set changed since
  // the last explicit resolve. The predicate is the pure
  // ``computeOrdinalStale`` helper so its PRESENT branch is unit-tested
  // independently (review SF-1) — the in-component useMemo only ever
  // memoises it.
  const currentEdgeCount = correlationEdges.length
  const ordinalIsStale = useMemo(
    () => computeOrdinalStale(lithoFormations, currentEdgeCount, lastResolvedEdgeCount),
    [lithoFormations, currentEdgeCount, lastResolvedEdgeCount],
  )

  // No geological backbone — the litho model requires one as a parent.
  if (activeGeologicalModel === null) {
    return (
      <div className="flex flex-col gap-3 p-3">
        <div className="text-xs font-semibold text-text-primary">Lithology model</div>
        <p className="text-[11px] leading-snug text-text-muted">
          Create a geological model first (Geology stage) — a lithostratigraphic
          model refines it.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="text-xs font-semibold text-text-primary">Lithology model</div>

      {/* Model select / create lifecycle — relocated from GeologyInspector
          header per #55 re-scope.  Same component + hook layer. */}
      <ModelKindPicker />

      {activeLithoModel === null ? (
        /* No active litho model: compact guidance */
        <EmptyState
          icon={<Layers3 />}
          title="No lithology model"
          hint="Create a lithology model above, then open the Sections stage to draw contacts."
          compact
        />
      ) : (
        <>
          {/* Stale-surface info banner — read-only status, no action here.
              The Build verb lives on the Sections toolbar (cross-sections are
              the editing surface).  Mirrors the GeologyInspector crossings
              banner which also carries no action button. */}
          {lithoStaleSurfaceCount > 0 && (
            <div
              className="text-[11px] leading-snug rounded px-2 py-1.5 bg-surface-sunken border border-border-subtle text-text-secondary"
              data-testid="litho-stale-banner"
            >
              {lithoStaleSurfaceCount} litho surface
              {lithoStaleSurfaceCount === 1 ? '' : 's'} stale — Build on Sections.
            </div>
          )}

          {/* Stale-TIN straddle-fallback pill. AcceptLithoSuggestions
              falls back to depth-ordered geology contacts when the
              parent geology TIN is stale or absent — geometrically
              correct but less precise than a fresh TIN sample.  The
              pill accumulates across the current dogfeed session and
              clears on (a) successful geology rebuild + (b) Clear
              suggestions. */}
          {lithoStaleTinSessionCount > 0 && (
            <div
              className="text-[11px] leading-snug rounded px-2 py-1.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300"
              data-testid="litho-stale-tin-pill"
            >
              {lithoStaleTinSessionCount} stale-TIN straddle fallback
              {lithoStaleTinSessionCount === 1 ? '' : 's'} this session — rebuild
              geology for precision.
            </div>
          )}

          {/* Phase-2 Slice 2: Resolve instances action.
              Appears when a litho model is active; always visible so the
              engineer can explicitly re-run the resolver after drawing edges
              on the section canvas (Slice 4). Quiet busy-spinner during the
              async call. */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-text-muted uppercase tracking-wide font-semibold">
              Instances
            </span>
            <button
              type="button"
              onClick={() => void handleResolve()}
              disabled={resolving}
              className="flex items-center gap-1 text-[11px] text-text-secondary hover:text-text-primary disabled:opacity-40 transition-colors"
              title="Re-number litho bodies from their correlation graph"
              data-testid="resolve-instances-btn"
            >
              <RefreshCw
                size={11}
                className={resolving ? 'animate-spin' : ''}
                aria-hidden="true"
              />
              {resolving ? 'Resolving…' : 'Resolve instances'}
            </button>
          </div>

          {/* Read-only formation roster grouped under parent geological formations.
              Geological parents ordered ascending by display_order (oldest=0
              first — geological superposition convention used by all renderers).
              Litho units share a parent via parent_formation_id; units without
              a parent are shown under an "Unassigned" group at the bottom.
              Formations are project-scoped shared vocabulary; CRUD stays in
              GeologyInspector. */}
          {lithoFormations.length === 0 ? (
            <EmptyState
              icon={<Layers3 />}
              title="No litho formations yet"
              hint="Accept CPT suggestions or draw contacts on a section — each accepted layer creates a formation here."
              compact
            />
          ) : (
            <LithoFormationRoster
              geoFormations={formations}
              lithoFormations={lithoFormations}
              lithoContacts={lithoContacts}
              ordinalIsStale={ordinalIsStale}
              onToggleLock={handleToggleLock}
              onReviewParent={setConfirmTarget}
            />
          )}

          {/* Workflow guidance footer — always visible when a model is active. */}
          <p className="text-[11px] leading-snug text-text-muted">
            Draw contacts on Sections, then Build to update surfaces.
          </p>
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
  ordinalIsStale: boolean
  onToggleLock: (formation: GeologicalFormationResponse) => Promise<void>
  /** Debt #87: opens the confirm-parent dialog for an extrapolated or
   *  orphan unit. Click target is the amber dot on the left of the row. */
  onReviewParent: (formation: GeologicalFormationResponse) => void
}

function LithoUnitRow({
  f,
  lithoContacts,
  ordinalIsStale,
  onToggleLock,
  onReviewParent,
}: LithoUnitRowProps): JSX.Element {
  const contactCount = lithoContacts.filter(c => c.formation_id === f.id).length
  // Ordinal badge: "body N" when resolved, "body ?" when still null.
  const ordinalLabel = f.instance_ordinal !== null ? `body ${f.instance_ordinal}` : 'body ?'
  // RO-3 amber badge: locked formation + edge set changed since last resolve.
  const showStaleBadge = f.instance_ordinal_locked && ordinalIsStale
  // Debt #87: amber dot when the parent needs engineer review.
  // Either the AcceptLitho path stamped parent_extrapolated=true, or the
  // unit is orphan (no parent at all — usually grouped under "Unassigned"
  // but the dot makes the per-row affordance discoverable from any group).
  const needsParentReview = f.parent_extrapolated || f.parent_formation_id == null
  const reviewTooltip = f.parent_extrapolated
    ? 'Parent extrapolated from TIN — click to confirm or reassign'
    : 'No parent assigned — click to assign or detach'

  return (
    <li
      className="flex items-center gap-2 px-1 py-0.5 rounded text-xs text-text-primary"
      data-testid={`litho-formation-row-${f.id}`}
    >
      <span
        className="h-3 w-3 flex-shrink-0 rounded-sm border border-border-subtle"
        style={{ backgroundColor: f.color }}
        aria-hidden="true"
      />
      <span className="flex-1 truncate">{f.name}</span>

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

      {/* Ordinal badge — "body N" or "body ?" when unresolved */}
      <span
        className="text-[10px] tabular-nums text-text-muted"
        title={ordinalLabel}
        data-testid={`ordinal-badge-${f.id}`}
      >
        {ordinalLabel}
      </span>

      {/* RO-3 amber stale badge — inline, quiet otherwise */}
      {showStaleBadge && (
        <span
          className="text-amber-600"
          title="Connections changed — re-resolve or unlock"
          data-testid={`stale-ordinal-badge-${f.id}`}
          aria-label="Connections changed — re-resolve or unlock"
        >
          <AlertCircle size={11} aria-hidden="true" />
        </span>
      )}

      {/* Lock toggle — locks/unlocks the instance_ordinal for this unit */}
      <button
        type="button"
        onClick={() => void onToggleLock(f)}
        className="flex-shrink-0 text-text-muted hover:text-text-primary transition-colors"
        title={
          f.instance_ordinal_locked
            ? 'Ordinal locked — click to unlock'
            : 'Ordinal free — click to lock'
        }
        data-testid={`lock-toggle-${f.id}`}
        aria-pressed={f.instance_ordinal_locked}
      >
        {f.instance_ordinal_locked ? (
          <Lock size={11} aria-hidden="true" />
        ) : (
          <LockOpen size={11} aria-hidden="true" />
        )}
      </button>

      {/* Contact count */}
      <span
        className="text-[10px] tabular-nums text-text-muted"
        title={`${contactCount} contact${contactCount === 1 ? '' : 's'} in this model`}
      >
        {contactCount}
      </span>
    </li>
  )
}

// ---------------------------------------------------------------------------
// LithoFormationRoster — grouped roster of litho units with ordinal badges
// ---------------------------------------------------------------------------

interface LithoFormationRosterProps {
  /** Parent geological formations — ordered ascending by display_order. */
  geoFormations: readonly GeologicalFormationResponse[]
  /** Litho units in the active litho model. */
  lithoFormations: readonly GeologicalFormationResponse[]
  /** All contacts in the active litho model — used for per-unit count. */
  lithoContacts: readonly FormationContactResponse[]
  /** True when the edge set changed since the last explicit resolve,
   *  causing locked formations to show the RO-3 amber stale badge. */
  ordinalIsStale: boolean
  /** Called when the user clicks the lock/unlock icon on a unit row. */
  onToggleLock: (formation: GeologicalFormationResponse) => Promise<void>
  /** Debt #87: called when the user clicks a unit's parent-review dot. */
  onReviewParent: (formation: GeologicalFormationResponse) => void
}

/**
 * Renders lithostratigraphic units grouped under their parent geological
 * formations, ordered ascending by the geological formation's
 * ``display_order`` (oldest first — superposition convention).
 *
 * Each unit row shows: colour swatch, name, contact count, ordinal badge
 * ("body N" / "body ?"), lock toggle, and the RO-3 amber stale badge when
 * the formation is locked and the edge set changed since last resolve.
 *
 * Parameters
 * ----------
 * geoFormations
 *     Geological formations sorted by display_order.  Units inherit the
 *     parent's ordering.
 * lithoFormations
 *     Litho units to display — may have parent_formation_id = null.
 * lithoContacts
 *     All contacts in the litho model for per-unit contact counting.
 * ordinalIsStale
 *     When true, every locked formation gets the amber "!" badge.
 * onToggleLock
 *     Called with the formation when the user clicks the lock icon.
 *
 * Returns
 * -------
 * JSX.Element
 *     The grouped roster element.
 */
function LithoFormationRoster({
  geoFormations,
  lithoFormations,
  lithoContacts,
  ordinalIsStale,
  onToggleLock,
  onReviewParent,
}: LithoFormationRosterProps): JSX.Element {
  // Group litho units by parent_formation_id.
  const byParent = new Map<string | null, GeologicalFormationResponse[]>()
  // Slice 5 / debt #67: collect server-resolved parent names so the group
  // heading uses the canonical name without an extra geoFormations join.
  const parentNameById = new Map<string, string>()
  for (const lf of lithoFormations) {
    const key = lf.parent_formation_id ?? null
    const existing = byParent.get(key) ?? []
    existing.push(lf)
    byParent.set(key, existing)
    if (key !== null && lf.parent_formation_name !== null && !parentNameById.has(key)) {
      parentNameById.set(key, lf.parent_formation_name)
    }
  }

  // Build the ordered parent sequence: geological formations ascending by
  // display_order, keeping only those with at least one litho child.
  const geoById = new Map(geoFormations.map(gf => [gf.id, gf]))
  const sortedParents = [...geoFormations].sort((a, b) => a.display_order - b.display_order)
  const parentsWithChildren = sortedParents.filter(gf => byParent.has(gf.id))
  const unassigned = byParent.get(null) ?? []

  return (
    <div className="flex flex-col gap-2" aria-label="Litho formations">
      {parentsWithChildren.map(gf => {
        // Prefer server-resolved name (Slice 5); fall back to geo-join name.
        const groupLabel = parentNameById.get(gf.id) ?? gf.name
        const geoRow = geoById.get(gf.id)
        return (
        <section key={gf.id} aria-label={groupLabel}>
          {/* Parent geological formation header */}
          <div className="flex items-center gap-1.5 mb-0.5">
            <span
              className="h-2.5 w-2.5 flex-shrink-0 rounded-sm border border-border-subtle opacity-60"
              style={{ backgroundColor: geoRow?.color ?? gf.color }}
              aria-hidden="true"
            />
            <span
              className="text-[10px] font-semibold text-text-muted uppercase tracking-wide truncate"
              title={groupLabel}
            >
              {groupLabel}
            </span>
          </div>
          {/* Litho units under this parent */}
          <ul className="flex flex-col gap-0.5 pl-3 border-l border-border-subtle">
            {(byParent.get(gf.id) ?? []).map(f => (
              <LithoUnitRow
                key={f.id}
                f={f}
                lithoContacts={lithoContacts}
                ordinalIsStale={ordinalIsStale}
                onToggleLock={onToggleLock}
                onReviewParent={onReviewParent}
              />
            ))}
          </ul>
        </section>
        )
      })}

      {/* Unassigned units — litho formations without a parent_formation_id */}
      {unassigned.length > 0 && (
        <section aria-label="Unassigned">
          <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wide mb-0.5">
            Unassigned
          </div>
          <ul className="flex flex-col gap-0.5">
            {unassigned.map(f => (
              <LithoUnitRow
                key={f.id}
                f={f}
                lithoContacts={lithoContacts}
                ordinalIsStale={ordinalIsStale}
                onToggleLock={onToggleLock}
                onReviewParent={onReviewParent}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
