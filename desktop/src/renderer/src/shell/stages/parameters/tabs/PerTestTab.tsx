// Per-test tab — table of every CPT / borehole in the project; columns
// are computed parameters.
//
// Owner ruling (dogfeed 2026-08-03) reshaped this tab twice:
//   * the inline expanded Ic/SBT chart is GONE — "all horizontal and squished";
//     a depth series reads TALL, so it moved to the stage's right inspector
//     (``ParametersInspector`` → ``CptSbtDepthPanels``);
//   * the "SBT (dominant)" column is GONE — a single dominant zone over a whole
//     profile is geotechnically meaningless. A CPT through 4 m of sand, 8 m of
//     clay and 3 m of sand has no dominant soil, it has a SEQUENCE, and the
//     sequence is what the strips in the inspector show.
//
// So a row click now SELECTS the CPT (``coordinator.handleSelectWithoutView``,
// which also warms the plot cache) and the inspector plots it. The
// WithoutView variant is deliberate: plain ``handleSelect`` also fires
// ``setView('chart')``, a Data-stage view mode, so plotting a CPT here would
// silently rewrite where the Data stage lands next time.
//
// Populated TODAY:
//   - Inventory columns (id, name, kind, depth, location).
//   - Ic̄ — mean Ic across the test's depth series, once ``/cpt/{id}/plot``
//     has been fetched into the plotMap ("—" otherwise).
//
// Phase 5 fills in (placeholder columns shown muted with "Phase 5"):
//   - φ′, c′, cu, E50, OCR, Vs, G0, M.
//   - The "method" tag per cell (Robertson 1986 / Mayne 2007 / Kulhawy
//     2014 / Uzielli 2013 / NAD-NEN xlsx / lab-derived / ML / manual).
//   - Cross-test comparison: shift-click rows to overlay raincloud
//     densities side-by-side.

import { useMemo, useRef, useState } from 'react'
import { ArrowUpDown, Beaker } from 'lucide-react'

import { EmptyState } from '../../../EmptyState'
import { useShell } from '../../../ShellContext'
import { useT } from '../../../../i18n/translate'

type Row = {
  id: string
  name: string
  kind: 'CPT' | 'Borehole'
  depth_m: number | null
  location_x: number
  location_y: number
  // Computed (today: Ic average from plotMap when fetched; null otherwise).
  ic_avg: number | null
}

type SortKey = 'name' | 'kind' | 'depth_m' | 'ic_avg'

