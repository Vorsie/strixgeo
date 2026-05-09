import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react'

import type {
  BoreholeDetailResponse,
  DrillSegmentResponse,
  FieldLogIntervalResponse,
  ObservationLayerResponse,
  ObservationResponse,
  SampleResponse,
} from '../api/client'
import { soilStyle } from '../utils/soilColors'
import { SoilPatterns, getSoilFillUrl } from '../utils/soilPatterns'
import { drillMethodStyle } from '../utils/drillMethodColors'
import { isTypingTarget } from '../utils/keyboard'
import {
  consistencyFill,
  fieldColorFill,
  moistureFill,
} from '../utils/fieldLogColors'
import LabTestPanel from './LabTestPanel'

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
// Geometry constants
// ---------------------------------------------------------------------------

// Default depth scale: 60 pixels per metre. Zoomable at runtime —
// BoreholeLog owns a ``zoomFactor`` state and broadcasts the effective
// scale via ``PxPerMContext``. Sub-components consume the context and
// re-render whenever the user clicks zoom-in / zoom-out / reset.
const BASE_PX_PER_M = 60
const ZOOM_MIN = 0.4
const ZOOM_MAX = 4.0
const ZOOM_STEP = 1.25
const PxPerMContext = createContext<number>(BASE_PX_PER_M)
function usePxPerM(): number {
  return useContext(PxPerMContext)
}
// Per-track widths. Lithology tracks (geotechnical coding, coded
// lithology, lithological description) carry a lot of per-layer text
// (soil codes + admixtures) so they get the wider 150 px. Stratigraphy
// tracks just hold short formation codes (``A`` / ``Q`` / ``HyEg``) per
// layer — 150 px is wasteful, the column is mostly empty. 90 px gives
// the borelog a more compact left-to-right footprint when 4–5
// stratigraphy interpretations land alongside the lithology stream.
const OBS_TRACK_WIDTH_LITHOLOGY = 150
const OBS_TRACK_WIDTH_STRATIGRAPHY = 90
const HEADER_HEIGHT = 72 // px — diagonal track headers
const M_TAW_AXIS_WIDTH = 64
const DRILL_TRACK_WIDTH = 90
const FIELD_LOG_SUB_WIDTH = 36
const FIELD_LOG_TRACK_WIDTH = FIELD_LOG_SUB_WIDTH * 3
const SAMPLES_TRACK_WIDTH = 220
const TRACK_GAP = 1
const SVG_X_PAD = 16
const SVG_Y_PAD = 8

// Lithology streams render with soil patterns; stratigraphy streams use plain
// labelled rectangles (formation codes A / Q / HyEg, no soil meaning).
const LITHOLOGY_TYPES = new Set([
  'coded_lithology',
  'geotechnical_coding',
])
const STRATIGRAPHY_TYPES = new Set([
  'formal_stratigraphy',
  'informal_stratigraphy',
  'quaternary_stratigraphy',
  'hydrogeological_stratigraphy',
  'informal_hydrogeological_stratigraphy',
])
// Free-text descriptions render as labelled rectangles too.
// (lithological_description has free text but no soil codes.)

// Stable display order — driller's record first, engineer's reinterpretation
// next, then text descriptions, then the four stratigraphy flavours.
const OBSERVATION_TYPE_ORDER = [
  'coded_lithology',
  'geotechnical_coding',
  'lithological_description',
  'formal_stratigraphy',
  'informal_stratigraphy',
  'quaternary_stratigraphy',
  'hydrogeological_stratigraphy',
  'informal_hydrogeological_stratigraphy',
]

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

interface Props {
  borehole: BoreholeDetailResponse
}

