/**
 * Cross-section panel — viewport state + coordinate transforms +
 * SVG composition. Sub-components for header, scrub bar, columns,
 * DEM polyline live in ``components/sections/``; data fetching
 * (DEM samples, CPT plot batch, projected investigations) lives in
 * the ``useSectionData`` hook.
 *
 * What this orchestrator owns:
 *
 *   * Viewport state — xMin/xMax, levelMin/levelMax, VEX. These are
 *     interaction-driven (pan, wheel-zoom, slider, scrub bar) and
 *     drive every coordinate transform on screen.
 *   * Coordinate transforms — ``xToScreen``, ``levelToScreen``, and
 *     their inverses. Cached as ``useCallback``s with the viewport
 *     in the dep list so the sub-components see stable identities
 *     across renders that don't actually change the transform.
 *   * Pan / wheel-zoom / scrub-bar / zoom-button interactions.
 *   * Collision-handled column layout (``placedColumns``). Depends
 *     on viewport because the per-column screen X comes from
 *     ``xToScreen``, so it lives here rather than in the data hook.
 *   * Render composition — wires the data layer into the SVG.
 *
 * Rendering choice: SVG over Canvas. Matches BoreholeLog / CptChart
 * which already handle 1000+ elements without trouble, and keeps
 * DOM inspection / hover tooltips / accessibility easy. If column
 * rendering pushes into >2000 elements range we'll revisit.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type {
  BoreholeListItem,
  CptListItem,
  CrossSectionResponse,
} from '../api/client'
import { verticalDatumShort } from '../utils/verticalDatum'
import { nudgeColumns } from '../utils/columnLayout'
import type { ProjectedInvestigation } from '../utils/sectionProjection'
import { SoilPatterns } from '../utils/soilPatterns'
import BoreholeColumn from './sections/BoreholeColumn'
import CptDataColumn from './sections/CptDataColumn'
import { cptBandFullWidth, cptBandHalfWidth } from './sections/cptChannels'
import DemSurfaceLine from './sections/DemSurfaceLine'
import InvestigationColumns from './sections/InvestigationColumns'
import SectionHeader from './sections/SectionHeader'
import SectionScrubBar from './sections/SectionScrubBar'
import { useSectionData } from './sections/useSectionData'
import {
  BARE_COLUMN_WIDTH_PX,
  COLUMN_EDGE_GAP_PX,
  DEFAULT_LEVEL_RANGE,
  MARGIN,
  VEX_DEFAULT,
  WHEEL_ZOOM_FACTOR,
  sectionLengthM,
  ticks,
  useElementSize,
  type PlacedColumn,
  type PlacedColumnInput,
  type Viewport,
} from './sections/utils'

interface Props {
  section: CrossSectionResponse
  /** Project-level vertical EPSG used for the y-axis label.
   * ``null`` → the axis renders without a datum suffix (just
   * "Level (m)"). */
  zEpsg?: number | null
  /** All CPTs in the project. The panel filters down to those that
   * project within the section's buffer + endpoints. */
  cpts?: readonly CptListItem[]
  /** All boreholes in the project. Same filter as cpts. */
  boreholes?: readonly BoreholeListItem[]
  /** Patch the section row server-side. Called on slider release
   * for ``projection_buffer_m`` and ``vertical_exaggeration`` and
   * on every channel-toggle click for ``view_state.cpt_channels``,
   * so the values persist across opens and ride the .gmproj
   * bundle. The handler is optional so the test-render path can
   * mount without a network seam. */
  onPatch?: (patch: {
    projection_buffer_m?: number
    vertical_exaggeration?: number
    view_state?: Record<string, unknown>
  }) => Promise<void>
  /** Close the section view — typically clears the parent's
   * selectedSectionId so the App's render branch flips back to the
   * map. Optional so the test-render path can mount without a
   * navigation seam. */
  onClose?: () => void
  /** Click handlers for the projected columns. Selecting an
   * investigation routes through the App's normal handleSelect /
   * handleSelectBorehole — those already clear section selection
   * so the App's render branch flips to the CPT / borehole detail
   * panel cleanly. Optional for the test-render path. */
  onSelectCpt?: (id: string) => void
  onSelectBorehole?: (id: string) => void
}

