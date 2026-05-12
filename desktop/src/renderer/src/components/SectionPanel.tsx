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
import { Minus, Plus, RotateCcw, X } from 'lucide-react'

import {
  api,
  type BoreholeListItem,
  type CptListItem,
  type CptPlotResponse,
  type CrossSectionResponse,
  type DemSamplePoint,
} from '../api/client'
import { log } from '../utils/log'
import { verticalDatumShort } from '../utils/verticalDatum'
import { nudgeColumns, type NudgeResult } from '../utils/columnLayout'
import {
  investigationsOnSection,
  type ProjectedInvestigation,
} from '../utils/sectionProjection'
import CptDataColumn from './sections/CptDataColumn'
import {
  cptDataTrackWidth,
  cptTrackWidths,
  readCptChannels,
  type CptChannels,
} from './sections/cptChannels'

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
  /** Patch the section row server-side. Called on slider release for
   * ``projection_buffer_m`` and ``vertical_exaggeration`` so the
   * values persist across opens and ride the .gmproj bundle. The
   * handler is optional so the test-render path can mount without
   * a network seam. */
  onPatch?: (patch: {
    projection_buffer_m?: number
    vertical_exaggeration?: number
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

// Edge-to-edge gap between adjacent columns. 4 px of clear air
// keeps tie-back diagonals readable even on tight profiles.
const COLUMN_EDGE_GAP_PX = 4

// Bare column width (S2/S3 layout — no data tracks). Used as the
// floor for both kinds; data tracks grow the width additively as
// the header toggles flip on.
const BARE_COLUMN_WIDTH_PX = 14

interface PlacedColumnInput {
  kind: 'cpt' | 'borehole'
  proj: ProjectedInvestigation<CptListItem | BoreholeListItem>
  trueX: number
  /** Visible pixel width of this column at its widest point —
   * feeds the nudge's edge-to-edge spacing. */
  width: number
}

interface PlacedColumn {
  kind: 'cpt' | 'borehole'
  proj: ProjectedInvestigation<CptListItem | BoreholeListItem>
  /** Screen X where the column would naturally land. */
  trueX: number
  /** Screen X where the column actually renders after collision
   * nudging. Equal to ``trueX`` when no displacement was needed. */
  nudgedX: number
  /** Pixel width of this column's rendered glyph (cap + any data
   * tracks). The renderer uses ``halfWidth`` to position the qc
   * curve / interpretation tracks relative to the column centerline. */
  width: number
  /** ``true`` when the column had to be moved more than half a
   * pixel. Drives whether the tie-back diagonal renders. */
  displaced: boolean
}

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
  onPatch,
  onClose,
  onSelectCpt,
  onSelectBorehole,
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

  // Horizontal pan for the scrub bar. Sets the viewport's xMin/xMax
  // to a new window of the same width centred on ``centerX``.
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

  // ---- DEM ground-surface samples ---------------------------------------

  // Fetch elevations from the backend's /dem/sample endpoint when the
  // section's endpoints / CRS change. ``null`` = not loaded yet (or
  // the endpoint returned an error — see catch below); the renderer
  // simply skips the polyline in that case rather than blocking the
  // whole panel. 200 samples is enough for a smooth profile at any
  // realistic screen width.
  const [demSamples, setDemSamples] = useState<DemSamplePoint[] | null>(null)
  useEffect(() => {
    let cancelled = false
    setDemSamples(null)
    api.dem
      .sampleLine({
        startX: section.start_x,
        startY: section.start_y,
        endX: section.end_x,
        endY: section.end_y,
        epsg: section.epsg,
        nSamples: 200,
      })
      .then(res => {
        if (cancelled) return
        setDemSamples(res.samples)
        log.debug('dem', `loaded ${res.samples.length} samples from ${res.source}`)
      })
      .catch(err => {
        // Backend returns 400 when the section's CRS isn't mapped to
        // a DEM source (anything outside EPSG:31370 today). Stay
        // quiet — the section still renders cleanly, just without
        // the surface line.
        log.warn('dem', `sample failed for section ${section.id}`, err)
      })
    return () => {
      cancelled = true
    }
  }, [
    section.id,
    section.start_x,
    section.start_y,
    section.end_x,
    section.end_y,
    section.epsg,
  ])

  // ---- CPT plot data batch (S7) ----------------------------------------

  // Channels the user has toggled on. Persisted in section.view_state
  // (currently not part of CrossSectionResponse — falls back to the
  // documented defaults until that view_state shape lands; see S7
  // open item below). Local-only for now keeps S7 functional.
  const [cptChannels] = useState<CptChannels>(() =>
    readCptChannels(
      // CrossSectionResponse doesn't expose ``view_state`` yet —
      // typed as unknown so the read helper applies its full-bag
      // fallback. Schema can grow later without code change here.
      (section as unknown as { view_state?: Record<string, unknown> }).view_state,
    ),
  )

  // Map of cpt id → CptPlotResponse, populated on section open via
  // a single ``plot-batch`` round-trip. ``null`` while loading,
  // ``Map`` once the response lands. The column renderer skips the
  // data tracks when an id isn't in the map (e.g. just-imported
  // CPT before refresh, or unknown id from a stale section row).
  const [cptPlots, setCptPlots] = useState<Map<string, CptPlotResponse> | null>(null)
  // Compute the in-buffer CPT ids — used as the batch input.
  // Project once per section/cpts/excluded change; the network call
  // is the next effect.
  const inBufferCptIds = useMemo<string[]>(
    () =>
      investigationsOnSection(section, cpts, new Set(section.excluded_cpt_ids))
        .map(p => p.item.id),
    [section, cpts],
  )
  // Stable signature for the effect deps — when callers don't pass
  // ``cpts`` (test fixtures, callers that don't have the list yet),
  // the default ``cpts = []`` creates a NEW array literal on every
  // render. ``useMemo`` over that returns a NEW ``[]`` per render
  // too, so a raw ``[inBufferCptIds]`` effect dep fires on every
  // render → setCptPlots → re-render → infinite loop (and a hung
  // jsdom worker in tests).
  //
  // Joining to a string collapses reference churn into a value
  // comparison. We pay one ``.join`` per render in exchange for a
  // bounded effect.
  const inBufferCptIdsKey = inBufferCptIds.join(',')
  useEffect(() => {
    let cancelled = false
    setCptPlots(null)
    if (inBufferCptIds.length === 0) {
      setCptPlots(new Map())
      return
    }
    api.cpt
      .plotBatch(inBufferCptIds, section.app_project_id)
      .then(plots => {
        if (cancelled) return
        const m = new Map<string, CptPlotResponse>()
        for (const p of plots) m.set(p.cpt_id, p)
        setCptPlots(m)
        log.debug(
          'section',
          `loaded ${plots.length}/${inBufferCptIds.length} CPT plots`,
        )
      })
      .catch(err => {
        // Network failure is recoverable — the panel still renders
        // bare columns. Log it; don't block.
        log.warn('section', `cpt plot-batch failed for ${section.id}`, err)
        if (!cancelled) setCptPlots(new Map())
      })
    return () => {
      cancelled = true
    }
    // inBufferCptIds is intentionally NOT in the deps — its identity
    // changes every render under the default-prop literal. The string
    // key above captures its content stably.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section.id, inBufferCptIdsKey])

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

  // Track widths scale with horizontal zoom — at low zoom keep
  // columns compact, at high zoom let curves breathe. The same
  // widths feed both the layout (nudge) and the render (column
  // glyph) so positions and visuals stay in sync.
  const trackWidthsByChannel = useMemo(() => cptTrackWidths(scaleH), [scaleH])

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
        // CPT column width grows additively with each enabled data
        // channel. The bare cap+tie width is the floor; track
        // widths come from ``cptDataTrackWidth`` at the current
        // zoom. The nudge then spaces edge-to-edge so a data-laden
        // CPT next to a bare borehole still gets breathing room.
        const trackW = cptPlots?.has(proj.item.id)
          ? cptDataTrackWidth(proj.item.cpt_type, cptChannels, trackWidthsByChannel)
          : 0
        return {
          kind: 'cpt' as const,
          proj: proj as ProjectedInvestigation<CptListItem | BoreholeListItem>,
          trueX: xToScreen(proj.along),
          width: BARE_COLUMN_WIDTH_PX + trackW,
        }
      }),
      ...projectedBoreholes.map(proj => ({
        kind: 'borehole' as const,
        proj: proj as ProjectedInvestigation<CptListItem | BoreholeListItem>,
        trueX: xToScreen(proj.along),
        width: BARE_COLUMN_WIDTH_PX,
      })),
    ]
    return nudgeColumns(items, COLUMN_EDGE_GAP_PX).map(r => ({
      kind: r.item.kind,
      proj: r.item.proj,
      trueX: r.trueX,
      nudgedX: r.nudgedX,
      width: r.item.width,
      displaced: r.displaced,
    }))
  }, [projectedCpts, projectedBoreholes, xToScreen, cptPlots, cptChannels, trackWidthsByChannel])

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
                    widths={trackWidthsByChannel}
                    screenX={col.nudgedX}
                    surfaceElevationM={item.elevation_m}
                    plotTop={MARGIN.top}
                    plotBottom={MARGIN.top + plotHeight}
                    levelToScreen={levelToScreen}
                  />
                )
              })}

            {/* Investigation columns. Both kinds rendered from a
                single nudged list — the layout pass spaces crowded
                projections rightward while drawing tie-back diagonals
                so each column's true projected position stays
                inspectable. */}
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