export default function BoreholeLog({ borehole }: Props): React.ReactElement {
  const [selectedSampleId, setSelectedSampleId] = useState<string | null>(null)

  // Vertical zoom — broadcast via PxPerMContext so deeply nested track
  // sub-components don't need prop drilling. ``zoomFactor`` is a multiplier
  // on BASE_PX_PER_M; +/- buttons clamp it to [ZOOM_MIN, ZOOM_MAX].
  const [zoomFactor, setZoomFactor] = useState(1.0)
  const pxPerM = BASE_PX_PER_M * zoomFactor

  const layout = useMemo(() => computeLayout(borehole, pxPerM), [borehole, pxPerM])

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
    <div className="flex flex-col h-full overflow-hidden bg-white">
      <BoreholeHeader borehole={borehole} />

      {/* Toolbar above the canvas — currently zoom controls only. */}
      <div className="flex items-center gap-1 px-3 py-1 border-b border-gray-100 bg-gray-50 text-[11px]">
        <button
          onClick={zoomOut}
          disabled={zoomFactor <= ZOOM_MIN + 1e-6}
          title="Zoom out (vertical scale)"
          className="p-1 rounded hover:bg-gray-200 text-gray-600 disabled:text-gray-300 disabled:cursor-not-allowed"
        >
          <ZoomOut size={13} />
        </button>
        <button
          onClick={zoomIn}
          disabled={zoomFactor >= ZOOM_MAX - 1e-6}
          title="Zoom in (vertical scale)"
          className="p-1 rounded hover:bg-gray-200 text-gray-600 disabled:text-gray-300 disabled:cursor-not-allowed"
        >
          <ZoomIn size={13} />
        </button>
        <button
          onClick={zoomReset}
          disabled={Math.abs(zoomFactor - 1) < 1e-6}
          title="Reset zoom to 1×"
          className="p-1 rounded hover:bg-gray-200 text-gray-600 disabled:text-gray-300 disabled:cursor-not-allowed"
        >
          <Maximize2 size={13} />
        </button>
        <span className="text-gray-400 ml-1 tabular-nums">
          {(zoomFactor * 100).toFixed(0)}%
        </span>
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
            width={layout.totalWidth}
            height={layout.totalHeight}
            className="block"
          >
          <defs>
            <SoilPatterns />
          </defs>

          {borehole.elevation_m != null ? (
            <MTawAxis
              x={SVG_X_PAD}
              y={SVG_Y_PAD + HEADER_HEIGHT}
              height={layout.canvasHeight}
              surfaceElevation={borehole.elevation_m}
              totalDepth={layout.totalDepth}
            />
          ) : (
            <NoElevationLabel x={SVG_X_PAD} y={SVG_Y_PAD + HEADER_HEIGHT - 14} />
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
// Layout — single source of truth for x positions and dimensions
// ---------------------------------------------------------------------------

interface ObservationTrackLayout {
  observation: ObservationResponse
  x: number
  width: number
}

function widthForObservationType(observationType: string): number {
  return STRATIGRAPHY_TYPES.has(observationType)
    ? OBS_TRACK_WIDTH_STRATIGRAPHY
    : OBS_TRACK_WIDTH_LITHOLOGY
}

interface Layout {
  totalWidth: number
  totalHeight: number
  totalDepth: number
  canvasHeight: number
  canvasLeft: number // x where the first track starts (for groundwater line)
  canvasRight: number // x where the last track ends (for groundwater line)
  observationTracks: ObservationTrackLayout[]
  drillMethodX: number | null
  fieldLogX: number | null
  samplesX: number | null
}

function computeLayout(borehole: BoreholeDetailResponse, pxPerM: number): Layout {
  // Observations to render — only those with at least one layer, in stable
  // display order (driller's record first, engineer's next, then the
  // stratigraphy flavours).
  const observationsToShow = [...borehole.observations]
    .filter(o => o.layers.length > 0)
    .sort((a, b) => {
      const ai = OBSERVATION_TYPE_ORDER.indexOf(a.observation_type)
      const bi = OBSERVATION_TYPE_ORDER.indexOf(b.observation_type)
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
    })

  // Total depth: take the deepest extent across header + every layer + every
  // drill segment + every sample so the canvas covers everything that needs
  // drawing.
  const candidates: number[] = [borehole.total_depth_m ?? 0]
  for (const o of observationsToShow) {
    for (const l of o.layers) candidates.push(l.base_m)
  }
  for (const s of borehole.drill_segments) candidates.push(s.base_m)
  for (const sa of borehole.samples) candidates.push(sa.depth_base_m)
  const totalDepth = Math.max(...candidates, 1)

  const canvasHeight = totalDepth * pxPerM

  // X cursor — start with mTAW axis (always reserved, even when elevation is
  // null, so headers align consistently), then accumulate per-track widths.
  let cursor = SVG_X_PAD + M_TAW_AXIS_WIDTH + TRACK_GAP
  const canvasLeft = cursor

  const observationTracks: ObservationTrackLayout[] = []
  for (const o of observationsToShow) {
    const width = widthForObservationType(o.observation_type)
    observationTracks.push({ observation: o, x: cursor, width })
    cursor += width + TRACK_GAP
  }

  let drillMethodX: number | null = null
  if (borehole.drill_segments.length > 0) {
    drillMethodX = cursor
    cursor += DRILL_TRACK_WIDTH + TRACK_GAP
  }

  let fieldLogX: number | null = null
  if (borehole.field_log_intervals.length > 0) {
    fieldLogX = cursor
    cursor += FIELD_LOG_TRACK_WIDTH + TRACK_GAP
  }

  let samplesX: number | null = null
  if (borehole.samples.length > 0) {
    samplesX = cursor
    cursor += SAMPLES_TRACK_WIDTH + TRACK_GAP
  }

  const canvasRight = cursor - TRACK_GAP
  const totalWidth = canvasRight + SVG_X_PAD
  const totalHeight = SVG_Y_PAD + HEADER_HEIGHT + canvasHeight + SVG_Y_PAD

  return {
    totalWidth,
    totalHeight,
    totalDepth,
    canvasHeight,
    canvasLeft,
    canvasRight,
    observationTracks,
    drillMethodX,
    fieldLogX,
    samplesX,
  }
}

// ---------------------------------------------------------------------------
// Header strip (HTML)
// ---------------------------------------------------------------------------

function BoreholeHeader({ borehole }: { borehole: BoreholeDetailResponse }): React.ReactElement {
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-1 px-4 py-2 border-b border-gray-200 bg-gray-50 text-[11px] shrink-0">
      <Field label="Boring" value={borehole.name} bold />
      <Field
        label="X / Y"
        value={
          borehole.epsg
            ? `${borehole.location_x.toFixed(1)} / ${borehole.location_y.toFixed(1)} (EPSG:${borehole.epsg})`
            : `${borehole.location_x.toFixed(1)} / ${borehole.location_y.toFixed(1)}`
        }
      />
      <Field
        label="Z (mTAW)"
        value={borehole.elevation_m != null ? borehole.elevation_m.toFixed(2) : '— missing —'}
        warn={borehole.elevation_m == null}
      />
      <Field
        label="Depth"
        value={borehole.total_depth_m != null ? `0 – ${borehole.total_depth_m.toFixed(2)} m` : '—'}
      />
      <Field label="Date" value={borehole.start_date ?? '—'} />
      <Field label="Executor" value={borehole.executor ?? '—'} />
      {borehole.water_table_depth_m != null && (
        <Field label="Water at" value={`${borehole.water_table_depth_m.toFixed(2)} m`} />
      )}
      {borehole.drill_method && <Field label="Method" value={borehole.drill_method} />}
    </div>
  )
}

function Field({
  label,
  value,
  bold,
  warn,
}: {
  label: string
  value: string
  bold?: boolean
  warn?: boolean
}): React.ReactElement {
  return (
    <div className="flex flex-col leading-tight">
      <span className="text-[9px] uppercase tracking-wide text-gray-400">{label}</span>
      <span
        className={[
          'text-gray-700',
          bold ? 'font-semibold' : '',
          warn ? 'text-amber-600 italic' : '',
        ].join(' ')}
      >
        {value}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// mTAW axis (SVG)
// ---------------------------------------------------------------------------

function MTawAxis({
  x,
  y,
  height,
  surfaceElevation,
  totalDepth,
}: {
  x: number
  y: number
  height: number
  surfaceElevation: number
  totalDepth: number
}): React.ReactElement {
  const PX_PER_M = usePxPerM()
  // Surface + every whole-metre level + bottom. Dedup so we don't double the
  // surface or bottom when those happen to land on whole metres.
  const bottomElevation = surfaceElevation - totalDepth
  const ticks = new Set<number>()
  ticks.add(roundTo(surfaceElevation, 2))
  for (let lvl = Math.floor(surfaceElevation); lvl > bottomElevation; lvl -= 1) {
    if (lvl < surfaceElevation && lvl > bottomElevation) ticks.add(lvl)
  }
  ticks.add(roundTo(bottomElevation, 2))

  const axisRight = x + M_TAW_AXIS_WIDTH

  return (
    <g>
      {/* Vertical guide line */}
      <line
        x1={axisRight - 1}
        x2={axisRight - 1}
        y1={y}
        y2={y + height}
        stroke="#d4d4d8"
        strokeWidth={1}
      />
      {/* "mTAW" header label */}
      <text
        x={axisRight - 4}
        y={y - 6}
        textAnchor="end"
        fontSize={9}
        fill="#9ca3af"
        style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}
      >
        mTAW
      </text>
      {[...ticks]
        .sort((a, b) => b - a)
        .map(lvl => {
          const depth = surfaceElevation - lvl
          const ty = y + depth * PX_PER_M
          return (
            <g key={lvl}>
              <line x1={axisRight - 6} x2={axisRight - 1} y1={ty} y2={ty} stroke="#9ca3af" />
              <text
                x={axisRight - 8}
                y={ty + 3}
                textAnchor="end"
                fontSize={10}
                fill="#6b7280"
                fontFamily="monospace"
              >
                {formatMtaw(lvl)}
              </text>
            </g>
          )
        })}
    </g>
  )
}

function formatMtaw(lvl: number): string {
  const sign = lvl >= 0 ? '+' : ''
  return `${sign}${lvl.toFixed(2)}`
}

function NoElevationLabel({ x, y }: { x: number; y: number }): React.ReactElement {
  return (
    <text x={x} y={y} fontSize={10} fill="#d97706" fontStyle="italic">
      no Z (manual entry needed)
    </text>
  )
}

// ---------------------------------------------------------------------------
// Track header — diagonal-text title + author/date sub-line (SVG)
// ---------------------------------------------------------------------------

function TrackHeader({
  x,
  width,
  y,
  title,
  subtitle,
}: {
  x: number
  width: number
  y: number
  title: string
  subtitle: string | null
}): React.ReactElement {
  // Render as horizontal text — diagonal looks nice at print sizes but is
  // hard to read at on-screen sizes. Two lines: title + subtitle.
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={HEADER_HEIGHT}
        fill="#fafafa"
        stroke="#e5e7eb"
        strokeWidth={0.5}
      />
      <text
        x={x + 4}
        y={y + 14}
        fontSize={10}
        fontWeight={600}
        fill="#374151"
      >
        {truncate(title, 22)}
      </text>
      {subtitle && (
        <text x={x + 4} y={y + 28} fontSize={9} fill="#9ca3af">
          {truncate(subtitle, 26)}
        </text>
      )}
    </g>
  )
}

// ---------------------------------------------------------------------------
// Observation track (SVG) — one rect per layer + per-layer depth labels
// ---------------------------------------------------------------------------

function ObservationTrack({
  observation,
  x,
  y,
  width,
  totalDepth,
}: {
  observation: ObservationResponse
  x: number
  y: number
  width: number
  totalDepth: number
}): React.ReactElement {
  const PX_PER_M = usePxPerM()
  const isLithology = LITHOLOGY_TYPES.has(observation.observation_type)
  const isStratigraphy = STRATIGRAPHY_TYPES.has(observation.observation_type)
  // Anything not lithology and not stratigraphy renders as text-card style
  // (e.g. lithological_description, free-text).
  const cardStyle = !isLithology

  return (
    <g>
      {/* Background — empty area below the deepest layer */}
      <rect
        x={x}
        y={y}
        width={width}
        height={totalDepth * PX_PER_M}
        fill="#ffffff"
        stroke="#e5e7eb"
        strokeWidth={0.5}
      />
      {observation.layers.map(layer => (
        <ObservationLayerBlock
          key={layer.id}
          layer={layer}
          x={x}
          y={y}
          width={width}
          cardStyle={cardStyle}
          isStratigraphy={isStratigraphy}
        />
      ))}
    </g>
  )
}

function ObservationLayerBlock({
  layer,
  x,
  y,
  width,
  cardStyle,
  isStratigraphy,
}: {
  layer: ObservationLayerResponse
  x: number
  y: number
  width: number
  cardStyle: boolean
  isStratigraphy: boolean
}): React.ReactElement {
  const PX_PER_M = usePxPerM()
  const top = y + layer.top_m * PX_PER_M
  const height = (layer.base_m - layer.top_m) * PX_PER_M
  const primary = layer.main_soil_codes[0] ?? null
  const fillUrl = cardStyle ? '#f8fafc' : getSoilFillUrl(primary)

  // Stratigraphy: centred formation code (e.g. "A", "Q", "HyEg") on a soft
  // tinted background. Lithology: pattern fill + main soil code label in a
  // small white badge near the top-left.
  // Pass the FULL description through; WrappedText decides per-render
  // how much fits given the layer's width and height. Source-side
  // truncation (the old ``truncate(..., 20)``) made narrow layers OK
  // but consistently chopped off text that COULD have wrapped onto a
  // second line.
  const stratLabel = isStratigraphy && layer.description ? layer.description : null
  const lithoBadge = !cardStyle && primary ? primary : null
  const lithoSecondary =
    !cardStyle && layer.main_soil_codes.length > 1
      ? layer.main_soil_codes.slice(1).join(' + ')
      : null
  const admixtureLabel = layer.admixtures
    .map(a => `${a.amount ? a.amount + ' ' : ''}${a.soil_code}${a.locally ? ' (loc.)' : ''}`)
    .join(', ')
  const cardLabel = cardStyle && !isStratigraphy ? layer.description : null

  // Build the hover tooltip — surfaces every fact about the layer.
  const tooltipLines = [
    `${layer.top_m.toFixed(2)} – ${layer.base_m.toFixed(2)} m`,
    layer.color ? `Colour: ${layer.color}` : null,
    layer.main_soil_codes.length > 0 ? `Main: ${layer.main_soil_codes.join(', ')}` : null,
    admixtureLabel ? `Admixtures: ${admixtureLabel}` : null,
    layer.description ? `Description: ${layer.description}` : null,
  ].filter(Boolean)

  // Reserve a right-edge strip for admixtures so even short layers
  // (which can't fit text chips) communicate "this layer has X mixed
  // in" visually. The strip is a vertical stack of small coloured
  // rectangles, one per admixture, using the same SOIL_COLORS palette
  // as the main lithology fills. Stratigraphy / card-style layers
  // don't have admixtures (or shouldn't), so we skip the reservation.
  const hasAdmixtures = !cardStyle && !isStratigraphy && layer.admixtures.length > 0
  // Layout: main lithology fills the LEFT portion of the layer rect;
  // vertical admix strips occupy the RIGHT portion. The main fraction
  // depends on admix intensity:
  //   - no admixtures           → 100 % main, no strips
  //   - only "weinig" admixtures → 80 % main, 20 % strips
  //   - has "matig" or "veel"    → 60 % main, 40 % strips
  // Within the right portion each strip's WIDTH is proportional to its
  // DOV ``amount`` token (veel=3, matig=2, weinig=1).
  const mainFraction = mainLithologyFraction(hasAdmixtures ? layer.admixtures : [])
  const mainWidth = width * mainFraction
  const stripsWidth = width - mainWidth

  return (
    <g>
      <title>{tooltipLines.join('\n')}</title>
      <rect
        x={x}
        y={top}
        width={mainWidth}
        height={height}
        fill={fillUrl}
        stroke="#9ca3af"
        strokeWidth={0.4}
      />

      {hasAdmixtures && stripsWidth > 0 && (
        <AdmixtureStrip
          admixtures={layer.admixtures}
          x={x + mainWidth}
          y={top}
          width={stripsWidth}
          height={height}
        />
      )}

      {/* Stratigraphy: centred formation code, wrapped to fit the column.
          Long descriptions like "Paleogeen: Formatie van Kortrijk - Lid
          van Roubaix" overflow visually if rendered as a single line into
          the narrow stratigraphy track; we wrap onto multiple lines when
          there's vertical room and truncate per-line so each line fits
          the column width. */}
      {stratLabel && height >= 16 && (
        <WrappedText
          text={stratLabel}
          centerX={x + width / 2}
          centerY={top + height / 2}
          maxWidth={width - 6}
          maxHeight={height - 4}
          fontSize={11}
          fontWeight={600}
          fill="#1f2937"
        />
      )}

      {/* Lithology: small badge with the main code(s), top-left of the
          main fill (does NOT extend over the admixture strips). */}
      {lithoBadge && height >= 14 && (
        <g>
          <rect
            x={x + 2}
            y={top + 2}
            width={Math.min(mainWidth - 4, 18 + lithoBadge.length * 6)}
            height={12}
            rx={1}
            fill="white"
            opacity={0.85}
          />
          <text
            x={x + 5}
            y={top + 11}
            fontSize={9}
            fontWeight={600}
            fontFamily="monospace"
            fill="#1f2937"
          >
            {lithoBadge}
            {lithoSecondary ? ` + ${lithoSecondary}` : ''}
          </text>
        </g>
      )}

      {/* Lithology: admixtures rendered as swatch + text chips along the
          bottom of the layer block. Each chip is a small colour square
          (using the same SOIL_COLORS palette as the main fills) followed by
          the qualifier + soil code, so the reader can spot the admixture
          family at a glance even when the code is unfamiliar. Chips wrap
          to a second row when the layer is tall enough; otherwise the row
          is truncated to fit the available width. */}
      {hasAdmixtures && height >= 24 && (
        <AdmixtureChips
          admixtures={layer.admixtures}
          x={x + 3}
          // Chip baseline sits at the bottom of the main fill area.
          y={top + height - 4}
          // Chip text must not overflow into the right-side admix strips.
          maxWidth={mainWidth - 6}
        />
      )}

      {/* Free-text card label (for lithological_description) */}
      {cardLabel && height >= 14 && (
        <text x={x + 4} y={top + 12} fontSize={9} fill="#374151">
          {truncate(cardLabel, Math.floor(width / 5))}
        </text>
      )}

      {/* Per-layer top-edge depth label, mirrors DOV's PDF style */}
      <text
        x={x + width - 3}
        y={top + 8}
        textAnchor="end"
        fontSize={8}
        fill="#6b7280"
        fontFamily="monospace"
      >
        {layer.top_m.toFixed(2)}
      </text>
      {/* Bottom label only when the layer is tall enough that it wouldn't
          overlap the next layer's top label. */}
      {height >= 14 && (
        <text
          x={x + width - 3}
          y={top + height - 3}
          textAnchor="end"
          fontSize={8}
          fill="#6b7280"
          fontFamily="monospace"
        >
          {layer.base_m.toFixed(2)}
        </text>
      )}
    </g>
  )
}

// ---------------------------------------------------------------------------
// Admixture strip — right-side vertical slices, widths scaled by amount
// ---------------------------------------------------------------------------

/**
 * Vertical-strip column rendered along the RIGHT side of the layer
 * rect (left side carries the main lithology pattern). Each strip is
 * full-height, with a width proportional to the DOV ``amount`` token
 * (``veel`` = 3× ``weinig``). Strips are arranged left → right in
 * source order, matching DOV's "primary admixture first" convention.
 *
 * Combined with the parent's ``mainLithologyFraction`` rule, the
 * relative on-page area of an admixture is roughly:
 *   weinig only:  20 % overall × (its weight / total weight)
 *   has matig/veel: 40 % overall × (its weight / total weight)
 * So a layer with "veel silt, weinig klei" shows: 60 % main, then a
 * silt strip (3/4 of 40 % = 30 %) and a klei strip (1/4 of 40 % =
 * 10 %). The composition reads at a glance.
 */
function AdmixtureStrip({
  admixtures,
  x,
  y,
  width,
  height,
}: {
  admixtures: { soil_code: string; amount: string; locally: boolean }[]
  x: number
  y: number
  width: number
  height: number
}): React.ReactElement {
  const pcts = admixtures.map(a => pctForAmount(a.amount))
  const totalPct = pcts.reduce((s, p) => s + p, 0) || 1
  let cursor = 0
  return (
    <g>
      {admixtures.map((a, i) => {
        const segWidth = (pcts[i] / totalPct) * width
        const segX = x + cursor
        cursor += segWidth
        return (
          <rect
            key={i}
            // Add a hair of overlap on inner segments so anti-aliasing
            // doesn't leave a 1-pixel gap between adjacent fills.
            x={segX}
            y={y}
            width={i < admixtures.length - 1 ? segWidth + 0.5 : segWidth}
            height={height}
            fill={soilStyle(a.soil_code).fill}
            stroke="#374151"
            strokeWidth={0.3}
          >
            <title>
              {`${a.amount ? a.amount + ' ' : ''}${a.soil_code}${a.locally ? ' (loc.)' : ''}`}
            </title>
          </rect>
        )
      })}
      {/* Vertical separator between main fill and the strips column. */}
      <line
        x1={x}
        x2={x}
        y1={y}
        y2={y + height}
        stroke="#374151"
        strokeWidth={0.6}
      />
    </g>
  )
}

/**
 * Width of the main lithology fill as a fraction of the layer rect.
 *
 * Each admixture contributes a fixed percentage of admix-strip width
 * based on its DOV ``amount`` token:
 *
 *   weinig (little)   →  5 % of layer width
 *   matig  (moderate) → 10 %
 *   veel   (much)     → 15 %
 *
 * The contributions sum across admixtures, capped at 45 % total so
 * the main lithology is always at least 55 %. Past the cap the
 * individual strip widths get scaled down proportionally
 * (``AdmixtureStrip`` does that math from the same per-amount weights),
 * keeping the relative ratio between admixtures intact.
 *
 * Examples:
 *   no admixtures        → main 100 %
 *   1 × weinig           → main 95 %
 *   2 × weinig           → main 90 %
 *   1 × matig            → main 90 %
 *   1 × matig + 1 weinig → main 85 %
 *   1 × veel             → main 85 %
 *   3 × veel             → main 55 % (capped — 45 % total admix area)
 */
const ADMIX_AREA_CAP_PCT = 45

function mainLithologyFraction(
  admixtures: { amount: string }[],
): number {
  if (admixtures.length === 0) return 1.0
  const totalPct = admixtures
    .map(a => pctForAmount(a.amount))
    .reduce((s, p) => s + p, 0)
  const cappedPct = Math.min(totalPct, ADMIX_AREA_CAP_PCT)
  return 1 - cappedPct / 100
}

/**
 * Map a DOV ``amount`` token to its admix-area percentage. Source
 * vocabulary: ``weinig`` (little) / ``matig`` (moderate) / ``veel``
 * (much). Anything else (empty, unknown variants, percentages) falls
 * through to ``weinig``-equivalent so an un-quantified admixture
 * still gets a visible slice but doesn't dominate the strip.
 *
 * The returned value is BOTH:
 *   - the layer-width percentage this admixture contributes when
 *     summed (capped at ``ADMIX_AREA_CAP_PCT``), used by
 *     ``mainLithologyFraction``; and
 *   - the relative weight inside ``AdmixtureStrip`` — since the
 *     ratios 5 : 10 : 15 = 1 : 2 : 3 are preserved, a ``veel`` strip
 *     is always 3× the width of a ``weinig`` strip in the same layer.
 */
function pctForAmount(amount: string | null | undefined): number {
  const a = (amount || '').toLowerCase()
  if (a.includes('veel')) return 15
  if (a.includes('matig')) return 10
  if (a.includes('weinig')) return 5
  return 5
}

// ---------------------------------------------------------------------------
// Admixture chips — small colour swatches + text inside an observation layer
// ---------------------------------------------------------------------------

/**
 * Chips render as: ``[■] amount code [(loc.)]`` separated by a small gap,
 * packed left-to-right inside ``maxWidth``. When too many chips don't fit
 * we drop the last ones and show ``+N`` to flag the truncation. The hover
 * <title> on the parent layer block already lists every admixture, so
 * truncation here only affects the visible label.
 */
function AdmixtureChips({
  admixtures,
  x,
  y,
  maxWidth,
}: {
  admixtures: { soil_code: string; amount: string; locally: boolean }[]
  x: number
  y: number
  maxWidth: number
}): React.ReactElement {
  // Approximate widths for layout — SVG text is variable-width so we
  // estimate from average char width (~5px at 9pt) plus chip overhead.
  const SWATCH = 7 // colour square edge
  const GAP = 6
  const CHAR_W = 5

  const chips: { label: string; fill: string; width: number }[] = []
  let usedWidth = 0
  let dropped = 0

  for (const a of admixtures) {
    const text = `${a.amount ? a.amount + ' ' : ''}${a.soil_code}${a.locally ? ' (loc.)' : ''}`
    const chipWidth = SWATCH + 2 + text.length * CHAR_W + GAP
    if (usedWidth + chipWidth > maxWidth && chips.length > 0) {
      dropped = admixtures.length - chips.length
      break
    }
    chips.push({ label: text, fill: soilStyle(a.soil_code).fill, width: chipWidth })
    usedWidth += chipWidth
  }

  let cursor = 0
  return (
    <g>
      {chips.map((chip, i) => {
        const cx = x + cursor
        cursor += chip.width
        return (
          <g key={i}>
            <rect
              x={cx}
              y={y + 1}
              width={SWATCH}
              height={SWATCH}
              fill={chip.fill}
              stroke="#374151"
              strokeWidth={0.4}
              rx={1}
            />
            <text x={cx + SWATCH + 2} y={y + 8} fontSize={9} fill="#1f2937">
              {chip.label}
            </text>
          </g>
        )
      })}
      {dropped > 0 && (
        <text
          x={x + cursor}
          y={y + 8}
          fontSize={9}
          fill="#6b7280"
          fontStyle="italic"
        >
          +{dropped}
        </text>
      )}
    </g>
  )
}

// ---------------------------------------------------------------------------
// Drill-method track (SVG)
// ---------------------------------------------------------------------------

function DrillMethodTrack({
  segments,
  x,
  y,
  width,
  totalDepth,
}: {
  segments: DrillSegmentResponse[]
  x: number
  y: number
  width: number
  totalDepth: number
}): React.ReactElement {
  const PX_PER_M = usePxPerM()
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={totalDepth * PX_PER_M}
        fill="#ffffff"
        stroke="#e5e7eb"
        strokeWidth={0.5}
      />
      {segments.map(seg => {
        const top = y + seg.top_m * PX_PER_M
        const height = (seg.base_m - seg.top_m) * PX_PER_M
        const style = drillMethodStyle(seg.method)
        return (
          <g key={seg.id}>
            <title>
              {`${seg.top_m.toFixed(2)} – ${seg.base_m.toFixed(2)} m\n${seg.method ?? '—'}`}
            </title>
            <rect
              x={x}
              y={top}
              width={width}
              height={height}
              fill={style.fill}
              stroke="#9ca3af"
              strokeWidth={0.4}
            />
            {height >= 14 && (
              <text
                x={x + width / 2}
                y={top + height / 2 + 3}
                textAnchor="middle"
                fontSize={9}
                fill="#1f2937"
              >
                {truncate(seg.method ?? '', 12)}
              </text>
            )}
          </g>
        )
      })}
    </g>
  )
}

// ---------------------------------------------------------------------------
// Field-log track (SVG) — 3 sub-stripes: color / moisture / consistency
// ---------------------------------------------------------------------------

function FieldLogTrack({
  intervals,
  x,
  y,
}: {
  intervals: FieldLogIntervalResponse[]
  x: number
  y: number
}): React.ReactElement {
  // Group intervals by kind so each sub-stripe renders its own list.
  const colour = intervals.filter(i => i.kind === 'color')
  const moisture = intervals.filter(i => i.kind === 'moisture')
  const consistency = intervals.filter(i => i.kind === 'consistency')

  return (
    <g>
      <FieldLogStripe
        x={x}
        y={y}
        width={FIELD_LOG_SUB_WIDTH}
        intervals={colour}
        fillFor={fieldColorFill}
      />
      <FieldLogStripe
        x={x + FIELD_LOG_SUB_WIDTH}
        y={y}
        width={FIELD_LOG_SUB_WIDTH}
        intervals={moisture}
        fillFor={moistureFill}
      />
      <FieldLogStripe
        x={x + FIELD_LOG_SUB_WIDTH * 2}
        y={y}
        width={FIELD_LOG_SUB_WIDTH}
        intervals={consistency}
        fillFor={consistencyFill}
      />
    </g>
  )
}

function FieldLogStripe({
  x,
  y,
  width,
  intervals,
  fillFor,
}: {
  x: number
  y: number
  width: number
  intervals: FieldLogIntervalResponse[]
  fillFor: (v: string | null | undefined) => string
}): React.ReactElement {
  const PX_PER_M = usePxPerM()
  return (
    <g>
      {intervals.map(it => {
        const top = y + it.top_m * PX_PER_M
        const height = (it.base_m - it.top_m) * PX_PER_M
        return (
          <g key={it.id}>
            <title>
              {`${it.top_m.toFixed(2)} – ${it.base_m.toFixed(2)} m\n${it.kind}: ${it.value ?? '—'}`}
            </title>
            <rect
              x={x}
              y={top}
              width={width}
              height={height}
              fill={fillFor(it.value)}
              stroke="#9ca3af"
              strokeWidth={0.4}
            />
            {/* Show the literal source value on the stripe when there's room */}
            {height >= 12 && it.value && (
              <text
                x={x + width / 2}
                y={top + height / 2 + 3}
                textAnchor="middle"
                fontSize={8}
                fill="#1f2937"
              >
                {truncate(it.value, 8)}
              </text>
            )}
          </g>
        )
      })}
    </g>
  )
}

// ---------------------------------------------------------------------------
// Samples track (SVG, clickable)
// ---------------------------------------------------------------------------

function SamplesTrack({
  samples,
  x,
  y,
  width,
  selectedSampleId,
  onSampleClick,
}: {
  samples: SampleResponse[]
  x: number
  y: number
  width: number
  selectedSampleId: string | null
  onSampleClick: (id: string | null) => void
}): React.ReactElement {
  const PX_PER_M = usePxPerM()
  return (
    <g>
      {samples.map(sample => {
        const top = y + sample.depth_top_m * PX_PER_M
        const bottom = y + sample.depth_base_m * PX_PER_M
        const mid = (top + bottom) / 2
        const isSpot = sample.depth_top_m === sample.depth_base_m
        const selected = sample.id === selectedSampleId

        // Lab-test icons: which families have data?
        const tests: { label: string; symbol: string; color: string }[] = []
        if (sample.grain_sizes.length > 0)
          tests.push({ label: 'grain size', symbol: '▣', color: '#8b6f47' })
        if (sample.atterberg_limits_tests.length > 0)
          tests.push({ label: 'Atterberg', symbol: '▲', color: '#1f5077' })
        if (sample.caco3_content_tests.length > 0)
          tests.push({ label: 'CaCO₃', symbol: '◆', color: '#d4a373' })
        if (sample.organic_content_tests.length > 0)
          tests.push({ label: 'organic', symbol: '●', color: '#2d6a3e' })
        if (sample.water_content_tests.length > 0)
          tests.push({ label: 'water', symbol: '◯', color: '#1e88e5' })
        if (sample.scalar_lab_tests.length > 0)
          tests.push({
            label: `${sample.scalar_lab_tests.length} other`,
            symbol: '★',
            color: '#a855f7',
          })

        const hasAnyTest = tests.length > 0
        const clickable = true // even sample-only rows are clickable to show metadata

        return (
          <g
            key={sample.id}
            style={{ cursor: clickable ? 'pointer' : 'default' }}
            onClick={() => onSampleClick(selected ? null : sample.id)}
          >
            <title>
              {`${sample.sample_number ?? '(unnumbered)'}\n${sample.depth_top_m.toFixed(2)} – ${sample.depth_base_m.toFixed(2)} m\n${tests.length} lab test${tests.length !== 1 ? 's' : ''}`}
            </title>

            {/* Selected highlight */}
            {selected && (
              <rect
                x={x + 1}
                y={top - 2}
                width={width - 2}
                height={Math.max(bottom - top, 12) + 4}
                fill="#dbeafe"
                stroke="#3b82f6"
                strokeWidth={1}
                rx={2}
              />
            )}

            {/* Interval bracket OR spot marker */}
            {!isSpot ? (
              <rect
                x={x + 8}
                y={top}
                width={4}
                height={bottom - top}
                fill="#374151"
                rx={1}
              />
            ) : (
              <circle cx={x + 10} cy={mid} r={4} fill="#374151" />
            )}

            {/* Sample label + test icons */}
            <text x={x + 18} y={mid + 3} fontSize={10} fill="#1f2937">
              {sample.sample_number ?? '#?'}
            </text>
            {hasAnyTest && (
              <text x={x + 50} y={mid + 4} fontSize={11} fill="#1f2937">
                {tests.map(t => t.symbol).join(' ')}
              </text>
            )}
            {!hasAnyTest && (
              <text x={x + 50} y={mid + 3} fontSize={9} fill="#9ca3af" fontStyle="italic">
                no tests
              </text>
            )}
          </g>
        )
      })}
    </g>
  )
}

// ---------------------------------------------------------------------------
// Groundwater line (SVG)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Selected-sample depth marker — translucent yellow band overlay
// ---------------------------------------------------------------------------

/**
 * Translucent yellow rectangle spanning the borelog horizontally at
 * the selected sample's depth interval. Drawn after every track so it
 * always sits on top, with a low alpha so the underlying lithology
 * patterns and codes stay readable. Small triangular markers on the
 * left + right edges sharpen the "you are here" signal.
 *
 * For spot samples (depth_top == depth_base) the band defaults to
 * 4 px tall so it doesn't collapse into an invisible line.
 */
function SelectedSampleMarker({
  sample,
  fromX,
  toX,
  y,
}: {
  sample: SampleResponse
  fromX: number
  toX: number
  y: number
}): React.ReactElement {
  const PX_PER_M = usePxPerM()
  const top = y + sample.depth_top_m * PX_PER_M
  const rawHeight = (sample.depth_base_m - sample.depth_top_m) * PX_PER_M
  const height = Math.max(rawHeight, 4)
  const width = toX - fromX
  // Tailwind ``yellow-400`` at low alpha — vivid enough to spot,
  // translucent enough to read through.
  const fill = 'rgba(250, 204, 21, 0.30)'
  const stroke = 'rgba(202, 138, 4, 0.85)' // yellow-600 ~ stronger edge
  return (
    <g style={{ pointerEvents: 'none' }}>
      <rect
        x={fromX}
        y={top}
        width={width}
        height={height}
        fill={fill}
        stroke="none"
      />
      {/* Top + bottom edge lines for definition. */}
      <line x1={fromX} x2={toX} y1={top} y2={top} stroke={stroke} strokeWidth={1} />
      <line
        x1={fromX}
        x2={toX}
        y1={top + height}
        y2={top + height}
        stroke={stroke}
        strokeWidth={1}
      />
      {/* Left-edge triangular pointer ▶ */}
      <polygon
        points={`${fromX},${top + height / 2} ${fromX + 8},${top + height / 2 - 5} ${fromX + 8},${top + height / 2 + 5}`}
        fill={stroke}
      />
      {/* Right-edge triangular pointer ◀ */}
      <polygon
        points={`${toX},${top + height / 2} ${toX - 8},${top + height / 2 - 5} ${toX - 8},${top + height / 2 + 5}`}
        fill={stroke}
      />
    </g>
  )
}

function GroundwaterLine({
  waterDepth,
  fromX,
  toX,
  y,
  totalDepth,
}: {
  waterDepth: number
  fromX: number
  toX: number
  y: number
  totalDepth: number
}): React.ReactElement | null {
  const PX_PER_M = usePxPerM()
  // If the water table is below the deepest drawn extent, skip the line
  // entirely — drawing it past the canvas just confuses.
  if (waterDepth > totalDepth) return null

  const ly = y + waterDepth * PX_PER_M
  return (
    <g>
      <line
        x1={fromX}
        x2={toX}
        y1={ly}
        y2={ly}
        stroke="#1e88e5"
        strokeWidth={1.2}
        strokeDasharray="6 3"
      />
      <text
        x={fromX + 4}
        y={ly - 3}
        fontSize={9}
        fill="#1e88e5"
        fontStyle="italic"
      >
        ▾ water at {waterDepth.toFixed(2)} m
      </text>
    </g>
  )
}

// ---------------------------------------------------------------------------
// Legend (HTML) — only items actually present in this borehole
// ---------------------------------------------------------------------------

function Legend({ borehole }: { borehole: BoreholeDetailResponse }): React.ReactElement {
  // 1. Soil codes used in any lithology track
  const soilCodes = new Set<string>()
  for (const obs of borehole.observations) {
    if (!LITHOLOGY_TYPES.has(obs.observation_type)) continue
    for (const layer of obs.layers) {
      layer.main_soil_codes.forEach(c => soilCodes.add(c))
      layer.admixtures.forEach(a => soilCodes.add(a.soil_code))
    }
  }

  // 2. Stratigraphy formation codes (description = formation label)
  const stratEntries = new Map<string, string>() // code → full description
  for (const obs of borehole.observations) {
    if (!STRATIGRAPHY_TYPES.has(obs.observation_type)) continue
    for (const layer of obs.layers) {
      if (layer.description) {
        const code = layer.description.split(/[\s-]/)[0] || layer.description
        stratEntries.set(code, layer.description)
      }
    }
  }

  // 3. Drill methods used
  const drillMethods = new Set<string>()
  for (const seg of borehole.drill_segments) {
    if (seg.method) drillMethods.add(seg.method)
  }

  // 4. Lab-test icons present (from samples)
  const testIcons: { symbol: string; label: string; color: string }[] = []
  if (borehole.samples.some(s => s.grain_sizes.length > 0))
    testIcons.push({ symbol: '▣', label: 'grain size', color: '#8b6f47' })
  if (borehole.samples.some(s => s.atterberg_limits_tests.length > 0))
    testIcons.push({ symbol: '▲', label: 'Atterberg', color: '#1f5077' })
  if (borehole.samples.some(s => s.caco3_content_tests.length > 0))
    testIcons.push({ symbol: '◆', label: 'CaCO₃', color: '#d4a373' })
  if (borehole.samples.some(s => s.organic_content_tests.length > 0))
    testIcons.push({ symbol: '●', label: 'organic', color: '#2d6a3e' })
  if (borehole.samples.some(s => s.water_content_tests.length > 0))
    testIcons.push({ symbol: '◯', label: 'water', color: '#1e88e5' })
  if (borehole.samples.some(s => s.scalar_lab_tests.length > 0))
    testIcons.push({ symbol: '★', label: 'other', color: '#a855f7' })

  const sectionsPresent =
    soilCodes.size > 0 || stratEntries.size > 0 || drillMethods.size > 0 || testIcons.length > 0

  if (!sectionsPresent) {
    return <div />
  }

  return (
    <div className="border-t border-gray-200 bg-gray-50 px-4 py-2 text-[11px] flex flex-wrap gap-x-6 gap-y-2 shrink-0">
      {soilCodes.size > 0 && (
        <LegendSection title="Lithology codes">
          {[...soilCodes].sort().map(code => {
            const style = soilStyle(code)
            return (
              <LegendChip
                key={code}
                code={code}
                label={style.label}
                preview={
                  <svg width={14} height={14}>
                    <defs>
                      <SoilPatterns />
                    </defs>
                    <rect
                      x={0}
                      y={0}
                      width={14}
                      height={14}
                      fill={getSoilFillUrl(code)}
                      stroke="#9ca3af"
                      strokeWidth={0.4}
                    />
                  </svg>
                }
              />
            )
          })}
        </LegendSection>
      )}

      {stratEntries.size > 0 && (
        <LegendSection title="Stratigraphy">
          {[...stratEntries.entries()].map(([code, desc]) => (
            <LegendChip key={code} code={code} label={desc} />
          ))}
        </LegendSection>
      )}

      {drillMethods.size > 0 && (
        <LegendSection title="Drill method">
          {[...drillMethods].sort().map(m => {
            const s = drillMethodStyle(m)
            return (
              <LegendChip
                key={m}
                code={m}
                label={s.label}
                preview={
                  <span
                    className="inline-block w-3.5 h-3.5 border border-gray-300 rounded-sm"
                    style={{ backgroundColor: s.fill }}
                  />
                }
              />
            )
          })}
        </LegendSection>
      )}

      {testIcons.length > 0 && (
        <LegendSection title="Lab tests">
          {testIcons.map(t => (
            <span key={t.label} className="flex items-center gap-1.5 text-gray-700">
              <span className="text-base leading-none" style={{ color: t.color }}>
                {t.symbol}
              </span>
              <span>{t.label}</span>
            </span>
          ))}
          <span className="text-[10px] text-gray-400 italic ml-2">click sample to view</span>
        </LegendSection>
      )}

      {borehole.elevation_m == null && (
        <div className="flex items-center gap-1 text-amber-600">
          <AlertTriangle size={11} />
          <span>Surface elevation missing — borelog renders without absolute level axis.</span>
        </div>
      )}
    </div>
  )
}

function LegendSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[9px] uppercase tracking-wide text-gray-400">{title}</div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">{children}</div>
    </div>
  )
}

