import { useState, useEffect, useRef } from 'react'
import { Database, ArrowLeftRight } from 'lucide-react'
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ReferenceArea, ResponsiveContainer,
} from 'recharts'
import type {
  CptPlotResponse,
  CptResponse,
  VirtueleBoringInvestigationPrediction,
} from '../api/client'
import ElevationEditor from './ElevationEditor'
import {
  FS_AXIS_MAX_MPA,
  FS_AXIS_TICKS_MPA,
  QC_AXIS_MAX_MPA,
  QC_AXIS_TICKS_MPA,
  RF_AXIS_MAX_PCT,
  RF_AXIS_TICKS_PCT,
  U2_AXIS_MAX_KPA,
  U2_AXIS_MIN_KPA,
  U2_AXIS_TICKS_KPA,
} from '../utils/cptAxisScales'
import { verticalDatumLabel, verticalDatumShort } from '../utils/verticalDatum'
import VirtueleBoringDepthColumn from './VirtueleBoringDepthColumn'
import { useVirtueleBoringCatalog } from '../hooks/useVirtueleBoringCatalog'
import { usePersistedJSON } from '../hooks/usePersistedJSON'
import type { ContactOverlay } from '../utils/contactOverlays'
import { useT } from '../i18n/translate'

interface Props {
  plot:   CptPlotResponse
  name:   string
  detail?: CptResponse
  // Save handler for the inline elevation editor in the chart header.
  // Optional so existing call sites that render the chart without a
  // mutation path keep working (read-only dashboards, snapshot tests).
  // ``zEpsg`` carries the user's pick from the editor's datum dropdown
  // (mTAW / NAP), or ``null`` when the value is being cleared.
  onElevationChange?: (elevationM: number | null, zEpsg: number | null) => Promise<void>
  // DOV Virtuele Boring overlay — informative-only ghost column to
  // the right of the data panels. The overlay is hidden by default
  // here (per-pane visibility lives in localStorage); the header
  // button toggles it. All four props must be present for the
  // overlay to render — when the App can't supply predictions yet
  // (no models picked, project CRS isn't 31370, …) the button stays
  // disabled.
  virtueleBoringPrediction?: VirtueleBoringInvestigationPrediction | null
  // The effective model list for THIS pane — already resolved by
  // App.tsx (override > section pick). The CptChart renders one
  // ghost column per entry.
  virtueleBoringActiveModels?: readonly string[]
  virtueleBoringMaxDepthM?: number | null
  virtueleBoringVisible?: boolean
  onToggleVirtueleBoringVisible?: () => void
  // Per-pane model override. Empty string = "follow section";
  // a specific code = render only that model regardless of the
  // section pane's selection. The dropdown next to the DOV button
  // exposes this control to the engineer.
  virtueleBoringOverrideModel?: string
  onChangeVirtueleBoringOverrideModel?: (next: string) => void
  // True while the predictions network fetch is in flight. Surfaces a
  // spinner next to the DOV button so the pane doesn't appear hung.
  virtueleBoringLoading?: boolean
  // Faded depth-context lines for every formation contact (geological
  // model) and litho contact (lithostratigraphic model) anchored at
  // this CPT. The engineer sees, in the same pane as the qc/Ic trace,
  // where each formation top + litho-unit top sits. Computed by
  // ``buildContactOverlays`` (see ``utils/contactOverlays.ts``); empty
  // / undefined means "no overlay" (renders unchanged). The chart is
  // informative-only — never interactive on these lines.
  contactOverlays?: readonly ContactOverlay[]
}

// ── DOV standard axis ranges ────────────────────────────────────────────────
// The scale values live in ``utils/cptAxisScales.ts`` so surfaces that promise
// "the same axes as the cpt plot" (the per-unit distribution panels) share one
// source. The local aliases keep this file's axis wiring readable.
const Y_W    = 52    // px — every Y-axis (real and ghost) uses this width so grid lines align
const QC_MAX = QC_AXIS_MAX_MPA // MPa
const FS_MAX = FS_AXIS_MAX_MPA // MPa
const RF_MAX = RF_AXIS_MAX_PCT // %
const U2_MIN = U2_AXIS_MIN_KPA // kPa
const U2_MAX = U2_AXIS_MAX_KPA // kPa
// Curve colours are CSS custom properties defined in index.css.
// Light values (:root) are the original hard-coded constants so the
// light theme is byte-identical after this change. Dark values (.dark)
// are contrast-corrected, hue-preserving equivalents that clear WCAG
// 2.2 AA on the dark surface. Recharts passes these strings directly to
// SVG ``stroke``/``fill`` attributes — CSS var() resolves because the
// SVG is rendered in the DOM and inherits from :root / .dark on <html>.
const GRID   = 'var(--chart-grid)'
const QC_CLR = 'var(--chart-clr-qc)'
const FS_CLR = 'var(--chart-clr-fs)'
const RF_CLR = 'var(--chart-clr-rf)'
const U2_CLR = 'var(--chart-clr-u2)'
const QT_CLR = 'var(--chart-clr-qt)'
const PD_CLR = 'var(--chart-clr-pd)'

