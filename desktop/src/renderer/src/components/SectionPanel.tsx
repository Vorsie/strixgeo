/**
 * Cross-section panel — S2 scaffold.
 *
 * Renders the empty viewing surface for a project's cross-section:
 * along-distance horizontal axis (metres along the projected line),
 * level vertical axis (m TAW / m NAP, derived from the project's
 * default_vertical_epsg), gridlines, pan + wheel-zoom, vertical-
 * exaggeration slider, and a live scale read-out.
 *
 * What S2 deliberately does NOT do:
 *
 * * Project investigations onto the line (CPT strips, borelogs) —
 *   that's S3.
 * * Sample the DEM along the line to draw a ground-surface polyline
 *   — that's S4 (requires the backend DemService).
 * * Show offset indicators / collision-handled column layout — S5/S6.
 *
 * The viewport (the world-coords window the SVG renders) is fully
 * local state for now. Persisting view prefs (zoom + VEX) into the
 * section row's ``min_depth_m`` / ``max_depth_m`` / ``vertical_
 * exaggeration`` columns happens once the user has a reason to keep
 * a specific framing — typically right after the editor lands.
 *
 * Rendering choice: SVG over Canvas. Matches BoreholeLog / CptChart
 * which already handle 1000+ elements without trouble, and keeps DOM
 * inspection / hover tooltips / accessibility easy. If S3's column
 * rendering pushes into >2000 elements range we'll revisit.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'

import type { BoreholeListItem, CptListItem, CrossSectionResponse } from '../api/client'
import { verticalDatumShort } from '../utils/verticalDatum'
import {
  investigationsOnSection,
  type ProjectedInvestigation,
} from '../utils/sectionProjection'

interface Props {
  section: CrossSectionResponse
  /** Project-level vertical EPSG used for the y-axis label. ``null`` →
   * the axis renders without a datum suffix (just "Level (m)"). */
  zEpsg?: number | null
  /** All CPTs in the project. The panel filters down to those that
   * project within the section's buffer + endpoints. */
  cpts?: readonly CptListItem[]
  /** All boreholes in the project. Same filter as cpts. */
  boreholes?: readonly BoreholeListItem[]
}

// World viewport in section-local coordinates: x = along-distance
// from start endpoint (metres), level = vertical (metres in the
// project's vertical datum — typically TAW or NAP).
interface Viewport {
  xMin: number
  xMax: number
  levelMin: number
  levelMax: number
}

// Pixel margins reserved for axis labels + ticks. Tight enough that
// the drawing area doesn't shrink visibly on small viewports.
const MARGIN = { top: 24, right: 24, bottom: 36, left: 56 } as const

// Default vertical window when the user opens a fresh section with no
// data overlaid. Engineers can pan/zoom freely; this is just the
// initial framing so the canvas isn't empty.
const DEFAULT_LEVEL_RANGE = { min: -40, max: 20 } as const

// Vertical-exaggeration slider bounds. Geotech engineers typically
// use 5–10× for shallow profiles; deep soundings (200m+) sometimes
// run as low as 0.5×. Log-mapped on the slider so both ends are
// reachable with reasonable thumb travel.
const VEX_MIN = 0.5
const VEX_MAX = 50
const VEX_DEFAULT = 1

// Wheel-zoom factor per wheel tick. 1.15 = 15% in or out per detent;
// matches Leaflet's default and feels natural after the user's
// already-trained map muscle memory.
const WHEEL_ZOOM_FACTOR = 1.15

// ---------------------------------------------------------------------------
// Coordinate transforms
// ---------------------------------------------------------------------------

/** Euclidean length of the section line, computed once from endpoints. */
function sectionLengthM(section: CrossSectionResponse): number {
  const dx = section.end_x - section.start_x
  const dy = section.end_y - section.start_y
  return Math.sqrt(dx * dx + dy * dy)
}

/** Plate-tectonic "nice number" tick spacing — pick the largest of
 * {1, 2, 5} × 10^k that fits ~5-10 ticks across the range. Matches
 * the chart libraries' standard heuristic and reads cleanly for
 * engineers used to surveyed dimensions. */
function niceStep(range: number, targetTicks = 6): number {
  if (range <= 0) return 1
  const rough = range / targetTicks
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)))
  const norm = rough / magnitude
  let nice: number
  if (norm < 1.5) nice = 1
  else if (norm < 3) nice = 2
  else if (norm < 7) nice = 5
  else nice = 10
  return nice * magnitude
}

