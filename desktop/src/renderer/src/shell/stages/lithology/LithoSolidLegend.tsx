// Lithology inspector — per-body colour pickers grouped by lithology
// (LithoSolidLegend).
//
// Extracted verbatim from LithologyInspector.tsx (debt #201 god-component
// decomposition round). This is the largest single block of the old
// orchestrator (~330 lines). It owns its OWN presentational state — the
// per-group expand/collapse Set and the "open small groups once solids arrive"
// effect — which moves with it unchanged; the parent still owns the model, the
// solids, the colour setter, and the hide-markers flag.

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Eye, EyeOff, RotateCcw } from 'lucide-react'

import type {
  GeologicalFormationResponse,
  LithoBodySolidResponse,
} from '../../../api/client'
import { formationUnitDisplayName } from '../../../utils/formationUnitDisplayName'
import type { Translator } from '../../../i18n/translate'

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
export default function LithoSolidLegend({
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
          ? formationUnitDisplayName(formation)
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
