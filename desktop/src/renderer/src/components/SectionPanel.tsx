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
  FormationContactBatchUpdateEntry,
  FormationContactResponse,
  FormationSurfaceResponse,
  GeologicalFormationCreatePayload,
  GeologicalFormationResponse,
  VirtueleBoringInvestigationPrediction,
} from '../api/client'
import { verticalDatumShort } from '../utils/verticalDatum'
import { nudgeColumns } from '../utils/columnLayout'
import type { ProjectedInvestigation } from '../utils/sectionProjection'
import { SoilPatterns } from '../utils/soilPatterns'
import FormationPickerDialog from './interpretation/FormationPickerDialog'
import BoreholeColumn from './sections/BoreholeColumn'
import ColumnContextMenu from './sections/ColumnContextMenu'
import ContactPickBar from './sections/ContactPickBar'
import ContactsLayer, {
  type ContactCopyPayload,
  type MarqueeState,
} from './sections/ContactsLayer'
import { lookupCptValueAtDepth } from './sections/cptInterpolation'
import { useColumnContextMenu } from './sections/useColumnContextMenu'
import { useContactPicker } from './sections/useContactPicker'
import { useFocusColumn } from './sections/useFocusColumn'
import CptDataColumn from './sections/CptDataColumn'
import {
  cptBandFullWidth,
  cptBandHalfWidth,
  enabledBoreholeChannelCount,
} from './sections/cptChannels'
import DemSurfaceLine from './sections/DemSurfaceLine'
import InvestigationColumns from './sections/InvestigationColumns'
import VirtueleBoringGhostColumns, {
  virtueleBoringGhostRailWidth,
} from './sections/VirtueleBoringGhostColumns'
import VirtueleBoringStrip from './sections/VirtueleBoringStrip'
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
import {
  selectVisibleLabels,
  type ColumnLabelMode,
} from '../utils/columnLabelLod'

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
    excluded_cpt_ids?: string[]
    excluded_borehole_ids?: string[]
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
  /** Cached TIN surfaces for the active geological model, keyed by
   * formation id. Forwarded straight to ContactsLayer; when present
   * the surface line renders as a slice-of-TIN against the section
   * line so off-line picks contribute properly. Absent → connect-the-
   * dots fallback in ContactsLayer (still works for sparse data). */
  surfacesByFormationId?: ReadonlyMap<string, FormationSurfaceResponse>
  /** Contact ids the user has asked to be visually highlighted —
   * driven by the crossings banner click (debt #9). Forwarded to
   * ContactsLayer which renders the ring + pulse. Transient: App
   * clears the array on a short timer after dispatch. */
  focusedContactIds?: readonly string[]
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
  /** Right-click → confirm → delete a contact. Forwarded straight
   * through to ContactsLayer; the picker / drag flows don't touch
   * it. Caller deletes the row and prunes the local contacts
   * state so the overlay updates without a refetch. */
  onDeleteContact?: (contactId: string) => Promise<void>
  /** All-or-nothing batch update — fired by the section editor's
   * multi-drag (same-column depth shift) and cross-column re-anchor
   * (Alt+drag MOVE) flows. Forwarded straight to ContactsLayer;
   * the caller posts the batch and refreshes the local contacts
   * state in one pass. */
  onBatchUpdateContacts?: (
    updates: readonly FormationContactBatchUpdateEntry[],
  ) => Promise<void>
  /** Batch CREATE — fired by cross-column drag WITHOUT Alt (the
   * COPY default). Each entry becomes a new contact at the target
   * anchor with the dragged depth; originals stay where they were.
   * Forwarded to ContactsLayer. */
  onBatchCreateContacts?: (
    creates: readonly ContactCopyPayload[],
  ) => Promise<void>
  /** Inline-create a formation from the picker modal's "New
   * formation here" affordance. Returns the new row's id so the
   * picker can chain to a contact commit. */
  onCreateFormation?: (
    payload: GeologicalFormationCreatePayload,
  ) => Promise<{ id: string } | null>
  /** Fire the "Export DXF" header action. The handler owns the
   * fetch + Electron save-dialog + file-write flow so the panel
   * stays storage-agnostic. Omitting it (or there being no active
   * geological model) hides the button. */
  onExportDxf?: () => Promise<void>
  /** Fire the "Seed from stratigraphy" header action. Receives the
   * borehole IDs projected onto the active section (computed here
   * from placedColumns); the handler scopes the auto-populate call
   * to that list. Omitting it (or no active model) hides the button. */
  onAutoPopulateFromStratigraphy?: (
    boreholeIds: readonly string[],
  ) => Promise<void>
  /** DOV Virtuele Boring overlay — informative-only ghost columns
   * rendered next to each investigation. Empty array / undefined
   * prop = no overlay. Up to two model codes are honoured (the UI
   * provides two dropdowns); extras are silently truncated. */
  virtueleBoringActiveModels?: readonly string[]
  /** Per-investigation overlay payload — built by App.tsx from
   * ``api.virtueleBoring.predictions`` and cached there across
   * renders so toggling the section view doesn't refetch. */
  virtueleBoringPredictions?: readonly VirtueleBoringInvestigationPrediction[]
  /** Picker state, owned by App.tsx (round-trips via project
   * view_state). The overlay strip mounts at the top of the section
   * pane and writes through these props. */
  virtueleBoringModelA?: string | null
  virtueleBoringModelB?: string | null
  virtueleBoringMaxDepthM?: number | null
  /** Per-pane visibility flag (localStorage-backed in App). When
   * false, the ghost columns hide but the picker stays expanded so
   * the user can flip it back on without losing state. */
  virtueleBoringShowOnSection?: boolean
  onChangeVirtueleBoringPicker?: (next: {
    modelA: string | null
    modelB: string | null
    maxDepthM: number | null
  }) => void
  onChangeVirtueleBoringShowOnSection?: (next: boolean) => void
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
  surfacesByFormationId,
  focusedContactIds,
  onCreateContact,
  onUpdateContactDepth,
  onDeleteContact,
  onBatchUpdateContacts,
  onBatchCreateContacts,
  onAutoPopulateFromStratigraphy,
  onCreateFormation,
  onExportDxf,
  onSelectCpt,
  onSelectBorehole,
  virtueleBoringActiveModels,
  virtueleBoringPredictions,
  virtueleBoringModelA = null,
  virtueleBoringModelB = null,
  virtueleBoringMaxDepthM = null,
  virtueleBoringShowOnSection = true,
  onChangeVirtueleBoringPicker,
  onChangeVirtueleBoringShowOnSection,
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

  // Marquee (box-select) state lives here so the SVG root's
  // mousedown handler can decide between marquee (Shift held) and
  // pan (plain). ContactsLayer handles the mousemove/mouseup, hit-
  // test against its layer index, and the selection update;
  // SectionPanel just owns "is there an active marquee, and what
  // are its start coords."
  const [marquee, setMarquee] = useState<MarqueeState | null>(null)
  // Selection reset counter — bumped on a plain (no-Shift) bg
  // click that didn't move the mouse. ContactsLayer watches the
  // counter and clears its selection on each tick. Click-to-clear.
  const [selectionResetCounter, setSelectionResetCounter] = useState(0)

  // Hovered column id — tracked so the LOD pass can force the hovered
  // column's label to 'full' regardless of spacing. Transient UI state;
  // not persisted (it resets naturally when the user moves the mouse).
  const [hoveredColumnId, setHoveredColumnId] = useState<string | null>(null)

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
  // True while a CAD-style both-buttons-held pan is active, so the
  // trailing right-button contextmenu is suppressed (see the SVG
  // onContextMenu wrapper). Reset on the next single-button mousedown.
  const bothBtnPanRef = useRef(false)

  function handleMouseDown(e: React.MouseEvent<SVGSVGElement>): void {
    // CAD/Plaxis-style pan: holding BOTH mouse buttons pans regardless
    // of which button fired this event. Left-drag pan + shift-marquee
    // (below) are unchanged. e.buttons is a bitmask: 1=left, 2=right.
    if ((e.buttons & 1) === 1 && (e.buttons & 2) === 2) {
      e.preventDefault()
      bothBtnPanRef.current = true
      const r = e.currentTarget.getBoundingClientRect()
      panStart.current = {
        px: e.clientX - r.left,
        py: e.clientY - r.top,
        viewport,
      }
      setIsPanning(true)
      return
    }
    bothBtnPanRef.current = false
    // Only the left button starts a pan — right-click is reserved
    // for a future context menu, middle-click stays for browser
    // autoscroll.
    if (e.button !== 0) return
    // Shift held → start a marquee instead of a pan. Owning the
    // dispatch on the SVG ROOT (vs the bg rect) means Shift+click
    // ANYWHERE on the section — including on a column glyph — opens
    // the marquee, satisfying the "shift+click on column = multi-
    // select" requirement.
    if (e.shiftKey && onBatchUpdateContacts) {
      const svgEl = e.currentTarget
      const rect = svgEl.getBoundingClientRect()
      setMarquee({
        startClientX: e.clientX,
        startClientY: e.clientY,
        currentClientX: e.clientX,
        currentClientY: e.clientY,
        svgLeft: rect.left,
        svgTop: rect.top,
        // Always additive — the user's selection grows.
        additive: true,
      })
      // Don't start pan in parallel.
      return
    }
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

  function handleMouseUp(e: React.MouseEvent<SVGSVGElement>): void {
    const start = panStart.current
    panStart.current = null
    setIsPanning(false)
    // Click-without-drag on the section background → clear the
    // contact selection. Threshold mirrors the marquee's click-vs-
    // drag dead-zone so a tiny mouse jitter doesn't cancel the
    // clear. Skip when Shift is held (additive selection semantics)
    // or when the click landed on an element that handles its own
    // mousedown (hit-strips stopPropagation, columns route via
    // onClick — neither triggers this clear path).
    if (start === null) return
    if (e.shiftKey) return
    const rect = e.currentTarget.getBoundingClientRect()
    const dx = Math.abs(e.clientX - rect.left - start.px)
    const dy = Math.abs(e.clientY - rect.top - start.py)
    if (dx < 3 && dy < 3) {
      setSelectionResetCounter(c => c + 1)
    }
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

  // Boreholes the active model excludes are filtered out of the
  // section view entirely (column doesn't render, picker can't fire,
  // contacts don't appear). The "Boreholes in model" checkbox in the
  // InterpretationPane controls inclusion; unchecking removes the
  // borehole from every section editor view of this model. Cleaner
  // mental model than "column shown but contacts hidden" (which was
  // a real source of "I clicked but nothing happened" confusion in
  // dogfooding).
  const includedBoreholes = useMemo(() => {
    if (!excludedBoreholeIds || excludedBoreholeIds.length === 0) {
      return boreholes
    }
    const excluded = new Set(excludedBoreholeIds)
    return boreholes.filter(b => !excluded.has(b.id))
  }, [boreholes, excludedBoreholeIds])

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
  } = useSectionData(section, cpts, includedBoreholes)

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

  // Ghost-rail footprint per column when the Virtuele Boring
  // overlay is showing on this pane. Each column carries this extra
  // width into the nudge pass so neighbouring columns don't sit on
  // top of the ghosts to their right. Reads as 0 when the overlay
  // is off — keeps the no-overlay layout pixel-identical to before.
  const virtueleBoringActiveModelsForLayout = useMemo<readonly string[]>(
    () => (virtueleBoringActiveModels ?? []).slice(0, 2),
    [virtueleBoringActiveModels],
  )
  const ghostFootprintForLayout =
    virtueleBoringShowOnSection &&
    virtueleBoringActiveModelsForLayout.length > 0
      ? virtueleBoringGhostRailWidth(virtueleBoringActiveModelsForLayout.length)
      : 0

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
    // Type the array as the discriminated union directly so TS
    // doesn't widen the per-branch ``proj`` to a single union and
    // force the cast back at the consumer (debt #28).
    type RawCpt = {
      kind: 'cpt'
      proj: ProjectedInvestigation<CptListItem>
      trueX: number
      visualWidth: number
    }
    type RawBh = {
      kind: 'borehole'
      proj: ProjectedInvestigation<BoreholeListItem>
      trueX: number
      visualWidth: number
    }
    // The ghost rail extends to the right of each column's data
    // band. Adding the same footprint to every column's visualWidth
    // means the nudge pass guarantees: column[i+1].left_edge >=
    // column[i].band_right + ghostFootprint + edgeGap, which is the
    // condition for the ghosts NOT to overlap column[i+1]'s band.
    // The extra is symmetric (both sides) for nudge math symmetry —
    // a small over-spacing on the leftmost column is acceptable.
    const rawItems: (RawCpt | RawBh)[] = [
      ...projectedCpts.map((proj): RawCpt => {
        const trackW = cptPlots?.has(proj.item.id)
          ? cptBandFullWidth(proj.item.cpt_type, cptChannels, bandHalfWidth)
          : 0
        return {
          kind: 'cpt',
          proj,
          trueX: xToScreen(proj.along),
          visualWidth: BARE_COLUMN_WIDTH_PX + trackW + ghostFootprintForLayout,
        }
      }),
      ...projectedBoreholes.map((proj): RawBh => {
        const stripsW = boreholeDetails?.has(proj.item.id)
          ? enabledBhChannels * 2 * bandHalfWidth
          : 0
        return {
          kind: 'borehole',
          proj,
          trueX: xToScreen(proj.along),
          visualWidth: BARE_COLUMN_WIDTH_PX + stripsW + ghostFootprintForLayout,
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
    ghostFootprintForLayout,
  ])

  // Virtuele Boring overlay — index the predictions by
  // investigation_id once per prop change so the SVG render walks a
  // single Map lookup per column. Truncate active models to two; the
  // UI only exposes two dropdown slots so anything beyond would
  // overflow the ghost-column rail (each slot owns its own ghost).
  const virtueleBoringActiveModelsClamped = useMemo<readonly string[]>(
    () => (virtueleBoringActiveModels ?? []).slice(0, 2),
    [virtueleBoringActiveModels],
  )
  const virtueleBoringPredictionsByInvestigationId = useMemo(() => {
    const map = new Map<string, VirtueleBoringInvestigationPrediction>()
    for (const pred of virtueleBoringPredictions ?? []) {
      map.set(pred.investigation_id, pred)
    }
    return map
  }, [virtueleBoringPredictions])

  // Pan the viewport so the focused contact's column lands near
  // the centre of the visible window. Fires when the App's
  // crossings-banner click flow sets focusedContactIds; without
  // this the contact's highlight ring would fire off-screen if the
  // user had zoomed in elsewhere. We only pan horizontally so
  // vertical zoom is preserved (the engineer's framing of "what
  // depths am I looking at" stays intact). Setting xMin/xMax keeps
  // the current width — we centre by translation only.
  //
  // The effect's body only runs on the transition empty → non-empty
  // so a repeated click on the same banner item (focusedContactIds
  // identity changes but content stays) doesn't re-pan; a banner
  // *click* always re-fires the parent's setFocusedContactIds with
  // a fresh array, so the dep on the identity is enough.
  const focusedContactsLastRef = useRef<readonly string[] | null>(null)
  useEffect(() => {
    if (!focusedContactIds || focusedContactIds.length === 0) {
      focusedContactsLastRef.current = null
      return
    }
    if (focusedContactsLastRef.current === focusedContactIds) return
    focusedContactsLastRef.current = focusedContactIds
    // Resolve each focused contact's anchor id, then find the
    // matching placed column to read its projected along-distance.
    const focusedSet = new Set(focusedContactIds)
    const targetAlongs: number[] = []
    for (const contact of contacts) {
      if (!focusedSet.has(contact.id)) continue
      const anchorId = contact.borehole_id ?? contact.cpt_id ?? null
      if (!anchorId) continue
      const col = placedColumns.find(c => c.proj.item.id === anchorId)
      if (col) targetAlongs.push(col.proj.along)
    }
    if (targetAlongs.length === 0) return
    const targetAlong =
      targetAlongs.reduce((a, b) => a + b, 0) / targetAlongs.length
    setViewport(prev => {
      const halfWidth = (prev.xMax - prev.xMin) / 2
      return {
        ...prev,
        xMin: targetAlong - halfWidth,
        xMax: targetAlong + halfWidth,
      }
    })
  }, [focusedContactIds, contacts, placedColumns])

  // Click-to-place pick state + handlers. The hook owns the modal's
  // open / closed state and the create-on-select flow; the
  // ColumnGlyph + ContactPickBar + BoreholeColumn click handlers
  // call into its handlePickCpt / handlePickBorehole entries, and
  // the FormationPickerDialog's onSelect / onCancel hit
  // handlePickerSelect / cancel respectively. Debt #30.
  const {
    pickContext,
    handlePickCpt,
    handlePickBorehole,
    handlePickerSelect,
    cancel: cancelPicker,
  } = useContactPicker(onCreateContact)

  // Focus mode — when set, the section renders only the named test's
  // column (no DEM, no neighbours). Used for single-test boundary
  // editing without leaving the section view's existing pick / snap /
  // picker plumbing. Transient: not persisted to view_state because
  // it's a momentary edit state, not a saved preference. The hook
  // also owns the auto-zoom-on-entry / restore-on-exit snapshot.
  // Debt #30.
  const { focusedColumn, enterFocus, exitFocus } = useFocusColumn(
    placedColumns,
    viewport,
    vex,
    setViewport,
    setVex,
  )

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

  // Right-click context menu state + handlers — both the
  // ColumnGlyph hit-box handler and the SVG-level catch-all
  // fallback live in this hook (debt #30).
  const {
    contextMenu,
    handleColumnContextMenu,
    handleSvgContextMenu,
    dismiss: dismissContextMenu,
  } = useColumnContextMenu(visibleColumns, containerRef)

  // Remove-from-section handler — appends the column's id to the
  // section's excluded_{cpt,borehole}_ids list and PATCHes. The
  // backend's section projection already filters by these arrays,
  // so the column disappears on the next render. Reversible (the
  // test stays in the project + on the map); per UX rules no
  // confirmation dialog. Returns the next list shape locally to
  // avoid a refetch round-trip — App's PATCH handler replaces the
  // section state with the server's response anyway.
  const handleRemoveFromSection = useCallback(
    (kind: 'cpt' | 'borehole', id: string) => {
      if (!onPatch) return
      if (kind === 'cpt') {
        const next = Array.from(new Set([...section.excluded_cpt_ids, id]))
        void onPatch({ excluded_cpt_ids: next })
      } else {
        const next = Array.from(
          new Set([...section.excluded_borehole_ids, id]),
        )
        void onPatch({ excluded_borehole_ids: next })
      }
    },
    [onPatch, section.excluded_cpt_ids, section.excluded_borehole_ids],
  )

  // Esc exits focus + dismisses any open context menu. Skip when the
  // user is typing into an input so we don't steal text-editing Esc.
  // Lives after the useColumnContextMenu call because the dep array
  // references contextMenu + dismissContextMenu — TDZ would crash
  // first render if this useEffect sat above the hook.
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
      if (contextMenu !== null) dismissContextMenu()
      else if (focusedColumn !== null) exitFocus()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [contextMenu, focusedColumn, exitFocus, dismissContextMenu])

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

  // Column-label level-of-detail. At dense column spacings the three-line
  // header stack collides into an unreadable mess. ``selectVisibleLabels``
  // decides per column whether to render the full header, a rotated id, or
  // nothing. Selected (focusedColumn) and hovered columns always get full.
  // Recomputes when the layout changes (zoom / pan / spacing) or when
  // hover/focus changes.
  const { labelModeById, calloutIds } = useMemo(() => {
    const lodInputs = visibleColumns.map(col => ({
      id: col.proj.item.id,
      nudgedX: col.nudgedX,
      selected: focusedColumn !== null && col.proj.item.id === focusedColumn.id,
      hovered: col.proj.item.id === hoveredColumnId,
    }))
    const results = selectVisibleLabels(lodInputs)
    const modeMap = new Map<string, ColumnLabelMode>(results.map(r => [r.id, r.mode]))
    const callout = new Set<string>(results.filter(r => r.callout).map(r => r.id))
    return { labelModeById: modeMap, calloutIds: callout }
  }, [visibleColumns, focusedColumn, hoveredColumnId])

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
        const item = col.proj.item
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
        const item = col.proj.item
        if (boreholeDetails.has(item.id) && item.elevation_m !== null) s.add(item.id)
      }
    }
    return s
  }, [visibleColumns, cptPlots, boreholeDetails, enabledBhChannels])

  // ---- Render --------------------------------------------------------

  const datumShort = verticalDatumShort(zEpsg)
  const yAxisLabel = datumShort ? `Level (${datumShort})` : 'Level (m)'

  return (
    <div className="flex flex-col h-full w-full bg-surface-page">
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
        onExportDxf={onExportDxf}
        onAutoPopulateFromStratigraphy={
          // Scope the action to boreholes on the active section
          // only — CPTs are skipped (no stratigraphy observations
          // there) and projects with hundreds of boreholes get a
          // bounded request size. Hidden when no boreholes are on
          // the section, since the action would no-op.
          onAutoPopulateFromStratigraphy &&
          placedColumns.some(c => c.kind === 'borehole')
            ? () =>
                onAutoPopulateFromStratigraphy(
                  placedColumns
                    .filter(c => c.kind === 'borehole')
                    .map(c => c.proj.item.id),
                )
            : undefined
        }
      />

      {/* DOV Virtuele Boring overlay controls — picker dropdowns +
          depth + per-pane show toggle. Sits directly under the
          SectionHeader so the engineer can flip on the overlay
          without leaving the section view. */}
      {onChangeVirtueleBoringPicker && onChangeVirtueleBoringShowOnSection && (
        <VirtueleBoringStrip
          modelA={virtueleBoringModelA}
          modelB={virtueleBoringModelB}
          maxDepthM={virtueleBoringMaxDepthM}
          showOnSection={virtueleBoringShowOnSection}
          onChangePicker={onChangeVirtueleBoringPicker}
          onChangeShowOnSection={onChangeVirtueleBoringShowOnSection}
        />
      )}

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
            onContextMenu={e => {
              // Swallow the contextmenu that fires when the right
              // button is released at the end of a both-button pan.
              if (bothBtnPanRef.current) {
                e.preventDefault()
                bothBtnPanRef.current = false
                return
              }
              handleSvgContextMenu(e)
            }}
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

            {/* Plot-area background — surface one step above the page
                background so the grid + axes read cleanly over it.
                Uses CSS-var tokens (section-plot-*) defined in
                index.css :root/.dark because SVG attributes can't
                use Tailwind dark: variants. Marquee + pan dispatch
                lives on the SVG root (see handleMouseDown above) so
                this rect only needs to draw — its mousedown bubbles
                up to the SVG and gets routed there. */}
            <rect
              x={MARGIN.left}
              y={MARGIN.top}
              width={plotWidth}
              height={plotHeight}
              fill="var(--section-plot-bg)"
              stroke="var(--section-plot-border)"
              data-testid="section-marquee-bg"
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
                    stroke="var(--section-grid)"
                  />
                  <text
                    x={sx}
                    y={MARGIN.top + plotHeight + 14}
                    fontSize={10}
                    fill="var(--section-axis-tick)"
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
                    stroke="var(--section-grid)"
                  />
                  <text
                    x={MARGIN.left - 6}
                    y={sy + 3}
                    fontSize={10}
                    fill="var(--section-axis-tick)"
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
                const item = col.proj.item
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
                const item = col.proj.item
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
                const item = col.proj.item
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
              labelModeById={labelModeById}
              calloutIds={calloutIds}
              onColumnHover={setHoveredColumnId}
            />

            {/* DOV Virtuele Boring ghost columns — informative-only
                overlay showing what DOV's 3D model predicts at each
                investigation's (x, y). One labelled column per
                active model, faded so it reads as "DOV says…"
                rather than ground truth. Engineers use it to inform
                manual contact picks. Renders nothing when both
                dropdowns are off, no predictions have been fetched,
                or the user toggled visibility off on this pane. */}
            {virtueleBoringShowOnSection && (
              <VirtueleBoringGhostColumns
                columns={visibleColumns}
                activeModels={virtueleBoringActiveModelsClamped}
                predictionsByInvestigationId={virtueleBoringPredictionsByInvestigationId}
                levelToScreen={levelToScreen}
                plotTop={MARGIN.top}
                plotBottom={MARGIN.top + plotHeight}
                bandHalfWidth={bandHalfWidth}
                maxDepthMBelowSurface={virtueleBoringMaxDepthM}
              />
            )}

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
              onDeleteContact={onDeleteContact}
              onBatchUpdateContacts={onBatchUpdateContacts}
              onBatchCreateContacts={onBatchCreateContacts}
              marquee={marquee}
              onSetMarquee={setMarquee}
              selectionResetSignal={selectionResetCounter}
              snapDepthsByAnchorId={snapDepthsByAnchorId}
              getCptValuesAtDepth={getCptValuesAtDepth}
              surfacesByFormationId={surfacesByFormationId}
              focusedContactIds={
                focusedContactIds && focusedContactIds.length > 0
                  ? new Set(focusedContactIds)
                  : undefined
              }
              sectionLine={{
                startX: section.start_x,
                startY: section.start_y,
                endX: section.end_x,
                endY: section.end_y,
              }}
              alongMToScreenX={warpedXToScreen}
            />

            {/* Axis labels. */}
            <text
              x={MARGIN.left + plotWidth / 2}
              y={MARGIN.top + plotHeight + 28}
              fontSize={11}
              fill="var(--section-axis-title)"
              textAnchor="middle"
            >
              Distance along section (m)
            </text>
            <text
              x={14}
              y={MARGIN.top + plotHeight / 2}
              fontSize={11}
              fill="var(--section-axis-title)"
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
            onRemoveFromSection={
              onPatch
                ? () =>
                    handleRemoveFromSection(contextMenu.kind, contextMenu.id)
                : undefined
            }
            onClose={dismissContextMenu}
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

      {/* Hidden-from-section restore footer — mirrors the Sidebar's
          "N removed · restore all" pattern. Only renders when the
          section has at least one excluded id; clicking the link
          clears both arrays in a single PATCH so the columns
          reappear on the next render. Reversible action's undo
          surface. */}
      {onPatch &&
        (section.excluded_cpt_ids.length + section.excluded_borehole_ids.length) > 0 && (
          <div
            className="flex items-center justify-between px-3 py-1 text-[11px] text-gray-500 bg-gray-50 border-t border-gray-200"
            data-testid="section-hidden-footer"
          >
            <span>
              {section.excluded_cpt_ids.length + section.excluded_borehole_ids.length}{' '}
              hidden from this section
            </span>
            <button
              type="button"
              className="text-blue-600 hover:text-blue-800 hover:underline"
              onClick={() =>
                void onPatch({
                  excluded_cpt_ids: [],
                  excluded_borehole_ids: [],
                })
              }
              title="Restore every test hidden from this section. Their columns reappear on the next render."
            >
              restore all
            </button>
          </div>
        )}

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
        onCancel={cancelPicker}
      />
    </div>
  )
}

function CanvasHints(): JSX.Element {
  return (
    // SVG can't use Tailwind dark: variants; the hint pill's background and
    // text colour are driven by --section-hint-* CSS-var tokens (index.css
    // :root/.dark) so they match the dark plot-area chrome.
    <div
      className="absolute bottom-2 left-2 z-10 text-[10px] px-1.5 py-0.5 rounded pointer-events-none"
      style={{
        color: 'var(--section-hint-text)',
        background: 'var(--section-hint-bg)',
      }}
    >
      Drag to pan · scroll to zoom · double-click to reset · right-click a column to focus
    </div>
  )
}
