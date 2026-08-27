// The unit list — the INSPECTOR half of the Parameters per-unit surface.
//
// Owner ruling R3 (2026-08-27, verbatim): "honestly i do not like the list
// view here. The statistics should be the main item, switch statistics and
// list from pane." The distribution statistics own the canvas; this pane is
// the roster the engineer picks from, and a row click is what drives the
// canvas (via ``coordinator.selectedParameterUnit``).
//
// WHICH ROSTER. Geotech units when the project has them (their bands are what
// the statistics pool); the litho roster otherwise, so a litho-only project
// never goes blank. Litho rows are SELECTABLE too (ruling R1): a litho scope
// pools the whole litho unit, every packing class inside it.
//
// TWO LEVELS (owner body-scope ruling 2026-08-27, verbatim: "a body is only a
// body if it is geometrically connected or if the users says, this body is
// the same as that body"). A unit row is a formation row that LUMPS many
// resolver bodies; under it sit its body rows — labelled the way the 3-D
// legend names bodies — and clicking one scopes the canvas to that ONE body.
// The unit row itself stays the pooled scope. A unit with a single body needs
// no expander (the GT3 single-instance precedent: nothing to tell apart).
//
// The old table's φ′/c′/cu/E50 dash columns became the compact Phase-5 note
// at the foot of the pane — the information survives, the dead cells do not
// (R3: "the φ'/c′/cu/E50 dash columns can become a compact hint").

import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Layers } from 'lucide-react'

import { geotechUnitColor, geotechUnitLabel } from '../../../utils/nadClasses'
import {
  buildSourceLithoNameMap,
  sourceLithoNameOf,
} from '../../../utils/sourceLithoNames'
import { EmptyState, LoadingState } from '../../EmptyState'
import { useShell } from '../../ShellContext'
import type { ParameterUnitScope, ParameterUnitScopeKind } from '../../ShellContext'
import { unitBodyRows, type ParameterUnitBodyRow } from './parameterUnitBodies'
import { useModelBodies } from './useModelBodies'

/**
 * Unit roster for the Parameters inspector.
 *
 * Takes no props — state is sourced from ``useShell()`` (rendered from
 * ``ParametersInspector``, which is itself a no-props stage slot).
 *
 * Returns
 * -------
 * JSX.Element
 *     The list, or an empty state when the project has no units at all.
 */
