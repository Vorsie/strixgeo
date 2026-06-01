// Per-test tab — table of every CPT / borehole in the project; columns
// are computed parameters.
//
// Populated TODAY:
//   - Inventory columns (id, name, kind, depth, location, n_rows)
//     from useShell().investigations.cpts + .boreholes.
//   - Parameter columns:
//       Ic_avg     — mean Ic across the test's depth series (when the
//                    /cpt/{id}/plot endpoint has been fetched into the
//                    plotMap; "—" otherwise).
//       SBT_dom    — dominant SBT zone over the series (heuristic:
//                    Ic via Robertson 2015 from robertson_2015.py via the
//                    plot endpoint; mode of zone-from-Ic per row).
//   - Ic curve + SBT zone chart: click a CPT row to expand the
//     CptIcSbtChart below the table (debt #22 — lifted from CptChart).
//     Borehole rows collapse the chart (no Ic series available).
//
// Phase 5 fills in (placeholder columns shown muted with "Phase 5"):
//   - φ′, c′, cu, E50, OCR, Vs, G0, M.
//   - The "method" tag per cell (Robertson 1986 / Mayne 2007 / Kulhawy
//     2014 / Uzielli 2013 / NAD-NEN xlsx / lab-derived / ML / manual).
//   - Click-to-expand: raincloud plot of source data + per-correlation
//     comparison + probabilistic-distribution wiring.
//   - Cross-test comparison: shift-click rows to overlay raincloud
//     densities side-by-side.
//
// This is a sketch — the columns + sort + future-column structure are
// the contract the Phase-5 work will fill in. Lab-test rows slot into
// the same table when the per-sample lab parameters land.

import { useMemo, useState } from 'react'
import { ArrowUpDown, Beaker } from 'lucide-react'

import { EmptyState } from '../../../EmptyState'
import { useShell } from '../../../ShellContext'
import CptIcSbtChart from '../CptIcSbtChart'

type Row = {
  id: string
  name: string
  kind: 'CPT' | 'Borehole'
  depth_m: number | null
  location_x: number
  location_y: number
  // Computed (today: Ic average from plotMap when fetched; null otherwise).
  ic_avg: number | null
  // Dominant SBT zone label — null when Ic not yet computed.
  sbt_dom: string | null
}

type SortKey = 'name' | 'kind' | 'depth_m' | 'ic_avg'

// Tiny Robertson-1990 SBT zone classifier (1..7+) keyed off Ic value.
// Matches the breakpoints in domain/services/cpt_interpretation.py
// (kept inline so the Phase-5 wiring doesn't need to wait for a
// frontend port; once the Parameters stage takes a real backend route
// this gets retired in favour of server-computed dominant zone).
function sbtZoneFromIc(ic: number): string | null {
  if (ic <= 0 || !Number.isFinite(ic)) return null
  if (ic < 1.31) return 'Gravelly sand'
  if (ic < 2.05) return 'Sand'
  if (ic < 2.6) return 'Sand mix'
  if (ic < 2.95) return 'Silt mix'
  if (ic < 3.6) return 'Clay'
  return 'Organic'
}

