import { useEffect, useMemo, useRef, useState } from 'react'
import { Database, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react'

import type {
  BoreholeDetailResponse,
  VirtueleBoringInvestigationPrediction,
  VirtueleBoringLayer,
} from '../api/client'
import {
  maxCharsForWidth,
  maxLinesForHeight,
  wrapLabelToLines,
} from '../utils/labelWrap'
import { SoilPatterns } from '../utils/soilPatterns'
import { useVirtueleBoringCatalog } from '../hooks/useVirtueleBoringCatalog'
import { isTypingTarget } from '../utils/keyboard'
import LabTestPanel from './LabTestPanel'
import {
  BASE_PX_PER_M,
  DRILL_TRACK_WIDTH,
  FIELD_LOG_TRACK_WIDTH,
  HEADER_HEIGHT,
  SAMPLES_TRACK_WIDTH,
  SVG_X_PAD,
  SVG_Y_PAD,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
} from './borelog/constants'
import {
  computeLayout,
  humanizeObservationType,
  PxPerMContext,
} from './borelog/utils'
import { BoreholeHeader } from './borelog/components/BoreholeHeader'
import { DrillMethodTrack } from './borelog/components/DrillMethodTrack'
import { FieldLogTrack } from './borelog/components/FieldLogTrack'
import { GroundwaterLine } from './borelog/components/GroundwaterLine'
import { Legend } from './borelog/components/Legend'
import { MTawAxis } from './borelog/components/MTawAxis'
import { ObservationTrack } from './borelog/components/ObservationTrack'
import { SamplesTrack } from './borelog/components/SamplesTrack'
import { SelectedSampleMarker } from './borelog/components/SelectedSampleMarker'
import { TrackHeader } from './borelog/components/TrackHeader'

// PR 4b–4d — full-feature borelog modelled on DOV's Rapport BoorProfiel:
//
// * Header strip (HTML)
// * SVG canvas with:
//   - mTAW axis on the left (when surface elevation known)
//   - One vertical track per observation stream (lithology with hatching
//     patterns; stratigraphy with plain text labels)
//   - Drill-method track (when drill_segments present)
//   - Field-log track (3 sub-stripes: color / moisture / consistency)
//   - Samples track with clickable per-test icons
//   - Groundwater horizontal dashed line
// * Legend (HTML) — only items actually used in this borehole
// * LabTestPanel slide-in (HTML overlay) when a sample is clicked
//
// The canvas is one big SVG element so patterns, click-targets, and the
// groundwater line all share the same coordinate space. Layout is computed
// once via ``computeLayout`` so x-offsets stay aligned.

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

interface Props {
  borehole: BoreholeDetailResponse
  // Called when the user saves a new elevation in the header editor.
  // Optional so existing call sites (tests, future read-only views) can
  // mount the borelog without wiring an API path. The editor hides the
  // pencil/clear affordances when this is omitted. ``zEpsg`` carries the
  // user's pick from the editor's datum dropdown (mTAW / NAP); it's
  // ``null`` when the value is being cleared.
  onElevationChange?: (elevationM: number | null, zEpsg: number | null) => Promise<void>
  // DOV Virtuele Boring overlay — informative-only ghost columns
  // rendered to the right of the existing tracks inside the same
  // SVG (so they scroll together). The toggle button in the toolbar
  // flips the per-pane visibility; the picker (model selection +
  // depth) lives on the section pane.
  virtueleBoringPrediction?: VirtueleBoringInvestigationPrediction | null
  // Effective model list for this pane — App.tsx resolves the
  // override-vs-section pick before passing here.
  virtueleBoringActiveModels?: readonly string[]
  virtueleBoringMaxDepthM?: number | null
  virtueleBoringVisible?: boolean
  onToggleVirtueleBoringVisible?: () => void
  // Per-pane model override. "" = follow section.
  virtueleBoringOverrideModel?: string
  onChangeVirtueleBoringOverrideModel?: (next: string) => void
  // True while the predictions network fetch is in flight. Surfaces a
  // spinner next to the DOV button so the pane doesn't appear hung.
  virtueleBoringLoading?: boolean
}

// Per-model ghost-column width inside the borelog. Same vocabulary
// as the section view + CPT depth column for visual consistency.
const VB_COLUMN_WIDTH = 50
const VB_COLUMN_GAP = 4
const VB_GAP_FROM_TRACKS = 8
const VB_LABEL_FONT_SIZE = 9

export default function BoreholeLog({
  borehole,
  onElevationChange,
  virtueleBoringPrediction = null,
  virtueleBoringActiveModels = [],
  virtueleBoringMaxDepthM = null,
  virtueleBoringVisible = false,
  onToggleVirtueleBoringVisible,
  virtueleBoringOverrideModel = '',
  onChangeVirtueleBoringOverrideModel,
  virtueleBoringLoading = false,
}: Props): React.ReactElement {
  const virtueleBoringCatalog = useVirtueleBoringCatalog(
    onChangeVirtueleBoringOverrideModel !== undefined,
  )
  const [selectedSampleId, setSelectedSampleId] = useState<string | null>(null)

  // Vertical zoom — broadcast via PxPerMContext so deeply nested track
  // sub-components don't need prop drilling. ``zoomFactor`` is a multiplier
  // on BASE_PX_PER_M; +/- buttons clamp it to [ZOOM_MIN, ZOOM_MAX].
  const [zoomFactor, setZoomFactor] = useState(1.0)
  const pxPerM = BASE_PX_PER_M * zoomFactor

  const layout = useMemo(() => computeLayout(borehole, pxPerM), [borehole, pxPerM])

  // Width of the DOV Virtuele Boring ghost-column rail rendered to
  // the right of the borelog's normal tracks. Zero when the overlay
  // is off or no models are armed; otherwise one slim column per
  // active model with a small gap between them.
  const overlayShows =
    virtueleBoringVisible && virtueleBoringActiveModels.length > 0
  const vbRailWidth = overlayShows
    ? VB_GAP_FROM_TRACKS +
      virtueleBoringActiveModels.length * VB_COLUMN_WIDTH +
      Math.max(0, virtueleBoringActiveModels.length - 1) * VB_COLUMN_GAP
    : 0
  const vbRailLeftX = layout.totalWidth - SVG_X_PAD + VB_GAP_FROM_TRACKS
  const svgWidth = layout.totalWidth + vbRailWidth

  const selectedSample =
    selectedSampleId != null
      ? (borehole.samples.find(s => s.id === selectedSampleId) ?? null)
      : null

  function zoomIn(): void {
    setZoomFactor(z => Math.min(ZOOM_MAX, z * ZOOM_STEP))
  }
  function zoomOut(): void {
    setZoomFactor(z => Math.max(ZOOM_MIN, z / ZOOM_STEP))
  }
  function zoomReset(): void {
    setZoomFactor(1.0)
  }

  // Ctrl+scroll wheel zoom — standard CAD/map UX. We attach via
  // ``addEventListener`` (NOT React's ``onWheel``) because React wheel
  // handlers are passive-by-default and ``preventDefault`` is a no-op
  // there; we need preventDefault to stop the page from also scrolling
  // while the user is zooming.
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    function onWheel(e: WheelEvent): void {
      if (!e.ctrlKey) return
      e.preventDefault()
      // ``deltaY`` < 0 means wheel-up = zoom in, > 0 means wheel-down =
      // zoom out. Same convention as image viewers / map tools.
      setZoomFactor(z => {
        const next = e.deltaY < 0 ? z * ZOOM_STEP : z / ZOOM_STEP
        return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next))
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Ctrl+0 resets vertical zoom to 100 %. Standard convention across
  // browsers / image viewers / IDEs. Skipped when an input owns focus.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (!(e.ctrlKey || e.metaKey)) return
      if (e.key === '0' && !isTypingTarget(e.target)) {
        e.preventDefault()
        zoomReset()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  // Auto-scroll the borelog so the selected sample's depth interval is
  // centred in the visible viewport. Fires ONLY on sample-id change —
  // re-running on zoom changes turned out to fight the user mid-wheel-
  // zoom (every wheel-tick re-triggered a smooth-scroll animation,
  // pulling the viewport away from where they were aiming). Reading
  // the latest ``pxPerM`` via a ref keeps the math correct without
  // re-firing the effect.
  const pxPerMRef = useRef(pxPerM)
  pxPerMRef.current = pxPerM
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el || !selectedSample) return
    const midDepth = (selectedSample.depth_top_m + selectedSample.depth_base_m) / 2
    const sampleY = SVG_Y_PAD + HEADER_HEIGHT + midDepth * pxPerMRef.current
    const targetTop = sampleY - el.clientHeight / 2
    el.scrollTo({
      top: Math.max(0, targetTop),
      behavior: 'smooth',
    })
  }, [selectedSample?.id])

  return (
    <PxPerMContext.Provider value={pxPerM}>
    <div className="flex flex-col h-full overflow-hidden bg-white dark:bg-slate-900">
      <BoreholeHeader borehole={borehole} onElevationChange={onElevationChange} />

      {/* Toolbar above the canvas — currently zoom controls only. */}
      <div className="flex items-center gap-1 px-3 py-1 border-b border-gray-100 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 text-[11px]">
        <button
          onClick={zoomOut}
          disabled={zoomFactor <= ZOOM_MIN + 1e-6}
          title="Zoom out (vertical scale)"
          className="p-1 rounded hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-600 dark:text-slate-300 disabled:text-gray-300 dark:disabled:text-slate-600 disabled:cursor-not-allowed"
        >
          <ZoomOut size={13} />
        </button>
        <button
          onClick={zoomIn}
          disabled={zoomFactor >= ZOOM_MAX - 1e-6}
          title="Zoom in (vertical scale)"
          className="p-1 rounded hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-600 dark:text-slate-300 disabled:text-gray-300 dark:disabled:text-slate-600 disabled:cursor-not-allowed"
        >
          <ZoomIn size={13} />
        </button>
        <button
          onClick={zoomReset}
          disabled={Math.abs(zoomFactor - 1) < 1e-6}
          title="Reset zoom to 1×"
          className="p-1 rounded hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-600 dark:text-slate-300 disabled:text-gray-300 dark:disabled:text-slate-600 disabled:cursor-not-allowed"
        >
          <Maximize2 size={13} />
        </button>
        <span className="text-gray-400 dark:text-slate-500 ml-1 tabular-nums">
          {(zoomFactor * 100).toFixed(0)}%
        </span>
        {/* DOV overlay toggle + override picker. The button flips
            visibility; the dropdown selects which model THIS pane
            shows ("Follow section" inherits modelA/modelB; a
            specific code renders only that one). */}
        {onToggleVirtueleBoringVisible !== undefined && (
          <div className="flex items-center gap-1 ml-auto">
            {/* Spinner shown while the predictions fetch is in flight
                so the pane doesn't look unresponsive after model pick. */}
            {virtueleBoringLoading && (
              <span
                aria-label="Loading DOV predictions"
                className="inline-block w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"
              />
            )}
            <button
              onClick={onToggleVirtueleBoringVisible}
              disabled={virtueleBoringActiveModels.length === 0}
              aria-pressed={virtueleBoringVisible}
              aria-label="Toggle DOV Virtuele Boring overlay"
              title={
                virtueleBoringActiveModels.length === 0
                  ? 'Pick a DOV model in the dropdown or the section pane to enable this overlay'
                  : virtueleBoringVisible
                    ? 'Hide DOV Virtuele Boring overlay'
                    : 'Show DOV Virtuele Boring overlay'
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
              DOV
            </button>
            {onChangeVirtueleBoringOverrideModel !== undefined && (
              <select
                value={virtueleBoringOverrideModel}
                onChange={e => onChangeVirtueleBoringOverrideModel(e.target.value)}
                disabled={virtueleBoringCatalog === null}
                title="Override which DOV model this pane shows"
                aria-label="DOV overlay model for this pane"
                className="h-6 px-1 border border-gray-200 dark:border-slate-600 rounded text-[10px] bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200 max-w-[160px]"
              >
                <option value="">Follow section</option>
                {(virtueleBoringCatalog ?? []).map(entry => (
                  <option key={entry.code} value={entry.code}>
                    {entry.beschrijving}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
      </div>

      {/* Horizontal split: borelog (flex-1, scrolls) + lab panel (fixed
          420px, only when a sample is selected). Switching from the old
          absolute-overlay pattern means the borelog stays visible and
          interactive while the user reads lab tests — it just gets
          narrower. The borelog's internal SVG already has its own
          horizontal scroll, so cropping the visible viewport doesn't
          hide tracks; the user can scroll within the borelog area. */}
      <div className="flex-1 flex flex-row overflow-hidden">
        <div ref={scrollContainerRef} className="flex-1 overflow-auto">
          <svg
            width={svgWidth}
            height={layout.totalHeight}
            className="block"
          >
          <defs>
            <SoilPatterns />
          </defs>

          {/* mTAW axis only renders when surface elevation is known.
              The "needs Z" affordances live elsewhere now: the amber
              "Set elevation" link in the header is the action; the
              footer legend explains the consequence ("borelog renders
              without absolute level axis"). The earlier in-canvas
              ``no Z (manual entry needed)`` SVG label was clipped by
              the first track header at default zoom, so it's been
              removed — three flagging surfaces was already one too
              many. */}
          {borehole.elevation_m != null && (
            <MTawAxis
              x={SVG_X_PAD}
              y={SVG_Y_PAD + HEADER_HEIGHT}
              height={layout.canvasHeight}
              surfaceElevation={borehole.elevation_m}
              totalDepth={layout.totalDepth}
              zEpsg={borehole.z_epsg}
            />
          )}

          {/* Observation tracks */}
          {layout.observationTracks.map(t => (
            <g key={t.observation.id}>
              <TrackHeader
                x={t.x}
                width={t.width}
                y={SVG_Y_PAD}
                title={humanizeObservationType(t.observation.observation_type)}
                subtitle={[t.observation.author, t.observation.observation_date]
                  .filter(Boolean)
                  .join(' · ')}
              />
              <ObservationTrack
                observation={t.observation}
                x={t.x}
                y={SVG_Y_PAD + HEADER_HEIGHT}
                width={t.width}
                totalDepth={layout.totalDepth}
              />
            </g>
          ))}

          {/* Drill method track */}
          {layout.drillMethodX != null && (
            <g>
              <TrackHeader
                x={layout.drillMethodX}
                width={DRILL_TRACK_WIDTH}
                y={SVG_Y_PAD}
                title="Drill method"
                subtitle={null}
              />
              <DrillMethodTrack
                segments={borehole.drill_segments}
                x={layout.drillMethodX}
                y={SVG_Y_PAD + HEADER_HEIGHT}
                width={DRILL_TRACK_WIDTH}
                totalDepth={layout.totalDepth}
              />
            </g>
          )}

          {/* Field log track */}
          {layout.fieldLogX != null && (
            <g>
              <TrackHeader
                x={layout.fieldLogX}
                width={FIELD_LOG_TRACK_WIDTH}
                y={SVG_Y_PAD}
                title="Field log"
                subtitle="col · mst · con"
              />
              <FieldLogTrack
                intervals={borehole.field_log_intervals}
                x={layout.fieldLogX}
                y={SVG_Y_PAD + HEADER_HEIGHT}
              />
            </g>
          )}

          {/* Samples track — clickable */}
          {layout.samplesX != null && (
            <g>
              <TrackHeader
                x={layout.samplesX}
                width={SAMPLES_TRACK_WIDTH}
                y={SVG_Y_PAD}
                title="Samples + lab tests"
                subtitle={`${borehole.samples.length} sample${borehole.samples.length !== 1 ? 's' : ''}`}
              />
              <SamplesTrack
                samples={borehole.samples}
                x={layout.samplesX}
                y={SVG_Y_PAD + HEADER_HEIGHT}
                width={SAMPLES_TRACK_WIDTH}
                selectedSampleId={selectedSampleId}
                onSampleClick={setSelectedSampleId}
              />
            </g>
          )}

          {/* Groundwater line spanning every track */}
          {borehole.water_table_depth_m != null && layout.canvasRight > layout.canvasLeft && (
            <GroundwaterLine
              waterDepth={borehole.water_table_depth_m}
              fromX={layout.canvasLeft}
              toX={layout.canvasRight}
              y={SVG_Y_PAD + HEADER_HEIGHT}
              totalDepth={layout.totalDepth}
            />
          )}

          {/* Selected-sample depth marker — translucent yellow band
              drawn LAST so it sits on top of every track. The user can
              instantly see "you are here" while reading the lab pane,
              even when the borelog has dozens of layers and tracks.
              For spot samples (top == base) we force a 4-pixel minimum
              band height so it stays visible. */}
          {selectedSample && (
            <SelectedSampleMarker
              sample={selectedSample}
              fromX={SVG_X_PAD}
              toX={layout.canvasRight}
              y={SVG_Y_PAD + HEADER_HEIGHT}
            />
          )}

          {/* DOV Virtuele Boring ghost rail — slim labelled columns
              rendered next to the borelog's tracks, sharing the
              same depth-pixel scale (pxPerM) so layers align with
              the lithology / sample tracks pixel-for-pixel. */}
          {overlayShows && (
            <VirtueleBoringBorelogRail
              prediction={virtueleBoringPrediction}
              activeModels={virtueleBoringActiveModels}
              surfaceElevationM={borehole.elevation_m ?? null}
              maxDepthMBelowSurface={virtueleBoringMaxDepthM}
              leftX={vbRailLeftX}
              topY={SVG_Y_PAD + HEADER_HEIGHT}
              pxPerM={pxPerM}
              totalDepthM={layout.totalDepth}
            />
          )}
          </svg>
        </div>

        {selectedSample && (
          <LabTestPanel
            sample={selectedSample}
            // Pass the full sibling list so the panel can nav prev/next.
            // Sorted by depth so navigation feels physical (top-to-bottom
            // through the borehole) rather than database-insertion order.
            allSamples={[...borehole.samples].sort(
              (a, b) => a.depth_top_m - b.depth_top_m,
            )}
            onSelectSample={setSelectedSampleId}
            onClose={() => setSelectedSampleId(null)}
          />
        )}
      </div>

      <Legend borehole={borehole} />
    </div>
    </PxPerMContext.Provider>
  )
}

// ---------------------------------------------------------------------------
// VirtueleBoringBorelogRail — informative-only DOV overlay rendered
// inside the borelog SVG so it scrolls with the rest of the tracks.
// ---------------------------------------------------------------------------

function VirtueleBoringBorelogRail({
  prediction,
  activeModels,
  surfaceElevationM,
  maxDepthMBelowSurface,
  leftX,
  topY,
  pxPerM,
  totalDepthM,
}: {
  prediction: VirtueleBoringInvestigationPrediction | null
  activeModels: readonly string[]
  surfaceElevationM: number | null
  maxDepthMBelowSurface: number | null
  leftX: number
  topY: number
  pxPerM: number
  totalDepthM: number
}): JSX.Element | null {
  if (!prediction || surfaceElevationM === null) {
    return (
      <text x={leftX} y={topY + 12} fontSize={9} fill="#9ca3af">
        no data
      </text>
    )
  }
  return (
    <g data-testid="virtuele-boring-borelog-rail">
      {activeModels.map((modelCode, modelIdx) => {
        const layers = prediction.predictions_by_model[modelCode]
        if (!layers || layers.length === 0) return null
        const left = leftX + modelIdx * (VB_COLUMN_WIDTH + VB_COLUMN_GAP)
        return (
          <g key={modelCode} data-testid={`vb-rail-${modelCode}`}>
            <text
              x={left + VB_COLUMN_WIDTH / 2}
              y={topY - 4}
              textAnchor="middle"
              fontSize={9}
              fill="#6b7280"
            >
              {modelCode}
            </text>
            {layers.map(layer => (
              <BorelogRailLayer
                key={`${layer.code}-${layer.top_m_taw}`}
                layer={layer}
                left={left}
                width={VB_COLUMN_WIDTH}
                surfaceElevationM={surfaceElevationM}
                topY={topY}
                pxPerM={pxPerM}
                totalDepthM={totalDepthM}
                maxDepthMBelowSurface={maxDepthMBelowSurface}
              />
            ))}
          </g>
        )
      })}
    </g>
  )
}

function BorelogRailLayer({
  layer,
  left,
  width,
  surfaceElevationM,
  topY,
  pxPerM,
  totalDepthM,
  maxDepthMBelowSurface,
}: {
  layer: VirtueleBoringLayer
  left: number
  width: number
  surfaceElevationM: number
  topY: number
  pxPerM: number
  totalDepthM: number
  maxDepthMBelowSurface: number | null
}): JSX.Element | null {
  const layerDepthTop = Math.max(0, surfaceElevationM - layer.top_m_taw)
  let layerDepthBase = surfaceElevationM - layer.base_m_taw
  if (maxDepthMBelowSurface !== null && layerDepthTop >= maxDepthMBelowSurface) {
    return null
  }
  if (maxDepthMBelowSurface !== null && layerDepthBase > maxDepthMBelowSurface) {
    layerDepthBase = maxDepthMBelowSurface
  }
  // Clip to the borelog's total depth so a much-deeper DOV layer
  // doesn't paint below the lithology tracks.
  if (layerDepthBase > totalDepthM) layerDepthBase = totalDepthM
  if (layerDepthBase <= 0 || layerDepthTop >= totalDepthM) return null
  const yTop = topY + layerDepthTop * pxPerM
  const yBase = topY + layerDepthBase * pxPerM
  const height = yBase - yTop
  if (height <= 0.3) return null
  const fill = layer.color_hex ?? '#9ca3af'
  const label = layer.beschrijving || layer.name
  const tooltip = `${label}: ${layer.top_m_taw.toFixed(2)} → ${layer.base_m_taw.toFixed(2)} mTAW (${layer.thickness_m.toFixed(2)} m)`
  const maxLines = maxLinesForHeight(height, VB_LABEL_FONT_SIZE)
  const lines = maxLines > 0
    ? wrapLabelToLines(label, maxCharsForWidth(width, VB_LABEL_FONT_SIZE), maxLines)
    : []
  const lineHeight = VB_LABEL_FONT_SIZE * 1.15
  const blockHeight = lineHeight * lines.length
  const firstBaselineY =
    yTop + height / 2 - blockHeight / 2 + VB_LABEL_FONT_SIZE * 0.8
  return (
    <g>
      <rect
        x={left}
        y={yTop}
        width={width}
        height={height}
        fill={fill}
        fillOpacity={0.55}
        stroke={fill}
        strokeOpacity={0.75}
        strokeWidth={0.5}
      >
        <title>{tooltip}</title>
      </rect>
      {lines.length > 0 && (
        <text
          x={left + width / 2}
          y={firstBaselineY}
          textAnchor="middle"
          fontSize={VB_LABEL_FONT_SIZE}
          fill="#111827"
          style={{ pointerEvents: 'none' }}
        >
          {lines.map((line, i) => (
            <tspan key={i} x={left + width / 2} dy={i === 0 ? 0 : lineHeight}>
              {line}
            </tspan>
          ))}
          <title>{tooltip}</title>
        </text>
      )}
    </g>
  )
}
