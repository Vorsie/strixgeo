// Identification-test (OKP) panels for the scoped unit — owner ruling R8,
// 2026-08-27, verbatim: "i want a plot with all OKP's in a layer."
//
// One SCATTER PANEL PER PARAMETER that has data in this unit: value on X,
// elevation (mTAW) on Y — the idiom of the owner's own per-laag Python
// scripts — with a light grid and an n= count. Parameters nothing was
// measured for render NOTHING (the standing no-empty-jars rule). Pooling and
// the mTAW conversion live in ``unitIdentification.ts`` (pure); this file
// owns the fetch and the drawing.
//
// AXES. Every quantity pooled here is non-negative (percentages, densities,
// contents), so every value axis starts at 0 — the same zero-anchor ruling
// as the qc/fs/Rf panels. The two Atterberg panels share ONE value scale so
// vloeigrens and uitrolgrens are visually comparable side by side.
//
// FETCH. One ``detail-batch`` round-trip for the unit's member boreholes,
// only when the unit actually has borehole bands; responses are cached per
// hole for the life of this surface so switching units back and forth does
// not refetch.

import { useEffect, useMemo, useRef, useState } from 'react'

import { api } from '../../../api/client'
import type { BoreholeDetailResponse, LithoLayerResponse } from '../../../api/client'
import { axisTickValues, fitAxisMax } from '../../../utils/cptAxisScales'
import { log } from '../../../utils/log'
import { useShell } from '../../ShellContext'
import type { ParameterUnitScope } from '../../ShellContext'
import AxisTickRow from './AxisTickRow'
import UnitPsdPanel from './UnitPsdPanel'
import {
  poolIdentificationPanels,
  unitBoreholeBands,
  type IdentificationPanel,
} from './unitIdentification'
import { poolUnitPsdCurves } from './unitPsd'

// ── Plot geometry (user-space; stretched by the row width) ───────────────────
const PLOT_W = 100
const PLOT_H = 48
const GRID = 'var(--chart-grid, #e5e7eb)'
const DOT = 'var(--chart-clr-qc, #111827)'

/** The two Atterberg panels — pinned to one shared value scale (IP4). */
const ATTERBERG_KEYS = new Set(['typed:liquid_limit', 'typed:plastic_limit'])

interface Props {
  /** The unit whose samples are pooled. */
  scope: ParameterUnitScope
  /** The scoped model's layer list (litho or geotech, matching the scope). */
  layers: readonly LithoLayerResponse[]
  /** The pooling population (R6) — canonical section membership union. */
  memberInvestigationIds: ReadonlySet<string>
}

/**
 * Identification-test scatter panels for one unit.
 *
 * Parameters
 * ----------
 * props : Props
 *     Scope + the scoped layer list + the pooling population.
 *
 * Returns
 * -------
 * JSX.Element
 *     A heading plus one panel per parameter with data, a quiet line when
 *     there is none, or a retryable error line when the fetch failed.
 */