// Chrome-only colours — not domain curves, but axis/grid chrome.
// These also need contrast against the dark surface.
const SURFACE_REF_CLR   = 'var(--chart-surface-ref)'
const SURFACE_LABEL_CLR = 'var(--chart-surface-label)'

// ── Depth-gap detection ─────────────────────────────────────────────────────

/** One row in the chart data array.  All measurement channels are nullable
 *  so a null-sentinel row (depth present, all channels null) can break
 *  Recharts lines across a no-data interval without interpolating. */
export interface CptDataPoint {
  depth: number
  qc: number | null
  fs: number | null
  rf: number | null
  u2_kpa: number | null
  qt: number | null
}

/**
 * Insert null-sentinel rows at depth discontinuities so the qc / fs / Rf / u2
 * lines break visually rather than interpolating across a real no-data gap.
 *
 * Context: a DOV CPT can be pushed to refusal, then a borehole drilled to
 * continue past the resistance layer.  The drilled interval carries depth
 * entries but no qc — those rows are currently *skipped* by the DOV parser
 * (which only keeps rows with both depth and qc), so the gap collapses to a
 * straight line in the chart (see 1779022792921.pdf reference report).
 * The correct representation is a broken line.
 *
 * Because changing qc_mpa to allow null elements in the ORM array contract
 * is invasive (CptSeriesOrm, persist, API schema — all typed list[float]),
 * the gap is detected here from consecutive depth deltas: when two adjacent
 * rows jump by more than GAP_THRESHOLD_M, a sentinel row with null channels
 * is inserted between them.  The threshold is generous enough to avoid
 * tripping on variable sampling rates (typical DOV step is 0.02 m) while
 * catching real handoff gaps (typically 0.5–5 m).
 *
 * @param rows - Flat depth-ascending data array built from the plot arrays.
 * @param gapThresholdM - Minimum depth delta to qualify as a gap.
 *   Defaults to 0.20 m (10× the typical 2 cm DOV step).
 * @returns A new array with null-sentinel rows inserted at every gap.
 */
export function injectDepthGaps(
  rows: CptDataPoint[],
  gapThresholdM = 0.20,
): CptDataPoint[] {
  if (rows.length < 2) return rows
  const result: CptDataPoint[] = [rows[0]]
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1]
    const curr = rows[i]
    if (curr.depth - prev.depth > gapThresholdM) {
      // Sentinel at the midpoint so the axis label renders at a sensible
      // position; all channels null so every Line breaks here.
      result.push({
        depth: (prev.depth + curr.depth) / 2,
        qc: null,
        fs: null,
        rf: null,
        u2_kpa: null,
        qt: null,
      })
    }
    result.push(curr)
  }
  return result
}

function makeLevelFmt(elevationM: number | null) {
  return (d: number) => {
    const v = elevationM !== null ? elevationM - d : d
    return (v >= 0 ? '+' : '') + v.toFixed(1)
  }
}
const fmtDepth = (d: number) => d.toFixed(1)

// ── Y-axis builders ─────────────────────────────────────────────────────────
function yLevel(domain: [number, number], fmt: (d: number) => string, label: string) {
  return (
    <YAxis yAxisId="y" orientation="left" dataKey="depth" type="number"
      domain={domain} tickCount={11} tick={{ fontSize: 11 }}
      tickFormatter={fmt}
      label={{ value: label, angle: -90, position: 'insideLeft', offset: -(Y_W - 12), style: { fontSize: 10 } }}
      width={Y_W}
    />
  )
}
function yLength(domain: [number, number], label: string) {
  return (
    <YAxis yAxisId="yr" orientation="right" dataKey="depth" type="number"
      domain={domain} tickCount={11} tick={{ fontSize: 11 }}
      tickFormatter={fmtDepth}
      label={{ value: label, angle: 90, position: 'insideRight', offset: -(Y_W - 12), style: { fontSize: 10 } }}
      width={Y_W}
    />
  )
}
function yGhostLeft(domain: [number, number]) {
  return (
    <YAxis yAxisId="y" orientation="left" dataKey="depth" type="number"
      domain={domain} tick={false} axisLine={false} tickLine={false} width={Y_W}
    />
  )
}
function yGhostRight(domain: [number, number]) {
  return (
    <YAxis yAxisId="yr" orientation="right" dataKey="depth" type="number"
      domain={domain} tick={false} axisLine={false} tickLine={false} width={Y_W}
    />
  )
}

