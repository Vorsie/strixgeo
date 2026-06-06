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
 *     raw projection-along, so the column under the cursor stays pinned at any
 *     ``column_spacing`` slider value. See
 *     ``memory/feedback_section_view_spacing_modifier`` — this anchor math has
 *     bitten twice when computed against raw ``proj.along``.
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
  BARE_COLUMN_WIDTH_PX,
  COLUMN_EDGE_GAP_PX,
  MARGIN,
  WHEEL_ZOOM_FACTOR,
  type PlacedColumn,
  type Viewport,
} from './utils'

/**
 * Layout snapshot the wheel handler reads (via a ref, to avoid TDZ) to compute
 * the EXACT cumulative-width offset at the post-zoom band half-width. Mirrored
 * into ``layoutStateRef`` by SectionPanel from its layout useMemos.
 */
export interface SectionWheelLayoutState {
  placedColumns: PlacedColumn[]
  cptPlots: Map<string, CptPlotResponse> | null | undefined
  boreholeDetails: Map<string, BoreholeDetailResponse> | null | undefined
  cptChannels: CptChannels
  enabledBhChannels: number
  ghostFootprintForLayout: number
  lithoGhostAnchorIds: Set<string>
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

      // Cursor zoom anchor — SPACING-AWARE blend (dogfeed 2026-05-31).
      // Two endpoints, blended by the column-spacing slider:
      //
      //   * spacing = 1 (no compression): the cursor's LINEAR along-
      //     section world position. Cursor at world 50 m → zoom
      //     anchored at 50 m. Standard cursor-anchor behaviour.
      //
      //   * spacing = 0 (fully packed): the leftmost test's along.
      //     At spacing=0 every column's screen X is packedX_0 +
      //     Σ widths, where packedX_0 = xToScreen(leftmost.along). All
      //     packed columns translate UNIFORMLY when the leftmost's
      //     screen X moves. So anchoring on the leftmost's along
      //     keeps every column at the same pixel — the cursor's
      //     column stays under the cursor, no drift.
      //
      // Linear interpolation between the two endpoints by spacing
      // matches the lerp the column-layout itself does
      // (lerpedX = packedX + (trueX - packedX) * spacing). Without
      // this blend, wheel zoom at spacing=0 drifts rightward (the
      // packed columns translate while the linear anchor preserves
      // a world point that's decoupled from the visible content).
      // Cursor anchor — keep the column UNDER the cursor at the same
      // pixel after the zoom, even at spacing < 1 where bands pack
      // edge-to-edge instead of sitting at their world-along screen
      // positions.
      //
      // For a column at index C, post-warp:
      //   nudgedX_C ≈ packedX_0 * (1-α) + trueX_C * α + (1-α) * offset_C
      // where
      //   packedX_0 = MARGIN.left + (L - xMin) * scaleH   (leftmost test's screen X)
      //   trueX_C   = MARGIN.left + (col.along - xMin) * scaleH
      //   offset_C  = (nudgedX_C - packedX_0_old)         (current packed offset, in px)
      //   α         = columnSpacing
      //
      // bandHalfWidth scales with scaleH, so offset_C grows in
      // proportion when zooming in — the wheel handler scales it by
      // (new bandHalfWidth / old bandHalfWidth) to estimate the new
      // packed offset.
      //
      // Solving "nudgedX_C_new = cursor_px" for new_xMin gives the
      // formula below.  At spacing=1 it collapses to the standard
      // linear cursor anchor (worldX = col.along, offset term vanishes).
      // At spacing=0 it accounts for the cumulative width shift that
      // would otherwise drift columns rightward on every wheel step.
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
      // Find the column closest to the cursor in current screen X.
      // Anchors are sorted ascending by ``along``; ``effX`` is the
      // current nudgedX — what the user actually sees under the
      // cursor.  If no anchors yet (fresh section without projected
      // columns), fall back to pure linear cursor anchor.
      let cursorAlong: number
      let cursorOffsetPxNew: number
      const linearAlong = viewport.xMin + (px - MARGIN.left) / scaleH
      if (anchorsNow.length === 0) {
        cursorAlong = linearAlong
        cursorOffsetPxNew = 0
      } else {
        let bestIdx = 0
        let bestDist = Math.abs(anchorsNow[0].effX - px)
        for (let i = 1; i < anchorsNow.length; i += 1) {
          const d = Math.abs(anchorsNow[i].effX - px)
          if (d < bestDist) {
            bestDist = d
            bestIdx = i
          }
        }
        const cursorCol = anchorsNow[bestIdx]
        const leftmost = anchorsNow[0]
        // Compute the EXACT cumulative pixel offset at the new
        // bandHalfWidth (same simulation the banner-zoom uses).
        // Walks every placed column up to the cursor's index and sums
        // the per-column visualWidth at the post-zoom scale. No
        // approximation — works at any spacing because the formula
        // matches what placedColumns will ACTUALLY render at the new
        // viewport.
        //
        // Falls back to the per-column-ratio approximation when the
        // layoutStateRef hasn't been populated yet (fresh mount race).
        const state = layoutStateRef.current
        if (state !== null && state.placedColumns.length > 0) {
          const widthAtNew = (col: PlacedColumn): number => {
            if (col.kind === 'cpt') {
              const trackW = state.cptPlots?.has(col.proj.item.id)
                ? cptBandFullWidth(
                    col.proj.item.cpt_type,
                    state.cptChannels,
                    newBandHalfWidth,
                  )
                : 0
              const lithoBandW = state.lithoGhostAnchorIds.has(col.proj.item.id)
                ? 2 * newBandHalfWidth
                : 0
              return (
                BARE_COLUMN_WIDTH_PX +
                Math.max(trackW, lithoBandW) +
                state.ghostFootprintForLayout
              )
            }
            const stripsW = state.boreholeDetails?.has(col.proj.item.id)
              ? state.enabledBhChannels * 2 * newBandHalfWidth
              : 0
            const lithoBandW = state.lithoGhostAnchorIds.has(col.proj.item.id)
              ? 2 * newBandHalfWidth
              : 0
            return (
              BARE_COLUMN_WIDTH_PX +
              Math.max(stripsW, lithoBandW) +
              state.ghostFootprintForLayout
            )
          }
          const sorted = [...state.placedColumns].sort(
            (a, b) => a.proj.along - b.proj.along,
          )
          const cursorIdx = sorted.findIndex(c => c.proj.along === cursorCol.along)
          let cumOff = 0
          if (cursorIdx > 0) {
            for (let i = 1; i <= cursorIdx; i += 1) {
              cumOff +=
                (widthAtNew(sorted[i - 1]) + widthAtNew(sorted[i])) / 2 +
                COLUMN_EDGE_GAP_PX
            }
          }
          cursorOffsetPxNew = cumOff
        } else {
          // Fall-back per-column ratio when layout ref hasn't been
          // mirrored yet. Same approximation as the previous fix.
          const oldPerCol =
            BARE_COLUMN_WIDTH_PX + 2 * oldBandHalfWidth + COLUMN_EDGE_GAP_PX
          const newPerCol =
            BARE_COLUMN_WIDTH_PX + 2 * newBandHalfWidth + COLUMN_EDGE_GAP_PX
          const widthRatio = oldPerCol > 0 ? newPerCol / oldPerCol : 1
          cursorOffsetPxNew = (cursorCol.effX - leftmost.effX) * widthRatio
        }
        // Blend with leftmost.along by spacing — at spacing=1 we anchor
        // on the cursor column's along, at spacing=0 we anchor on the
        // leftmost.along and the offset term carries the packed
        // location.
        cursorAlong = leftmost.along * (1 - spacing) + cursorCol.along * spacing
      }

