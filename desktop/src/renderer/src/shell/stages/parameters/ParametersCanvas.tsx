// Parameters stage canvas — three tabs.
//
// Owner directive 2026-05-21: a single stage hosts THREE views of the
// same parameter data so the engineer flips between them without
// losing context.
//
//   1. Per-test — table of CPTs/boreholes (and Phase 5: lab tests).
//      Rows are tests, columns are computed parameters. Click a row
//      to expand for raincloud/distribution plots + per-correlation
//      comparison + probabilistic/ML override surface.
//
//   2. Per-unit — table of lithostratigraphic / geotechnical units.
//      Rows are units, columns are aggregate parameters (mean / P50 /
//      P95 of qc, derived φ′/c′/cu/E50/Vs, ...). Same column set as
//      per-test, aggregated.
//
//   3. Methods — HARD-SEPARATED method picker:
//        • Correlations (formula-driven: Robertson 1986, Mayne 2007,
//          Kulhawy 2014, Uzielli 2013, ...)
//        • Excel lookups (table-driven: NAD-NEN xlsx, project-specific
//          imports)
//      Plus future surfaces:
//        • Probabilistic distributions (deterministic vs μ±σ, plus
//          distribution type — for probabilistic design downstream).
//        • ML/AI suggestion hooks (structural slot; model audited
//          per memory/project_litho_geotech_three_level_model.md
//          before any pipeline ships).
//      The two method families never mix in one cell — the engineer
//      picks ONE path per (parameter, unit). Comparison view shows
//      both side-by-side for sanity checking.

import { useState } from 'react'
import { BarChart3, Beaker, Sliders, Sparkles } from 'lucide-react'

import { EmptyState } from '../../EmptyState'
import TabBar from '../../../components/ui/TabBar'
import type { TabSpec } from '../../../components/ui/TabBar'
import MethodConfigTab from './tabs/MethodConfigTab'
import PerTestTab from './tabs/PerTestTab'
import PerUnitTab from './tabs/PerUnitTab'

type TabId = 'per-test' | 'per-unit' | 'methods'

// TabSpec is the imported type from TabBar; cast id to TabId for type safety.
const TABS: readonly (TabSpec & { id: TabId; iconComponent: typeof Beaker })[] = [
  {
    id: 'per-test',
    label: 'Per test',
    iconComponent: Beaker,
    hint: 'One row per CPT / borehole / lab test; columns are parameters.',
    testid: 'parameters-tab-per-test',
  },
  {
    id: 'per-unit',
    label: 'Per unit',
    iconComponent: BarChart3,
    hint: 'One row per litho / geotechnical unit; columns aggregate over the unit (mean / P50 / P95 / derived values).',
    testid: 'parameters-tab-per-unit',
  },
  {
    id: 'methods',
    label: 'Methods',
    iconComponent: Sliders,
    hint: 'Correlations (formula) vs Excel lookups (NAD-NEN table) — hard-separated. Plus probabilistic + ML hooks.',
    testid: 'parameters-tab-methods',
  },
] as const

/**
 * Canvas for the Parameters stage — switches between three tabs.
 *
 * Currently shipped:
 *   - Per-test inventory table (populates from the shell's
 *     ``investigations.cpts`` + ``.boreholes`` slices).
 *   - Per-unit structural skeleton (populates from
 *     ``geoModel.lithoFormations`` when present).
 *   - Methods structural skeleton with the hard-separated
 *     correlation / xlsx layout.
 *
 * Phase 5 fills in: per-correlation math, statistics widgets,
 * raincloud plots, NAD-NEN xlsx ingestion + lookup, probabilistic
 * distributions, ML/AI hook stubs.
 */
export default function ParametersCanvas(): JSX.Element {
  const [tab, setTab] = useState<TabId>('per-test')

  return (
    <div className="flex flex-col h-full bg-surface-app text-text-primary">
      {/* Tab bar — uses the shared TabBar primitive for accessible role="tablist"
          + Arrow-key navigation. The aria-controls id prefix "tab-panel-" is
          the TabBar convention; panel divs below use matching ids. */}
      <div className="flex items-center border-b border-border-subtle bg-surface-sunken">
        <TabBar
          tabs={TABS.map(spec => ({
            id: spec.id,
            label: spec.label,
            icon: <spec.iconComponent size={13} aria-hidden="true" />,
            hint: spec.hint,
            testid: spec.testid,
          }))}
          activeId={tab}
          onActivate={id => setTab(id as TabId)}
          ariaLabel="Parameter views"
          containerClassName="flex items-center gap-0"
          tabClassName="px-3 py-2 text-[11px] border-b-2 transition-colors aria-selected:border-b-status-amber aria-selected:text-text-primary aria-selected:bg-surface-app aria-[selected=false]:border-b-transparent aria-[selected=false]:text-text-secondary aria-[selected=false]:hover:text-text-primary aria-[selected=false]:hover:bg-surface-app/60"
        />
        <div className="ml-auto flex items-center gap-1.5 px-3 py-2 text-[10px] text-text-muted">
          <Sparkles size={11} aria-hidden="true" />
          <span>
            Phase-5 surface — design-ready parameters (φ′ / c′ / cu /
            E50 / OCR / Vs / G0 / M) populate as correlations and
            lookups land.
          </span>
        </div>
      </div>

      {/* Tab panel */}
      <div className="flex-1 min-h-0 overflow-auto">
        {tab === 'per-test' && (
          <div
            id="tab-panel-per-test"
            role="tabpanel"
            data-testid="parameters-panel-per-test"
            className="h-full"
          >
            <PerTestTab />
          </div>
        )}
        {tab === 'per-unit' && (
          <div
            id="tab-panel-per-unit"
            role="tabpanel"
            data-testid="parameters-panel-per-unit"
            className="h-full"
          >
            <PerUnitTab />
          </div>
        )}
        {tab === 'methods' && (
          <div
            id="tab-panel-methods"
            role="tabpanel"
            data-testid="parameters-panel-methods"
            className="h-full"
          >
            <MethodConfigTab />
          </div>
        )}
        {/* Defensive fallback — should be unreachable since `tab` is
            constrained to TabId, but TypeScript-narrowing helpers can
            drift; an empty-state beats a blank panel. */}
        {!['per-test', 'per-unit', 'methods'].includes(tab) && (
          <EmptyState
            icon={<Beaker />}
            title="Unknown parameters tab"
            hint="Pick a tab above."
          />
        )}
      </div>
    </div>
  )
}