// ── Main component ───────────────────────────────────────────────────────────
export default function CptChart({
  plot,
  name,
  detail,
  onElevationChange,
  virtueleBoringPrediction = null,
  virtueleBoringActiveModels = [],
  virtueleBoringMaxDepthM = null,
  virtueleBoringVisible = false,
  onToggleVirtueleBoringVisible,
  virtueleBoringOverrideModel = '',
  onChangeVirtueleBoringOverrideModel,
  virtueleBoringLoading = false,
  contactOverlays,
}: Props) {
  // Lazy-load the catalogue when the model dropdown is present —
  // most CPT detail views never need it (engineers leaving overlays
  // off). Cached at module scope so the section pane's strip and
  // this dropdown share one fetch per session.
  const {
    catalog,
    failed: dovCatalogFailed,
    status: dovCatalogStatus,
  } = useVirtueleBoringCatalog(onChangeVirtueleBoringOverrideModel !== undefined)
  const t = useT()
  const elevationM = detail?.elevation_m ?? null
  const zEpsg = detail?.z_epsg ?? null
  const elevationSource = detail?.elevation_source ?? null
  const preDrillM  = detail?.pre_drill_m ?? 0
  const cptType    = detail?.cpt_type ?? ''

  const rawData = plot.depths_m.map((d, i) => ({
    depth:   d,
    qc:      plot.qc_mpa[i]                    ?? null,
    fs:      plot.fs_mpa ?  (plot.fs_mpa[i]    ?? null) : null,
    rf:      plot.rf_pct ?  (plot.rf_pct[i]    ?? null) : null,
    u2_kpa:  plot.u2_mpa && plot.u2_mpa[i] != null ? plot.u2_mpa[i]! * 1000 : null,
    // qt line: CPTM uses totaalweerstand directly. CPTU corrected qc is
    // available in plot.qt_mpa (computed by the API from qc + u2 + a) but
    // currently isn't rendered — add a CPTU branch here when a corrected-qc
    // line is wanted. The two are physically different quantities, never
    // both populated at once.
    qt:      plot.q_total_mpa ? (plot.q_total_mpa[i] ?? null) : null,
    // Ic is intentionally absent here — Ic/SBT is interpretation, not a
    // raw measurement. The Ic curve + SBT zone bands live in the Parameters
    // stage's inspector (shell/stages/parameters/CptSbtDepthPanels.tsx, bands
    // from icBands.ts). See debt #22 (2026-06-01).
  }))
  // Inject null-sentinel rows at depth discontinuities so the chart
  // lines break instead of interpolating across real no-data gaps
  // (e.g. a borehole drilled through a layer after CPT refusal).
  // connectNulls={false} on every Line already handles the break;
  // we just need the sentinels in the data array.
  const data = injectDepthGaps(rawData)

  const maxDepth = Math.ceil((plot.depths_m.at(-1) ?? 1) * 10) / 10

  const [zoomDomain, setZoomDomain] = useState<[number, number]>([0, maxDepth])
  const [isDragging, setIsDragging] = useState(false)

  // Rf-axis orientation is a per-user reading preference (many Belgian
  // engineers read Rf increasing to the LEFT), so it persists in
  // localStorage per user — not in the project bundle — and applies to
  // every CPT chart. Default matches today: Rf increases to the right.
  const [rfInverted, setRfInverted] = usePersistedJSON<boolean>(
    'groundmodel.cptchart.rf_inverted',
    false,
    raw => raw === true,
  )

  // Keep a ref so event listeners always see the latest domain without being recreated
  const zoomDomainRef = useRef(zoomDomain)
  zoomDomainRef.current = zoomDomain

  useEffect(() => {
    setZoomDomain([0, maxDepth])
  }, [plot, maxDepth])

  const panelsRef = useRef<HTMLDivElement>(null)
  const dragRef   = useRef<{ startY: number; domainAtStart: [number, number] } | null>(null)

  useEffect(() => {
    const el = panelsRef.current
    if (!el) return

    // Scroll = zoom centred on the depth under the cursor (Y axis only, X stays locked)
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect  = el.getBoundingClientRect()
      const relY  = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
      const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15

      setZoomDomain(([min, max]) => {
        const range        = max - min
        const depthAtMouse = min + relY * range
        const newRange     = Math.max(0.5, Math.min(maxDepth, range * factor))
        let   newMin       = depthAtMouse - relY * newRange
        let   newMax       = newMin + newRange
        if (newMin < 0)         { newMin = 0;         newMax = Math.min(maxDepth, newRange) }
        if (newMax > maxDepth)  { newMax = maxDepth;  newMin = Math.max(0, maxDepth - newRange) }
        return [newMin, newMax]
      })
    }

    // Drag = pan along depth (only when zoomed in)
    const onMouseDown = (e: MouseEvent) => {
      const [min, max] = zoomDomainRef.current
      if (min === 0 && max === maxDepth) return
      dragRef.current = { startY: e.clientY, domainAtStart: [min, max] }
      setIsDragging(true)
    }

    const onMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return
      const rect  = el.getBoundingClientRect()
      const dy    = e.clientY - dragRef.current.startY
      const [min, max] = dragRef.current.domainAtStart
      const range = max - min
      const delta = (dy / rect.height) * range  // pixels → depth metres
      const newMin = Math.max(0, min - delta)
      const newMax = Math.min(maxDepth, newMin + range)
      setZoomDomain([newMin, newMax])
    }

    const onMouseUp = () => {
      if (!dragRef.current) return
      dragRef.current = null
      setIsDragging(false)
    }

    el.addEventListener('wheel',      onWheel,     { passive: false })
    el.addEventListener('mousedown',  onMouseDown)
    el.addEventListener('mousemove',  onMouseMove)
    el.addEventListener('mouseup',    onMouseUp)
    el.addEventListener('mouseleave', onMouseUp)

    return () => {
      el.removeEventListener('wheel',      onWheel)
      el.removeEventListener('mousedown',  onMouseDown)
      el.removeEventListener('mousemove',  onMouseMove)
      el.removeEventListener('mouseup',    onMouseUp)
      el.removeEventListener('mouseleave', onMouseUp)
    }
  }, [maxDepth])

  const hasFs  = plot.fs_mpa != null
  const hasRf  = plot.rf_pct != null
  const hasU2  = plot.u2_mpa != null
  const hasQt  = plot.q_total_mpa != null
  const showU2 = hasU2 && (cptType === 'CPTU' || hasU2)

  const fmtLevel   = makeLevelFmt(elevationM)
  // Y-axis label switches to absolute level when we have a Z; the datum
  // suffix tracks the row's z_epsg so a NAP-tagged CPT shows "Level (m NAP)".
  const datumLabel = verticalDatumLabel(zEpsg)
  const levelLabel =
    elevationM !== null ? t('chart.levelAxis', { datum: datumLabel }) : t('chart.depthAxis')
  const datumShort = verticalDatumShort(zEpsg)

  const topM = 16
  const botM = 16

  // Filter to visible depth window so lines actually clip (domain alone only clips the axis)
  const zoomedData = data.filter(d => d.depth >= zoomDomain[0] && d.depth <= zoomDomain[1])
  const chartProps = { data: zoomedData, layout: 'vertical' as const }

  function preDrillZone(xAxisId: string) {
    if (preDrillM <= 0) return null
    return (
      <>
        <ReferenceArea yAxisId="y" xAxisId={xAxisId} y1={0} y2={preDrillM}
          fill={PD_CLR} fillOpacity={0.08} />
        <ReferenceLine yAxisId="y" xAxisId={xAxisId} y={preDrillM}
          stroke={PD_CLR} strokeDasharray="6 3" strokeWidth={1.5} />
      </>
    )
  }
  function surfaceElevationRef(xAxisId: string) {
    if (elevationM === null) return null
    return (
      <ReferenceLine yAxisId="y" xAxisId={xAxisId} y={0}
        stroke={SURFACE_REF_CLR} strokeDasharray="3 3" strokeWidth={1}
        label={{ value: t('chart.surfaceRef', { level: fmtLevel(0) }), position: 'insideTopLeft', style: { fontSize: 9, fill: SURFACE_LABEL_CLR } }}
      />
    )
  }
  // Faded depth-context overlays — one ReferenceLine per geology or
  // litho contact anchored at this CPT. The label is shown only on
  // the leftmost panel (xAxisId 'qc' here is the leftmost data column
  // when the qc/Fs panel renders); other panels get the line without
  // the label so the chart doesn't repeat the same name four times.
  // Litho overlays are slightly more transparent than geology so the
  // engineer can read the stratigraphic hierarchy at a glance.
  function contactOverlayLines(xAxisId: string, showLabels: boolean) {
    if (!contactOverlays || contactOverlays.length === 0) return null
    return contactOverlays.map(ov => {
      const opacity = ov.source === 'litho' ? 0.28 : 0.4
      return (
        <ReferenceLine
          key={`${xAxisId}-${ov.key}`}
          yAxisId="y"
          xAxisId={xAxisId}
          y={ov.depth_m}
          stroke={ov.color}
          strokeOpacity={opacity}
          strokeWidth={1}
          label={
            showLabels
              ? {
                  value: ov.label,
                  position: 'insideBottomRight',
                  style: { fontSize: 9, fill: ov.color, fillOpacity: 0.85 },
                }
              : undefined
          }
        />
      )
    })
  }

  function renderU2Panel(isLeft: boolean, isRight: boolean) {
    return (
      <ComposedChart {...chartProps} margin={{ top: topM, right: 0, bottom: botM, left: 0 }}>
        <CartesianGrid strokeDasharray="2 4" stroke={GRID} />
        {isLeft  ? yLevel(zoomDomain, fmtLevel, levelLabel) : yGhostLeft(zoomDomain)}
        {isRight ? yLength(zoomDomain, t('chart.lengthAxis'))                    : yGhostRight(zoomDomain)}
        <XAxis xAxisId="u2" type="number" orientation="top" domain={[U2_MIN, U2_MAX]}
          tick={{ fontSize: 11, fill: U2_CLR }} ticks={[...U2_AXIS_TICKS_KPA]}
        />
        <XAxis xAxisId="u2b" type="number" orientation="bottom" domain={[U2_MIN, U2_MAX]}
          tick={{ fontSize: 11, fill: U2_CLR }} ticks={[...U2_AXIS_TICKS_KPA]}
        />
        <ReferenceLine yAxisId="y" xAxisId="u2" x={0} stroke={SURFACE_REF_CLR} strokeWidth={0.5} />
        {preDrillZone('u2')}
        {surfaceElevationRef('u2')}
        {contactOverlayLines('u2', false)}
        <Tooltip contentStyle={{ fontSize: 10 }}
          formatter={(val, key) => val === null ? ['—', key] : [`${Number(val).toFixed(1)} kPa`, key]}
          labelFormatter={d => t('chart.tooltipDepth', { depth: Number(d).toFixed(2) })}
        />
        <Line yAxisId="y" xAxisId="u2" dataKey="u2_kpa" name="u (kPa)"
          stroke={U2_CLR} dot={false} strokeWidth={1.5} isAnimationActive={false} connectNulls={false} />
      </ComposedChart>
    )
  }

  function renderQcFsPanel(isLeft: boolean, isRight: boolean) {
    return (
      <ComposedChart {...chartProps} margin={{ top: topM, right: 0, bottom: botM, left: 0 }}>
        <CartesianGrid strokeDasharray="2 4" stroke={GRID} />
        {isLeft  ? yLevel(zoomDomain, fmtLevel, levelLabel) : yGhostLeft(zoomDomain)}
        {isRight ? yLength(zoomDomain, t('chart.lengthAxis'))                    : yGhostRight(zoomDomain)}
        <XAxis xAxisId="qc" type="number" orientation="top" domain={[0, QC_MAX]}
          tick={{ fontSize: 11, fill: QC_CLR }} ticks={[...QC_AXIS_TICKS_MPA]}
        />
        {hasFs
          ? <XAxis xAxisId="fs" type="number" orientation="bottom" domain={[0, FS_MAX]}
              tick={{ fontSize: 11, fill: FS_CLR }} ticks={[...FS_AXIS_TICKS_MPA]}
            />
          : <XAxis xAxisId="fs" type="number" orientation="bottom" domain={[0, FS_MAX]}
              tick={false} axisLine={false} tickLine={false}
            />
        }
        {surfaceElevationRef('qc')}
        {preDrillZone('qc')}
        {contactOverlayLines('qc', true)}
        <Tooltip contentStyle={{ fontSize: 10 }}
          formatter={(val, key) => val === null ? ['—', key] : [`${Number(val).toFixed(4)}`, key]}
          labelFormatter={d =>
            t('chart.tooltipDepth', { depth: Number(d).toFixed(2) }) +
            (elevationM !== null
              ? t('chart.tooltipLevelSuffix', {
                  level: `${fmtLevel(Number(d))}${datumShort ? ` ${datumShort}` : ''}`,
                })
              : '')
          }
        />
        <Line yAxisId="y" xAxisId="qc" dataKey="qc" name="qc (MPa)"
          stroke={QC_CLR} dot={false} strokeWidth={1.5} isAnimationActive={false} connectNulls={false} />
        {hasQt && (
          <Line yAxisId="y" xAxisId="qc" dataKey="qt" name="Qt (MPa)"
            stroke={QT_CLR} dot={false} strokeWidth={1.5} isAnimationActive={false} connectNulls={false} />
        )}
        {hasFs && (
          <Line yAxisId="y" xAxisId="fs" dataKey="fs" name="fs (MPa)"
            stroke={FS_CLR} dot={false} strokeWidth={1.5} isAnimationActive={false} connectNulls={false} />
        )}
      </ComposedChart>
    )
  }

  function renderRfPanel(isLeft: boolean, isRight: boolean) {
    return (
      <ComposedChart {...chartProps} margin={{ top: topM, right: 0, bottom: botM, left: 0 }}>
        <CartesianGrid strokeDasharray="2 4" stroke={GRID} />
        {isLeft  ? yLevel(zoomDomain, fmtLevel, levelLabel) : yGhostLeft(zoomDomain)}
        {isRight ? yLength(zoomDomain, t('chart.lengthAxis'))                    : yGhostRight(zoomDomain)}
        {/* reversed={rfInverted}: many Belgian engineers read Rf
            increasing to the LEFT. Both the top ("rf") and bottom
            ("rfb") axes flip together so ticks and the data line agree. */}
        <XAxis xAxisId="rf" type="number" orientation="top" domain={[0, RF_MAX]} reversed={rfInverted}
          tick={{ fontSize: 11, fill: RF_CLR }} ticks={[...RF_AXIS_TICKS_PCT]}
        />
        <XAxis xAxisId="rfb" type="number" orientation="bottom" domain={[0, RF_MAX]} reversed={rfInverted}
          tick={{ fontSize: 11, fill: RF_CLR }} ticks={[...RF_AXIS_TICKS_PCT]}
        />
        {preDrillZone('rf')}
        {surfaceElevationRef('rf')}
        {contactOverlayLines('rf', false)}
        <Tooltip contentStyle={{ fontSize: 10 }}
          formatter={(val, key) => val === null ? ['—', key] : [`${Number(val).toFixed(2)} %`, key]}
          labelFormatter={d => t('chart.tooltipDepth', { depth: Number(d).toFixed(2) })}
        />
        <Line yAxisId="y" xAxisId="rf" dataKey="rf" name="Rf (%)"
          stroke={RF_CLR} dot={false} strokeWidth={1.5} isAnimationActive={false} connectNulls={false} />
      </ComposedChart>
    )
  }

  // renderIcPanel removed — Ic/SBT chart lives in Parameters stage (debt #22, 2026-06-01).

  const leftmost  = showU2 ? 'u2' : 'qcfs'
  // Ic panel removed (debt #22, 2026-06-01) — rightmost is now rf or qcfs.
  const rightmost = hasRf ? 'rf' : 'qcfs'
  const isZoomed  = zoomDomain[0] !== 0 || zoomDomain[1] !== maxDepth

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-3 pb-1 shrink-0">
        <div className="text-sm font-semibold text-gray-700 dark:text-slate-200">{name}</div>
        <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-slate-400 mt-0.5">
          <span>{t('chart.runSummary', { type: cptType, rows: detail?.n_rows ?? rawData.length, depth: maxDepth.toFixed(2) })}</span>
          {/* Inline elevation editor sits on the same line as the run
              summary so the user can fix a missing Z without leaving the
              chart. Falls back to the static "Z = …" readout when no
              save handler is wired (read-only contexts). */}
          <span className="text-gray-300 dark:text-slate-600">·</span>
          {onElevationChange ? (
            <ElevationEditor
              elevationM={elevationM}
              zEpsg={zEpsg}
              elevationSource={elevationSource}
              onSave={onElevationChange}
            />
          ) : elevationM !== null ? (
            <span>Z = {elevationM.toFixed(2)} {datumLabel}</span>
          ) : (
            <span className="text-amber-600">{t('chart.zMissing')}</span>
          )}
        </div>
      </div>

      {/* Legend + zoom controls */}
      <div className="flex items-center justify-between px-4 pb-1 shrink-0">
        <div className="flex items-center gap-4 flex-wrap">
          {/* i18n-exempt: qc/Qt/fs/Rf/u + MPa/kPa/% are CPT channel + unit axis symbols (international notation, identical across locales) */}
          <LegendItem color={QC_CLR} label="qc (MPa)" />
          {hasQt  && <LegendItem color={QT_CLR} label="Qt (MPa)" /> /* i18n-exempt: channel+unit symbol */}
          {hasFs  && <LegendItem color={FS_CLR} label="fs (MPa)" /> /* i18n-exempt: channel+unit symbol */}
          {hasRf  && <LegendItem color={RF_CLR} label="Rf (%)" /> /* i18n-exempt: channel+unit symbol */}
          {showU2 && <LegendItem color={U2_CLR} label="u (kPa)" /> /* i18n-exempt: channel+unit symbol */}
          {/* Ic legend removed — Ic/SBT chart lives in Parameters stage (debt #22) */}
          {preDrillM > 0 && <LegendItem color={PD_CLR} label={t('chart.preDrill', { depth: preDrillM.toFixed(1) })} dashed />}
        </div>
        <div className="flex items-center gap-1 shrink-0 text-gray-400 dark:text-slate-400 text-[10px] select-none">
          {isZoomed && (
            <span className="mr-1">
              {zoomDomain[0].toFixed(1)}–{zoomDomain[1].toFixed(1)} m
            </span>
          )}
          <button
            className="w-6 h-6 rounded text-sm font-bold hover:bg-gray-100 dark:hover:bg-slate-700 border border-gray-200 dark:border-slate-600 leading-none text-gray-500 dark:text-slate-300"
            title={t('common.zoomIn')}
            onClick={() => setZoomDomain(([min, max]) => {
              const c = (min + max) / 2, r = Math.max(0.5, (max - min) / 1.5)
              const nm = Math.max(0, c - r / 2)
              return [nm, Math.min(maxDepth, nm + r)]
            })}
          >+</button>
          <button
            className="w-6 h-6 rounded text-sm font-bold hover:bg-gray-100 dark:hover:bg-slate-700 border border-gray-200 dark:border-slate-600 leading-none text-gray-500 dark:text-slate-300"
            title={t('common.zoomOut')}
            onClick={() => setZoomDomain(([min, max]) => {
              const c = (min + max) / 2, r = Math.min(maxDepth, (max - min) * 1.5)
              const nm = Math.max(0, c - r / 2)
              return [nm, Math.min(maxDepth, nm + r)]
            })}
          >−</button>
          {isZoomed && (
            <button
              className="px-2 h-6 rounded hover:bg-gray-100 dark:hover:bg-slate-700 border border-gray-200 dark:border-slate-600 text-gray-500 dark:text-slate-300"
              title={t('common.resetZoom')}
              onClick={() => setZoomDomain([0, maxDepth])}
            >{t('common.reset')}</button>
          )}
          {/* Rf-axis orientation toggle — flips Rf to increase leftward.
              Only offered when the chart actually draws an Rf panel. */}
          {hasRf && (
            <button
              onClick={() => setRfInverted(v => !v)}
              aria-pressed={rfInverted}
              aria-label={t('chart.invertRfAxis')}
              title={t('chart.invertRfAxis')}
              className={
                'flex items-center gap-1 px-2 h-6 rounded border text-[10px] transition-colors ' +
                (rfInverted
                  ? 'border-blue-600 bg-blue-600 text-white hover:bg-blue-700'
                  : 'border-gray-200 dark:border-slate-600 text-gray-500 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700')
              }
            >
              <ArrowLeftRight size={11} />
              {/* i18n-exempt: Rf is a CPT channel symbol (international notation) */}
              Rf
            </button>
          )}
          {/* DOV Virtuele Boring overlay toggle + override picker.
              The button flips visibility; the dropdown picks which
              model THIS pane shows. "Follow section" inherits the
              section pane's modelA/modelB; a specific model code
              renders only that one regardless of the section's
              selection — useful for comparing a CPT against
              hydrogeology while the section pane shows formations. */}
          {onToggleVirtueleBoringVisible !== undefined && (
            <>
              {/* Spinner shown while the predictions fetch is in flight
                  so the pane doesn't look unresponsive after model pick. */}
              {virtueleBoringLoading && (
                <span
                  aria-label={t('borelog.loadingDovPredictions')}
                  className="inline-block w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"
                />
              )}
              <button
                onClick={onToggleVirtueleBoringVisible}
                disabled={virtueleBoringActiveModels.length === 0}
                aria-pressed={virtueleBoringVisible}
                aria-label={t('borelog.toggleVirtueleBoring')}
                title={
                  virtueleBoringActiveModels.length === 0
                    ? t('borelog.dovPickModelHint')
                    : virtueleBoringVisible
                      ? t('borelog.hideDovOverlay')
                      : t('borelog.showDovOverlay')
                }
                className={
                  'flex items-center gap-1 px-2 h-6 rounded border text-[10px] transition-colors ' +
                  (virtueleBoringActiveModels.length === 0
                    ? 'border-gray-200 dark:border-slate-600 text-gray-300 dark:text-slate-600 cursor-not-allowed'
                    : virtueleBoringVisible
                      ? 'border-blue-600 bg-blue-600 text-white hover:bg-blue-700'
                      : 'border-gray-200 dark:border-slate-600 text-gray-500 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700')
                }
              >
                <Database size={11} />
                {/* i18n-exempt: DOV is the product/brand name (Databank Ondergrond Vlaanderen), identical across locales */}
                DOV
              </button>
              {onChangeVirtueleBoringOverrideModel !== undefined && (
                <select
                  value={virtueleBoringOverrideModel}
                  onChange={e => onChangeVirtueleBoringOverrideModel(e.target.value)}
                  disabled={catalog === null}
                  title={t('borelog.overrideDovModel')}
                  aria-label={t('borelog.dovOverlayModel')}
                  className="h-6 px-1 border border-gray-200 dark:border-slate-600 rounded text-[10px] bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200 max-w-[160px]"
                >
                  <option value="">{t('borelog.followSection')}</option>
                  {(catalog ?? []).map(entry => (
                    <option key={entry.code} value={entry.code}>
                      {entry.beschrijving}
                    </option>
                  ))}
                </select>
              )}
              {/* When the lagenmodel catalogue fetch failed (e.g. the
                  backend refused the DOV host → 503) the picker above is
                  disabled; say why instead of leaving it silently greyed.
                  i18n-exempt: DOV is the product/brand name. */}
              {dovCatalogFailed && (
                <span
                  className="text-[10px] text-gray-400 dark:text-slate-500"
                  title={t('borelog.dovUnavailable')}
                >
                  {t('borelog.dovUnavailable')}
                  {dovCatalogStatus !== null ? ` (${dovCatalogStatus})` : ''}
                </span>
              )}
            </>
          )}
        </div>
      </div>

      {/* SBT zone colour key removed — Ic/SBT chart lives in Parameters stage (debt #22) */}

      {/* Panels — scroll to zoom at cursor, drag to pan */}
      <div
        ref={panelsRef}
        className="flex flex-1 overflow-hidden px-1"
        style={{ cursor: isDragging ? 'grabbing' : (isZoomed ? 'grab' : 'default') }}
      >
        {showU2 && (
          <div style={{ flex: 1, position: 'relative' }} className="min-w-0 border-r border-gray-200 dark:border-slate-700">
            <ResponsiveContainer width="100%" height="100%">
              {/* u2 is the leftmost panel when present (line 548); it
                  cannot be the rightmost (rightmost is among ic/rf/
                  qcfs only). tsc flags the `rightmost === 'u2'` test
                  as dead code — that's correct; pass literal false. */}
              {renderU2Panel(leftmost === 'u2', false)}
            </ResponsiveContainer>
            <ChartLabel left={{ color: U2_CLR, text: 'u (kPa)' }} />
          </div>
        )}

        <div style={{ flex: 2, position: 'relative' }} className={`min-w-0${hasRf ? ' border-r border-gray-200 dark:border-slate-700' : ''}`}>
          <ResponsiveContainer width="100%" height="100%">
            {renderQcFsPanel(leftmost === 'qcfs', rightmost === 'qcfs')}
          </ResponsiveContainer>
          <ChartLabel
            left={{ color: QC_CLR, text: hasQt ? 'qc / Qt (MPa)' : 'qc (MPa)' }}
            right={hasFs ? { color: FS_CLR, text: 'fs (MPa)' } : undefined}
          />
        </div>

        {hasRf && (
          <div style={{ flex: 1, position: 'relative' }} className="min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              {/* leftmost is among u2/qcfs only — `rf` is
                  never the leftmost. Pass literal false. */}
              {renderRfPanel(false, rightmost === 'rf')}
            </ResponsiveContainer>
            <ChartLabel left={{ color: RF_CLR, text: 'Rf (%)' }} />
          </div>
        )}
        {/* Ic panel removed — Ic/SBT chart lives in Parameters stage (debt #22, 2026-06-01) */}

        {/* DOV Virtuele Boring depth overlay — renders only when
            the user toggled it on in this pane AND the section
            pane's picker has armed at least one model. topMargin /
            bottomMargin approximate the recharts top-axis +
            bottom-axis space so y=0 lines up with the data tracks'
            depth=0 within ~5 px; exact alignment isn't required
            because the overlay is informative-only. */}
        {virtueleBoringVisible && virtueleBoringActiveModels.length > 0 && (
          <VirtueleBoringDepthColumn
            prediction={virtueleBoringPrediction}
            activeModels={virtueleBoringActiveModels}
            depthDomain={zoomDomain}
            surfaceElevationM={elevationM}
            maxDepthMBelowSurface={virtueleBoringMaxDepthM}
            topMarginPx={topM + 22}
            bottomMarginPx={botM + 22}
          />
        )}
      </div>
    </div>
  )
}

