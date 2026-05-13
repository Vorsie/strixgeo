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
  FormationContactResponse,
  GeologicalFormationCreatePayload,
  GeologicalFormationResponse,
} from '../api/client'
import { verticalDatumShort } from '../utils/verticalDatum'
import { nudgeColumns } from '../utils/columnLayout'
import type { ProjectedInvestigation } from '../utils/sectionProjection'
import { SoilPatterns } from '../utils/soilPatterns'
import FormationPickerDialog from './interpretation/FormationPickerDialog'
import BoreholeColumn from './sections/BoreholeColumn'
import ColumnContextMenu from './sections/ColumnContextMenu'
import ContactPickBar from './sections/ContactPickBar'
import ContactsLayer from './sections/ContactsLayer'
import { lookupCptValueAtDepth } from './sections/cptInterpolation'
import CptDataColumn from './sections/CptDataColumn'
import {
  cptBandFullWidth,
  cptBandHalfWidth,
  enabledBoreholeChannelCount,
} from './sections/cptChannels'
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
  collectSnapDepths,
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
  /** Active geological model's formation contacts — render as the
   * Phase 4 editor overlay (horizontal lines connecting picks per
   * formation across the projected investigations). */
  contacts?: readonly FormationContactResponse[]
  /** Formation vocabulary — used to colour each contact polyline
   * with the formation's own colour. */
  formations?: readonly GeologicalFormationResponse[]
  /** Borehole IDs the active model excludes from contact rendering.
   * The ContactsLayer skips polyline vertices at these anchors. */
  excludedBoreholeIds?: readonly string[]
  /** Click-to-place hook. Fires when the user picks a formation on
   * the picker modal — caller (App) POSTs the contact and updates
   * the contacts state. Omitting it leaves the section read-only.
   *
   * ``snapped`` reflects whether the depth came from a snap-to-
   * stratigraphy boundary; the caller uses it to decide the
   * contact's ``source`` + ``confidence`` fields (debt #22/#23). */
  onCreateContact?: (
    anchorKind: 'cpt' | 'borehole',
    anchorId: string,
    depth_m: number,
    formationId: string,
    snapped: boolean,
  ) => Promise<void>
  /** Drag-to-re-pick hook. Fires on the drag's mouseup with the
   * contact id, its new depth_top_m, and whether the depth landed
   * on a snap candidate. Caller PATCHes and updates the local
   * contacts state. */
  onUpdateContactDepth?: (
    contactId: string,
    newDepthM: number,
    snapped: boolean,
  ) => Promise<void>
  /** Inline-create a formation from the picker modal's "New
   * formation here" affordance. Returns the new row's id so the
   * picker can chain to a contact commit. */
  onCreateFormation?: (
    payload: GeologicalFormationCreatePayload,
  ) => Promise<{ id: string } | null>
}