/** Generate tick positions for a [min, max] range at a nice step. */
function ticks(min: number, max: number, targetTicks = 6): number[] {
  const step = niceStep(max - min, targetTicks)
  const first = Math.ceil(min / step) * step
  const out: number[] = []
  // Cap iteration so a bad viewport (e.g. inverted) can't burn the
  // CPU; tick generation is in a render hot path.
  for (let v = first, i = 0; v <= max && i < 200; v += step, i += 1) {
    out.push(v)
  }
  return out
}

// ---------------------------------------------------------------------------
// SVG measurement — track the available drawing area for axis scaling
// ---------------------------------------------------------------------------

/** Observe a DOM element's size; returns ``{ width, height }`` that
 * updates as the container resizes. ``null`` on first render before
 * the ResizeObserver fires.
 *
 * Lives inline here rather than in ``hooks/`` because no other module
 * needs it yet — promote on the second copy per the duplication rule. */
function useElementSize(ref: React.RefObject<HTMLElement | null>): {
  width: number
  height: number
} | null {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    setSize({ width: el.clientWidth, height: el.clientHeight })
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        setSize({ width, height })
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return size
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SectionPanel({
  section,
  zEpsg = null,
  cpts = [],
  boreholes = [],
}: Props): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const size = useElementSize(containerRef)
  const lengthM = useMemo(() => sectionLengthM(section), [section])

  // Default viewport — full section length, default vertical window.
  // Recomputed when the section changes so switching sections in the
  // sidebar fits the new one without inheriting the previous framing.
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
  // Reset to default framing when the section identity changes (the
  // user picked a different section in the sidebar).
  useEffect(() => {
    setViewport(defaultViewport)
  }, [defaultViewport])

  const [vex, setVex] = useState<number>(section.vertical_exaggeration ?? VEX_DEFAULT)
  useEffect(() => {
    setVex(section.vertical_exaggeration ?? VEX_DEFAULT)
  }, [section.id, section.vertical_exaggeration])

  // Drawing-area pixel size. The SVG's ``viewBox`` always spans the
  // full container; coordinate transforms convert world → viewBox.
  const plotWidth = Math.max(1, (size?.width ?? 800) - MARGIN.left - MARGIN.right)
  const plotHeight = Math.max(1, (size?.height ?? 400) - MARGIN.top - MARGIN.bottom)

  // World-to-screen scaling. scaleH and scaleV are derived from the
  // viewport; VEX is the ratio between them.
  const scaleH = plotWidth / Math.max(1e-6, viewport.xMax - viewport.xMin)
  // Apply VEX by amplifying scaleV relative to scaleH. The vertical
  // viewport extent is then derived from plotHeight and the resulting
  // scaleV — keeps the centre fixed when the user drags the slider.
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
  const screenToX = useCallback(
    (px: number) => viewport.xMin + (px - MARGIN.left) / scaleH,
    [viewport.xMin, scaleH],
  )
  const screenToLevel = useCallback(
    (py: number) => effLevelMax - (py - MARGIN.top) / scaleV,
    [effLevelMax, scaleV],
  )

  // ---- Pan / zoom interactions ---------------------------------------

  const panStart = useRef<{ px: number; py: number; viewport: Viewport } | null>(null)
  const [isPanning, setIsPanning] = useState(false)

  function handleMouseDown(e: React.MouseEvent<SVGSVGElement>): void {
    // Only the left button starts a pan — right-click is reserved for
    // a future context menu, middle-click stays for browser autoscroll.
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
      // Drag down means viewport.levelMax (which is at the top of the
      // screen) needs to go up in world terms — add dyWorld.
      levelMin: panStart.current.viewport.levelMin + dyWorld,
      levelMax: panStart.current.viewport.levelMax + dyWorld,
    })
  }

  function handleMouseUp(): void {
    panStart.current = null
    setIsPanning(false)
  }

  // Wheel-zoom centred on the cursor — the world point under the mouse
  // stays put while the viewport shrinks or grows around it. Matches
  // Leaflet's interaction, so engineers' map muscle memory transfers.
  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault()
      const svg = containerRef.current?.querySelector('svg')
      if (!svg) return
      const rect = svg.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      // Bail when the cursor is outside the plot area — wheel events
      // bubbling up from the toolbar wouldn't otherwise be excluded.
      if (px < MARGIN.left || px > MARGIN.left + plotWidth) return
      if (py < MARGIN.top || py > MARGIN.top + plotHeight) return

      const worldX = viewport.xMin + (px - MARGIN.left) / scaleH
      const worldLevel = effLevelMax - (py - MARGIN.top) / scaleV
      const factor = e.deltaY < 0 ? 1 / WHEEL_ZOOM_FACTOR : WHEEL_ZOOM_FACTOR

      // Scale both axes by ``factor`` around the cursor's world coords.
      // Solving "the same screen point still maps to the same world
      // point after the zoom" yields these expressions.
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

  // React's onWheel is passive-by-default (preventDefault is a no-op
  // there). Attach the listener natively so we can intercept the page
  // scroll. Same pattern as the BoreholeLog Ctrl+wheel zoom.
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

  // ---- Tick generation -----------------------------------------------

  const xTicks = useMemo(
    () => ticks(viewport.xMin, viewport.xMax, 8),
    [viewport.xMin, viewport.xMax],
  )
  const levelTicks = useMemo(
    () => ticks(effLevelMin, effLevelMax, 6),
    [effLevelMin, effLevelMax],
  )

  // ---- Projected investigations -----------------------------------------

  // Filter + project the CPTs and boreholes onto the section line.
  // ``excluded_*_ids`` on the section row let the user manually hide
  // specific items; we honour them here. Built once per (section,
  // data) change — pan / zoom / VEX never invalidate the projection,
  // they just re-map the projected world coords to screen.
  const excludedCptIds = useMemo(
    () => new Set(section.excluded_cpt_ids),
    [section.excluded_cpt_ids],
  )
  const excludedBhIds = useMemo(
    () => new Set(section.excluded_borehole_ids),
    [section.excluded_borehole_ids],
  )
  const projectedCpts = useMemo(
    () => investigationsOnSection(section, cpts, excludedCptIds),
    [section, cpts, excludedCptIds],
  )
  const projectedBoreholes = useMemo(
    () => investigationsOnSection(section, boreholes, excludedBhIds),
    [section, boreholes, excludedBhIds],
  )

  // ---- Render --------------------------------------------------------

  const datumShort = verticalDatumShort(zEpsg)
  const yAxisLabel = datumShort ? `Level (${datumShort})` : 'Level (m)'

  return (
    <div className="flex flex-col h-full w-full bg-white">
      <SectionHeader
        section={section}
        lengthM={lengthM}
        vex={vex}
        onVexChange={setVex}
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
            {/* Plot-area background — solid white over the tinted
                container so the grid + axes read cleanly even when a
                future overlay tints the canvas. */}
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

            {/* Investigation columns. CPTs first (thinner stroke,
                circle marker) then boreholes (square marker) so the
                square caps render above the round CPT tops if they
                share a slot. Collision handling lives in S5 — for now
                columns at the same projected x simply overlap. */}
            <InvestigationColumns
              projectedCpts={projectedCpts}
              projectedBoreholes={projectedBoreholes}
              xToScreen={xToScreen}
              levelToScreen={levelToScreen}
              plotTop={MARGIN.top}
              plotBottom={MARGIN.top + plotHeight}
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
    </div>
  )
}

