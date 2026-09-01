/**
 * Native-event gesture hooks for the cross-section canvas, extracted from
 * ``SectionPanel`` (debt #201 Move 4) so the orchestrator stays focused on
 * viewport state + render composition.
 *
 * Two concerns live here, each as its own hook so each call site sits at its
 * natural position in the component body (no reordering of the parent's
 * binding declarations was needed):
 *
 *   * ``useSectionWheelZoom`` — cursor-anchored wheel zoom. React's onWheel is
 *     passive-by-default, so the listener is attached natively with
 *     ``{ passive: false }`` to intercept the page scroll. The cursor anchor is
 *     SPACING-AWARE: it reads the post-nudge column positions
 *     (``warpAnchorsRef`` / ``columnSpacingRef`` / ``layoutStateRef``), not the
 *     raw projection-along, so what is under the cursor stays pinned at any
 *     ``column_spacing`` slider value. See
 *     ``memory/feedback_section_view_spacing_modifier`` — this anchor math has
 *     bitten three times when computed against raw ``proj.along`` or against an
 *     approximation of the packed layout. The solve itself is exact and lives
 *     in ``wheelZoomAnchor.ts``; this hook only supplies the layout snapshot.
 *   * ``useSectionKeyboardShortcuts`` — the section-wide Esc peel cascade
 *     (ghost menu → body menu → column menu → focus → close).
 */

