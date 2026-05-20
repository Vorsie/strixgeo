/**
 * Hover-driven contact-pick affordance for a single CPT band.
 *
 * Renders an invisible rect over the CPT's data band that captures
 * pointer events. On mouse-move:
 *
 *   * A thin horizontal line tracks the cursor Y inside the band.
 *   * A floating readout shows the values the engineer needs to
 *     decide whether THIS depth is a formation top:
 *       - qc (MPa), looked up by linear interpolation between the
 *         two depth-series samples bracketing the cursor depth.
 *       - Rf (%), same lookup.
 *       - depth (m below surface).
 *       - + elevation (m TAW) on the project's vertical datum.
 *
 * On mouse-click the bar fires ``onCommitDepth(depth_m)`` so the
 * parent (SectionPanel) opens the formation picker pre-seeded
 * with the chosen depth.
 *
 * No persistent state — the ghost only exists during hover. Keeps
 * the section uncluttered when the user isn't actively placing
 * contacts. To re-pick a depth, hover again.
 */

import { useMemo, useRef, useState } from 'react'

import type { CptPlotResponse } from '../../api/client'
import { useClickDebounce } from '../../hooks/useClickDebounce'
import { lookupCptValueAtDepth } from './cptInterpolation'
import HoverReadoutCard from './HoverReadoutCard'

interface Props {
  plot: CptPlotResponse
  cptType: string
  cptName: string
  cptId: string
  /** Column centerline X in screen px. */
  screenX: number
  /** Half-width of the CPT's data band — pick area extends
   * ±halfWidth from screenX. */
  halfWidth: number
  surfaceElevationM: number
  plotTop: number
  plotBottom: number
  /** Cap-clamped data extent — the pick area is bounded to here so
   * the user can't pick a depth above the surface or below the
   * deepest sample. */
  bgTopY: number
  bgBottomY: number
  levelToScreen: (level: number) => number
  /** Fires when the user clicks at a depth. Caller opens the
   * formation picker pre-seeded with the depth. Optional so the bar
   * can render in read-only hover-readout mode (focus view without
   * an active geological model) — click does nothing in that case
   * but hover still surfaces depth / mTAW / qc / Rf. */
  onCommitDepth?: (anchor: {
    kind: 'cpt'
    cptId: string
    cptName: string
    depth_m: number
    elevationM: number
    /** CPT picks never snap to stratigraphy (no observation
     * streams on a CPT), so this is always false — present so
     * the caller's pick anchor union types line up with
     * BoreholeColumn's anchor shape. Debt #22/#23. */
    snapped: false
  }) => void
  /** Fires on dbl-click ON THE PICK RECT so the dbl-click intent
   * (open detail) works even when the user dbl-clicks on the CPT
   * data band. The outer ColumnGlyph's onDoubleClick handler does
   * NOT see this event because the pick rect is an SVG sibling of
   * the column glyph (not a child) — events on the rect bubble up
   * its own <g>, not into ColumnGlyph. Without this passthrough,
   * a dbl-click on the data band cancels the queued single-click
   * (good) but never opens detail (bad). Optional: when wired,
   * the queued click is cancelled AND this fires; when not wired,
   * cancellation still happens (no detail-open). */
  onDoubleClickOpen?: () => void
}

