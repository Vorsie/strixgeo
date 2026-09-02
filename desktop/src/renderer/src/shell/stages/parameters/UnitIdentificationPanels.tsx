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
// AXES. Every quantity pooled here SHOULD be non-negative (percentages,
// densities, contents), so every value axis starts at 0 — the same
// zero-anchor ruling as the qc/fs/Rf panels — and a negative lab artefact is
// OFF AXIS: excluded and counted, never clamped (the S2 rule, adopted here
// by audit F6). The two Atterberg panels share ONE value scale so vloeigrens
// and uitrolgrens are visually comparable side by side.
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
import { t as tStatic, useT } from '../../../i18n/translate'
import { useShell } from '../../ShellContext'
import AxisTickRow from './AxisTickRow'
import { sampleColor } from './sampleColor'
import UnitPsdPanel from './UnitPsdPanel'
import {
  poolIdentificationPanels,
  unitBoreholeBands,
  type IdentificationPanel,
} from './unitIdentification'
import { poolUnitPsdCurves, type UnitPsdCurve } from './unitPsd'

// ── Plot geometry (user-space; stretched by the row width) ───────────────────
const PLOT_W = 100
const PLOT_H = 48
const GRID = 'var(--chart-grid, #e5e7eb)'

/** The two Atterberg panels — pinned to one shared value scale (IP4). */
const ATTERBERG_KEYS = new Set(['typed:liquid_limit', 'typed:plastic_limit'])