export default function SectionPanel({
  section,
  zEpsg = null,
  cpts = [],
  boreholes = [],
  onPatch,
  onClose,
  onSelectCpt,
  onSelectBorehole,
}: Props): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const size = useElementSize(containerRef)
  const lengthM = useMemo(() => sectionLengthM(section), [section])

  // Default viewport — full section length, default vertical
  // window. Recomputed when the section changes so switching
  // sections in the sidebar fits the new one without inheriting the
  // previous framing.
  const defaultViewport = useMemo<Viewport>(
    () => ({
      xMin: 0,
      xMax: lengthM,
      levelMin: section.min_depth_m ?? DEFAULT_LEVEL_RANGE.min,
      levelMax: section.max_depth_m ?? DEFAULT_LEVEL_RANGE.max,
    }),
    [lengthM, section.min_depth_m, section.max_depth_m],
  )

  const [viewport, setViewport] = useState<Viewport>(defaultViewport)
  // Reset to default framing when the section identity changes
  // (the user picked a different section in the sidebar).
  useEffect(() => {
    setViewport(defaultViewport)
  }, [defaultViewport])

  const [vex, setVex] = useState<number>(section.vertical_exaggeration ?? VEX_DEFAULT)
  useEffect(() => {
    setVex(section.vertical_exaggeration ?? VEX_DEFAULT)
  }, [section.id, section.vertical_exaggeration])

  // Drawing-area pixel size. The SVG's ``viewBox`` always spans
  // the full container; coordinate transforms convert world →
  // viewBox.
  const plotWidth = Math.max(1, (size?.width ?? 800) - MARGIN.left - MARGIN.right)
  const plotHeight = Math.max(1, (size?.height ?? 400) - MARGIN.top - MARGIN.bottom)

  // World-to-screen scaling. scaleH and scaleV are derived from the
  // viewport; VEX is the ratio between them.
  const scaleH = plotWidth / Math.max(1e-6, viewport.xMax - viewport.xMin)
  // Apply VEX by amplifying scaleV relative to scaleH. The vertical
  // viewport extent is then derived from plotHeight and the
  // resulting scaleV — keeps the centre fixed when the user drags
  // the slider.
  const scaleV = scaleH * vex
  const visibleLevelExtent = plotHeight / scaleV
  const levelCentre = (viewport.levelMin + viewport.levelMax) / 2
  // Effective vertical viewport — what's actually visible given the
  // current VEX. Different from ``viewport.levelMin/Max`` only when
  // VEX has been changed since the last setViewport.
  const effLevelMin = levelCentre - visibleLevelExtent / 2
  const effLevelMax = levelCentre + visibleLevelExtent / 2

  const xToScreen = useCallback(
    (x: number) => MARGIN.left + (x - viewport.xMin) * scaleH,
    [viewport.xMin, scaleH],
  )
  const levelToScreen = useCallback(
    (level: number) => MARGIN.top + (effLevelMax - level) * scaleV,
    [effLevelMax, scaleV],
  )

  // ---- Pan / zoom interactions ---------------------------------------

  const panStart = useRef<{ px: number; py: number; viewport: Viewport } | null>(null)
  const [isPanning, setIsPanning] = useState(false)

  function handleMouseDown(e: React.MouseEvent<SVGSVGElement>): void {
    // Only the left button starts a pan — right-click is reserved
    // for a future context menu, middle-click stays for browser
    // autoscroll.
    if (e.button !== 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    panStart.current = {
      px: e.clientX - rect.left,
      py: e.clientY - rect.top,
      viewport,
    }
    setIsPanning(true)
  }

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>): void {
    if (panStart.current === null) return
    const rect = e.currentTarget.getBoundingClientRect()
    const dx = e.clientX - rect.left - panStart.current.px
    const dy = e.clientY - rect.top - panStart.current.py
    // dx in pixels → world metres via scaleH. Drag right means the
    // world moves left under the viewport, so subtract.
    const dxWorld = dx / scaleH
    const dyWorld = dy / scaleV
    setViewport({
      xMin: panStart.current.viewport.xMin - dxWorld,
      xMax: panStart.current.viewport.xMax - dxWorld,
      // Drag down means viewport.levelMax (which is at the top of
      // the screen) needs to go up in world terms — add dyWorld.
      levelMin: panStart.current.viewport.levelMin + dyWorld,
      levelMax: panStart.current.viewport.levelMax + dyWorld,
    })
  }

  function handleMouseUp(): void {
    panStart.current = null
    setIsPanning(false)
  }

  // Wheel-zoom centred on the cursor — the world point under the
  // mouse stays put while the viewport shrinks or grows around it.
  // Matches Leaflet's interaction, so engineers' map muscle memory
  // transfers.
  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault()
      const svg = containerRef.current?.querySelector('svg')
      if (!svg) return
      const rect = svg.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      // Bail when the cursor is outside the plot area — wheel
      // events bubbling up from the toolbar wouldn't otherwise be
      // excluded.
      if (px < MARGIN.left || px > MARGIN.left + plotWidth) return
      if (py < MARGIN.top || py > MARGIN.top + plotHeight) return

      const worldX = viewport.xMin + (px - MARGIN.left) / scaleH
      const worldLevel = effLevelMax - (py - MARGIN.top) / scaleV
      const factor = e.deltaY < 0 ? 1 / WHEEL_ZOOM_FACTOR : WHEEL_ZOOM_FACTOR

      // Scale both axes by ``factor`` around the cursor's world
      // coords. Solving "the same screen point still maps to the
      // same world point after the zoom" yields these expressions.
      const newXRange = (viewport.xMax - viewport.xMin) * factor
      const newLevelRange = (viewport.levelMax - viewport.levelMin) * factor
      const xFraction = (worldX - viewport.xMin) / (viewport.xMax - viewport.xMin)
      const levelFraction =
        (worldLevel - viewport.levelMin) / (viewport.levelMax - viewport.levelMin)
      setViewport({
        xMin: worldX - xFraction * newXRange,
        xMax: worldX + (1 - xFraction) * newXRange,
        levelMin: worldLevel - levelFraction * newLevelRange,
        levelMax: worldLevel + (1 - levelFraction) * newLevelRange,
      })
    },
    [viewport, scaleH, scaleV, effLevelMax, plotWidth, plotHeight],
  )

  // React's onWheel is passive-by-default (preventDefault is a
  // no-op there). Attach the listener natively so we can intercept
  // the page scroll. Same pattern as the BoreholeLog Ctrl+wheel
  // zoom.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [handleWheel])

  function resetView(): void {
    setViewport(defaultViewport)
    setVex(section.vertical_exaggeration ?? VEX_DEFAULT)
  }

  // Centred zoom — same factor as the wheel, but pivoting on the
  // viewport's centre instead of the mouse position. Wired to the
  // header's +/- buttons for users who'd rather click than scroll.
  const zoomBy = useCallback((factor: number) => {
    setViewport(prev => {
      const cx = (prev.xMin + prev.xMax) / 2
      const cl = (prev.levelMin + prev.levelMax) / 2
      const xHalf = (prev.xMax - prev.xMin) * factor * 0.5
      const lHalf = (prev.levelMax - prev.levelMin) * factor * 0.5
      return {
        xMin: cx - xHalf,
        xMax: cx + xHalf,
        levelMin: cl - lHalf,
        levelMax: cl + lHalf,
      }
    })
  }, [])
  const zoomIn = useCallback(() => zoomBy(1 / WHEEL_ZOOM_FACTOR), [zoomBy])
  const zoomOut = useCallback(() => zoomBy(WHEEL_ZOOM_FACTOR), [zoomBy])

  // Horizontal pan for the scrub bar. Sets the viewport's
  // xMin/xMax to a new window of the same width centred on
  // ``centerX``.
  const scrubTo = useCallback((centerX: number) => {
    setViewport(prev => {
      const half = (prev.xMax - prev.xMin) / 2
      return { ...prev, xMin: centerX - half, xMax: centerX + half }
    })
  }, [])

  // ---- Tick generation -----------------------------------------------

  const xTicks = useMemo(
    () => ticks(viewport.xMin, viewport.xMax, 8),
    [viewport.xMin, viewport.xMax],
  )
  const levelTicks = useMemo(
    () => ticks(effLevelMin, effLevelMax, 6),
    [effLevelMin, effLevelMax],
  )

  // ---- Data layer (DEM + CPT plots + projected investigations) -------

  const {
    cptChannels,
    setCptChannels,
    demSamples,
    cptPlots,
    projectedCpts,
    projectedBoreholes,
    boreholeDetails,
  } = useSectionData(section, cpts, boreholes)

  // Channel-toggle commit: update the in-memory state optimistically
  // for an instant re-render, then PATCH the section row's
  // ``view_state.cpt_channels`` so the change survives section
  // reopens + .gmproj round-trips. Falls back to local-only when
  // ``onPatch`` is absent (test-render path).
  const handleChannelsChange = useCallback(
    (next: typeof cptChannels) => {
      setCptChannels(next)
      if (onPatch) {
        void onPatch({ view_state: { cpt_channels: next } })
      }
    },
    [setCptChannels, onPatch],
  )

  // Band half-width scales with horizontal zoom — at low zoom keep
  // columns compact, at high zoom let curves breathe. The same
  // half-width feeds both the layout (nudge) and the render (column
  // glyph) so positions and visuals stay in sync.
  const bandHalfWidth = useMemo(() => cptBandHalfWidth(scaleH), [scaleH])

  // Column collision handling — when multiple investigations project
  // near the same along-distance their columns would overlap into an
  // unreadable stack. Combine both kinds, nudge in a single sweep so
  // crowded ones cascade rightward, and surface the displacement
  // back to the column renderer so it can draw a tie-back diagonal.
  // Recomputes on viewport pan / zoom because the available pixel
  // space changes with scaleH.
  const placedColumns = useMemo<PlacedColumn[]>(() => {
    const items: PlacedColumnInput[] = [
      ...projectedCpts.map(proj => {
        // CPT column width = bare cap+tie width (the floor) + the
        // shared data band when at least one channel is applicable
        // to this cone. The nudge then spaces edge-to-edge so a
        // data-laden CPT next to a bare borehole gets breathing room.
        const trackW = cptPlots?.has(proj.item.id)
          ? cptBandFullWidth(proj.item.cpt_type, cptChannels, bandHalfWidth)
          : 0
        return {
          kind: 'cpt' as const,
          proj: proj as ProjectedInvestigation<CptListItem | BoreholeListItem>,
          trueX: xToScreen(proj.along),
          width: BARE_COLUMN_WIDTH_PX + trackW,
        }
      }),
      ...projectedBoreholes.map(proj => {
        // Borehole columns claim the lithology-strip width whenever
        // their detail has loaded — the strip mirrors the CPT band's
        // total width so a section reads with consistent column
        // footprints regardless of investigation kind. Boreholes
        // without loaded detail (still in-flight) fall back to the
        // bare cap width so the layout doesn't reflow when the data
        // arrives.
        const stripW = boreholeDetails?.has(proj.item.id) ? 2 * bandHalfWidth : 0
        return {
          kind: 'borehole' as const,
          proj: proj as ProjectedInvestigation<CptListItem | BoreholeListItem>,
          trueX: xToScreen(proj.along),
          width: BARE_COLUMN_WIDTH_PX + stripW,
        }
      }),
    ]
    return nudgeColumns(items, COLUMN_EDGE_GAP_PX).map(r => ({
      kind: r.item.kind,
      proj: r.item.proj,
      trueX: r.trueX,
      nudgedX: r.nudgedX,
      width: r.item.width,
      displaced: r.displaced,
    }))
  }, [
    projectedCpts,
    projectedBoreholes,
    xToScreen,
    cptPlots,
    boreholeDetails,
    cptChannels,
    bandHalfWidth,
  ])

  // Collision-aware gridline labels: a CPT only shows its per-CPT
  // gridline value labels ("2", "10 MPa", "2 %", "4 %") when its
  // nearest CPT neighbour on the cross-section is far enough away
  // that the label strips don't overlap. Without this gate, every
  // label band collapses into an unreadable wall at the default
  // section zoom.
  //
  // Threshold ~50 px gives the worst-case label ("10 MPa", ~32 px
  // wide at fontSize=7) plus a small gap. Tight columns drop labels
  // silently; the user can zoom in to spread them out.
  const showLabelsByCptId = useMemo(() => {
    const LABEL_MIN_SPACING_PX = 50
    const cptCols = placedColumns.filter(c => c.kind === 'cpt')
    const m = new Map<string, boolean>()
    for (const col of cptCols) {
      let minDist = Infinity
      for (const other of cptCols) {
        if (other === col) continue
        const d = Math.abs(col.nudgedX - other.nudgedX)
        if (d < minDist) minDist = d
      }
      m.set(col.proj.item.id, minDist >= LABEL_MIN_SPACING_PX)
    }
    return m
  }, [placedColumns])

  // ---- Render --------------------------------------------------------

  const datumShort = verticalDatumShort(zEpsg)
  const yAxisLabel = datumShort ? `Level (${datumShort})` : 'Level (m)'

  return (
    <div className="flex flex-col h-full w-full bg-white">
      <SectionHeader
        section={section}
        lengthM={lengthM}
        onClose={onClose}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        vex={vex}
        onVexChange={setVex}
        onVexCommit={
          // Persist VEX on slider release so reopening the section
          // keeps the user's last setting. Local ``vex`` already
          // updated optimistically by ``setVex``; this just flushes
          // the value to the server.
          onPatch
            ? next => void onPatch({ vertical_exaggeration: next })
            : undefined
        }
        onBufferCommit={
          onPatch
            ? next => void onPatch({ projection_buffer_m: next })
            : undefined
        }
        channels={cptChannels}
        onChannelsChange={handleChannelsChange}
        scaleH={scaleH}
        scaleV={scaleV}
        onReset={resetView}
      />

      <div
        ref={containerRef}
        className="relative flex-1 overflow-hidden select-none"
        style={{ cursor: isPanning ? 'grabbing' : 'grab' }}
      >
        {size && (
          <svg
            width={size.width}
            height={size.height}
            viewBox={`0 0 ${size.width} ${size.height}`}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onDoubleClick={resetView}
          >
            {/* Soil-code pattern defs — hoisted to a single ``<defs>``
                so every BoreholeColumn renders into the same pattern
                instances (one render of each pattern per SVG, not per
                column). Pattern ids are stable (``soil-FZ``,
                ``soil-KL``, …); ``getSoilFillUrl`` produces matching
                ``url(#soil-XXX)`` references from the layer's soil
                code. */}
            <defs>
              <SoilPatterns />
            </defs>

            {/* Plot-area background — solid white over the tinted
                container so the grid + axes read cleanly even when
                a future overlay tints the canvas. */}
            <rect
              x={MARGIN.left}
              y={MARGIN.top}
              width={plotWidth}
              height={plotHeight}
              fill="#fafafa"
              stroke="#e5e7eb"
            />

            {/* Vertical gridlines + x-axis ticks (along-distance). */}
            {xTicks.map(v => {
              const sx = xToScreen(v)
              return (
                <g key={`xt-${v}`}>
                  <line
                    x1={sx}
                    x2={sx}
                    y1={MARGIN.top}
                    y2={MARGIN.top + plotHeight}
                    stroke="#e5e7eb"
                  />
                  <text
                    x={sx}
                    y={MARGIN.top + plotHeight + 14}
                    fontSize={10}
                    fill="#6b7280"
                    textAnchor="middle"
                  >
                    {Math.round(v)}
                  </text>
                </g>
              )
            })}

            {/* Horizontal gridlines + y-axis ticks (level). */}
            {levelTicks.map(v => {
              const sy = levelToScreen(v)
              return (
                <g key={`lt-${v}`}>
                  <line
                    x1={MARGIN.left}
                    x2={MARGIN.left + plotWidth}
                    y1={sy}
                    y2={sy}
                    stroke="#e5e7eb"
                  />
                  <text
                    x={MARGIN.left - 6}
                    y={sy + 3}
                    fontSize={10}
                    fill="#6b7280"
                    textAnchor="end"
                  >
                    {/* One decimal when the step is sub-metre so
                        labels like "-12.5" don't collapse to "-13". */}
                    {Number.isInteger(v) ? v : v.toFixed(1)}
                  </text>
                </g>
              )
            })}

            {/* DEM ground-surface polyline. Drawn below the
                investigation columns so the column caps + name
                labels read cleanly on top — the surface line is
                context, not the primary content. Breaks at NoData
                samples (gaps outside DHMVII coverage). */}
            {demSamples !== null && (
              <DemSurfaceLine
                samples={demSamples}
                xToScreen={xToScreen}
                levelToScreen={levelToScreen}
                plotTop={MARGIN.top}
                plotBottom={MARGIN.top + plotHeight}
                plotLeft={MARGIN.left}
                plotRight={MARGIN.left + plotWidth}
              />
            )}

            {/* CPT data tracks (qc curve + Rf curve + optional fs /
                u2 / q_total). Drawn BEFORE the column glyphs so the
                cap + name label + tie-back sit on top and stay
                readable. Only renders for CPTs whose plot data
                finished loading; bare columns render fine without
                it. Widths scale with horizontal zoom so curves stay
                readable when the user zooms in. */}
            {cptPlots !== null &&
              placedColumns.map(col => {
                if (col.kind !== 'cpt') return null
                const item = col.proj.item as CptListItem
                const plot = cptPlots.get(item.id)
                if (!plot || item.elevation_m === null) return null
                return (
                  <CptDataColumn
                    key={`cpt-data-${item.id}`}
                    plot={plot}
                    cptType={item.cpt_type}
                    channels={cptChannels}
                    halfWidth={bandHalfWidth}
                    screenX={col.nudgedX}
                    surfaceElevationM={item.elevation_m}
                    plotTop={MARGIN.top}
                    plotBottom={MARGIN.top + plotHeight}
                    levelToScreen={levelToScreen}
                    showLabels={showLabelsByCptId.get(item.id) ?? true}
                  />
                )
              })}

            {/* Borehole lithology strips — DOV lengteprofiel
                convention, patterned coloured rectangles per
                coded_lithology layer. Renders ONLY for boreholes
                whose detail finished loading AND that have a known
                elevation; bare cap-only columns render fine without
                a strip. Drawn before InvestigationColumns so the
                cap + name label overlays on top. */}
            {boreholeDetails !== null &&
              placedColumns.map(col => {
                if (col.kind !== 'borehole') return null
                const item = col.proj.item as BoreholeListItem
                const detail = boreholeDetails.get(item.id)
                if (!detail || item.elevation_m === null) return null
                return (
                  <BoreholeColumn
                    key={`bh-strip-${item.id}`}
                    detail={detail}
                    screenX={col.nudgedX}
                    halfWidth={bandHalfWidth}
                    surfaceElevationM={item.elevation_m}
                    plotTop={MARGIN.top}
                    plotBottom={MARGIN.top + plotHeight}
                    levelToScreen={levelToScreen}
                  />
                )
              })}

            {/* Investigation columns. Both kinds rendered from a
                single nudged list — the layout pass spaces crowded
                projections rightward while drawing tie-back
                diagonals so each column's true projected position
                stays inspectable. */}
            <InvestigationColumns
              columns={placedColumns}
              levelToScreen={levelToScreen}
              plotTop={MARGIN.top}
              plotBottom={MARGIN.top + plotHeight}
              onSelectCpt={onSelectCpt}
              onSelectBorehole={onSelectBorehole}
            />

            {/* Axis labels. */}
            <text
              x={MARGIN.left + plotWidth / 2}
              y={MARGIN.top + plotHeight + 28}
              fontSize={11}
              fill="#374151"
              textAnchor="middle"
            >
              Distance along section (m)
            </text>
            <text
              x={14}
              y={MARGIN.top + plotHeight / 2}
              fontSize={11}
              fill="#374151"
              textAnchor="middle"
              transform={`rotate(-90 14 ${MARGIN.top + plotHeight / 2})`}
            >
              {yAxisLabel}
            </text>
          </svg>
        )}
        {!size && (
          <div className="flex items-center justify-center h-full text-xs text-gray-400">
            Sizing canvas…
          </div>
        )}
        <CanvasHints />
      </div>

      <SectionScrubBar
        sectionLength={lengthM}
        xMin={viewport.xMin}
        xMax={viewport.xMax}
        onScrubTo={scrubTo}
      />
    </div>
  )
}

function CanvasHints(): JSX.Element {
  return (
    <div className="absolute bottom-2 left-2 z-10 text-[10px] text-gray-400 bg-white/80 px-1.5 py-0.5 rounded pointer-events-none">
      Drag to pan · scroll to zoom · double-click to reset
    </div>
  )
}