export default function SectionPanel({
  section,
  zEpsg = null,
  cpts = [],
  boreholes = [],
  onPatch,
  onClose,
  contacts = [],
  formations = [],
  excludedBoreholeIds,
  onCreateContact,
  onUpdateContactDepth,
  onCreateFormation,
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
    boreholeChannels,
    setBoreholeChannels,
    columnSpacing,
    setColumnSpacing,
    snapToStratigraphy,
    setSnapToStratigraphy,
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

  // Same shape for borehole interpretation toggles — optimistic
  // in-memory update + PATCH so the choice rides .gmproj saves.
  const handleBoreholeChannelsChange = useCallback(
    (next: typeof boreholeChannels) => {
      setBoreholeChannels(next)
      if (onPatch) {
        void onPatch({ view_state: { borehole_channels: next } })
      }
    },
    [setBoreholeChannels, onPatch],
  )

  const handleSnapToStratigraphyChange = useCallback(
    (next: boolean) => {
      setSnapToStratigraphy(next)
      if (onPatch) {
        void onPatch({ view_state: { snap_to_stratigraphy: next } })
      }
    },
    [setSnapToStratigraphy, onPatch],
  )

  // Spacing-slider commit. Same shape as channels — optimistic local
  // update for instant feedback while the user drags, server-side
  // PATCH on release so the chosen spacing rides the .gmproj bundle.
  // SectionHeader calls ``setColumnSpacing`` on every input change
  // (smooth visual update) and ``handleSpacingCommit`` on release.
  const handleSpacingCommit = useCallback(
    (next: number) => {
      if (onPatch) {
        void onPatch({ view_state: { column_spacing: next } })
      }
    },
    [onPatch],
  )

  // Band half-width scales with horizontal zoom only — at low zoom
  // keep columns compact, at high zoom let curves breathe. This is
  // the VISUAL width — what each band renders at — and stays fixed
  // regardless of the column-spacing knob.
  const bandHalfWidth = useMemo(() => cptBandHalfWidth(scaleH), [scaleH])

  // Column collision handling — when multiple investigations project
  // near the same along-distance their columns would overlap into an
  // unreadable stack. Combine both kinds, nudge in a single sweep so
  // crowded ones cascade rightward, and surface the displacement
  // back to the column renderer so it can draw a tie-back diagonal.
  // Recomputes on viewport pan / zoom because the available pixel
  // space changes with scaleH.
  const enabledBhChannels = useMemo(
    () => enabledBoreholeChannelCount(boreholeChannels),
    [boreholeChannels],
  )

  const placedColumns = useMemo<PlacedColumn[]>(() => {
    // ``columnSpacing`` lerps between two layouts, both collision-safe:
    //
    //   spacing = 1.0 → TRUTH layout: each column's trueX is its
    //     projected along-distance. Nudge runs over the truth and
    //     only displaces columns whose natural positions would
    //     overlap. Distant tests sit exactly where they should.
    //   spacing = 0.0 → PACKED layout: columns are placed
    //     edge-to-edge in projection-order starting from the
    //     leftmost trueX. Adjacent tests sit "right next to each
    //     other" regardless of how far apart they are on the actual
    //     section line.
    //
    // For each column we feed the lerped position as its trueX into
    // nudgeColumns, so the standard edge-gap collision rule applies
    // at every spacing value — bands NEVER overlap.
    const rawItems = [
      ...projectedCpts.map(proj => {
        const trackW = cptPlots?.has(proj.item.id)
          ? cptBandFullWidth(proj.item.cpt_type, cptChannels, bandHalfWidth)
          : 0
        const visualWidth = BARE_COLUMN_WIDTH_PX + trackW
        return {
          kind: 'cpt' as const,
          proj: proj as ProjectedInvestigation<CptListItem | BoreholeListItem>,
          trueX: xToScreen(proj.along),
          visualWidth,
        }
      }),
      ...projectedBoreholes.map(proj => {
        const stripsW = boreholeDetails?.has(proj.item.id)
          ? enabledBhChannels * 2 * bandHalfWidth
          : 0
        const visualWidth = BARE_COLUMN_WIDTH_PX + stripsW
        return {
          kind: 'borehole' as const,
          proj: proj as ProjectedInvestigation<CptListItem | BoreholeListItem>,
          trueX: xToScreen(proj.along),
          visualWidth,
        }
      }),
    ]
    // Stable sort by trueX for the packed layout. The original order
    // re-emerges naturally because each item carries its identity
    // (kind + item.id); rendering uses the result keyed by id.
    const sorted = [...rawItems].sort((a, b) => a.trueX - b.trueX)
    // Edge-to-edge packed positions starting from the leftmost trueX.
    // Each consecutive column's centre lands half-its-width past the
    // previous column's right edge.
    const packedXBySortedIndex: number[] = []
    let cursor = sorted.length > 0 ? sorted[0].trueX : 0
    for (let i = 0; i < sorted.length; i += 1) {
      const halfW = sorted[i].visualWidth / 2
      if (i === 0) {
        packedXBySortedIndex.push(cursor)
        cursor = cursor + halfW
      } else {
        cursor += halfW
        packedXBySortedIndex.push(cursor)
        cursor += halfW
      }
    }
    // Re-attach the packed X to each item by identity; rawItems is in
    // CPT-then-borehole order so we look up each one's place in
    // ``sorted`` via reference identity.
    const items: PlacedColumnInput[] = rawItems.map(item => {
      const sortedIdx = sorted.indexOf(item)
      const packedX = packedXBySortedIndex[sortedIdx]
      const lerpedX = packedX + (item.trueX - packedX) * columnSpacing
      return {
        kind: item.kind,
        proj: item.proj,
        trueX: lerpedX,
        width: item.visualWidth,
      }
    })
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
    columnSpacing,
    enabledBhChannels,
  ])

  // Click-to-place pick context. When non-null the FormationPicker
  // modal is open; ``anchor`` carries the CPT/borehole + depth +
  // elevation so the picker can show a confirmation subtitle. The
  // modal closes by clearing this state (cancel) or by calling
  // ``onCreateContact`` then clearing (commit).
  const [pickContext, setPickContext] = useState<{
    kind: 'cpt' | 'borehole'
    anchorId: string
    anchorName: string
    depth_m: number
    elevationM: number
    snapped: boolean
  } | null>(null)

  const handlePickCpt = useCallback(
    (anchor: {
      kind: 'cpt'
      cptId: string
      cptName: string
      depth_m: number
      elevationM: number
      snapped: false
    }) => {
      setPickContext({
        kind: 'cpt',
        anchorId: anchor.cptId,
        anchorName: anchor.cptName,
        depth_m: anchor.depth_m,
        elevationM: anchor.elevationM,
        snapped: anchor.snapped,
      })
    },
    [],
  )
  const handlePickBorehole = useCallback(
    (anchor: {
      kind: 'borehole'
      boreholeId: string
      boreholeName: string
      depth_m: number
      elevationM: number
      snapped: boolean
    }) => {
      setPickContext({
        kind: 'borehole',
        anchorId: anchor.boreholeId,
        anchorName: anchor.boreholeName,
        depth_m: anchor.depth_m,
        elevationM: anchor.elevationM,
        snapped: anchor.snapped,
      })
    },
    [],
  )
  const handlePickerSelect = useCallback(
    async (formationId: string): Promise<void> => {
      if (!pickContext || !onCreateContact) return
      await onCreateContact(
        pickContext.kind,
        pickContext.anchorId,
        pickContext.depth_m,
        formationId,
        pickContext.snapped,
      )
      setPickContext(null)
    },
    [pickContext, onCreateContact],
  )

  // Focus mode — when set, the section renders only the named test's
  // column (no DEM, no neighbours). Used for single-test boundary
  // editing without leaving the section view's existing pick / snap /
  // picker plumbing. Transient: not persisted to view_state because
  // it's a momentary edit state, not a saved preference.
  const [focusedColumn, setFocusedColumn] = useState<{
    kind: 'cpt' | 'borehole'
    id: string
    name: string
  } | null>(null)

  // Context-menu state. Anchored to a container-local coordinate so
  // the menu renders inside SectionPanel's relative wrapper.
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    kind: 'cpt' | 'borehole'
    id: string
    name: string
  } | null>(null)

  const handleColumnContextMenu = useCallback(
    (
      e: React.MouseEvent,
      col: { kind: 'cpt' | 'borehole'; id: string; name: string },
    ) => {
      e.preventDefault()
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      setContextMenu({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        kind: col.kind,
        id: col.id,
        name: col.name,
      })
    },
    [],
  )

  // Focus enter/exit are event-driven rather than effect-driven.
  // The previous useEffect on ``[focusedColumn]`` had to stale-read
  // viewport + vex + placedColumns from closure (eslint-disabled) —
  // exactly the pattern that bites in subtle ways. With the logic
  // in plain useCallbacks we capture the current values through
  // the React closure naturally; no eslint suppression needed
  // (debt #21).
  //
  // The pre-focus snapshot only fires when entering from un-focused
  // state — re-focusing column B while still in column A's focus
  // keeps column A's original pre-focus framing as the restore
  // target. Otherwise sub-focuses would lose the original viewport.
  const preFocusViewportRef = useRef<Viewport | null>(null)
  const preFocusVexRef = useRef<number | null>(null)

  const enterFocus = useCallback(
    (target: { kind: 'cpt' | 'borehole'; id: string; name: string }) => {
      const col = placedColumns.find(
        c => c.kind === target.kind && c.proj.item.id === target.id,
      )
      if (!col) return
      // Only snapshot when not already in focus mode — protects
      // against sub-focus chains overwriting the original framing.
      if (preFocusViewportRef.current === null) {
        preFocusViewportRef.current = viewport
        preFocusVexRef.current = vex
      }
      const item = col.proj.item as CptListItem | BoreholeListItem
      const elevation = item.elevation_m
      const depth =
        col.kind === 'cpt'
          ? (item as CptListItem).max_depth_m
          : (item as BoreholeListItem).total_depth_m
      // Horizontal window — 40 m centred on the column's projected
      // along-distance. Wide enough to give the column band
      // breathing room, narrow enough that the test reads as the
      // obvious subject.
      const xHalf = 20
      let newLevelMin = viewport.levelMin
      let newLevelMax = viewport.levelMax
      if (elevation !== null) {
        const dEff = depth ?? 30
        // 2 m headroom above the surface + 2 m below the bottom so
        // the column caps don't sit flush against the plot edge.
        newLevelMax = elevation + 2
        newLevelMin = elevation - dEff - 2
      }
      setViewport({
        xMin: col.proj.along - xHalf,
        xMax: col.proj.along + xHalf,
        levelMin: newLevelMin,
        levelMax: newLevelMax,
      })
      setVex(1.0)
      setFocusedColumn(target)
    },
    [placedColumns, viewport, vex],
  )

  const exitFocus = useCallback(() => {
    if (preFocusViewportRef.current !== null) {
      setViewport(preFocusViewportRef.current)
      preFocusViewportRef.current = null
    }
    if (preFocusVexRef.current !== null) {
      setVex(preFocusVexRef.current)
      preFocusVexRef.current = null
    }
    setFocusedColumn(null)
  }, [])

  // Esc exits focus + dismisses any open context menu. Skip when the
  // user is typing into an input so we don't steal text-editing Esc.
  useEffect(() => {
    function handleKey(e: KeyboardEvent): void {
      if (e.key !== 'Escape') return
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }
      if (contextMenu !== null) setContextMenu(null)
      else if (focusedColumn !== null) exitFocus()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [contextMenu, focusedColumn, exitFocus])

  // Filter the layout pass to just the focused column when active.
  // Downstream warpAnchors, showLabelsByCptId, hideStickIds all read
  // through this so the focused view renders one column, centred on
  // its existing nudgedX (the user can pan to recentre).
  const visibleColumns = useMemo(() => {
    if (focusedColumn === null) return placedColumns
    return placedColumns.filter(
      c => c.kind === focusedColumn.kind && c.proj.item.id === focusedColumn.id,
    )
  }, [placedColumns, focusedColumn])


  // Per-borehole snap candidates for the contact-drag interaction.
  // Empty when snap is off — ContactsLayer treats absent entries as
  // "free drag" so CPTs (which have no stratigraphy to snap to) also
  // fall through correctly. Same set of depths the click-to-place
  // snap consumer in BoreholeColumn uses (formal + informal
  // stratigraphy layer tops + bases).
  // Lookup callback for ContactsLayer's drag readout — interpolates
  // qc + Rf at the dragged depth from the CPT's plot series.
  // Returns null when the CPT id isn't currently loaded (still
  // streaming, off-section, etc.) so the readout falls back to
  // depth + mTAW only.
  const getCptValuesAtDepth = useCallback(
    (cptId: string, depthM: number) => {
      const plot = cptPlots?.get(cptId)
      if (!plot) return null
      return {
        qc: lookupCptValueAtDepth(plot.depths_m, plot.qc_mpa, depthM),
        rf: lookupCptValueAtDepth(plot.depths_m, plot.rf_pct ?? [], depthM),
      }
    },
    [cptPlots],
  )

  const snapDepthsByAnchorId = useMemo(() => {
    const out = new Map<string, readonly number[]>()
    if (!snapToStratigraphy || boreholeDetails === null) return out
    for (const [id, detail] of boreholeDetails) {
      const depths = collectSnapDepths(detail)
      if (depths.length > 0) out.set(id, depths)
    }
    return out
  }, [snapToStratigraphy, boreholeDetails])

  // SVG-level right-click handler. Acts as the wide-area fallback so
  // the user can right-click anywhere within a column's VISUAL width
  // (including the CPT data band + borehole lithology strips) to open
  // the context menu — not just the narrow 14 px column-axis hit-box
  // the ColumnGlyph rect covers. Hit-detection runs against the
  // currently-visible placed columns; outside any column the
  // browser's default menu is still suppressed (preventDefault always)
  // and any open menu is dismissed.
  const handleSvgContextMenu = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      e.preventDefault()
      const containerRect = containerRef.current?.getBoundingClientRect()
      const svgRect = e.currentTarget.getBoundingClientRect()
      if (!containerRect) return
      const svgLocalX = e.clientX - svgRect.left
      let hit: { kind: 'cpt' | 'borehole'; id: string; name: string } | null = null
      let bestDist = Number.POSITIVE_INFINITY
      for (const col of visibleColumns) {
        const halfW = col.width / 2
        const dist = Math.abs(svgLocalX - col.nudgedX)
        if (dist <= halfW && dist < bestDist) {
          bestDist = dist
          hit = {
            kind: col.kind,
            id: col.proj.item.id,
            name: col.proj.item.name,
          }
        }
      }
      if (hit) {
        setContextMenu({
          x: e.clientX - containerRect.left,
          y: e.clientY - containerRect.top,
          kind: hit.kind,
          id: hit.id,
          name: hit.name,
        })
      } else {
        setContextMenu(null)
      }
    },
    [visibleColumns],
  )

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
    const cptCols = visibleColumns.filter(c => c.kind === 'cpt')
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
  }, [visibleColumns])

  // Warped along-distance → screen X. The Spacing slider's lerp
  // moves each test from its true projected X toward its packed
  // position; without warping any other X-positioned content, the
  // DEM ground-surface line draws at the TRUE along-distance and
  // visually detaches from the tests at low spacing. Build a
  // piecewise-linear map anchored by each placed column's
  // ``(along, nudgedX)`` pair so the DEM "bends" along with the
  // tests. Outside the test range we fall back to true scaling so
  // the line extends naturally past the leftmost / rightmost test.
  //
  // At spacing=1, ``nudgedX`` ≈ ``xToScreen(along)`` (modulo
  // collision nudges) so the warp is essentially identity. At
  // spacing=0, each test sits at its packed X and the function
  // interpolates the DEM through those.
  const warpAnchors = useMemo(() => {
    return [...visibleColumns]
      .map(col => ({ along: col.proj.along, effX: col.nudgedX }))
      .sort((a, b) => a.along - b.along)
  }, [visibleColumns])

  const warpedXToScreen = useCallback(
    (along: number): number => {
      if (warpAnchors.length === 0) return xToScreen(along)
      // Before the first anchor — extrapolate at true scale so the
      // DEM extends to the left edge with its natural slope.
      if (along <= warpAnchors[0].along) {
        return warpAnchors[0].effX - (warpAnchors[0].along - along) * scaleH
      }
      // After the last anchor — same on the right.
      const last = warpAnchors[warpAnchors.length - 1]
      if (along >= last.along) {
        return last.effX + (along - last.along) * scaleH
      }
      // Inside — find the segment and linearly interpolate.
      let i = 0
      while (i < warpAnchors.length - 1 && warpAnchors[i + 1].along < along) i += 1
      const a = warpAnchors[i]
      const b = warpAnchors[i + 1]
      // Defensive against duplicate-along anchors (two tests
      // projected to the same along-distance) — fall back to ``a``'s
      // effX rather than dividing by zero.
      if (b.along === a.along) return a.effX
      const frac = (along - a.along) / (b.along - a.along)
      return a.effX + frac * (b.effX - a.effX)
    },
    [warpAnchors, xToScreen, scaleH],
  )

  // IDs of investigations that already have a data band rendered —
  // CPTs with loaded plot data + boreholes with loaded detail — and
  // a known elevation. For these the ColumnGlyph cap + body line is
  // redundant ("you can see where the test sits, that's the band"),
  // so we suppress the stick visual but keep the name + elevation
  // labels above the band as the identifier.
  const hideStickIds = useMemo(() => {
    const s = new Set<string>()
    if (cptPlots !== null) {
      for (const col of visibleColumns) {
        if (col.kind !== 'cpt') continue
        const item = col.proj.item as CptListItem
        if (cptPlots.has(item.id) && item.elevation_m !== null) s.add(item.id)
      }
    }
    if (boreholeDetails !== null && enabledBhChannels > 0) {
      // Borehole stick only gets hidden when at least one
      // interpretation strip is actually showing. With zero channels
      // enabled BoreholeColumn renders nothing and the stick stays
      // as the column's only visual.
      for (const col of visibleColumns) {
        if (col.kind !== 'borehole') continue
        const item = col.proj.item as BoreholeListItem
        if (boreholeDetails.has(item.id) && item.elevation_m !== null) s.add(item.id)
      }
    }
    return s
  }, [visibleColumns, cptPlots, boreholeDetails, enabledBhChannels])

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
        boreholeChannels={boreholeChannels}
        onBoreholeChannelsChange={handleBoreholeChannelsChange}
        snapToStratigraphy={snapToStratigraphy}
        onSnapToStratigraphyChange={handleSnapToStratigraphyChange}
        columnSpacing={columnSpacing}
        onColumnSpacingChange={setColumnSpacing}
        onColumnSpacingCommit={onPatch ? handleSpacingCommit : undefined}
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
            onContextMenu={handleSvgContextMenu}
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

            {/* Vertical gridlines + x-axis ticks (along-distance).
                Position uses ``warpedXToScreen`` so the gridlines
                and axis labels track the test packing at low
                spacing — same warp the DEM polyline uses. The label
                values themselves stay at the true along-distance
                they represent (the "200 m" tick is still 200 m
                along the section, just rendered at a compressed
                screen X). */}
            {xTicks.map(v => {
              const sx = warpedXToScreen(v)
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
                samples (gaps outside DHMVII coverage). Suppressed
                in focus mode so the single visible column reads as
                a standalone test view. */}
            {demSamples !== null && focusedColumn === null && (
              <DemSurfaceLine
                samples={demSamples}
                // Use the warped x-mapping so the surface line
                // bends to follow the packed test positions at low
                // spacing. At spacing=1 the warp is identity and
                // the DEM draws at its true along-distance.
                xToScreen={warpedXToScreen}
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
              visibleColumns.map(col => {
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
              visibleColumns.map(col => {
                if (col.kind !== 'borehole') return null
                const item = col.proj.item as BoreholeListItem
                const detail = boreholeDetails.get(item.id)
                if (!detail || item.elevation_m === null) return null
                return (
                  <BoreholeColumn
                    key={`bh-strip-${item.id}`}
                    detail={detail}
                    channels={boreholeChannels}
                    screenX={col.nudgedX}
                    halfWidth={bandHalfWidth}
                    surfaceElevationM={item.elevation_m}
                    plotTop={MARGIN.top}
                    plotBottom={MARGIN.top + plotHeight}
                    levelToScreen={levelToScreen}
                    onCommitDepth={onCreateContact ? handlePickBorehole : undefined}
                    snapToStratigraphy={snapToStratigraphy}
                    showHoverReadout={focusedColumn !== null}
                  />
                )
              })}

            {/* CPT contact-pick affordance. Renders an invisible
                hover-capture overlay over each CPT's data band; on
                mouse-move shows a ghost depth line + readout
                (qc / Rf / depth / mTAW), on click commits the depth
                via ``handlePickCpt`` which opens the formation
                picker. Skipped when no contact-create callback is
                wired (read-only test view). */}
            {cptPlots !== null && (onCreateContact || focusedColumn !== null) &&
              visibleColumns.map(col => {
                if (col.kind !== 'cpt') return null
                const item = col.proj.item as CptListItem
                const plot = cptPlots.get(item.id)
                if (!plot || item.elevation_m === null) return null
                // Re-derive the cap-clamped data extent the
                // CptDataColumn uses so the pick area matches the
                // band the user sees.
                const surfaceY = levelToScreen(item.elevation_m)
                const bottomDepth =
                  plot.depths_m.length > 0
                    ? plot.depths_m[plot.depths_m.length - 1]
                    : 0
                const dataBottomY = levelToScreen(item.elevation_m - bottomDepth)
                const bgTopY = Math.max(
                  MARGIN.top,
                  Math.min(MARGIN.top + plotHeight, surfaceY),
                )
                const bgBottomY = Math.max(
                  MARGIN.top,
                  Math.min(MARGIN.top + plotHeight, dataBottomY),
                )
                return (
                  <ContactPickBar
                    key={`cpt-pick-${item.id}`}
                    plot={plot}
                    cptType={item.cpt_type}
                    cptName={item.name}
                    cptId={item.id}
                    screenX={col.nudgedX}
                    halfWidth={bandHalfWidth}
                    surfaceElevationM={item.elevation_m}
                    plotTop={MARGIN.top}
                    plotBottom={MARGIN.top + plotHeight}
                    bgTopY={bgTopY}
                    bgBottomY={bgBottomY}
                    levelToScreen={levelToScreen}
                    onCommitDepth={onCreateContact ? handlePickCpt : undefined}
                  />
                )
              })}

            {/* Investigation columns. Both kinds rendered from a
                single nudged list — the layout pass spaces crowded
                projections rightward while drawing tie-back
                diagonals so each column's true projected position
                stays inspectable. */}
            <InvestigationColumns
              columns={visibleColumns}
              levelToScreen={levelToScreen}
              plotTop={MARGIN.top}
              plotBottom={MARGIN.top + plotHeight}
              // Click-to-open on section glyphs disabled per
              // user request — accidental clicks during pan / zoom
              // were yanking the user into the detail panel. The
              // onSelectCpt / onSelectBorehole props are still in
              // the component signature for future re-enablement
              // (likely behind a confirm prompt).
              onSelectCpt={undefined}
              onSelectBorehole={undefined}
              onColumnContextMenu={handleColumnContextMenu}
              hideStickIds={hideStickIds}
            />

            {/* Geological-model formation contacts. Each formation
                with ≥1 contact in this section renders as a
                coloured polyline through its anchor columns; the
                formation's name label sits to the right of the
                rightmost vertex. Empty when the project has no
                contacts yet (the Phase 4 editor's blank canvas). */}
            <ContactsLayer
              contacts={contacts}
              formations={formations}
              placedColumns={visibleColumns}
              excludedBoreholeIds={
                excludedBoreholeIds === undefined
                  ? undefined
                  : new Set(excludedBoreholeIds)
              }
              levelToScreen={levelToScreen}
              plotTop={MARGIN.top}
              plotBottom={MARGIN.top + plotHeight}
              onUpdateContactDepth={onUpdateContactDepth}
              snapDepthsByAnchorId={snapDepthsByAnchorId}
              getCptValuesAtDepth={getCptValuesAtDepth}
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
        {contextMenu !== null && (
          <ColumnContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            name={contextMenu.name}
            onFocus={() =>
              enterFocus({
                kind: contextMenu.kind,
                id: contextMenu.id,
                name: contextMenu.name,
              })
            }
            onClose={() => setContextMenu(null)}
          />
        )}
        {focusedColumn !== null && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 bg-purple-600 text-white text-xs px-3 py-1.5 rounded-full shadow">
            <span>Focus: {focusedColumn.name}</span>
            <button
              type="button"
              className="hover:text-purple-200"
              onClick={exitFocus}
              title="Exit focus mode (Esc)"
              aria-label="Exit focus mode"
            >
              ✕
            </button>
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

      {/* Formation picker — modal opens whenever a child fires
          ``onCommitDepth`` (CPT click or borehole click). The
          picker either selects an existing formation (POSTs the
          contact via ``handlePickerSelect``) or kicks the user to
          the inline-create dialog. */}
      <FormationPickerDialog
        open={pickContext !== null}
        formations={formations}
        anchor={
          pickContext === null
            ? null
            : {
                kind: pickContext.kind,
                name: pickContext.anchorName,
                depth_m: pickContext.depth_m,
                elevationM: pickContext.elevationM,
              }
        }
        onSelect={handlePickerSelect}
        onCreateFormation={async payload => {
          if (!onCreateFormation) return null
          return onCreateFormation(payload)
        }}
        onCancel={() => setPickContext(null)}
      />
    </div>
  )
}

function CanvasHints(): JSX.Element {
  return (
    <div className="absolute bottom-2 left-2 z-10 text-[10px] text-gray-400 bg-white/80 px-1.5 py-0.5 rounded pointer-events-none">
      Drag to pan · scroll to zoom · double-click to reset · right-click a column to focus
    </div>
  )
}