// ── Absolute-positioned label overlay inside each panel ──────────────────────
// bottom: 46px clears recharts' bottom axis area (margin 16 + tick text ~26px + 4px gap).
// Inset by Y_W on each side so text aligns under the plot area, not the Y-axis gutters.
interface LabelEntry { color: string; text: string }
// 46px clears the recharts bottom axis area (margin.bottom=16 + tick text ~26px + 4px gap)
function ChartLabel({ left, right }: { left: LabelEntry; right?: LabelEntry; botM?: number }) {
  return (
    <div
      className="absolute flex justify-between pointer-events-none select-none"
      style={{ bottom: 46, left: Y_W + 4, right: Y_W + 4 }}
    >
      <span style={{ fontSize: 10, fontWeight: 500, color: left.color }}>{left.text}</span>
      {right && <span style={{ fontSize: 10, fontWeight: 500, color: right.color }}>{right.text}</span>}
    </div>
  )
}

// IcZoneLabelsOverlay and IC_ZONE_SHORT removed — the Ic band table now lives
// in shell/stages/parameters/icBands.ts and is drawn by CptSbtDepthPanels.tsx
// (debt #22, 2026-06-01; CptIcSbtChart.tsx deleted 2026-08-03).

function LegendItem({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <div className="flex items-center gap-1 text-[10px] text-gray-600 dark:text-slate-300">
      <div className="w-6" style={{ borderTopWidth: 1.5, borderTopStyle: dashed ? 'dashed' : 'solid', borderTopColor: color }} />
      {label}
    </div>
  )
}