export default function UnitIdentificationPanels({
  scope,
  layers,
  memberInvestigationIds,
}: Props): JSX.Element {
  const { project } = useShell()
  const projectId = project.id

  const bands = useMemo(
    () => unitBoreholeBands(layers, scope.unitId, memberInvestigationIds),
    [layers, scope.unitId, memberInvestigationIds],
  )

  // Sorted + deduplicated so the fetch key is stable under band reshuffles —
  // the same discipline as ``useUnitStatistics``.
  const boreholeIds = useMemo(
    () => Array.from(new Set(bands.map(b => b.boreholeId))).sort(),
    [bands],
  )
  const boreholeIdsKey = boreholeIds.join(',')

  const [details, setDetails] = useState<Map<string, BoreholeDetailResponse>>(new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retryNonce, setRetryNonce] = useState(0)

  // Cache reachable from the effect WITHOUT being a dependency (it grows on
  // every fetch, and re-running for our own writes would loop).
  const detailsRef = useRef(details)
  detailsRef.current = details

  useEffect(() => {
    if (boreholeIds.length === 0) {
      setLoading(false)
      setError(null)
      return
    }
    const missing = boreholeIds.filter(id => !detailsRef.current.has(id))
    if (missing.length === 0) {
      setLoading(false)
      setError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        log.debug('borehole', `unit identification: detail-batch for ${missing.length} hole(s)`)
        const fetched = await api.borehole.detailBatch(missing, projectId)
        if (cancelled) return
        log.debug(
          'borehole',
          `unit identification: ${fetched.length}/${missing.length} details returned`,
        )
        setDetails(prev => {
          const next = new Map(prev)
          for (const d of fetched) next.set(d.id, d)
          return next
        })
        setLoading(false)
      } catch (err) {
        if (cancelled) return
        log.error('borehole', `unit identification detail-batch(${missing.length}) failed`, err)
        setError(
          err instanceof Error && err.message
            ? `Could not load the lab tests for this unit — ${err.message}`
            : 'Could not load the lab tests for this unit.',
        )
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // reason: ``boreholeIdsKey`` is the stable projection of ``boreholeIds``;
    // ``detailsRef`` is a ref by design (see the cache note above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boreholeIdsKey, projectId, retryNonce])

  const pool = useMemo(
    () => poolIdentificationPanels(bands, details),
    [bands, details],
  )

  // S5 (owner 2026-08-27: "i'm missing all PSD's on one graph") — the unit's
  // grain-size curves, pooled by the same midpoint-in-band rule.
  const psd = useMemo(() => poolUnitPsdCurves(bands, details), [bands, details])

  // S4 (owner 2026-08-27): "make it so that you can scale the OKP values to
  // better fit the data." Same toggle mechanic as the CPT panels (S1): plain
  // state, no persistence, revert restores the exact default axes. In fit
  // mode each panel fits ITS OWN data — including the Atterberg pair, whose
  // shared scale is the one place the default axes visibly do not fit.
  const [fitAxes, setFitAxes] = useState(false)

  // IP4 — one shared max across the Atterberg pair.
  const atterbergMax = useMemo(() => {
    let max = 0
    for (const panel of pool.panels) {
      if (!ATTERBERG_KEYS.has(panel.key)) continue
      for (const p of panel.points) max = Math.max(max, p.value)
    }
    return max
  }, [pool.panels])

  return (
    <div className="border-t border-border-subtle" data-testid="unit-idtests">
      <div className="px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-semibold text-text-primary">
            Identification tests
          </div>
          {/* S4 — the label states the mode the press switches TO; offered
              only when there are panels to scale (no-affordance rule). */}
          {pool.panels.length > 0 && (
            <button
              type="button"
              data-testid="unit-idtests-fit-toggle"
              aria-pressed={fitAxes}
              onClick={() => setFitAxes(f => !f)}
              className="shrink-0 px-1.5 py-0.5 rounded border border-border-default text-[10px] text-text-secondary hover:text-text-primary hover:bg-surface-app"
            >
              {fitAxes ? 'Pooled axes' : 'Fit axes to data'}
            </button>
          )}
        </div>
        <div className="text-[10px] text-text-muted">
          Classification lab results (OKP) on the unit&apos;s borehole samples —
          value against elevation.
          {pool.skippedNoElevation > 0
            ? ` ${pool.skippedNoElevation} sample${pool.skippedNoElevation === 1 ? '' : 's'} skipped — collar elevation unknown.`
            : ''}
        </div>
      </div>

      {error !== null ? (
        <div className="flex flex-col items-start gap-2 px-3 pb-3 text-[11px] text-status-danger">
          <span data-testid="unit-idtests-error">{error}</span>
          <button
            onClick={() => setRetryNonce(n => n + 1)}
            className="px-2 py-0.5 rounded border border-border-default text-text-primary hover:bg-surface-app"
            data-testid="unit-idtests-retry"
          >
            Retry
          </button>
        </div>
      ) : loading ? (
        <div className="px-3 pb-3 text-[10px] text-text-muted" data-testid="unit-idtests-loading">
          Loading identification tests…
        </div>
      ) : pool.panels.length === 0 ? (
        // The quiet line — never an error (R8.5). Covers both "no borehole
        // bands at all" and "bands but no lab tests in them".
        <div className="px-3 pb-3 text-[10px] text-text-muted" data-testid="unit-idtests-empty">
          No identification tests in this unit.
        </div>
      ) : (
        <div className="flex flex-wrap gap-x-4">
          {pool.panels.map(panel => (
            <IdentificationPanelRow
              key={panel.key}
              panel={panel}
              // The Atterberg pair reads on one shared scale (IP4) — released
              // in fit mode (S4), where each panel fits its own data.
              forcedMax={!fitAxes && ATTERBERG_KEYS.has(panel.key) ? atterbergMax : null}
              fit={fitAxes}
            />
          ))}
        </div>
      )}

      {/* S5 — every grain-size curve of the unit on ONE graph. Renders
          nothing when the unit has no usable curves (no empty jars). */}
      {!loading && error === null && <UnitPsdPanel pool={psd} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// One parameter's scatter panel
// ---------------------------------------------------------------------------

/** Value-vs-elevation scatter for a single parameter. */
function IdentificationPanelRow({
  panel,
  forcedMax,
  fit,
}: {
  panel: IdentificationPanel
  forcedMax: number | null
  /** S4 — fitted axis: the panel's own max, rounded up to a tick. */
  fit: boolean
}): JSX.Element {
  const values = panel.points.map(p => p.value)
  const dataMax = Math.max(forcedMax ?? 0, ...values, 1e-9)
  // Fit mode rounds the panel's own pooled max up to a tick (headroom);
  // default keeps the exact pooled max — the revert target.
  const xMax = fit ? fitAxisMax(dataMax, dataMax) : dataMax

  const elevations = panel.points.map(p => p.elevationM)
  const eMin = Math.min(...elevations)
  const eMax = Math.max(...elevations)
  const eSpan = eMax - eMin
  // Zero-anchored X (every pooled quantity is non-negative); elevation maps
  // top-down — higher ground higher on the panel, the section convention.
  const toX = (v: number): number => Math.max(0, Math.min(1, v / xMax)) * PLOT_W
  const toY = (e: number): number =>
    eSpan <= 1e-9 ? PLOT_H / 2 : PLOT_H - ((e - eMin) / eSpan) * PLOT_H

  // S3 — labelled ticks on BOTH axes, derived from the spans (the shared
  // helper). The elevation axis is short (96 px), so it takes a coarser
  // density; ticks that would crowd the end labels are dropped below.
  const valueTicks = axisTickValues(0, xMax)
  const elevTicks = axisTickValues(eMin, eMax, 4).filter(t => {
    if (eSpan <= 1e-9) return false
    const f = (eMax - t) / eSpan
    return f >= 0.12 && f <= 0.88
  })

  const endLabel = `${xMax >= 10 ? xMax.toFixed(0) : xMax.toFixed(2)}${panel.unit ? ` ${panel.unit}` : ''}`

  return (
    <div
      className="px-3 py-2 w-64 max-w-full"
      data-testid={`unit-idtests-panel-${panel.key}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span
          className="text-[11px] font-medium text-text-primary truncate"
          // The raw upstream token rides the tooltip so a domain expert can
          // verify the translation without leaving the UI.
          title={panel.rawParameter ?? undefined}
          data-testid={`unit-idtests-label-${panel.key}`}
        >
          {panel.label}{' '}
          {panel.unit !== null && (
            <span className="text-text-muted font-normal">({panel.unit})</span>
          )}
        </span>
        <span
          className="text-[10px] text-text-muted tabular-nums"
          data-testid={`unit-idtests-n-${panel.key}`}
        >
          n = {panel.points.length}
        </span>
      </div>

      <div className="flex gap-1">
        {/* Elevation labels in HTML — text inside the non-uniformly
            stretched SVG would distort. Ends anchored top/bottom; the
            metre-round intermediate ticks position by their fraction (S3). */}
        <div className="relative w-8 text-[9px] text-text-muted tabular-nums leading-tight py-0.5 text-right">
          <span className="absolute top-0 right-0">{eMax.toFixed(1)}</span>
          {elevTicks.map(t => (
            <span
              key={`et-${t}`}
              data-testid={`unit-idtests-etick-${panel.key}`}
              className="absolute right-0 -translate-y-1/2"
              style={{ top: `${eSpan <= 1e-9 ? 50 : ((eMax - t) / eSpan) * 100}%` }}
            >
              {t}
            </span>
          ))}
          <span className="absolute bottom-0 right-0">{eMin.toFixed(1)}</span>
        </div>
        <svg
          viewBox={`0 0 ${PLOT_W} ${PLOT_H}`}
          preserveAspectRatio="none"
          className="w-full"
          style={{ height: 96 }}
          role="img"
          aria-label={`${panel.label}: ${panel.points.length} samples against elevation`}
        >
          {/* Gridlines at the labelled ticks (S3) — the grid and the labels
              state the same positions. */}
          {valueTicks.slice(1).filter(t => t / xMax <= 0.97).map(t => (
            <line
              key={`gx-${t}`}
              x1={toX(t)}
              x2={toX(t)}
              y1={0}
              y2={PLOT_H}
              stroke={GRID}
              strokeWidth={0.5}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {elevTicks.map(t => (
            <line
              key={`gy-${t}`}
              x1={0}
              x2={PLOT_W}
              y1={toY(t)}
              y2={toY(t)}
              stroke={GRID}
              strokeWidth={0.5}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <rect
            x={0}
            y={0}
            width={PLOT_W}
            height={PLOT_H}
            fill="none"
            stroke={GRID}
            strokeWidth={0.75}
            vectorEffect="non-scaling-stroke"
          />
          {panel.points.map((p, i) => (
            <circle
              key={`pt-${i}`}
              data-testid={`unit-idtests-dot-${panel.key}`}
              cx={toX(p.value)}
              cy={toY(p.elevationM)}
              r={1.4}
              fill={DOT}
              fillOpacity={0.65}
            >
              <title>
                {`${p.value} ${panel.unit ?? ''} · ${p.elevationM.toFixed(2)} mTAW · ${p.boreholeName}${p.sampleNumber ? ` · sample ${p.sampleNumber}` : ''}`}
              </title>
            </circle>
          ))}
        </svg>
      </div>

      {/* Value-axis tick labels (S3) — the zero anchor plus sublabels; the
          end stays the exact axis max. Shared row with the CPT panels so the
          treatment cannot drift. */}
      <AxisTickRow
        ticks={valueTicks}
        axisMax={xMax}
        unit={panel.unit}
        endLabel={endLabel}
        maxTestid={`unit-idtests-axis-max-${panel.key}`}
        tickTestid={`unit-idtests-axis-tick-${panel.key}`}
        className="ml-9"
      />
    </div>
  )
}
