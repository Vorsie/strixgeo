import { useEffect, useMemo, useRef, useState } from 'react'
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react'

import type { BoreholeDetailResponse } from '../api/client'
import { SoilPatterns } from '../utils/soilPatterns'
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
}

export default function BoreholeLog({
  borehole,
  onElevationChange,
}: Props): React.ReactElement {
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
      <BoreholeHeader borehole={borehole} onElevationChange={onElevationChange} />

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