import {
  useCallback,
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from 'react'

import type { BoreholeDetailResponse, CptPlotResponse } from '../../api/client'
import {
  cptBandFullWidth,
  cptBandHalfWidth,
  type CptChannels,
} from './cptChannels'
import type { WarpAnchor } from './sectionWarp'
import {
  COLUMN_EDGE_GAP_PX,
  MARGIN,
  WHEEL_ZOOM_FACTOR,
  type PlacedColumn,
  type Viewport,
} from './utils'
import {
  solveCursorAnchoredXMin,
  zoomLayoutColumn,
  type ZoomLayoutColumn,
} from './wheelZoomAnchor'

/**
 * Layout snapshot the wheel handler reads (via a ref, to avoid TDZ) so it can
 * re-run the REAL horizontal layout at the post-zoom scale. Mirrored into
 * ``layoutStateRef`` by SectionPanel from its layout useMemos.
 *
 * ``placedColumns`` carries the columns that are actually DRAWN — i.e. the
 * focus-filtered set, not the raw layout — so the simulated layout matches the
 * anchors on screen in column focus too.
 */
export interface SectionWheelLayoutState {
  placedColumns: PlacedColumn[]
  cptPlots: Map<string, CptPlotResponse> | null | undefined
  boreholeDetails: Map<string, BoreholeDetailResponse> | null | undefined
  cptChannels: CptChannels
  enabledBhChannels: number
  ghostFootprintForLayout: number
  lithoGhostAnchorIds: Set<string>
  /**
   * Edge gap for one adjacent pair, left to right — correlated pairs claim a
   * wider gap. Omitted ⇒ every pair uses the base gap.
   */
  gapForPair?: (prevId: string, currId: string) => number
}

/**
 * Re-describe the drawn columns as layout footprints, so the wheel zoom can
 * lay them out again at a scale it has not rendered yet.
 *
 * @param state - The mirrored layout snapshot.
 * @returns One footprint per drawn column.
 */
function layoutFootprints(state: SectionWheelLayoutState): ZoomLayoutColumn[] {
  return state.placedColumns.map(col => {
    const id = col.proj.item.id
    // ``cptBandFullWidth`` at a unit half-width returns the MULTIPLE (2 or 0),
    // which is what survives the band half-width changing under the zoom —
    // reusing it keeps the applicable-channel rule in exactly one place.
    const dataBandMultiple =
      col.kind === 'cpt'
        ? state.cptPlots?.has(id)
          ? cptBandFullWidth(col.proj.item.cpt_type, state.cptChannels, 1)
          : 0
        : state.boreholeDetails?.has(id)
          ? state.enabledBhChannels * 2
          : 0
    return zoomLayoutColumn(
      id,
      col.proj.along,
      dataBandMultiple,
      state.lithoGhostAnchorIds.has(id),
      state.ghostFootprintForLayout,
    )
  })
}

/** Inputs for {@link useSectionWheelZoom}. */
interface SectionWheelZoomParams {
  /** The panel's outer container; the SVG plot lives inside it. */
  containerRef: RefObject<HTMLDivElement>
  /** Latest post-nudge column anchors (read, never written, here). */
  warpAnchorsRef: MutableRefObject<WarpAnchor[]>
  /** Latest column-spacing slider value (0..1). */
  columnSpacingRef: MutableRefObject<number>
  /** Latest layout snapshot for the exact cumulative-width simulation. */
  layoutStateRef: MutableRefObject<SectionWheelLayoutState | null>
  /** Current viewport — drives the zoom factor + level anchor. */
  viewport: Viewport
  /** Horizontal scale (px per along-section metre). */
  scaleH: number
  /** Vertical scale (px per level metre). */
  scaleV: number
  /** Effective top of the level axis (after VEX), for the level anchor. */
  effLevelMax: number
  /** Plot area width in px (excludes margins). */
  plotWidth: number
  /** Plot area height in px (excludes margins). */
  plotHeight: number
  /** Viewport setter. */
  setViewport: Dispatch<SetStateAction<Viewport>>
}

/**
 * Cursor-anchored wheel zoom for the section canvas.
 *
 * Attaches a non-passive ``wheel`` listener to ``containerRef`` so the page
 * scroll can be intercepted, and keeps the column under the cursor pinned at
 * the same pixel across the zoom — spacing-aware so it holds at any
 * ``column_spacing``.
 *
 * Parameters
 * ----------
 * params
 *     See {@link SectionWheelZoomParams}.
 */
export function useSectionWheelZoom({
  containerRef,
  warpAnchorsRef,
  columnSpacingRef,
  layoutStateRef,
  viewport,
  scaleH,
  scaleV,
  effLevelMax,
  plotWidth,
  plotHeight,
  setViewport,
}: SectionWheelZoomParams): void {
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

      // Cursor zoom anchor — EXACT, not approximated (dogfeed 2026-08-15:
      // "when i zoom in and out the camera slowly moves left on the section??").
      //
      // The horizontal map is piecewise linear through the drawn columns, so
      // the cursor's world point is recoverable whether the mouse is on a
      // column or in the gap between two. The post-zoom layout is then RE-RUN
      // (same code path the render uses) and the viewport translated so that
      // world point lands back on the cursor pixel. The layout is translation-
      // equivariant in ``xMin``, so that translation is a closed form — see
      // ``wheelZoomAnchor.ts``.
      //
      // What this replaces: picking the column NEAREST the cursor and solving
      // for THAT column's pixel, with a band-half-width ratio standing in for
      // the packed offset. It snapped to a neighbour when the cursor sat
      // between columns, and the ratio's error did not cancel between a
      // zoom-in and a zoom-out — which is the camera creep the owner saw.
      const anchorsNow = warpAnchorsRef.current
      const spacing = columnSpacingRef.current
      const factor = e.deltaY < 0 ? 1 / WHEEL_ZOOM_FACTOR : WHEEL_ZOOM_FACTOR
      const newXRange = (viewport.xMax - viewport.xMin) * factor
      const newLevelRange = (viewport.levelMax - viewport.levelMin) * factor
      const newScaleH = plotWidth / newXRange
      const newBandHalfWidth = cptBandHalfWidth(newScaleH)
      const oldBandHalfWidth = cptBandHalfWidth(scaleH)
      // Refuse the wheel zoom if bandHalfWidth is already at its
      // clamp AND wouldn't change with this step. Past the clamp,
      // horizontal stops scaling but vertical keeps growing →
      // tests "elongate" instead of zooming. Dogfeed 2026-05-31.
      // Both ends matter: max clamp (factor=3.0 → BHW=72) on zoom-
      // in, min clamp (factor=0.6 → BHW=14) on zoom-out.
      if (oldBandHalfWidth === newBandHalfWidth) {
        const zoomingIn = factor < 1
        // Upper clamp = 6.0 × → 144 px halfwidth.
        // Lower clamp = 0.6 × → 14 px halfwidth.
        const atUpperClamp = oldBandHalfWidth >= 144 && zoomingIn
        const atLowerClamp = oldBandHalfWidth <= 14 && !zoomingIn
        if (atUpperClamp || atLowerClamp) return
      }
      // Re-run the horizontal layout at the post-zoom scale and translate the
      // viewport so the cursor's world point lands back on the cursor pixel.
      // With no mirrored layout yet (fresh mount) the column list is empty and
      // the solve degenerates to the plain linear cursor anchor.
      const state = layoutStateRef.current
      const newXMin = solveCursorAnchoredXMin({
        cursorPx: px,
        currentAnchors: anchorsNow,
        currentXMin: viewport.xMin,
        currentScaleH: scaleH,
        newScaleH,
        newBandHalfWidth,
        columns: state === null ? [] : layoutFootprints(state),
        columnSpacing: spacing,
        marginLeft: MARGIN.left,
        edgeGapPx: COLUMN_EDGE_GAP_PX,
        gapForPair: state?.gapForPair,
      })
      const newXMax = newXMin + newXRange

      const worldLevel = effLevelMax - (py - MARGIN.top) / scaleV
      const levelFraction =
        (worldLevel - viewport.levelMin) / (viewport.levelMax - viewport.levelMin)
      setViewport({
        xMin: newXMin,
        xMax: newXMax,
        levelMin: worldLevel - levelFraction * newLevelRange,
        levelMax: worldLevel + (1 - levelFraction) * newLevelRange,
      })
    },
    // setViewport is a stable useState setter — intentionally omitted.
    // The refs (warpAnchorsRef / columnSpacingRef / layoutStateRef) are
    // mutable containers read at call time, so they're omitted too.
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
}