// ---------------------------------------------------------------------------
// Header strip — name, length, VEX slider, scale read-out, reset.
// ---------------------------------------------------------------------------

// Projection-buffer slider bounds. 5 m is the tightest engineers
// typically use (closely-spaced corridor surveys); 500 m covers
// regional / preliminary sections through sparse boreholes.
const BUFFER_MIN = 5
const BUFFER_MAX = 500

function SectionHeader({
  section,
  lengthM,
  onClose,
  onZoomIn,
  onZoomOut,
  vex,
  onVexChange,
  onVexCommit,
  onBufferCommit,
  scaleH,
  scaleV,
  onReset,
}: {
  section: CrossSectionResponse
  lengthM: number
  onClose: (() => void) | undefined
  onZoomIn: () => void
  onZoomOut: () => void
  vex: number
  onVexChange: (next: number) => void
  // Fires on slider release with the final value; ``undefined`` means
  // "don't persist" (test-render mode without a backend seam).
  onVexCommit: ((next: number) => void) | undefined
  onBufferCommit: ((next: number) => void) | undefined
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

  // Local mirror of the buffer for smooth drag (same pattern the DEM
  // overlay opacity slider uses). Commit on release; the section row
  // is updated server-side then; until then the projected columns
  // still use ``section.projection_buffer_m`` because that's what
  // SectionPanel sees from the server-truth ``section`` prop.
  const [localBuffer, setLocalBuffer] = useState(section.projection_buffer_m)
  useEffect(() => {
    setLocalBuffer(section.projection_buffer_m)
  }, [section.id, section.projection_buffer_m])

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
        <span
          className="text-[10px] text-gray-500"
          title="Lateral distance from the section line within which investigations are projected onto it"
        >
          Buffer
        </span>
        <input
          type="range"
          min={BUFFER_MIN}
          max={BUFFER_MAX}
          step={5}
          value={Math.round(localBuffer)}
          onChange={e => setLocalBuffer(Number(e.target.value))}
          onMouseUp={() => onBufferCommit?.(localBuffer)}
          onTouchEnd={() => onBufferCommit?.(localBuffer)}
          onKeyUp={() => onBufferCommit?.(localBuffer)}
          className="w-28 cursor-pointer"
          aria-label="Projection buffer (m)"
          disabled={onBufferCommit === undefined}
        />
        <span className="tabular-nums w-12 text-right">±{Math.round(localBuffer)} m</span>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[10px] text-gray-500">V exag</span>
        <input
          type="range"
          min={0}
          max={100}
          value={sliderValue}
          onChange={handleSlider}
          onMouseUp={() => onVexCommit?.(vex)}
          onTouchEnd={() => onVexCommit?.(vex)}
          onKeyUp={() => onVexCommit?.(vex)}
          className="w-32 cursor-pointer"
          aria-label="Vertical exaggeration"
        />
        <span className="tabular-nums w-12 text-right">{vex.toFixed(1)}×</span>
      </div>

      <div className="flex flex-col items-end text-[10px] text-gray-500 tabular-nums">
        <span>H: {scaleH.toFixed(2)} px/m</span>
        <span>V: {scaleV.toFixed(2)} px/m</span>
      </div>

      <div className="flex items-center rounded border border-gray-200 overflow-hidden">
        <button
          onClick={onZoomOut}
          className="flex items-center justify-center w-7 h-7 text-gray-600 hover:bg-white hover:text-gray-800 transition-colors border-r border-gray-200"
          title="Zoom out (or scroll the canvas)"
          aria-label="Zoom out"
        >
          <Minus size={13} />
        </button>
        <button
          onClick={onZoomIn}
          className="flex items-center justify-center w-7 h-7 text-gray-600 hover:bg-white hover:text-gray-800 transition-colors"
          title="Zoom in (or scroll the canvas)"
          aria-label="Zoom in"
        >
          <Plus size={13} />
        </button>
      </div>

      <button
        onClick={onReset}
        className="flex items-center gap-1 px-2 py-1 rounded border border-gray-200 text-gray-600 hover:bg-white hover:text-gray-800 transition-colors"
        title="Reset view to default framing"
      >
        <RotateCcw size={11} />
        Reset
      </button>

      {onClose && (
        <button
          onClick={onClose}
          className="flex items-center justify-center w-7 h-7 rounded border border-gray-200 text-gray-500 hover:bg-white hover:text-gray-800 transition-colors"
          title="Close section view (back to map)"
          aria-label="Close section view"
        >
          <X size={13} />
        </button>
      )}
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
// Investigation columns — placed (post-nudge) CPTs + boreholes drawn
// on the section canvas. Each placed column carries both its true
// projected X and the nudged X where it actually renders; when those
// differ the renderer draws a tie-back diagonal to keep the
// projection geometry honest.
// ---------------------------------------------------------------------------
//
// Rendering rules:
//
//   * top at the investigation's elevation_m (faded "unknown elevation"
//     marker at level=0 when null — engineers should know the row
//     can't be placed vertically),
//   * bottom at elevation - depth (or no body when depth is null),
//   * CPT = thin vertical line + circle cap, borehole = thin line +
//     square cap. Same shape vocabulary as the map markers so the
//     identity reads consistently.
//   * Name label above the cap (no rotation — symbol labels handle
//     collision via the nudge pass, not in-place rotation).
//   * Tie-back diagonal when displaced: a small tick at the top of
//     the plot at the column's true X, connected by a thin grey line
//     to the column cap at its nudged X. Reads as "this column is
//     drawn here but belongs there."
//   * Native ``<title>`` tooltips on hover give the engineer the
//     numeric depth + offset without clicking.

const CPT_COLOR = '#1f2937' // slate-800; deliberate dark so it stays
// readable over the future DEM hillshade
const BH_COLOR = '#1f2937'
const MISSING_ELEV_COLOR = '#9ca3af' // gray-400 — "we don't know where
// this column belongs on Y" visual

function InvestigationColumns({
  columns,
  levelToScreen,
  plotTop,
  plotBottom,
  onSelectCpt,
  onSelectBorehole,
}: {
  columns: PlacedColumn[]
  levelToScreen: (level: number) => number
  plotTop: number
  plotBottom: number
  onSelectCpt: ((id: string) => void) | undefined
  onSelectBorehole: ((id: string) => void) | undefined
}): JSX.Element {
  return (
    <g>
      {columns.map(col => {
        const item = col.proj.item
        const depth =
          col.kind === 'cpt'
            ? (item as CptListItem).max_depth_m
            : (item as BoreholeListItem).total_depth_m
        const onClick =
          col.kind === 'cpt'
            ? onSelectCpt
              ? () => onSelectCpt(item.id)
              : undefined
            : onSelectBorehole
              ? () => onSelectBorehole(item.id)
              : undefined
        return (
          <ColumnGlyph
            key={`${col.kind}-${item.id}`}
            name={item.name}
            kind={col.kind}
            screenX={col.nudgedX}
            tieBackTrueX={col.displaced ? col.trueX : null}
            offset={col.proj.offset}
            elevation={item.elevation_m}
            depth={depth}
            levelToScreen={levelToScreen}
            plotTop={plotTop}
            plotBottom={plotBottom}
            onClick={onClick}
          />
        )
      })}
    </g>
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
 *
 * Tie-back: when ``tieBackTrueX`` is not null, the column was nudged
 * from its true projected X to ``screenX`` to avoid overlap. We draw
 * a tick at the true X on the top axis and a thin diagonal back to
 * the cap so the geometry stays inspectable.
 */
function ColumnGlyph({
  name,
  kind,
  screenX,
  tieBackTrueX,
  offset,
  elevation,
  depth,
  levelToScreen,
  plotTop,
  plotBottom,
  onClick,
}: {
  name: string
  kind: 'cpt' | 'borehole'
  screenX: number
  tieBackTrueX: number | null
  offset: number
  elevation: number | null
  depth: number | null
  levelToScreen: (level: number) => number
  plotTop: number
  plotBottom: number
  onClick: (() => void) | undefined
}): JSX.Element | null {
  const sx = screenX
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
    <g
      onClick={onClick}
      style={{ cursor: onClick ? 'pointer' : 'default' }}
    >
      {/* Transparent hit-box spanning the column's vertical strip.
          The body line + cap are too thin to click reliably; the
          invisible rect catches clicks anywhere within ±6 px of the
          column's X across the full plot height. ``pointerEvents``
          on the rect alone (not the wider <g>) keeps the tie-back
          diagonals and other siblings non-clickable. */}
      {onClick && (
        <rect
          x={sx - 7}
          y={plotTop}
          width={14}
          height={plotBottom - plotTop}
          fill="transparent"
        />
      )}

      {/* Native title is the cheapest, most accessible tooltip; we'll
          swap to a tracked hover-popover when collision handling
          adds offset indicators / leader lines in S5. */}
      <title>
        {`${name}`}
        {elevation !== null ? ` · ${elevation.toFixed(2)} m` : ' · elevation unknown'}
        {depth !== null ? ` · ${depth.toFixed(1)} m deep` : ''}
        {` · ${Math.abs(offset).toFixed(1)} m off-line`}
        {onClick ? ' · click for detail' : ''}
      </title>

      {/* Tie-back: short tick at the true X on the top axis +
          diagonal up to the cap at the nudged screenX. Renders only
          when the layout pass had to displace this column. */}
      {tieBackTrueX !== null && (
        <g pointerEvents="none">
          <line
            x1={tieBackTrueX}
            x2={tieBackTrueX}
            y1={plotTop}
            y2={plotTop + 5}
            stroke="#6b7280"
            strokeWidth={1.25}
            strokeOpacity={0.8}
          />
          <line
            x1={tieBackTrueX}
            x2={sx}
            y1={plotTop + 5}
            y2={clampedTop}
            stroke="#6b7280"
            strokeWidth={1}
            strokeOpacity={0.55}
            strokeDasharray="2 2"
          />
        </g>
      )}

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
          {/* Rotated -30° so adjacent crowded columns don't pile
              labels on top of each other. Anchor at end so the text
              extends up-left from the cap, mirroring DOV's
              lengteprofiel PDF convention for dense profiles. */}
          <text
            x={sx}
            y={sy - 7}
            fontSize={9}
            fill={elevKnown ? '#1f2937' : '#9ca3af'}
            textAnchor="end"
            transform={`rotate(-30 ${sx} ${sy - 7})`}
          >
            {name}
            {offsetLabel}
          </text>
        </>
      )}
    </g>
  )
}

// ---------------------------------------------------------------------------
// DEM ground-surface polyline
// ---------------------------------------------------------------------------
//
// Renders the elevation profile fetched from /dem/sample as a single
// polyline. NoData samples (null elevation_m) break the line into
// sub-paths — engineers expect a gap rather than a straight bridge
// across missing data.
//
// Visual: thin earth-brown stroke at 60% opacity. Reads as terrain
// context without competing with the investigation columns for
// primary attention.

const DEM_STROKE = '#92400e' // amber-800 — earthy brown
const DEM_STROKE_WIDTH = 1.5

function DemSurfaceLine({
  samples,
  xToScreen,
  levelToScreen,
  plotTop,
  plotBottom,
  plotLeft,
  plotRight,
}: {
  samples: DemSamplePoint[]
  xToScreen: (x: number) => number
  levelToScreen: (level: number) => number
  plotTop: number
  plotBottom: number
  plotLeft: number
  plotRight: number
}): JSX.Element {
  // Walk the samples, accumulating SVG path "d" commands. ``M`` opens
  // a new sub-path each time we cross a NoData gap or re-enter the
  // plot area from outside, so the renderer never draws a straight
  // line across missing data.
  const path = useMemo(() => {
    let d = ''
    let penDown = false
    for (const s of samples) {
      if (s.elevation_m === null) {
        penDown = false
        continue
      }
      const x = xToScreen(s.along_m)
      const y = levelToScreen(s.elevation_m)
      // Clip to the plot rect — points outside are skipped (the
      // surface line is part of the canvas; it shouldn't bleed into
      // the axis margins). We clamp the pen state on re-entry so a
      // single sample inside the rect doesn't draw a 1-point M move
      // and nothing else.
      if (
        x < plotLeft ||
        x > plotRight ||
        y < plotTop ||
        y > plotBottom
      ) {
        penDown = false
        continue
      }
      if (!penDown) {
        d += `M ${x.toFixed(2)} ${y.toFixed(2)} `
        penDown = true
      } else {
        d += `L ${x.toFixed(2)} ${y.toFixed(2)} `
      }
    }
    return d.trim()
  }, [samples, xToScreen, levelToScreen, plotTop, plotBottom, plotLeft, plotRight])

  if (path === '') return <></>

  return (
    <path
      d={path}
      stroke={DEM_STROKE}
      strokeWidth={DEM_STROKE_WIDTH}
      strokeOpacity={0.6}
      fill="none"
    >
      <title>Ground surface (DHMVII DTM)</title>
    </path>
  )
}

// ---------------------------------------------------------------------------
// Section scrub bar — fast horizontal navigation for long profiles
// ---------------------------------------------------------------------------
//
// Track represents the full section (0 → sectionLength). A coloured
// handle inside it shows the current viewport window. Drag the
// handle to pan; click on the track outside the handle to recentre
// the viewport at that x.
//
// Vertical zoom is unaffected — only the X bounds move. This keeps
// the scrub interaction predictable: same Y window, different X
// slice.

function SectionScrubBar({
  sectionLength,
  xMin,
  xMax,
  onScrubTo,
}: {
  sectionLength: number
  xMin: number
  xMax: number
  onScrubTo: (centerX: number) => void
}): JSX.Element | null {
  const trackRef = useRef<HTMLDivElement>(null)
  // Pixel offset between the cursor and the handle's centre at
  // drag-start. Lets the user grab anywhere on the handle without
  // the handle jumping to the cursor's exact x.
  const dragGrabRef = useRef<number | null>(null)

  if (sectionLength <= 0) return null

  // Viewport window as percentages of the full section. Clamped to
  // [0, 100] so a window scrolled past either end of the section
  // still renders as a flush-against-edge handle.
  const startPct = Math.max(0, Math.min(100, (xMin / sectionLength) * 100))
  const endPct = Math.max(0, Math.min(100, (xMax / sectionLength) * 100))
  const widthPct = Math.max(2, endPct - startPct) // floor at 2% so the
  // handle stays grab-able when fully zoomed in
  const centerX = (xMin + xMax) / 2
  const viewportSpan = xMax - xMin

  function xFromMouse(e: MouseEvent | React.MouseEvent): number | null {
    const track = trackRef.current
    if (!track) return null
    const rect = track.getBoundingClientRect()
    const px = e.clientX - rect.left
    const fraction = Math.max(0, Math.min(1, px / rect.width))
    return fraction * sectionLength
  }

  function startDrag(e: React.MouseEvent): void {
    const cursorX = xFromMouse(e)
    if (cursorX === null) return
    dragGrabRef.current = cursorX - centerX
    e.stopPropagation()
    e.preventDefault()
    function onMove(ev: MouseEvent): void {
      const x = xFromMouse(ev)
      if (x === null || dragGrabRef.current === null) return
      onScrubTo(x - dragGrabRef.current)
    }
    function onUp(): void {
      dragGrabRef.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  function onTrackClick(e: React.MouseEvent): void {
    // Click outside the handle = recentre on that x. The handle has
    // its own onMouseDown that ``stopPropagation``s, so a handle
    // grab won't accidentally recentre via this listener.
    const x = xFromMouse(e)
    if (x === null) return
    onScrubTo(x)
  }

  return (
    <div className="border-t border-gray-200 bg-gray-50 px-3 py-2 text-[10px] text-gray-500 flex items-center gap-2">
      <span className="tabular-nums w-14 text-right shrink-0">
        {Math.round(Math.max(0, xMin))} m
      </span>
      <div
        ref={trackRef}
        onMouseDown={onTrackClick}
        className="relative flex-1 h-3 rounded bg-gray-200 cursor-pointer select-none"
        title={`Showing ${viewportSpan.toFixed(0)} m of ${sectionLength.toFixed(0)} m`}
      >
        <div
          onMouseDown={startDrag}
          className="absolute top-0 bottom-0 rounded bg-blue-500/70 hover:bg-blue-500 transition-colors cursor-grab active:cursor-grabbing"
          style={{
            left: `${startPct}%`,
            width: `${widthPct}%`,
          }}
        />
      </div>
      <span className="tabular-nums w-14 text-left shrink-0">
        {Math.round(Math.min(sectionLength, xMax))} m
      </span>
    </div>
  )
}
