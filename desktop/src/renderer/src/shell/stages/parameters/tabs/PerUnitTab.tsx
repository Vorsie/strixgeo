// Per-unit tab — one row per unit in the project; the row click scopes the
// stage's inspector to that unit's measurements.
//
// WHICH ROSTER. The tab lists GEOTECH units when the project has them, and
// falls back to the litho roster when it does not. The header always promised
// "litho / geotechnical units" with a NAD-class column, but it listed only
// litho units, whose ``nad_class`` is null by definition — so the column read
// "—" on every row of every project. The bands the statistics are computed
// over hang off geotech units (``litho_layer`` rows in the geotech model), so
// listing those is both what the column meant and what the plots need. A
// litho-only project keeps the old roster rather than going blank.
//
// Populated TODAY:
//   - Geotech unit roster: label (via ``geotechUnitLabel`` — never blank, per
//     the 11b ruling), NAD class, source litho unit, band count.
//   - Click a row → the inspector draws the distribution of qc / fs / Rf over
//     exactly the CPT intervals inside that unit's bands (owner ballot
//     2026-08-26). Those are CHARACTERISATION outputs; the inspector says so.
//
// Phase 5 fills in:
//   - Derived design parameters (φ′ / c′ / cu / E50 / OCR / Vs / G0 / M) —
//     each cell carrying a method tag (Robertson 1986, Mayne 2007, Kulhawy
//     2014, Uzielli 2013, NAD-NEN xlsx lookup, ...).
//   - Per-cell method override: opens the methods picker scoped to this
//     (unit, parameter) pair.
//   - Probabilistic-distribution editor: deterministic scalar vs μ ± σ with a
//     distribution type, for downstream probabilistic design tools.
//   - ML/AI suggestion column: highlights when the model's prediction diverges
//     from the correlation/xlsx choice — surfaced for the engineer to audit
//     (no auto-apply, ever — owner directive on ML rigour).

import { useMemo } from 'react'
import { Layers } from 'lucide-react'

import { EmptyState } from '../../../EmptyState'
import { useShell } from '../../../ShellContext'
import { geotechUnitColor, geotechUnitLabel } from '../../../../utils/nadClasses'
import {
  buildSourceLithoNameMap,
  sourceLithoNameOf,
} from '../../../../utils/sourceLithoNames'