/** Inputs for {@link useSectionKeyboardShortcuts}. */
interface SectionKeyboardShortcutsParams {
  /**
   * Whether a body-identity "Join" pick is armed (debt #278). Esc peels it FIRST
   * — an armed gesture is the most recently opened surface, so one Esc cancels the
   * pick without losing the section context. (Renamed from ``separateArmed`` when
   * the Separate verb was removed, owner 2026-09-01.)
   */
  pairArmed?: boolean
  /** Clear the pick arm. Only called when ``pairArmed`` is true. */
  clearPairArm?: () => void
  /** Whether the body-wedge context menu is open. */
  bodyMenuOpen: boolean
  /** Whether the column context menu is open. */
  columnMenuOpen: boolean
  /** Whether a column is currently focused. */
  columnFocused: boolean
  /** Close the body-wedge context menu. */
  dismissBodyCtxMenu: () => void
  /** Close the column context menu. */
  dismissContextMenu: () => void
  /** Exit column focus. */
  exitFocus: () => void
  /** Deselect the section (final Esc peel), if a handler is wired. */
  onClose?: () => void
  /**
   * Whether a geotech body is currently selected (S4 — Esc clears it before
   * proceeding to the column-focus peel).
   */
  geotechBodySelected?: boolean
  /**
   * Callback to clear the geotech body selection.  Only called when
   * ``geotechBodySelected`` is true.
   */
  clearGeotechBody?: () => void
}

/**
 * Section-wide Esc peel cascade.
 *
 * One ``keydown`` listener on ``document`` that, on Escape (and only when the
 * user is NOT typing into an input), peels the most recently opened surface in
 * priority order: body menu → column menu → focus → close the section.
 * Mirrors the Data-stage Esc-to-map peel (debt #43).
 *
 * The open/focus states are passed as booleans rather than the underlying
 * menu objects: the handler only branches on open-vs-closed, so booleans keep
 * this hook decoupled from the menu shapes and re-attach the listener only on a
 * genuine open/closed transition.
 *
 * Parameters
 * ----------
 * params
 *     See {@link SectionKeyboardShortcutsParams}.
 */
export function useSectionKeyboardShortcuts({
  pairArmed,
  clearPairArm,
  bodyMenuOpen,
  columnMenuOpen,
  columnFocused,
  dismissBodyCtxMenu,
  dismissContextMenu,
  exitFocus,
  onClose,
  geotechBodySelected,
  clearGeotechBody,
}: SectionKeyboardShortcutsParams): void {
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
      if (pairArmed && clearPairArm) {
        // #278: an armed Join is the outermost peel — Esc cancels the
        // pick-the-other-body gesture before any menu / focus / close.
        clearPairArm()
      } else if (bodyMenuOpen) {
        dismissBodyCtxMenu()
      } else if (columnMenuOpen) {
        dismissContextMenu()
      } else if (geotechBodySelected && clearGeotechBody) {
        // S4: geotech body selected → clear it before peeling to column focus
        // or section close, so the user can Esc the sample highlight without
        // losing their section context.
        clearGeotechBody()
      } else if (columnFocused) {
        exitFocus()
      } else if (onClose) {
        // L-final: nothing else to peel — deselect the section, which
        // unmounts SectionPanel and falls back to the section map view
        // (SectionsCanvas renders MapView when selectedSectionId is
        // null). Mirrors the Data-stage Esc-to-map peel (debt #43).
        onClose()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [
    pairArmed,
    clearPairArm,
    bodyMenuOpen,
    columnMenuOpen,
    columnFocused,
    exitFocus,
    dismissContextMenu,
    dismissBodyCtxMenu,
    onClose,
    geotechBodySelected,
    clearGeotechBody,
  ])
}