function LegendChip({
  code,
  label,
  preview,
}: {
  code: string
  label: string
  preview?: React.ReactNode
}): React.ReactElement {
  return (
    <span className="flex items-center gap-1.5 text-gray-700">
      {preview}
      <span className="font-mono text-gray-500">{code}</span>
      <span>{label}</span>
    </span>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function humanizeObservationType(t: string): string {
  switch (t) {
    case 'coded_lithology':
      return 'Coded lithology'
    case 'geotechnical_coding':
      return 'Geotechnical coding'
    case 'lithological_description':
      return 'Lithological description'
    case 'informal_stratigraphy':
      return 'Informal stratigraphy'
    case 'formal_stratigraphy':
      return 'Formal stratigraphy'
    case 'quaternary_stratigraphy':
      return 'Quaternary stratigraphy'
    case 'hydrogeological_stratigraphy':
      return 'Hydrogeological stratigraphy'
    case 'informal_hydrogeological_stratigraphy':
      return 'Informal hydrogeological stratigraphy'
    default:
      return t
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1) + '…'
}

/**
 * Word-wrap an SVG text label inside a bounded rectangle.
 *
 * Splits on whitespace, packs words greedily into lines that fit
 * ``maxWidth`` (estimated via average char width — SVG has no
 * ``measureText`` we can use synchronously), stops adding lines once
 * the next line would push past ``maxHeight``, and ellipsises the
 * last line when more words remain. Lines are emitted as ``<tspan>``s
 * with ``dy`` line spacing relative to the centre baseline.
 *
 * Used for the stratigraphy column where descriptions like
 * ``"Paleogeen: Formatie van Kortrijk - Lid van Roubaix"`` need to
 * read across multiple lines on tall layers (instead of overflowing
 * into the next column) and gracefully degrade to a single
 * truncated line on thin layers.
 */
function WrappedText({
  text,
  centerX,
  centerY,
  maxWidth,
  maxHeight,
  fontSize,
  fontWeight,
  fill,
}: {
  text: string
  centerX: number
  centerY: number
  maxWidth: number
  maxHeight: number
  fontSize: number
  fontWeight?: number
  fill: string
}): React.ReactElement {
  // Average character width at 11pt ≈ 6 px for the Inter / system
  // fallback we ship. This is approximate but stable enough for
  // packing words; the centre alignment and ellipsis handle slack.
  const charW = fontSize * 0.55
  const lineH = fontSize * 1.15
  const maxCharsPerLine = Math.max(1, Math.floor(maxWidth / charW))
  const maxLines = Math.max(1, Math.floor(maxHeight / lineH))

  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length <= maxCharsPerLine) {
      current = candidate
    } else {
      if (current) lines.push(current)
      // Word longer than the line itself — hard-truncate.
      current = word.length <= maxCharsPerLine ? word : truncate(word, maxCharsPerLine)
      if (lines.length >= maxLines) break
    }
  }
  if (current && lines.length < maxLines) lines.push(current)

  // If we ran out of room before consuming every word, ellipsise the
  // last line so the user sees that more text exists.
  const consumedAll =
    lines.join(' ').length >= text.replace(/\s+/g, ' ').length - 1 &&
    lines.length <= maxLines
  if (!consumedAll && lines.length > 0) {
    const last = lines[lines.length - 1]
    lines[lines.length - 1] = truncate(last, Math.max(1, last.length))
    // truncate only changes if it's already at the limit — force ellipsis:
    if (!lines[lines.length - 1].endsWith('…')) {
      lines[lines.length - 1] = truncate(last + ' …', maxCharsPerLine)
    }
  }

  // Centre vertically: the FIRST line's y offset is centerY minus the
  // half-stack so the whole block is balanced around centerY.
  const firstY = centerY - ((lines.length - 1) * lineH) / 2 + fontSize / 3

  return (
    <text
      x={centerX}
      y={firstY}
      textAnchor="middle"
      fontSize={fontSize}
      fontWeight={fontWeight}
      fill={fill}
    >
      {lines.map((line, i) => (
        <tspan key={i} x={centerX} dy={i === 0 ? 0 : lineH}>
          {line}
        </tspan>
      ))}
    </text>
  )
}

function roundTo(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals)
  return Math.round(value * factor) / factor
}