// ---------------------------------------------------------------------------
// Header strip — name, length, VEX slider, scale read-out, reset.
// ---------------------------------------------------------------------------

function SectionHeader({
  section,
  lengthM,
  vex,
  onVexChange,
  scaleH,
  scaleV,
  onReset,
}: {
  section: CrossSectionResponse
  lengthM: number
  vex: number
  onVexChange: (next: number) => void
  scaleH: number
  scaleV: number
  onReset: () => void
}): JSX.Element {
  // Log-mapped slider: a linear 0-100 thumb travels across the full
  // VEX_MIN..VEX_MAX log range. Geotech sections regularly want 5× and
  // 50× both reachable; linear mapping would crowd the small values.
  const sliderValue = Math.round(
    ((Math.log10(vex) - Math.log10(VEX_MIN)) /
      (Math.log10(VEX_MAX) - Math.log10(VEX_MIN))) *
      100,
  )

  function handleSlider(e: React.ChangeEvent<HTMLInputElement>): void {
    const v = Number(e.target.value) / 100
    const logRange = Math.log10(VEX_MAX) - Math.log10(VEX_MIN)
    onVexChange(Math.pow(10, Math.log10(VEX_MIN) + v * logRange))
  }

  return (
    <div className="flex items-center gap-4 px-3 py-2 border-b border-gray-200 bg-gray-50 text-xs">
      <div className="flex flex-col min-w-0">
        <span
          className="font-medium text-gray-800 truncate"
          title={section.name}
        >
          {section.name}
        </span>
        <span className="text-[10px] text-gray-500">
          {lengthM.toFixed(0)} m · buffer ±{section.projection_buffer_m.toFixed(0)} m
        </span>
      </div>

      <div className="flex items-center gap-2 ml-auto">
        <span className="text-[10px] text-gray-500">V exag</span>
        <input
          type="range"
          min={0}
          max={100}
          value={sliderValue}
          onChange={handleSlider}
          className="w-32 cursor-pointer"
          aria-label="Vertical exaggeration"
        />
        <span className="tabular-nums w-12 text-right">{vex.toFixed(1)}×</span>
      </div>

      <div className="flex flex-col items-end text-[10px] text-gray-500 tabular-nums">
        <span>H: {scaleH.toFixed(2)} px/m</span>
        <span>V: {scaleV.toFixed(2)} px/m</span>
      </div>

      <button
        onClick={onReset}
        className="flex items-center gap-1 px-2 py-1 rounded border border-gray-200 text-gray-600 hover:bg-white hover:text-gray-800 transition-colors"
        title="Reset view to default framing"
      >
        <RotateCcw size={11} />
        Reset
      </button>
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

// ---------------------------------------------------------------------------
// Investigation columns — projected CPTs + boreholes drawn at their
// along-distance on the section canvas.
// ---------------------------------------------------------------------------
//
// Rendering rules for S3:
//
//   * top at the investigation's elevation_m (faded "unknown elevation"
//     marker at level=0 when null — engineers should know the row
//     can't be placed vertically),
//   * bottom at elevation - depth (or no body when depth is null),
//   * CPT = thin vertical line + circle cap, borehole = thin line +
//     square cap. Same shape vocabulary as the map markers so the
//     identity reads consistently.
//   * Name label above the cap (no rotation — collision handling is S5).
//   * Native ``<title>`` tooltips on hover give the engineer the
//     numeric depth + offset without clicking.

const CPT_COLOR = '#1f2937' // slate-800; deliberate dark so it stays
// readable over the future DEM hillshade
const BH_COLOR = '#1f2937'
const MISSING_ELEV_COLOR = '#9ca3af' // gray-400 — "we don't know where
// this column belongs on Y" visual

interface ProjectedColumnInput<T> {
  proj: ProjectedInvestigation<T>
}

function InvestigationColumns({
  projectedCpts,
  projectedBoreholes,
  xToScreen,
  levelToScreen,
  plotTop,
  plotBottom,
}: {
  projectedCpts: ProjectedInvestigation<CptListItem>[]
  projectedBoreholes: ProjectedInvestigation<BoreholeListItem>[]
  xToScreen: (x: number) => number
  levelToScreen: (level: number) => number
  plotTop: number
  plotBottom: number
}): JSX.Element {
  return (
    <g>
      {projectedCpts.map(proj => (
        <CptColumn
          key={`cpt-${proj.item.id}`}
          proj={proj}
          xToScreen={xToScreen}
          levelToScreen={levelToScreen}
          plotTop={plotTop}
          plotBottom={plotBottom}
        />
      ))}
      {projectedBoreholes.map(proj => (
        <BoreholeColumn
          key={`bh-${proj.item.id}`}
          proj={proj}
          xToScreen={xToScreen}
          levelToScreen={levelToScreen}
          plotTop={plotTop}
          plotBottom={plotBottom}
        />
      ))}
    </g>
  )
}

/** Single CPT column — thin vertical line, circle marker at the top. */
function CptColumn({
  proj,
  xToScreen,
  levelToScreen,
  plotTop,
  plotBottom,
}: ProjectedColumnInput<CptListItem> & {
  xToScreen: (x: number) => number
  levelToScreen: (level: number) => number
  plotTop: number
  plotBottom: number
}): JSX.Element | null {
  const { item, along, offset } = proj
  return (
    <ColumnGlyph
      name={item.name}
      kind="cpt"
      along={along}
      offset={offset}
      elevation={item.elevation_m}
      depth={item.max_depth_m}
      xToScreen={xToScreen}
      levelToScreen={levelToScreen}
      plotTop={plotTop}
      plotBottom={plotBottom}
    />
  )
}

/** Single borehole column — thin vertical line, square marker at the top. */
function BoreholeColumn({
  proj,
  xToScreen,
  levelToScreen,
  plotTop,
  plotBottom,
}: ProjectedColumnInput<BoreholeListItem> & {
  xToScreen: (x: number) => number
  levelToScreen: (level: number) => number
  plotTop: number
  plotBottom: number
}): JSX.Element | null {
  const { item, along, offset } = proj
  return (
    <ColumnGlyph
      name={item.name}
      kind="borehole"
      along={along}
      offset={offset}
      elevation={item.elevation_m}
      depth={item.total_depth_m}
      xToScreen={xToScreen}
      levelToScreen={levelToScreen}
      plotTop={plotTop}
      plotBottom={plotBottom}
    />
  )
}

/**
 * Shared column glyph for CPTs and boreholes. Shape encodes the
 * kind (circle vs. square) — same vocabulary as the map markers so a
 * user reading the section interprets the icons the same way they'd
 * interpret the map dots.
 *
 * Clipping: the body line is clipped to the plot area (via SVG
 * shape-from-attributes; we just clamp the y-coords to ``[plotTop,
 * plotBottom]``). The top cap renders only when its level is inside
 * the visible window; the name label renders alongside the cap so it
 * disappears with the cap when the user scrolls the elevation off-
 * screen.
 */
function ColumnGlyph({
  name,
  kind,
  along,
  offset,
  elevation,
  depth,
  xToScreen,
  levelToScreen,
  plotTop,
  plotBottom,
}: {
  name: string
  kind: 'cpt' | 'borehole'
  along: number
  offset: number
  elevation: number | null
  depth: number | null
  xToScreen: (x: number) => number
  levelToScreen: (level: number) => number
  plotTop: number
  plotBottom: number
}): JSX.Element | null {
  const sx = xToScreen(along)
  // ``null`` elevation gets the column floated at level=0 in a faded
  // tone so the user sees "this exists but we can't position it" —
  // dropping it entirely would silently hide rows that lack a Z.
  const elevValue = elevation ?? 0
  const elevKnown = elevation !== null
  const sy = levelToScreen(elevValue)
  const color = elevKnown ? (kind === 'cpt' ? CPT_COLOR : BH_COLOR) : MISSING_ELEV_COLOR

  // Body line: top at elevation, bottom at elevation - depth. ``null``
  // depth renders just the cap (no body) — same convention as the
  // map's missing-depth case.
  let bodyBottomY: number | null = null
  if (depth !== null && depth > 0) {
    bodyBottomY = levelToScreen(elevValue - depth)
  }
  // Clamp to the plot rect so columns extending below the viewport
  // don't render outside the canvas.
  const clampedTop = Math.max(plotTop, Math.min(plotBottom, sy))
  const clampedBottom =
    bodyBottomY !== null ? Math.max(plotTop, Math.min(plotBottom, bodyBottomY)) : null

  // Offset hint: rendered as a small sup-script next to the name when
  // |offset| > 1 m. The signed value tells the engineer which side
  // of the line the investigation lives on (positive = left of the
  // line direction).
  const offsetLabel =
    Math.abs(offset) >= 1
      ? ` (${offset > 0 ? '←' : '→'}${Math.abs(offset).toFixed(0)} m)`
      : ''

  return (
    <g>
      {/* Native title is the cheapest, most accessible tooltip; we'll
          swap to a tracked hover-popover when collision handling
          adds offset indicators / leader lines in S5. */}
      <title>
        {`${name}`}
        {elevation !== null ? ` · ${elevation.toFixed(2)} m` : ' · elevation unknown'}
        {depth !== null ? ` · ${depth.toFixed(1)} m deep` : ''}
        {` · ${Math.abs(offset).toFixed(1)} m off-line`}
      </title>

      {/* Body line — only rendered when both endpoints land inside
          the plot area. */}
      {clampedBottom !== null && clampedTop < clampedBottom && (
        <line
          x1={sx}
          x2={sx}
          y1={clampedTop}
          y2={clampedBottom}
          stroke={color}
          strokeWidth={1.5}
          strokeOpacity={elevKnown ? 0.9 : 0.4}
        />
      )}

      {/* Top cap + label — only inside the plot area. */}
      {sy >= plotTop && sy <= plotBottom && (
        <>
          {kind === 'cpt' ? (
            <circle cx={sx} cy={sy} r={3.5} fill={color} fillOpacity={elevKnown ? 0.95 : 0.5} />
          ) : (
            <rect
              x={sx - 3.5}
              y={sy - 3.5}
              width={7}
              height={7}
              fill={color}
              fillOpacity={elevKnown ? 0.95 : 0.5}
            />
          )}
          <text
            x={sx}
            y={sy - 6}
            fontSize={9}
            fill={elevKnown ? '#1f2937' : '#9ca3af'}
            textAnchor="middle"
          >
            {name}
            {offsetLabel}
          </text>
        </>
      )}
    </g>
  )
}