      const newXMin =
        cursorAlong - (px - MARGIN.left - (1 - spacing) * cursorOffsetPxNew) / newScaleH
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
  /** Whether the ghost-candidate context menu is open. */
  ghostMenuOpen: boolean
  /** Whether the body-wedge context menu is open. */
  bodyMenuOpen: boolean
  /** Whether the column context menu is open. */
  columnMenuOpen: boolean
  /** Whether a column is currently focused. */
  columnFocused: boolean
  /** Close the ghost-candidate context menu. */
  dismissGhostCtxMenu: () => void
  /** Close the body-wedge context menu. */
  dismissBodyCtxMenu: () => void
  /** Close the column context menu. */
  dismissContextMenu: () => void
  /** Exit column focus. */
  exitFocus: () => void
  /** Deselect the section (final Esc peel), if a handler is wired. */
  onClose?: () => void
}

/**
 * Section-wide Esc peel cascade.
 *
 * One ``keydown`` listener on ``document`` that, on Escape (and only when the
 * user is NOT typing into an input), peels the most recently opened surface in
 * priority order: ghost menu → body menu → column menu → focus → close the
 * section. Mirrors the Data-stage Esc-to-map peel (debt #43).
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
  ghostMenuOpen,
  bodyMenuOpen,
  columnMenuOpen,
  columnFocused,
  dismissGhostCtxMenu,
  dismissBodyCtxMenu,
  dismissContextMenu,
  exitFocus,
  onClose,
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
      if (ghostMenuOpen) {
        dismissGhostCtxMenu()
      } else if (bodyMenuOpen) {
        dismissBodyCtxMenu()
      } else if (columnMenuOpen) {
        dismissContextMenu()
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
    ghostMenuOpen,
    dismissGhostCtxMenu,
    bodyMenuOpen,
    columnMenuOpen,
    columnFocused,
    exitFocus,
    dismissContextMenu,
    dismissBodyCtxMenu,
    onClose,
  ])
}