function modeNonNull(values: (string | null)[]): string | null {
  const counts = new Map<string, number>()
  for (const v of values) {
    if (v === null) continue
    counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  let best: string | null = null
  let bestCount = 0
  for (const [k, v] of counts) {
    if (v > bestCount) {
      best = k
      bestCount = v
    }
  }
  return best
}

export default function PerTestTab(): JSX.Element {
  const {
    investigations: { cpts, boreholes, plotMap },
  } = useShell()

  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortAsc, setSortAsc] = useState(true)
  // Expanded CPT row — clicking a CPT row opens the Ic/SBT chart below the
  // table. Clicking the same row again collapses it. Borehole rows don't
  // carry an Ic series, so they always collapse the chart.
  const [expandedCptId, setExpandedCptId] = useState<string | null>(null)

  const rows = useMemo<Row[]>(() => {
    const cptRows: Row[] = cpts.map(c => {
      const plot = plotMap.get(c.id)
      // Ic average — drop nulls (no fs, qc<=0, etc.). Returns null
      // when there's no series OR when every point is null.
      let icAvg: number | null = null
      let sbtDom: string | null = null
      if (plot && plot.ic && plot.ic.length > 0) {
        const vals = plot.ic.filter((v): v is number => v !== null && v > 0)
        if (vals.length > 0) {
          icAvg = vals.reduce((s, v) => s + v, 0) / vals.length
          sbtDom = modeNonNull(plot.ic.map(v => (v === null ? null : sbtZoneFromIc(v))))
        }
      }
      return {
        id: c.id,
        name: c.name,
        kind: 'CPT',
        depth_m: c.max_depth_m,
        location_x: c.location_x,
        location_y: c.location_y,
        ic_avg: icAvg,
        sbt_dom: sbtDom,
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
      sbt_dom: null,
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
  }, [cpts, boreholes, plotMap, sortKey, sortAsc])

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
        title="No tests yet"
        hint="Import CPTs / boreholes on the Data stage. They'll appear here once the project has investigations."
        compact={false}
      />
    )
  }

  const expandedPlot = expandedCptId !== null ? plotMap.get(expandedCptId) ?? null : null
  const expandedName = expandedCptId !== null
    ? (rows.find(r => r.id === expandedCptId)?.name ?? undefined)
    : undefined

  function handleRowClick(r: Row): void {
    if (r.kind !== 'CPT') {
      // Boreholes have no Ic series — clicking collapses any open chart.
      setExpandedCptId(null)
      return
    }
    setExpandedCptId(prev => (prev === r.id ? null : r.id))
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Scrollable table */}
      <div className="flex-1 min-h-0 overflow-auto">
        <table className="w-full text-[11px] border-collapse">
          <thead className="sticky top-0 bg-surface-sunken text-text-secondary">
            <tr className="border-b border-border-subtle">
              <SortableHeader
                label="Name"
                active={sortKey === 'name'}
                asc={sortAsc}
                onClick={() => toggleSort('name')}
              />
              <SortableHeader
                label="Kind"
                active={sortKey === 'kind'}
                asc={sortAsc}
                onClick={() => toggleSort('kind')}
              />
              <SortableHeader
                label="Depth (m)"
                active={sortKey === 'depth_m'}
                asc={sortAsc}
                onClick={() => toggleSort('depth_m')}
              />
              <th className="px-2 py-1.5 text-left font-medium">x / y</th>
              <SortableHeader
                label="Ic̄ (Robertson 2015)"
                active={sortKey === 'ic_avg'}
                asc={sortAsc}
                onClick={() => toggleSort('ic_avg')}
              />
              <th className="px-2 py-1.5 text-left font-medium">SBT (dominant)</th>
              {/* Phase 5 columns — visible but muted so the engineer sees
                  the surface that will populate later. */}
              <PhaseFiveHeader label="φ′" />
              <PhaseFiveHeader label="c′" />
              <PhaseFiveHeader label="cu" />
              <PhaseFiveHeader label="E50" />
              <PhaseFiveHeader label="OCR" />
              <PhaseFiveHeader label="Vs" />
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const isExpanded = expandedCptId === r.id
              const hasSeries  = r.kind === 'CPT' && plotMap.has(r.id)
              return (
                <tr
                  key={r.id}
                  // CPT rows with a loaded series are clickable to expand the
                  // Ic/SBT chart. Rows without a series still register the click
                  // so the user can see the "open the CPT once" hint in the footer.
                  className={
                    'border-b border-border-subtle ' +
                    (r.kind === 'CPT'
                      ? 'cursor-pointer hover:bg-surface-sunken/60 ' + (isExpanded ? 'bg-surface-sunken' : 'hover:bg-surface-sunken/40')
                      : 'hover:bg-surface-sunken/40')
                  }
                  aria-selected={isExpanded}
                  onClick={() => handleRowClick(r)}
                  data-testid={`parameters-row-${r.id}`}
                >
                  <td className="px-2 py-1 font-medium">
                    {r.name}
                    {/* Expansion caret for CPT rows — visual affordance */}
                    {r.kind === 'CPT' && hasSeries && (
                      <span
                        className="ml-1 text-text-muted text-[9px]"
                        aria-hidden="true"
                      >
                        {isExpanded ? '▲' : '▼'}
                      </span>
                    )}
                  </td>
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
                  <td className="px-2 py-1 text-text-secondary">
                    {r.sbt_dom ?? <span className="text-text-muted">—</span>}
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
          {rows.length} test{rows.length === 1 ? '' : 's'} · Ic̄ shown when
          the plot data is loaded (open the CPT once to populate). Click a CPT
          row to expand the Ic / SBT zone chart. Future: raincloud plot,
          correlation method picker, probabilistic distribution, cross-test
          comparison.
        </div>
      </div>

      {/* Ic / SBT zone chart — shown when a CPT row with a loaded series is expanded */}
      {expandedPlot && expandedPlot.ic && expandedPlot.ic.length > 0 && (
        <div
          className="border-t-2 border-status-amber shrink-0 bg-surface-app overflow-auto"
          style={{ maxHeight: 440 }}
          data-testid="parameters-ic-sbt-panel"
        >
          <CptIcSbtChart
            plot={expandedPlot}
            title={expandedName}
            heightPx={380}
          />
        </div>
      )}
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
  return (
    <th
      className="px-2 py-1.5 text-left font-medium text-text-muted opacity-60"
      title="Design-ready parameter — populated in Phase 5 when the correlation / xlsx pipeline lands."
    >
      {label}
    </th>
  )
}

function PhaseFiveCell(): JSX.Element {
  return <td className="px-2 py-1 text-text-muted opacity-50">—</td>
}