interface Props {
  /**
   * The scoped node's accepted bands from ``bandsForScope`` — the single
   * band-selection authority. Both anchors; this panel narrows to the
   * borehole-anchored, member-filtered subset for the OKP + PSD pools.
   */
  scopeBands: readonly LithoLayerResponse[]
  /** The pooling population (R6) — canonical section membership union. */
  memberInvestigationIds: ReadonlySet<string>
  /**
   * Navigate to a PSD curve's sample on a cross-section (owner 2026-08-28).
   * Threaded down to the PSD panel's right-click menu; absent → no menu is
   * offered. The caller (the canvas) owns the section resolution + the honest
   * "on no section" toast — this file only forwards the request.
   */
  onRevealSample?: (curve: UnitPsdCurve) => void
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
  scopeBands,
  memberInvestigationIds,
  onRevealSample,
}: Props): JSX.Element {
  const { project } = useShell()
  const t = useT()
  const projectId = project.id

  // The lab + PSD pools read the SAME scope bands the statistics do (the one
  // authority): borehole-anchored, member-filtered. One filter scopes both.
  const bands = useMemo(
    () => unitBoreholeBands(scopeBands, memberInvestigationIds),
    [scopeBands, memberInvestigationIds],
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
            ? tStatic('params.labTestsLoadFailedDetail', { error: err.message })
            : tStatic('params.labTestsLoadFailed'),
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
            {t('params.identificationTests')}
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
              {fitAxes ? t('params.pooledAxes') : t('params.fitAxesToData')}
            </button>
          )}
        </div>
        <div className="text-[10px] text-text-muted">
          {t('params.okpBlurb')}
          {pool.skippedNoElevation > 0
            ? t(
                pool.skippedNoElevation === 1
                  ? 'params.samplesSkippedOne'
                  : 'params.samplesSkippedMany',
                { n: pool.skippedNoElevation },
              )
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
            {t('common.retry')}
          </button>
        </div>
      ) : loading ? (
        <div className="px-3 pb-3 text-[10px] text-text-muted" data-testid="unit-idtests-loading">
          {t('params.loadingIdentificationTests')}
        </div>
      ) : pool.panels.length === 0 && psd.curves.length === 0 ? (
        // The quiet line — never an error (R8.5). Covers both "no borehole
        // bands at all" and "bands but no lab tests in them". Gated on BOTH
        // pools (F8): grain-size curves ARE identification tests, so a
        // PSD-only unit must not claim to have none right above its curves.
        <div className="px-3 pb-3 text-[10px] text-text-muted" data-testid="unit-idtests-empty">
          {t('params.noIdentificationTests')}
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
          nothing when the unit has no usable curves (no empty jars). The
          right-click "go to the sample on a cross-section" rides along. */}
      {!loading && error === null && (
        <UnitPsdPanel pool={psd} onRevealSample={onRevealSample} />
      )}
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
  const t = useT()
  const values = panel.points.map(p => p.value)
  const dataMax = Math.max(forcedMax ?? 0, ...values, 1e-9)
  // Fit mode rounds the panel's own pooled max up to a tick (headroom);
  // default keeps the exact pooled max — the revert target.
  const xMax = fit ? fitAxisMax(dataMax, dataMax) : dataMax

  // S2 adopted here too (audit F6): every pooled quantity SHOULD be
  // non-negative, but a lab artefact can arrive negative, and a zero-anchored
  // axis cannot place it — excluded and counted, never clamped onto the 0
  // wall. The reported n stays the true sample count.
  const onAxisPoints = panel.points.filter(p => p.value >= 0 && p.value <= xMax)
  const offAxisCount = panel.points.length - onAxisPoints.length

  // The elevation span covers what is DRAWN — an excluded point must not
  // stretch the axis toward a dot that is not there.
  const elevations = onAxisPoints.map(p => p.elevationM)
  const eMin = elevations.length > 0 ? Math.min(...elevations) : 0
  const eMax = elevations.length > 0 ? Math.max(...elevations) : 0
  const eSpan = eMax - eMin
  // Zero-anchored X; no clamp (S2 — anything the axis cannot place is not
  // drawn); elevation maps top-down — higher ground higher on the panel, the
  // section convention.
  const toX = (v: number): number => (v / xMax) * PLOT_W
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

      {/* Y-axis title — the elevation axis is mTAW (owner 2026-08-28:
          "properly label all axes"; the dot tooltips already read mTAW). */}
      <div
        className="text-[9px] uppercase tracking-wide text-text-muted leading-none"
        data-testid={`unit-idtests-yaxis-label-${panel.key}`}
      >
        {/* i18n-exempt: mTAW is a datum unit symbol — domain canon */}
        mTAW
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
          aria-label={t('params.idPanelAriaLabel', {
            label: panel.label,
            n: panel.points.length,
          })}
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
          {onAxisPoints.map((p, i) => (
            <circle
              key={`pt-${i}`}
              data-testid={`unit-idtests-dot-${panel.key}`}
              cx={toX(p.value)}
              cy={toY(p.elevationM)}
              r={1.4}
              // Inked by the SAMPLE (owner 2026-08-28): the same colour marks
              // this sample's PSD curve below and its dots in every other panel.
              fill={sampleColor(p.sampleId)}
              fillOpacity={0.85}
            >
              <title>
                {t('params.idDotTooltip', {
                  value: p.value,
                  unit: panel.unit ?? '',
                  elevation: p.elevationM.toFixed(2),
                  borehole: p.boreholeName,
                  sample: p.sampleNumber ? t('params.sampleSuffix', { n: p.sampleNumber }) : '',
                })}
              </title>
            </circle>
          ))}
        </svg>
      </div>

      {/* S2 notifier (F6) — readings the zero-anchored axis could not place;
          quiet when nothing fell off. */}
      {offAxisCount > 0 && (
        <div
          className="ml-9 text-[10px] text-text-muted tabular-nums"
          data-testid={`unit-idtests-offaxis-${panel.key}`}
        >
          {t('params.offAxis', { count: offAxisCount })}
        </div>
      )}

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

      {/* X-axis title — the measured quantity + its unit (owner 2026-08-28:
          "properly label all axes"). Mirrors the CPT chart's "name (unit)"
          idiom; the ticks above already carry the unit at the axis end. */}
      <div
        className="ml-9 text-center text-[9px] text-text-muted truncate"
        data-testid={`unit-idtests-xaxis-label-${panel.key}`}
      >
        {panel.label}
        {panel.unit !== null && panel.unit !== '' ? ` (${panel.unit})` : ''}
      </div>
    </div>
  )
}