export default function PerTestTab(): JSX.Element {
  const {
    investigations: { cpts, boreholes, plotMap },
    coordinator: { selectedId, handleSelectWithoutView },
  } = useShell()
  const t = useT()

  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortAsc, setSortAsc] = useState(true)

  // Derived-stats cache: { ic_avg } per CPT id.
  //
  // The filter+reduce pipeline is O(series_length) per CPT. Without a cache,
  // every setPlotMap(prev => new Map(prev).set(id, plot)) creates a new Map
  // reference and forces the rows useMemo to rerun the pipeline across ALL
  // previously-loaded CPTs — O(N × series) per selection.
  //
  // The ref persists across renders without triggering re-renders itself.
  type DerivedStats = { ic_avg: number | null }
  const derivedStatsCacheRef = useRef<Map<string, DerivedStats>>(new Map())

  // Derived stats useMemo — only computes for CPT ids not yet in the cache.
  // Returns the cache map (stable reference when nothing new was added).
  const derivedStatsByCpt = useMemo<Map<string, DerivedStats>>(() => {
    const cache = derivedStatsCacheRef.current
    let updated = false
    for (const [id] of plotMap) {
      if (cache.has(id)) continue
      const plot = plotMap.get(id)
      let icAvg: number | null = null
      if (plot && plot.ic && plot.ic.length > 0) {
        const vals = plot.ic.filter((v): v is number => v !== null && v > 0)
        if (vals.length > 0) {
          icAvg = vals.reduce((s, v) => s + v, 0) / vals.length
        }
      }
      cache.set(id, { ic_avg: icAvg })
      updated = true
    }
    // Return a new Map only when entries were added so rows useMemo can
    // detect the stable-vs-changed reference and skip recomputation.
    return updated ? new Map(cache) : cache
  }, [plotMap])

  const rows = useMemo<Row[]>(() => {
    const cptRows: Row[] = cpts.map(c => {
      // Read from the per-CPT cache — O(1), never recomputes a loaded series.
      const stats = derivedStatsByCpt.get(c.id) ?? { ic_avg: null }
      return {
        id: c.id,
        name: c.name,
        kind: 'CPT',
        depth_m: c.max_depth_m,
        location_x: c.location_x,
        location_y: c.location_y,
        ic_avg: stats.ic_avg,
      }
    })
    const bhRows: Row[] = boreholes.map(b => ({
      id: b.id,
      name: b.name,
      kind: 'Borehole',
      // BoreholeListItem doesn't carry a typed depth on the list shape;
      // Phase 5 will pull it from the detail tree or extend the list
      // item. Showing null is honest; faking from the detail would
      // diverge per-row depending on whether detailMap is hot.
      depth_m: null,
      location_x: b.location_x,
      location_y: b.location_y,
      ic_avg: null,
    }))
    const all = [...cptRows, ...bhRows]
    const cmp = (a: Row, b: Row): number => {
      const va = a[sortKey]
      const vb = b[sortKey]
      if (va === vb) return 0
      if (va === null || va === undefined) return 1
      if (vb === null || vb === undefined) return -1
      if (typeof va === 'number' && typeof vb === 'number') return va - vb
      return String(va).localeCompare(String(vb))
    }
    all.sort((a, b) => (sortAsc ? cmp(a, b) : -cmp(a, b)))
    return all
  }, [cpts, boreholes, derivedStatsByCpt, sortKey, sortAsc])

  function toggleSort(key: SortKey): void {
    if (sortKey === key) {
      setSortAsc(prev => !prev)
    } else {
      setSortKey(key)
      setSortAsc(true)
    }
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Beaker />}
        title={t('params.noTestsYet')}
        hint={t('params.noTestsHint')}
        compact={false}
      />
    )
  }

  // Clicking a CPT row selects it — ``handleSelectWithoutView`` fetches the
  // detail AND the plot series on demand, so the inspector plots it even on a
  // cold cache, without touching the Data stage's view mode.
  // Boreholes have no Ic series and no SBT profile, so their rows stay inert
  // rather than selecting something the inspector cannot draw.
  function handleRowClick(r: Row): void {
    if (r.kind !== 'CPT') return
    // The unit scope is deliberately NOT cleared here (changed with the R3
    // layout flip): unit statistics live on the per-UNIT tab now, so a chosen
    // unit and a chosen test no longer fight over one pane — and clearing
    // would throw away the engineer's unit pick every time they peek at a
    // hole.
    void handleSelectWithoutView(r.id)
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Scrollable table */}
      <div className="flex-1 min-h-0 overflow-auto">
        <table className="w-full text-[11px] border-collapse">
          <thead className="sticky top-0 bg-surface-sunken text-text-secondary">
            <tr className="border-b border-border-subtle">
              <SortableHeader
                label={t('common.name')}
                active={sortKey === 'name'}
                asc={sortAsc}
                onClick={() => toggleSort('name')}
              />
              <SortableHeader
                label={t('params.colKind')}
                active={sortKey === 'kind'}
                asc={sortAsc}
                onClick={() => toggleSort('kind')}
              />
              <SortableHeader
                label={t('params.colDepthM')}
                active={sortKey === 'depth_m'}
                asc={sortAsc}
                onClick={() => toggleSort('depth_m')}
              />
              {/* i18n-exempt: x / y are coordinate-axis symbols — domain canon */}
              <th className="px-2 py-1.5 text-left font-medium">x / y</th>
              <SortableHeader
                label={t('params.colIcBar')}
                active={sortKey === 'ic_avg'}
                asc={sortAsc}
                onClick={() => toggleSort('ic_avg')}
              />
              {/* Phase 5 columns — visible but muted so the engineer sees
                  the surface that will populate later. The labels are parameter
                  symbols (φ′ / c′ / cu / E50 / OCR / Vs) — domain canon. */}
              {/* i18n-exempt: parameter symbol — domain canon */}
              <PhaseFiveHeader label="φ′" />
              {/* i18n-exempt: parameter symbol — domain canon */}
              <PhaseFiveHeader label="c′" />
              {/* i18n-exempt: parameter symbol — domain canon */}
              <PhaseFiveHeader label="cu" />
              {/* i18n-exempt: parameter symbol — domain canon */}
              <PhaseFiveHeader label="E50" />
              {/* i18n-exempt: parameter symbol — domain canon */}
              <PhaseFiveHeader label="OCR" />
              {/* i18n-exempt: parameter symbol — domain canon */}
              <PhaseFiveHeader label="Vs" />
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const isSelected = r.kind === 'CPT' && selectedId === r.id
              return (
                <tr
                  key={r.id}
                  className={
                    'border-b border-border-subtle ' +
                    (r.kind === 'CPT'
                      ? 'cursor-pointer ' +
                        (isSelected ? 'bg-surface-sunken' : 'hover:bg-surface-sunken/40')
                      : 'hover:bg-surface-sunken/40')
                  }
                  aria-selected={isSelected}
                  onClick={() => handleRowClick(r)}
                  data-testid={`parameters-row-${r.id}`}
                >
                  <td className="px-2 py-1 font-medium">{r.name}</td>
                  <td className="px-2 py-1 text-text-secondary">{r.kind}</td>
                  <td className="px-2 py-1 tabular-nums">
                    {r.depth_m === null ? '—' : r.depth_m.toFixed(1)}
                  </td>
                  <td className="px-2 py-1 tabular-nums text-text-muted">
                    {r.location_x.toFixed(0)} / {r.location_y.toFixed(0)}
                  </td>
                  <td className="px-2 py-1 tabular-nums">
                    {r.ic_avg === null ? <span className="text-text-muted">—</span> : r.ic_avg.toFixed(2)}
                  </td>
                  <PhaseFiveCell />
                  <PhaseFiveCell />
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
          {t(rows.length === 1 ? 'params.testCountOne' : 'params.testCountMany', {
            n: rows.length,
          })}
          {t('params.perTestFooterRest')}
        </div>
      </div>
    </div>
  )
}

interface SortableHeaderProps {
  label: string
  active: boolean
  asc: boolean
  onClick: () => void
}

function SortableHeader({ label, active, asc, onClick }: SortableHeaderProps): JSX.Element {
  return (
    <th
      className="px-2 py-1.5 text-left font-medium cursor-pointer select-none hover:text-text-primary"
      onClick={onClick}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <ArrowUpDown
          size={10}
          className={active ? 'text-text-primary' : 'text-text-muted opacity-50'}
          // Visual cue for the direction — flip when descending.
          style={active && !asc ? { transform: 'rotate(180deg)' } : undefined}
          aria-hidden="true"
        />
      </span>
    </th>
  )
}

function PhaseFiveHeader({ label }: { label: string }): JSX.Element {
  const t = useT()
  return (
    <th
      className="px-2 py-1.5 text-left font-medium text-text-muted opacity-60"
      title={t('params.designReadyParam')}
    >
      {label}
    </th>
  )
}

function PhaseFiveCell(): JSX.Element {
  return <td className="px-2 py-1 text-text-muted opacity-50">—</td>
}