export default function UnitListPane(): JSX.Element {
  const {
    project,
    geoModel: {
      lithoFormations,
      lithoLayers,
      geotechFormations,
      geotechLayers,
      geotechLayersLoaded,
      activeLithoModel,
      activeGeotechModel,
    },
    coordinator: {
      selectedParameterUnit,
      setSelectedParameterUnit,
      bodyRecomputeLithoNonce,
      bodyRecomputeGeotechNonce,
    },
  } = useShell()

  // Accepted bands per unit — same rule as everywhere a band is counted (the
  // Geotech-units pane, ``unitCptBands``): a pending proposal is not ground.
  const bandCountByUnitId = useMemo<Map<string, number>>(() => {
    const counts = new Map<string, number>()
    for (const layer of geotechLayers ?? []) {
      if (layer.status !== 'accepted') continue
      counts.set(layer.formation_id, (counts.get(layer.formation_id) ?? 0) + 1)
    }
    return counts
  }, [geotechLayers])

  const sourceLithoNameById = useMemo(
    () => buildSourceLithoNameMap(lithoFormations),
    [lithoFormations],
  )

  // A unit with no accepted bands describes nothing and is not listed — the
  // owner's empty-jars ruling (2026-08-26); the orphan sweep deletes these
  // shortly in any case.
  const geotechUnits = useMemo(
    () => (geotechFormations ?? []).filter(u => (bandCountByUnitId.get(u.id) ?? 0) > 0),
    [geotechFormations, bandCountByUnitId],
  )

  // F12 — gate on the LOADED flag: while the geotech layers are in flight the
  // empty array reads as "no geotech units", which flashed the litho roster
  // and then swapped it out. ``geotechLayersLoaded`` is true on a project
  // with NO geotech model ("a known state"), so litho-only projects are
  // never blocked.
  const usingGeotech = geotechLayersLoaded && geotechUnits.length > 0

  // The body level. The layers of the roster IN USE carry the resolver's
  // ``body_id``; the roster fetch supplies homes + labels (formation_id /
  // name / #ordinal — the 3-D legend's naming), so a missing roster degrades
  // to per-layer rows, never to a blocked pane.
  const rosterLayers = usingGeotech ? (geotechLayers ?? []) : (lithoLayers ?? [])
  const rosterModelId = usingGeotech
    ? (activeGeotechModel?.id ?? null)
    : (activeLithoModel?.id ?? null)
  const bodiesById = useModelBodies(
    project?.id ?? null,
    rosterModelId,
    // F9: body stamps (and F1's homes) move on recompute — follow them.
    usingGeotech ? bodyRecomputeGeotechNonce : bodyRecomputeLithoNonce,
  )
  const bodyRowsByUnitId = useMemo<Map<string, ParameterUnitBodyRow[]>>(() => {
    const out = new Map<string, ParameterUnitBodyRow[]>()
    const unitIds = usingGeotech ? geotechUnits.map(u => u.id) : lithoFormations.map(u => u.id)
    for (const unitId of unitIds) {
      out.set(unitId, unitBodyRows(rosterLayers, unitId, bodiesById))
    }
    return out
  }, [usingGeotech, geotechUnits, lithoFormations, rosterLayers, bodiesById])

  // Which unit rows are expanded. A body-scoped SELECTION keeps its unit open
  // regardless (the scoped row must be visible without a hunt).
  const [expandedUnitIds, setExpandedUnitIds] = useState<ReadonlySet<string>>(new Set())
  const toggleExpanded = (unitId: string): void => {
    setExpandedUnitIds(prev => {
      const next = new Set(prev)
      if (next.has(unitId)) next.delete(unitId)
      else next.add(unitId)
      return next
    })
  }

  // F12 — while the geotech layers are loading (or their load failed) the
  // roster CHOICE is unknown: showing the litho roster now and swapping it
  // the moment the layers land is the flash the loaded-flag gate exists to
  // prevent. Honest loading instead. (After every hook — no early-return
  // hook-order trap.)
  if (!geotechLayersLoaded) {
    return (
      <div className="py-6" data-testid="parameters-unit-list-loading">
        <LoadingState label="Loading the unit roster…" />
      </div>
    )
  }

  if (geotechUnits.length === 0 && lithoFormations.length === 0) {
    return (
      <EmptyState
        icon={<Layers />}
        title="No units yet"
        hint="Build a lithostratigraphic model on the Lithology stage, then subdivide it on the Geotechnical stage — the units will populate here."
      />
    )
  }

  const selectedBodyId = selectedParameterUnit?.bodyId ?? null
  const isUnitSelected = (kind: ParameterUnitScopeKind, unitId: string): boolean =>
    selectedParameterUnit?.kind === kind &&
    selectedParameterUnit.unitId === unitId &&
    selectedBodyId === null
  const isBodySelected = (
    kind: ParameterUnitScopeKind,
    unitId: string,
    bodyId: string,
  ): boolean =>
    selectedParameterUnit?.kind === kind &&
    selectedParameterUnit.unitId === unitId &&
    selectedBodyId === bodyId
  const isExpanded = (kind: ParameterUnitScopeKind, unitId: string): boolean =>
    expandedUnitIds.has(unitId) ||
    (selectedParameterUnit?.kind === kind &&
      selectedParameterUnit.unitId === unitId &&
      selectedBodyId !== null)

  /** The unit row + its body rows, shared by both rosters. */
  const renderUnitWithBodies = (
    kind: ParameterUnitScopeKind,
    unitId: string,
    unitRow: JSX.Element,
  ): JSX.Element => {
    const bodies = bodyRowsByUnitId.get(unitId) ?? []
    // GT3 precedent: one body has nothing to tell apart — no expander, no
    // sub-rows; the unit row IS that body's pooled view.
    const expandable = bodies.length > 1
    const expanded = expandable && isExpanded(kind, unitId)
    return (
      // role="presentation" on both wrappers so the listbox's owned options
      // stay the unit + body rows themselves, not these grouping nodes.
      <li key={`${kind}-${unitId}`} role="presentation" className="list-none">
        <ul role="presentation" className="m-0 p-0">
          {unitRow}
          {expanded &&
            bodies.map(body => (
              <BodyRow
                key={body.bodyId}
                body={body}
                selected={isBodySelected(kind, unitId, body.bodyId)}
                onSelect={() => setSelectedParameterUnit({ kind, unitId, bodyId: body.bodyId })}
              />
            ))}
        </ul>
      </li>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0" data-testid="parameters-unit-list">
      <div className="px-3 py-2 border-b border-border-subtle shrink-0">
        <div className="text-[10px] uppercase tracking-wide text-text-muted">
          {usingGeotech ? 'Geotechnical units' : 'Lithostratigraphic units'}
        </div>
      </div>

      {/* F12 — a LITHO-scoped selection while the geotech roster shows has no
          row to highlight; without this chip the active selection is
          invisible. Read-only: the deep-link/canvas own the scope. */}
      {usingGeotech && selectedParameterUnit?.kind === 'litho' && (
        <div
          className="px-3 py-1 border-b border-border-subtle shrink-0 text-[10px] text-text-secondary bg-surface-sunken/40"
          data-testid="parameters-litho-selection-chip"
        >
          Litho unit selected —{' '}
          {lithoFormations.find(f => f.id === selectedParameterUnit.unitId)?.name ?? 'unnamed'}
        </div>
      )}

      <ul
        role="listbox"
        aria-label="Units"
        className="flex-1 min-h-0 overflow-auto"
      >
        {usingGeotech
          ? geotechUnits.map(u => {
              const sourceLithoName = sourceLithoNameOf(u, sourceLithoNameById)
              const bands = bandCountByUnitId.get(u.id) ?? 0
              return renderUnitWithBodies(
                'geotech',
                u.id,
                <UnitRow
                  key={u.id}
                  scope={{ kind: 'geotech', unitId: u.id }}
                  selected={isUnitSelected('geotech', u.id)}
                  color={geotechUnitColor(u)}
                  label={geotechUnitLabel(u, sourceLithoName)}
                  onSelect={setSelectedParameterUnit}
                  expandable={(bodyRowsByUnitId.get(u.id)?.length ?? 0) > 1}
                  expanded={isExpanded('geotech', u.id)}
                  onToggleExpand={() => toggleExpanded(u.id)}
                >
                  <span>
                    {u.nad_class !== null ? `NAD ${u.nad_class}` : 'unclassified'}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span data-testid={`parameters-unit-source-${u.id}`}>
                    {sourceLithoName ?? '—'}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span data-testid={`parameters-unit-bands-${u.id}`}>
                    {bands} band{bands === 1 ? '' : 's'}
                  </span>
                </UnitRow>,
              )
            })
          : lithoFormations.map(u =>
              renderUnitWithBodies(
                'litho',
                u.id,
                <UnitRow
                  key={u.id}
                  scope={{ kind: 'litho', unitId: u.id }}
                  selected={isUnitSelected('litho', u.id)}
                  color={u.color ?? '#94a3b8'}
                  label={u.name ?? '—'}
                  onSelect={setSelectedParameterUnit}
                  expandable={(bodyRowsByUnitId.get(u.id)?.length ?? 0) > 1}
                  expanded={isExpanded('litho', u.id)}
                  onToggleExpand={() => toggleExpanded(u.id)}
                >
                  <span>{u.parent_formation_name ?? 'Unassigned'}</span>
                </UnitRow>,
              ),
            )}
      </ul>

      <div className="px-3 py-2 text-[10px] text-text-muted border-t border-border-subtle shrink-0">
        <div>
          {usingGeotech
            ? `${geotechUnits.length} geotechnical unit${geotechUnits.length === 1 ? '' : 's'} · click a row to see its statistics in the canvas.`
            : `${lithoFormations.length} lithostratigraphic unit${lithoFormations.length === 1 ? '' : 's'} · click a row to pool its whole ground; subdivide on the Geotechnical stage for per-packing statistics.`}
        </div>
        {/* The Phase-5 note the old dash columns carried — still visible. */}
        <div className="mt-1" data-testid="parameters-unit-phase5-note">
          φ′ · c′ · cu · E50 — design parameters populate in Phase 5, when the
          correlation + NAD-NEN lookup pipeline lands.
        </div>
      </div>
    </div>
  )
}

/** One selectable unit row. */
function UnitRow({
  scope,
  selected,
  color,
  label,
  onSelect,
  expandable = false,
  expanded = false,
  onToggleExpand,
  children,
}: {
  scope: ParameterUnitScope
  selected: boolean
  color: string
  label: string
  onSelect: (scope: ParameterUnitScope) => void
  /** True when the unit lumps ≥2 bodies — the only case an expander exists. */
  expandable?: boolean
  expanded?: boolean
  onToggleExpand?: () => void
  children: React.ReactNode
}): JSX.Element {
  return (
    <li
      role="option"
      aria-selected={selected}
      // F11 (WCAG listbox rules): expandedness lives on the OPTION itself;
      // an expandable option states it, a leaf option states nothing.
      aria-expanded={expandable ? expanded : undefined}
      tabIndex={0}
      onClick={() => onSelect(scope)}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(scope)
        }
        // F11 — the keyboard path to the body level: the tree/listbox idiom
        // (ArrowRight expands, ArrowLeft collapses), since the expander
        // affordance is deliberately not focusable.
        if (expandable && e.key === 'ArrowRight' && !expanded) {
          e.preventDefault()
          onToggleExpand?.()
        }
        if (expandable && e.key === 'ArrowLeft' && expanded) {
          e.preventDefault()
          onToggleExpand?.()
        }
      }}
      className={
        'px-3 py-1.5 border-b border-border-subtle cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent ' +
        (selected ? 'bg-surface-sunken' : 'hover:bg-surface-sunken/40')
      }
      data-testid={`parameters-unit-${scope.unitId}`}
    >
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-text-primary">
        {/* The expander is a sibling gesture, not the row's: it must not
            change the scope, so its click stops before the row handler.
            F11: a SPAN, not a button — a focusable descendant inside a
            ``role="option"`` breaks the listbox contract; the option itself
            carries aria-expanded and the arrow keys, so this stays a purely
            visual mouse affordance (hidden from assistive tech). */}
        {expandable && (
          <span
            aria-hidden="true"
            data-testid={`parameters-unit-expander-${scope.unitId}`}
            onClick={e => {
              e.stopPropagation()
              onToggleExpand?.()
            }}
            className="shrink-0 -ml-1 p-0.5 rounded text-text-muted hover:text-text-primary hover:bg-surface-app"
          >
            {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </span>
        )}
        <span
          aria-hidden="true"
          className="inline-block w-2 h-2 rounded-sm shrink-0"
          style={{ background: color }}
        />
        <span className="truncate">{label}</span>
      </div>
      <div className="flex items-center gap-1 pl-3.5 text-[10px] text-text-secondary tabular-nums">
        {children}
      </div>
    </li>
  )
}

/** One selectable body row under a unit row (the body-scope ruling). */
function BodyRow({
  body,
  selected,
  onSelect,
}: {
  body: ParameterUnitBodyRow
  selected: boolean
  onSelect: () => void
}): JSX.Element {
  return (
    <li
      role="option"
      aria-selected={selected}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      className={
        'pl-8 pr-3 py-1 border-b border-border-subtle cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent ' +
        (selected ? 'bg-surface-sunken' : 'hover:bg-surface-sunken/40')
      }
      data-testid={`parameters-unit-body-${body.bodyId}`}
    >
      <div className="flex items-center gap-1.5 text-[10px] text-text-primary">
        <span className="font-medium truncate">{body.label}</span>
        <span className="ml-auto shrink-0 text-text-secondary tabular-nums">
          {/* F7: "N bands · M with cone" — how many of the body's bands the
              cone pool can read, so borehole-heavy bodies read honestly. */}
          {body.bandCount} band{body.bandCount === 1 ? '' : 's'}
          {' · '}
          {body.cptBandCount} with cone
        </span>
      </div>
    </li>
  )
}
