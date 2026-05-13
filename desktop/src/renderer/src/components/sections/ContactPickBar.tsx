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
   * formation picker pre-seeded with the depth. */
  onCommitDepth: (anchor: {
    kind: 'cpt'
    cptId: string
    cptName: string
    depth_m: number
    elevationM: number
  }) => void
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
    if (values.length === 0) return null
    const depths = series.depths
    if (depth <= depths[0]) {
      const v = values[0]
      return v ?? null
    }
    if (depth >= depths[depths.length - 1]) {
      const v = values[values.length - 1]
      return v ?? null
    }
    // Binary search would be faster, but typical CPT length (~100
    // samples) makes a linear walk cheap enough and the code path
    // is mouse-move hot. Walk from the front; bail at the bracket.
    for (let i = 1; i < depths.length; i += 1) {
      if (depths[i] >= depth) {
        const v0 = values[i - 1]
        const v1 = values[i]
        if (v0 === null || v0 === undefined) return v1 ?? null
        if (v1 === null || v1 === undefined) return v0
        const frac = (depth - depths[i - 1]) / (depths[i] - depths[i - 1])
        return v0 + frac * (v1 - v0)
      }
    }
    return null
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

  function handleClick(): void {
    if (cursorY === null) return
    const depth = depthAtY(cursorY)
    onCommitDepth({
      kind: 'cpt',
      cptId,
      cptName,
      depth_m: depth,
      elevationM: surfaceElevationM - depth,
    })
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
        style={{ cursor: 'crosshair' }}
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
        onClick={handleClick}
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
              otherwise to the left. Stays inside [plotTop,
              plotBottom] so it never escapes the SVG. */}
          <ContactPickReadout
            x={rightX + 8}
            y={cursorY}
            depth={depth ?? 0}
            elevation={elevation ?? 0}
            qc={qc}
            rf={rf}
            plotTop={plotTop}
            plotBottom={plotBottom}
          />
        </g>
      )}
    </g>
  )
}

function ContactPickReadout({
  x,
  y,
  depth,
  elevation,
  qc,
  rf,
  plotTop,
  plotBottom,
}: {
  x: number
  y: number
  depth: number
  elevation: number
  qc: number | null
  rf: number | null
  plotTop: number
  plotBottom: number
}): JSX.Element {
  // Card-style readout block — anchored to the cursor Y but
  // clamped inside the plot area so it never paints over the
  // axis chrome.
  const cardHeight = 64
  const halfH = cardHeight / 2
  const cy = Math.max(plotTop + halfH, Math.min(plotBottom - halfH, y))
  return (
    <g>
      <rect
        x={x}
        y={cy - halfH}
        width={86}
        height={cardHeight}
        fill="#ffffff"
        fillOpacity={0.95}
        stroke="#dc2626"
        strokeWidth={0.75}
        rx={3}
      />
      <text x={x + 6} y={cy - halfH + 13} fontSize={9} fill="#374151">
        depth {depth.toFixed(2)} m
      </text>
      <text x={x + 6} y={cy - halfH + 26} fontSize={9} fill="#374151">
        {elevation >= 0 ? '+' : ''}
        {elevation.toFixed(2)} m TAW
      </text>
      <text x={x + 6} y={cy - halfH + 41} fontSize={9} fill="#111827">
        qc{' '}
        <tspan fontWeight={500}>
          {qc === null ? '—' : `${qc.toFixed(2)} MPa`}
        </tspan>
      </text>
      <text x={x + 6} y={cy - halfH + 54} fontSize={9} fill="#b45309">
        Rf{' '}
        <tspan fontWeight={500}>
          {rf === null ? '—' : `${rf.toFixed(2)} %`}
        </tspan>
      </text>
    </g>
  )
}