export default function PerUnitTab(): JSX.Element {
  const {
    geoModel: { lithoFormations, geotechFormations, geotechLayers },
    coordinator: { selectedParameterUnitId, setSelectedParameterUnitId },
  } = useShell()

  // Bands per unit. Counted from the model's own layer list rather than a
  // server aggregate so the number moves the moment a band edit lands.
  //
  // ACCEPTED only. The layer list arrives unfiltered (``listLayers`` is called
  // without a status filter), and a band is an accepted contact everywhere else
  // that counts one — the Geotech-units pane, and ``unitCptBands`` feeding the
  // statistics. Counting a pending proposal here would list a unit as having
  // ground and then show it with nothing in it.
  const bandCountByUnitId = useMemo<Map<string, number>>(() => {
    const counts = new Map<string, number>()
    for (const layer of geotechLayers ?? []) {
      if (layer.status !== 'accepted') continue
      counts.set(layer.formation_id, (counts.get(layer.formation_id) ?? 0) + 1)
    }
    return counts
  }, [geotechLayers])

  // A geotech unit's ``parent_formation_name`` is ALWAYS null — the server
  // resolves that from ``parent_formation_id``, which the geotech materialiser
  // never sets. The source litho unit is reached through
  // ``source_litho_formation_id`` instead, exactly as the Geotech-units pane
  // does it.
  const sourceLithoNameById = useMemo(
    () => buildSourceLithoNameMap(lithoFormations),
    [lithoFormations],
  )

  // A unit that describes NOTHING in this model is not listed — the owner's
  // ruling on the Geotech-units pane (2026-08-26): *"if a bin is empty that
  // means there is nothing in it and nothing exists"*. The orphan sweep
  // deletes these shortly in any case, so a row here would be a row for
  // something already on its way out.
  //
  // "Empty" means NO BANDS, not "no NAD class" and not "no CPT bands": an
  // unclassified unit with real bands is unclassified GROUND and belongs in
  // the list, and so does a borehole-only unit — it simply has no cone to
  // summarise, which the panel says in its own words rather than by vanishing.
  const geotechUnits = useMemo(
    () => (geotechFormations ?? []).filter(u => (bandCountByUnitId.get(u.id) ?? 0) > 0),
    [geotechFormations, bandCountByUnitId],
  )

  if (geotechUnits.length === 0 && lithoFormations.length === 0) {
    return (
      <EmptyState
        icon={<Layers />}
        title="No units yet"
        hint="Build a lithostratigraphic model on the Lithology stage, then subdivide it on the Geotechnical stage — the units will populate here with their aggregate parameters."
        compact={false}
      />
    )
  }

  // ── Litho fallback — a project that has not reached the geotech stage ─────
  if (geotechUnits.length === 0) {
    return (
      <div className="h-full overflow-auto">
        <table className="w-full text-[11px] border-collapse">
          <thead className="sticky top-0 bg-surface-sunken text-text-secondary">
            <tr className="border-b border-border-subtle">
              <th className="px-2 py-1.5 text-left font-medium">Unit</th>
              <th className="px-2 py-1.5 text-left font-medium">Parent formation</th>
              <th className="px-2 py-1.5 text-left font-medium">NAD class</th>
              <PhaseFiveHeader label="qc̄ (MPa)" />
              <PhaseFiveHeader label="qc P50" />
              <PhaseFiveHeader label="qc P95" />
              <PhaseFiveHeader label="Ic̄" />
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
          {lithoFormations.length} lithostratigraphic unit
          {lithoFormations.length === 1 ? '' : 's'} · subdivide them on the
          Geotechnical stage to get per-unit measurement statistics here.
        </div>
      </div>
    )
  }

  // ── Geotech roster — the rows the statistics attach to ────────────────────
  return (
    <div className="h-full overflow-auto">
      <table className="w-full text-[11px] border-collapse">
        <thead className="sticky top-0 bg-surface-sunken text-text-secondary">
          <tr className="border-b border-border-subtle">
            <th className="px-2 py-1.5 text-left font-medium">Unit</th>
            <th className="px-2 py-1.5 text-left font-medium">NAD class</th>
            <th className="px-2 py-1.5 text-left font-medium">Source litho unit</th>
            <th className="px-2 py-1.5 text-right font-medium">Bands</th>
            {/* Design parameters — Phase 5 fills in the values. */}
            <PhaseFiveHeader label="φ′" />
            <PhaseFiveHeader label="c′" />
            <PhaseFiveHeader label="cu" />
            <PhaseFiveHeader label="E50" />
          </tr>
        </thead>
        <tbody>
          {geotechUnits.map(u => {
            const isSelected = selectedParameterUnitId === u.id
            const sourceLithoName = sourceLithoNameOf(u, sourceLithoNameById)
            return (
              <tr
                key={u.id}
                className={
                  'border-b border-border-subtle cursor-pointer ' +
                  (isSelected ? 'bg-surface-sunken' : 'hover:bg-surface-sunken/40')
                }
                aria-selected={isSelected}
                onClick={() => setSelectedParameterUnitId(u.id)}
                data-testid={`parameters-unit-${u.id}`}
              >
                <td className="px-2 py-1 font-medium">
                  <span className="inline-flex items-center gap-1.5">
                    {/* The unit's own colour — the same rule every geotech
                        surface asks (an engineer's pick beats the NAD ramp). */}
                    <span
                      aria-hidden="true"
                      className="inline-block w-2 h-2 rounded-sm shrink-0"
                      style={{ background: geotechUnitColor(u) }}
                    />
                    {geotechUnitLabel(u, sourceLithoName)}
                  </span>
                </td>
                <td className="px-2 py-1 text-text-secondary tabular-nums">
                  {u.nad_class ?? <span className="text-text-muted">—</span>}
                </td>
                <td
                  className="px-2 py-1 text-text-secondary"
                  data-testid={`parameters-unit-source-${u.id}`}
                >
                  {sourceLithoName ?? <span className="text-text-muted">—</span>}
                </td>
                <td
                  className="px-2 py-1 text-right tabular-nums text-text-secondary"
                  data-testid={`parameters-unit-bands-${u.id}`}
                >
                  {bandCountByUnitId.get(u.id) ?? 0}
                </td>
                <PhaseFiveCell />
                <PhaseFiveCell />
                <PhaseFiveCell />
                <PhaseFiveCell />
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="px-3 py-2 text-[10px] text-text-muted border-t border-border-subtle">
        {geotechUnits.length} geotechnical unit
        {geotechUnits.length === 1 ? '' : 's'} · click a row to see the spread
        of qc, fs and Rf over that unit&apos;s bands in the inspector. Design
        parameters stay muted until the correlation + xlsx pipeline lands.
      </div>
    </div>
  )
}

function PhaseFiveHeader({ label }: { label: string }): JSX.Element {
  return (
    <th
      aria-disabled="true"
      aria-label={`${label} — Phase 5 (not yet available)`}
      className="px-2 py-1.5 text-left font-medium text-text-muted opacity-60"
      title="Phase-5 aggregate — populated when the correlation / xlsx pipeline lands."
    >
      {label}
    </th>
  )
}

function PhaseFiveCell(): JSX.Element {
  return (
    <td
      aria-disabled="true"
      aria-label="Phase 5 — not yet available"
      className="px-2 py-1 text-text-muted opacity-50"
    >
      —
    </td>
  )
}
