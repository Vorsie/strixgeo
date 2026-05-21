// Per-unit tab — table of every litho / geotechnical unit in the
// project; columns aggregate parameters over the unit.
//
// Populated TODAY:
//   - Unit roster from useShell().geoModel.lithoFormations (when the
//     project has a litho model). Each row shows the unit name + the
//     parent geological formation name (server-resolved per debt #67).
//
// Phase 5 fills in:
//   - Statistics columns: mean / std / P50 / P95 of qc (across the
//     CPTs intersecting the unit), mean Ic, dominant SBT zone.
//   - Derived design parameters (φ′ / c′ / cu / E50 / OCR / Vs / G0 /
//     M) — each cell carries a method tag (Robertson 1986, Mayne
//     2007, Kulhawy 2014, Uzielli 2013, NAD-NEN xlsx lookup, ...).
//   - Per-cell method override: opens the methods picker scoped to
//     this (unit, parameter) pair.
//   - Raincloud plot of the parameter distribution across all
//     tests inside the unit (click a row to expand).
//   - Probabilistic-distribution editor: deterministic scalar vs
//     μ ± σ with distribution type (Normal / Lognormal / Beta) for
//     downstream probabilistic design tools.
//   - ML/AI suggestion column: highlights when the model's prediction
//     diverges from the correlation/xlsx choice — surfaced for the
//     engineer to audit (no auto-apply, ever — owner directive on
//     ML rigour).

import { Layers } from 'lucide-react'

import { EmptyState } from '../../../EmptyState'
import { useShell } from '../../../ShellContext'

export default function PerUnitTab(): JSX.Element {
  const {
    geoModel: { lithoFormations },
  } = useShell()

  if (lithoFormations.length === 0) {
    return (
      <EmptyState
        icon={<Layers />}
        title="No units yet"
        hint="Build a lithostratigraphic model on the Lithology stage — its units will populate here with their aggregate parameters."
        compact={false}
      />
    )
  }

  return (
    <div className="h-full overflow-auto">
      <table className="w-full text-[11px] border-collapse">
        <thead className="sticky top-0 bg-surface-sunken text-text-secondary">
          <tr className="border-b border-border-subtle">
            <th className="px-2 py-1.5 text-left font-medium">Unit</th>
            <th className="px-2 py-1.5 text-left font-medium">Parent formation</th>
            <th className="px-2 py-1.5 text-left font-medium">NAD class</th>
            {/* Statistics columns — Phase 5 fills in the values. */}
            <PhaseFiveHeader label="qc̄ (MPa)" />
            <PhaseFiveHeader label="qc P50" />
            <PhaseFiveHeader label="qc P95" />
            <PhaseFiveHeader label="Ic̄" />
            {/* Design parameters — Phase 5 fills in the values. */}
            <PhaseFiveHeader label="φ′" />
            <PhaseFiveHeader label="c′" />
            <PhaseFiveHeader label="cu" />
            <PhaseFiveHeader label="E50" />
          </tr>
        </thead>
        <tbody>
          {lithoFormations.map(u => (
            <tr
              key={u.id}
              className="border-b border-border-subtle hover:bg-surface-sunken/40"
              data-testid={`parameters-unit-${u.id}`}
            >
              <td className="px-2 py-1 font-medium">{u.name ?? '—'}</td>
              <td className="px-2 py-1 text-text-secondary">
                {u.parent_formation_name ?? <span className="text-text-muted">Unassigned</span>}
              </td>
              <td className="px-2 py-1 text-text-secondary">
                {u.nad_class ?? <span className="text-text-muted">—</span>}
              </td>
              <PhaseFiveCell />
              <PhaseFiveCell />
              <PhaseFiveCell />
              <PhaseFiveCell />
              <PhaseFiveCell />
              <PhaseFiveCell />
              <PhaseFiveCell />
              <PhaseFiveCell />
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-3 py-2 text-[10px] text-text-muted border-t border-border-subtle">
        {lithoFormations.length} unit
        {lithoFormations.length === 1 ? '' : 's'} · Phase-5 columns
        muted until the correlation + xlsx pipeline lands. Click any
        row (when wired) to open the raincloud plot of source data
        intersecting this unit + per-correlation comparison +
        probabilistic distribution editor.
      </div>
    </div>
  )
}

function PhaseFiveHeader({ label }: { label: string }): JSX.Element {
  return (
    <th
      className="px-2 py-1.5 text-left font-medium text-text-muted opacity-60"
      title="Phase-5 aggregate — populated when the correlation / xlsx pipeline lands."
    >
      {label}
    </th>
  )
}

function PhaseFiveCell(): JSX.Element {
  return <td className="px-2 py-1 text-text-muted opacity-50">—</td>
}
