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
// The old table's φ′/c′/cu/E50 dash columns became the compact Phase-5 note
// at the foot of the pane — the information survives, the dead cells do not
// (R3: "the φ'/c′/cu/E50 dash columns can become a compact hint").

import { useMemo } from 'react'
import { Layers } from 'lucide-react'

import { geotechUnitColor, geotechUnitLabel } from '../../../utils/nadClasses'
import {
  buildSourceLithoNameMap,
  sourceLithoNameOf,
} from '../../../utils/sourceLithoNames'
import { EmptyState } from '../../EmptyState'
import { useShell } from '../../ShellContext'
import type { ParameterUnitScope } from '../../ShellContext'

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
    geoModel: { lithoFormations, geotechFormations, geotechLayers },
    coordinator: { selectedParameterUnit, setSelectedParameterUnit },
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

  if (geotechUnits.length === 0 && lithoFormations.length === 0) {
    return (
      <EmptyState
        icon={<Layers />}
        title="No units yet"
        hint="Build a lithostratigraphic model on the Lithology stage, then subdivide it on the Geotechnical stage — the units will populate here."
      />
    )
  }

  const usingGeotech = geotechUnits.length > 0

  return (
    <div className="flex flex-col h-full min-h-0" data-testid="parameters-unit-list">
      <div className="px-3 py-2 border-b border-border-subtle shrink-0">
        <div className="text-[10px] uppercase tracking-wide text-text-muted">
          {usingGeotech ? 'Geotechnical units' : 'Lithostratigraphic units'}
        </div>
      </div>

      <ul
        role="listbox"
        aria-label="Units"
        className="flex-1 min-h-0 overflow-auto"
      >
        {usingGeotech
          ? geotechUnits.map(u => {
              const scope: ParameterUnitScope = { kind: 'geotech', unitId: u.id }
              const sourceLithoName = sourceLithoNameOf(u, sourceLithoNameById)
              const bands = bandCountByUnitId.get(u.id) ?? 0
              return (
                <UnitRow
                  key={u.id}
                  scope={scope}
                  selected={
                    selectedParameterUnit?.kind === 'geotech' &&
                    selectedParameterUnit.unitId === u.id
                  }
                  color={geotechUnitColor(u)}
                  label={geotechUnitLabel(u, sourceLithoName)}
                  onSelect={setSelectedParameterUnit}
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
                </UnitRow>
              )
            })
          : lithoFormations.map(u => (
              <UnitRow
                key={u.id}
                scope={{ kind: 'litho', unitId: u.id }}
                selected={
                  selectedParameterUnit?.kind === 'litho' &&
                  selectedParameterUnit.unitId === u.id
                }
                color={u.color ?? '#94a3b8'}
                label={u.name ?? '—'}
                onSelect={setSelectedParameterUnit}
              >
                <span>{u.parent_formation_name ?? 'Unassigned'}</span>
              </UnitRow>
            ))}
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
  children,
}: {
  scope: ParameterUnitScope
  selected: boolean
  color: string
  label: string
  onSelect: (scope: ParameterUnitScope) => void
  children: React.ReactNode
}): JSX.Element {
  return (
    <li
      role="option"
      aria-selected={selected}
      tabIndex={0}
      onClick={() => onSelect(scope)}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(scope)
        }
      }}
      className={
        'px-3 py-1.5 border-b border-border-subtle cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent ' +
        (selected ? 'bg-surface-sunken' : 'hover:bg-surface-sunken/40')
      }
      data-testid={`parameters-unit-${scope.unitId}`}
    >
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-text-primary">
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
