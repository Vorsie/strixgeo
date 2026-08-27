// Per-unit tab — the scoped unit's STATISTICS as the main canvas content.
//
// Owner ruling R3 (2026-08-27, verbatim): "honestly i do not like the list
// view here. The statistics should be the main item, switch statistics and
// list from pane." The roster that used to be this tab lives in
// ``UnitListPane`` (the inspector); a row click there — or a section's "Unit
// statistics…" deep link — writes ``coordinator.selectedParameterUnit``, and
// this tab draws that unit via ``UnitStatisticsCanvas``.
//
// Phase 5 fills in (unchanged direction from the old table):
//   - Derived design parameters (φ′ / c′ / cu / E50 / OCR / Vs / G0 / M) —
//     each carrying a method tag (Robertson 1986, Mayne 2007, Kulhawy 2014,
//     Uzielli 2013, NAD-NEN xlsx lookup, ...).
//   - Per-cell method override, probabilistic-distribution editor, ML/AI
//     suggestion audit surface (no auto-apply, ever).

import { Layers, MousePointerClick } from 'lucide-react'

import { EmptyState } from '../../../EmptyState'
import { useShell } from '../../../ShellContext'
import UnitStatisticsCanvas from '../UnitStatisticsCanvas'

export default function PerUnitTab(): JSX.Element {
  const {
    geoModel: { lithoFormations, geotechFormations },
    coordinator: { selectedParameterUnit },
  } = useShell()

  if (selectedParameterUnit !== null) {
    return <UnitStatisticsCanvas scope={selectedParameterUnit} />
  }

  if ((geotechFormations ?? []).length === 0 && lithoFormations.length === 0) {
    return (
      <EmptyState
        icon={<Layers />}
        title="No units yet"
        hint="Build a lithostratigraphic model on the Lithology stage, then subdivide it on the Geotechnical stage — the units will populate here with their statistics."
        compact={false}
      />
    )
  }

  // Wrapped for addressability — ``EmptyState`` takes no testid.
  return (
    <div data-testid="parameters-unit-pick-hint" className="h-full">
      <EmptyState
        icon={<MousePointerClick />}
        title="Pick a unit"
        hint="Click a unit in the list on the right — its qc / fs / Rf statistics draw here. Right-clicking a band in a cross-section jumps here too."
        compact={false}
      />
    </div>
  )
}