export default function ContactPickBar({
  plot,
  cptType,
  cptName,
  cptId,
  screenX,
  halfWidth,
  surfaceElevationM,
  plotTop,
  plotBottom,
  bgTopY,
  bgBottomY,
  levelToScreen,
  onCommitDepth,
  onDoubleClickOpen,
}: Props): JSX.Element | null {
  const [cursorY, setCursorY] = useState<number | null>(null)
  const overlayRef = useRef<SVGRectElement>(null)

  // Pre-build a sorted index of (depth, qc, rf) so the readout
  // can interpolate cheaply on every mouse-move. ``depths_m`` is
  // already sorted ascending; we just grab parallel arrays.
  const series = useMemo(() => {
    const depths = plot.depths_m
    const qc = plot.qc_mpa
    const rf = plot.rf_pct ?? []
    return { depths, qc, rf }
  }, [plot])

  // Single-vs-double-click gate. MUST sit above any early-return
  // below or React throws "Rendered fewer hooks than expected" the
  // first frame ``bgBottomY - bgTopY > 0`` flips from false to true
  // (CLAUDE.md "Temporal Dead Zone after reordering React component
  // bodies" / Rules of Hooks). The hook itself is cheap — one ref
  // + a cleanup effect — so paying it on every render is free.
  const clickDebounce = useClickDebounce()

  if (bgBottomY - bgTopY <= 0) return null

  // Inverse of levelToScreen is callable from the closure since
  // it's a linear transform; we sample two points to derive the
  // ratio rather than asking the caller for a separate inverse.
  // (px-per-m below the surface) = (levelToScreen(s) -
  // levelToScreen(s-1)) for any s.
  const oneMetreDownPx = levelToScreen(surfaceElevationM - 1) - levelToScreen(surfaceElevationM)
  const surfaceY = levelToScreen(surfaceElevationM)

  function depthAtY(y: number): number {
    // depth = (y - surfaceY) / oneMetreDownPx
    // oneMetreDownPx is positive (deeper level = larger Y in the
    // flipped section transform).
    if (oneMetreDownPx === 0) return 0
    return (y - surfaceY) / oneMetreDownPx
  }

  function elevationAtY(y: number): number {
    return surfaceElevationM - depthAtY(y)
  }

  function lookupValue(depth: number, values: readonly (number | null)[]): number | null {
    return lookupCptValueAtDepth(series.depths, values, depth)
  }

  function handleMove(e: React.MouseEvent<SVGRectElement>): void {
    const rect = overlayRef.current?.getBoundingClientRect()
    if (!rect) return
    const localY = e.clientY - rect.top + bgTopY
    const clamped = Math.max(bgTopY, Math.min(bgBottomY, localY))
    setCursorY(clamped)
  }

  function handleLeave(): void {
    setCursorY(null)
  }

  // Single-vs-double-click gate — hook is declared above the
  // early-return guard (Rules of Hooks). handleDoubleClick clears
  // the queued single; the outer column's onDoubleClick still fires
  // for detail-open via SVG event bubbling.
  function handleClick(e: React.MouseEvent<SVGRectElement>): void {
    if (cursorY === null || !onCommitDepth) return
    // Shift held → user wants the section bg-marquee for multi-
    // select; let the click bubble up by bailing here.
    if (e.shiftKey) return
    // Capture depth at click time — the queued thunk runs ~250 ms
    // later, after the user may have moved the cursor.
    const depth = depthAtY(cursorY)
    const elevationM = surfaceElevationM - depth
    clickDebounce.schedule(() =>
      onCommitDepth({
        kind: 'cpt',
        cptId,
        cptName,
        depth_m: depth,
        elevationM,
        snapped: false,
      }),
    )
  }
  function handleDoubleClick(): void {
    clickDebounce.cancel()
    // Forward the dbl-click intent to the column's detail-open
    // handler — see the prop docstring for why this passthrough is
    // necessary (the outer ColumnGlyph doesn't see this event).
    if (onDoubleClickOpen) onDoubleClickOpen()
  }

  const leftX = screenX - halfWidth
  const rightX = screenX + halfWidth
  const depth = cursorY === null ? null : depthAtY(cursorY)
  const elevation = cursorY === null ? null : elevationAtY(cursorY)
  const qc = depth === null ? null : lookupValue(depth, series.qc)
  const rf = depth === null ? null : lookupValue(depth, series.rf)

  // The ``cptType`` doesn't influence the readout shape today —
  // qc + Rf are universal across CPTU / CPTE / CPTM — but the
  // prop is kept so per-kind extras (u2, qTotal) can light up in
  // a follow-up without changing the call site.
  void cptType

  return (
    <g>
      {/* Invisible click + hover capture. ``cursor: crosshair``
          makes the affordance discoverable on hover without any
          extra chrome. */}
      <rect
        ref={overlayRef}
        x={leftX}
        y={bgTopY}
        width={2 * halfWidth}
        height={bgBottomY - bgTopY}
        fill="transparent"
        style={{ cursor: onCommitDepth ? 'crosshair' : 'default' }}
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
        onClick={onCommitDepth ? handleClick : undefined}
        // onDoubleClick wires when EITHER onCommitDepth is wired (to
        // cancel the queued single) OR onDoubleClickOpen is wired (to
        // open detail). Without one of these the rect has nothing to
        // dbl-click for.
        onDoubleClick={
          onCommitDepth || onDoubleClickOpen ? handleDoubleClick : undefined
        }
      />
      {cursorY !== null && (
        <g pointerEvents="none">
          {/* Horizontal ghost line at cursor depth. Spans a bit
              wider than the band so the eye can scan adjacent
              columns at the same depth. */}
          <line
            x1={leftX - 6}
            x2={rightX + 6}
            y1={cursorY}
            y2={cursorY}
            stroke="#dc2626"
            strokeWidth={1}
            strokeOpacity={0.85}
            strokeDasharray="3 2"
          />
          {/* Readout label — right of the band when there's room,
              otherwise the parent could flip it; for now we stay
              right-only. The card clamps its own Y so it never
              escapes the SVG. */}
          <HoverReadoutCard
            x={rightX + 8}
            y={cursorY}
            plotTop={plotTop}
            plotBottom={plotBottom}
            lines={[
              { text: `depth ${(depth ?? 0).toFixed(2)} m` },
              {
                text: `${(elevation ?? 0) >= 0 ? '+' : ''}${(elevation ?? 0).toFixed(2)} m TAW`,
              },
              {
                text: `qc ${qc === null ? '—' : `${qc.toFixed(2)} MPa`}`,
                color: '#111827',
              },
              {
                text: `Rf ${rf === null ? '—' : `${rf.toFixed(2)} %`}`,
                color: '#b45309',
              },
            ]}
          />
        </g>
      )}
    </g>
  )
}
