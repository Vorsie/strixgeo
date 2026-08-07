/**
 * The hand-edit gesture surface for packing sub-bands on the geotech section axis.
 *
 * A deliberate, bounded hole in a gate that stays shut everywhere else. The geotech render
 * is view-only (``docs/design/geotech-stage.md``): ``PartitionFillOverlay`` suppresses every
 * freedraw / apex path on this axis, and contacts can be neither created, dragged nor
 * deleted here. This overlay adds the band-edit verbs on top of that — SPLIT a packing band,
 * MERGE adjacent ones, DRAG their shared boundary, REMOVE a band (an absorb into a
 * neighbour) — because those go through their own endpoints, which re-derive the NAD class
 * from the cone resistance instead of moving a contact.
 *
 * Gesture shape is mirrored from the litho axis rather than invented
 * (``LithoSuggestionGhostColumns`` / ``ContactsLayer``): right-click a band → "Split band…" /
 * "Remove band (merge into …)", right-click the boundary between two bands → "Merge bands",
 * and — since 2026-08-07 — LEFT-PRESS the boundary strip to DRAG it. What is NOT mirrored is
 * the persistence — litho edits pending ghosts in local state, while these bands are
 * committed rows and every edit is a server round-trip.
 *
 * Choosing "Split band…" ARMS a placement rather than committing one: the boundary then
 * follows the cursor until it is clicked into place. That is the only shape in which owner
 * ruling 2 is legible — *"a packing boundary moves freely inside its litho body and clamps
 * at the edge"* has to be felt while moving, not discovered as a rejection afterwards.
 *
 * WHY the drag's press target is ONLY the thin boundary strip: left-drag anywhere else on
 * this canvas pans the section (``SectionPanel.handleMouseDown``). A band-wide press target
 * would make every geotech column un-pannable ("tried dragging, get pan hand" — the owner's
 * 2026-08-07 dogfeed, which is what motivated the verb). The strip is the same solution the
 * litho contact drag uses; band-interior presses keep bubbling to the canvas.
 *
 * Squeezing a neighbour below ``max(0.1 m, 15 %)`` of its original thickness turns the
 * release into a MERGE of the pair (owner: "Absorb, like litho") — the shipped merge
 * endpoints re-derive the union's class; this overlay never owns the classification.
 *
 * Nothing here decides anything geological. The clamp, the absorb prediction and the merge
 * eligibility are the pure rules in ``geotechBandEdit.ts``; the consequence of an edit comes
 * from the preview endpoint; this file is the hit targets, the live lines and the menu.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'

import type { LithoLayerResponse } from '../../api/client'
import { surfaceYForColumn } from './contactsLayerGeometry'
import {
  type DepthInterval,
  type GeotechBandInterval,
  type SplitClampWall,
  bandAtDepth,
  canMergeBands,
  clampDragDepth,
  clampSplitDepth,
  columnBands,
  columnIsHandEditable,
  dragAbsorbPrediction,
  enclosingLithoBody,
} from './geotechBandEdit'
import type { PlacedColumn } from './utils'

/** Height in px of the strip that sits on a shared band boundary (drag + right-click). */
const MERGE_HANDLE_PX = 10

/**
 * Width in px of the armed-placement capture rect.
 *
 * Wider than any plausible section viewport so the boundary keeps following the cursor
 * horizontally; the SVG clips the overflow, and the rect exists only while a placement is
 * armed, so it never sits over the canvas at rest.
 */
const CAPTURE_WIDTH_PX = 10000

/** Props for the packing-band hand-edit overlay. */
export interface Props {
  /** Geotech ``litho_layer`` rows — the packing sub-bands, any order. */
  geotechLayers: readonly LithoLayerResponse[]
  /** Litho ``litho_layer`` rows — the hard walls a packing boundary never crosses. */
  lithoLayers: readonly LithoLayerResponse[]
  /** Placed columns; ``nudgedX`` is the post-spacing X every other overlay draws at. */
  placedColumns: readonly PlacedColumn[]
  /** Absolute elevation (mTAW) → screen y. */
  levelToScreen: (level: number) => number
  /** Top / bottom of the plot area in screen px. */
  plotTop: number
  plotBottom: number
  /** Ask to split this band at this depth. Absent → splitting is not offered. */
  onRequestSplit?: (bandId: string, depthM: number) => void
  /**
   * Ask to merge these two adjacent bands. ``boundaryDepthM`` is their shared boundary
   * today — the undo anchor (a merge is undone by re-splitting exactly there). Absent →
   * merging (and removing, which is a merge) is not offered.
   */
  onRequestMerge?: (upperBandId: string, lowerBandId: string, boundaryDepthM: number) => void
  /**
   * Ask to drag the pair's shared boundary to ``newDepthM`` (``preDragDepthM`` = where it
   * started, the undo anchor). Absent → the strips are right-click-only, exactly as before
   * the drag verb existed, and a press on them pans.
   */
  onRequestMoveBoundary?: (
    upperBandId: string,
    lowerBandId: string,
    newDepthM: number,
    preDragDepthM: number,
  ) => void
  /**
   * Drop every hit target while another gesture owns the canvas (correlate mode), the way
   * ``PartitionFillOverlay`` yields its handles so clicks reach the targets beneath.
   */
  suspended?: boolean
}

/** One column's geometry plus the band / body stacks drawn on it. */
interface ColumnModel {
  investigationId: string
  x0: number
  x1: number
  surfaceY: number
  pxPerMetre: number
  bands: GeotechBandInterval[]
  lithoBodies: DepthInterval[]
  /** Internal boundaries where a merge (and so a drag) is legal — not litho contacts. */
  mergeable: { upper: GeotechBandInterval; lower: GeotechBandInterval }[]
}

/** A split boundary being placed by hand, following the cursor until it is clicked down. */
interface SplitPlacement {
  /** Viewport Y of the SVG's top edge, captured once when the placement is armed. */
  svgTop: number
  column: ColumnModel
  /** The litho body the boundary belongs to — fixed when armed; it cannot leave. */
  lithoBody: DepthInterval
  depthM: number
  clampedAt: SplitClampWall
  clampReason: string | null
}

/** A boundary drag in progress (owner 2026-08-07 — the primary edit gesture). */
interface BoundaryDrag {
  /** Viewport Y of the SVG's top edge, captured at mousedown. */
  svgTop: number
  column: ColumnModel
  upper: GeotechBandInterval
  lower: GeotechBandInterval
  /** The boundary before the drag — the no-op guard and the undo anchor. */
  preDragDepthM: number
  depthM: number
  atLimit: 'upper' | 'lower' | 'none'
  absorb: 'upper' | 'lower' | null
}

/** A remove-band absorb target (the neighbour + their shared boundary). */
interface RemoveSeed {
  upperBandId: string
  lowerBandId: string
  boundaryDepthM: number
}

/** An open right-click menu. */
type MenuState =
  | {
      kind: 'split'
      clientX: number
      clientY: number
      seed: SplitPlacement
      /** Absorb into the band above, when that merge is legal. */
      removeUp: RemoveSeed | null
      /** Absorb into the band below, when that merge is legal. */
      removeDown: RemoveSeed | null
    }
  | { kind: 'merge'; clientX: number; clientY: number; upperBandId: string; lowerBandId: string; boundaryDepthM: number }

/**
 * Convert a viewport Y to a depth below one column's collar.
 *
 * The same arithmetic ``ContactsLayer`` uses for its band click-to-insert
 * (``svgY = clientY - svgRect.top``, then divide by the column's px-per-metre), kept as a
 * named function because a window-level drag handler cannot reach ``currentTarget`` and has
 * to be handed the offset captured at mousedown.
 *
 * Parameters
 * ----------
 * clientY : number
 *     Viewport Y of the cursor.
 * svgTop : number
 *     Viewport Y of the SVG's top edge, captured at mousedown.
 * surfaceY : number
 *     SVG Y of the column's ground surface.
 * pxPerMetre : number
 *     Vertical scale at this column.
 *
 * Returns
 * -------
 * number
 *     Depth in metres below the collar; 0 when the column has no vertical scale.
 */
export function depthAtClientY(
  clientY: number,
  svgTop: number,
  surfaceY: number,
  pxPerMetre: number,
): number {
  if (pxPerMetre === 0) return 0
  return (clientY - svgTop - surfaceY) / pxPerMetre
}

/**
 * Draw the band-edit hit targets, the live boundary lines, and the context menu.
 *
 * Parameters
 * ----------
 * props : Props
 *     Bands, walls, geometry and the request handlers.
 *
 * Returns
 * -------
 * JSX.Element | null
 *     ``null`` when nothing is editable — the axis then stays exactly as view-only as it
 *     was before this overlay existed.
 */
export default function GeotechBandEditOverlay({
  geotechLayers,
  lithoLayers,
  placedColumns,
  levelToScreen,
  plotTop,
  plotBottom,
  onRequestSplit,
  onRequestMerge,
  onRequestMoveBoundary,
  suspended = false,
}: Props): JSX.Element | null {
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [placing, setPlacing] = useState<SplitPlacement | null>(null)
  const [drag, setDrag] = useState<BoundaryDrag | null>(null)

  const editable =
    !suspended &&
    (onRequestSplit !== undefined ||
      onRequestMerge !== undefined ||
      onRequestMoveBoundary !== undefined)
  const draggable = !suspended && onRequestMoveBoundary !== undefined

  const columns = useMemo<ColumnModel[]>(() => {
    if (!editable) return []
    const out: ColumnModel[] = []
    for (const col of placedColumns) {
      const item = col.proj.item as { id: string }
      const surface = surfaceYForColumn(col, levelToScreen)
      if (surface.surfaceElevationM === null || surface.pxPerMetre === 0) continue
      const bands = columnBands(geotechLayers, item.id)
      // A borehole's packing bands carry no cone resistance to re-derive a class from, so
      // no verb is offered on them — the column keeps the same view-only treatment the
      // whole geotech axis had before this overlay existed. The bands' OWN anchors decide
      // it: this column may well be a borehole drawn right beside a CPT.
      if (!columnIsHandEditable(bands)) continue
      const lithoBodies: DepthInterval[] = columnBands(lithoLayers, item.id).map(b => ({
        topDepthM: b.topDepthM,
        baseDepthM: b.baseDepthM,
      }))
      const mergeable: { upper: GeotechBandInterval; lower: GeotechBandInterval }[] = []
      for (let i = 0; i < bands.length - 1; i++) {
        if (canMergeBands(bands[i], bands[i + 1], lithoBodies).ok) {
          mergeable.push({ upper: bands[i], lower: bands[i + 1] })
        }
      }
      const half = col.width / 2
      out.push({
        investigationId: item.id,
        x0: col.nudgedX - half,
        x1: col.nudgedX + half,
        surfaceY: surface.surfaceY,
        pxPerMetre: surface.pxPerMetre,
        bands,
        lithoBodies,
        mergeable,
      })
    }
    return out
  }, [editable, placedColumns, levelToScreen, geotechLayers, lithoLayers])

  // Escape abandons a placement, matching every other armed mode in the section editor.
  useEffect(() => {
    if (placing === null) return
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setPlacing(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [placing])

  // The boundary drag lives on WINDOW listeners (the litho-proven shape): the split
  // capture-rect pattern only covers plotTop..plotBottom and would lose the cursor on
  // vertical overshoot. Escape / blur / button-up-elsewhere all abandon the drag.
  useEffect(() => {
    if (drag === null) return
    function onMove(e: MouseEvent): void {
      setDrag(prev => {
        if (prev === null) return prev
        if (e.buttons === 0) return null // released outside the window
        const raw = depthAtClientY(e.clientY, prev.svgTop, prev.column.surfaceY, prev.column.pxPerMetre)
        const clamped = clampDragDepth(prev.upper, prev.lower, raw)
        const absorb = dragAbsorbPrediction(prev.upper, prev.lower, clamped.depthM)
        return { ...prev, depthM: clamped.depthM, atLimit: clamped.atLimit, absorb: absorb?.side ?? null }
      })
    }
    function onUp(): void {
      setDrag(prev => {
        if (prev !== null) {
          const moved = Math.abs(prev.depthM - prev.preDragDepthM) > 1e-6
          if (moved && prev.absorb !== null) {
            // The squeeze collapsed a band: the honest verb is the MERGE of
            // the pair, previewed and committed by the shipped endpoints.
            onRequestMerge?.(prev.upper.layerId, prev.lower.layerId, prev.preDragDepthM)
          } else if (moved) {
            onRequestMoveBoundary?.(
              prev.upper.layerId,
              prev.lower.layerId,
              prev.depthM,
              prev.preDragDepthM,
            )
          }
        }
        return null
      })
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setDrag(null)
    }
    function onBlur(): void {
      setDrag(null)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', onBlur)
    }
  }, [drag, onRequestMerge, onRequestMoveBoundary])

  // Correlate mode taking the canvas mid-drag abandons the drag, exactly as the hit
  // targets vanish: a gesture whose surface disappeared must not commit on release.
  useEffect(() => {
    if (suspended) {
      setDrag(null)
      setPlacing(null)
      setMenu(null)
    }
  }, [suspended])

  /** Follow the cursor while a placement is armed, clamped to the fixed litho body. */
  const trackPlacement = useCallback((clientY: number): void => {
    setPlacing(prev => {
      if (prev === null) return prev
      const raw = depthAtClientY(clientY, prev.svgTop, prev.column.surfaceY, prev.column.pxPerMetre)
      const clamped = clampSplitDepth(prev.lithoBody, raw)
      return {
        ...prev,
        depthM: clamped.depthM,
        clampedAt: clamped.clampedAt,
        clampReason: clamped.clampReason,
      }
    })
  }, [])

  /** Put the boundary down and ask for the split on whichever band now holds it. */
  const commitPlacement = useCallback((): void => {
    setPlacing(prev => {
      if (prev !== null && onRequestSplit) {
        const target = bandAtDepth(prev.column.bands, prev.depthM)
        if (target) onRequestSplit(target.layerId, prev.depthM)
      }
      return null
    })
  }, [onRequestSplit])

  if (!editable) return null

  const yAt = (column: ColumnModel, depthM: number): number =>
    column.surfaceY + depthM * column.pxPerMetre

  return (
    <g data-testid="geotech-band-edit-overlay">
      {columns.map(column => (
        <g key={`gbe-${column.investigationId}`}>
          {/* Per-band hit target — RIGHT-CLICK ONLY. It deliberately owns no mousedown:
              left-drag on this canvas pans the section, and a band-wide press target would
              either swallow that or fight it. */}
          {onRequestSplit !== undefined &&
            column.bands.map(band => {
              const y = yAt(column, band.topDepthM)
              const h = (band.baseDepthM - band.topDepthM) * column.pxPerMetre
              if (h <= 0) return null
              return (
                <rect
                  key={`gbe-band-${band.layerId}`}
                  data-testid={`geotech-band-hit-${band.layerId}`}
                  x={column.x0}
                  y={Math.max(y, plotTop)}
                  width={column.x1 - column.x0}
                  height={Math.max(0, Math.min(y + h, plotBottom) - Math.max(y, plotTop))}
                  fill="transparent"
                  pointerEvents="all"
                  onContextMenu={e => {
                    e.preventDefault()
                    e.stopPropagation()
                    const svg = e.currentTarget.ownerSVGElement
                    if (!svg) return
                    const svgTop = svg.getBoundingClientRect().top
                    const raw = depthAtClientY(
                      e.clientY,
                      svgTop,
                      column.surfaceY,
                      column.pxPerMetre,
                    )
                    // No litho body → no bounds, so no split may be placed here. Ruling 2
                    // has nothing to clamp against below the deepest litho layer.
                    const lithoBody = enclosingLithoBody(column.lithoBodies, raw)
                    if (lithoBody === null) return
                    const clamped = clampSplitDepth(lithoBody, raw)
                    // Remove-band = absorb into a neighbour, offered exactly where that
                    // merge is legal (the GS7 pattern: no affordance rather than a
                    // refusing item — a sole band in its body has nothing to absorb it).
                    const index = column.bands.findIndex(b => b.layerId === band.layerId)
                    const above = index > 0 ? column.bands[index - 1] : null
                    const below =
                      index >= 0 && index < column.bands.length - 1
                        ? column.bands[index + 1]
                        : null
                    const removeUp =
                      above !== null && canMergeBands(above, band, column.lithoBodies).ok
                        ? {
                            upperBandId: above.layerId,
                            lowerBandId: band.layerId,
                            boundaryDepthM: band.topDepthM,
                          }
                        : null
                    const removeDown =
                      below !== null && canMergeBands(band, below, column.lithoBodies).ok
                        ? {
                            upperBandId: band.layerId,
                            lowerBandId: below.layerId,
                            boundaryDepthM: band.baseDepthM,
                          }
                        : null
                    setMenu({
                      kind: 'split',
                      clientX: e.clientX,
                      clientY: e.clientY,
                      seed: {
                        svgTop,
                        column,
                        lithoBody,
                        depthM: clamped.depthM,
                        clampedAt: clamped.clampedAt,
                        clampReason: clamped.clampReason,
                      },
                      removeUp,
                      removeDown,
                    })
                  }}
                >
                  <title>
                    Right-click to place a new packing boundary or remove this band
                  </title>
                </rect>
              )
            })}

          {/* Per-boundary strip: right-click merges, left-press DRAGS (2026-08-07). Drawn
              only where a merge is legal, so a litho contact simply has no strip — and
              therefore no drag — rather than a gesture that refuses. */}
          {(onRequestMerge !== undefined || draggable) &&
            column.mergeable.map(pair => {
              const y = yAt(column, pair.upper.baseDepthM)
              if (y < plotTop || y > plotBottom) return null
              return (
                <rect
                  key={`gbe-boundary-${pair.upper.layerId}`}
                  data-testid={`geotech-band-boundary-${pair.upper.layerId}`}
                  x={column.x0}
                  y={y - MERGE_HANDLE_PX / 2}
                  width={column.x1 - column.x0}
                  height={MERGE_HANDLE_PX}
                  fill="transparent"
                  pointerEvents="all"
                  style={{ cursor: draggable ? 'ns-resize' : 'context-menu' }}
                  onMouseDown={
                    draggable
                      ? e => {
                          if (e.button !== 0) return
                          // The strip owns this press: without the stop, the canvas pan
                          // would start under the drag (the owner's pan-hand complaint).
                          e.preventDefault()
                          e.stopPropagation()
                          const svg = e.currentTarget.ownerSVGElement
                          if (!svg) return
                          setDrag({
                            svgTop: svg.getBoundingClientRect().top,
                            column,
                            upper: pair.upper,
                            lower: pair.lower,
                            preDragDepthM: pair.upper.baseDepthM,
                            depthM: pair.upper.baseDepthM,
                            atLimit: 'none',
                            absorb: null,
                          })
                        }
                      : undefined
                  }
                  onContextMenu={e => {
                    e.preventDefault()
                    e.stopPropagation()
                    setMenu({
                      kind: 'merge',
                      clientX: e.clientX,
                      clientY: e.clientY,
                      upperBandId: pair.upper.layerId,
                      lowerBandId: pair.lower.layerId,
                      boundaryDepthM: pair.upper.baseDepthM,
                    })
                  }}
                >
                  <title>
                    {draggable
                      ? 'Drag to move this packing boundary · right-click to merge the bands'
                      : 'Right-click to merge these two packing bands'}
                  </title>
                </rect>
              )
            })}
        </g>
      ))}

      {/* While a placement is armed this rect owns the canvas: it follows the cursor, and
          it swallows the mousedown so the click that puts the boundary down does not also
          start a section pan. Outside a placement it does not exist, so panning, column
          right-click and every other gesture behave exactly as before. */}
      {placing !== null && (
        <>
          <rect
            data-testid="geotech-split-capture"
            x={0}
            y={plotTop}
            width={CAPTURE_WIDTH_PX}
            height={plotBottom - plotTop}
            fill="transparent"
            pointerEvents="all"
            style={{ cursor: 'ns-resize' }}
            onMouseMove={e => trackPlacement(e.clientY)}
            onMouseDown={e => e.stopPropagation()}
            onClick={e => {
              e.stopPropagation()
              commitPlacement()
            }}
            onContextMenu={e => {
              e.preventDefault()
              e.stopPropagation()
              setPlacing(null)
            }}
          />
          {/* The live boundary. It stops at the litho contact; the readout says so. */}
          <g pointerEvents="none">
            <line
              data-testid="geotech-split-preview-line"
              x1={placing.column.x0 - 6}
              x2={placing.column.x1 + 6}
              y1={yAt(placing.column, placing.depthM)}
              y2={yAt(placing.column, placing.depthM)}
              stroke={placing.clampedAt === 'none' ? '#0f172a' : '#b45309'}
              strokeWidth={1.5}
              strokeDasharray="4 3"
            />
            <text
              data-testid="geotech-split-depth-readout"
              x={placing.column.x1 + 10}
              y={yAt(placing.column, placing.depthM) + 12}
              fontSize={10}
              fill="#0f172a"
            >
              {`${placing.depthM.toFixed(2)} m — click to place, Esc to cancel`}
            </text>
            {placing.clampReason !== null && (
              <text
                data-testid="geotech-split-clamp-readout"
                x={placing.column.x1 + 10}
                y={yAt(placing.column, placing.depthM) - 5}
                fontSize={10}
                fill="#b45309"
              >
                {placing.clampReason}
              </text>
            )}
          </g>
        </>
      )}

      {/* The live DRAG boundary: dark while free, amber at a pair limit, plus a hatched
          hint over the band the release would absorb. Purely visual — the window
          listeners own the gesture. */}
      {drag !== null && (
        <g pointerEvents="none">
          <line
            data-testid="geotech-drag-preview-line"
            x1={drag.column.x0 - 6}
            x2={drag.column.x1 + 6}
            y1={yAt(drag.column, drag.depthM)}
            y2={yAt(drag.column, drag.depthM)}
            stroke={drag.atLimit === 'none' ? '#0f172a' : '#b45309'}
            strokeWidth={1.5}
            strokeDasharray="4 3"
          />
          {drag.absorb !== null &&
            (() => {
              const victim = drag.absorb === 'upper' ? drag.upper : drag.lower
              const remainTop =
                drag.absorb === 'upper' ? yAt(drag.column, victim.topDepthM) : yAt(drag.column, drag.depthM)
              const remainBase =
                drag.absorb === 'upper' ? yAt(drag.column, drag.depthM) : yAt(drag.column, victim.baseDepthM)
              return (
                <rect
                  data-testid="geotech-drag-absorb-hint"
                  x={drag.column.x0}
                  y={Math.min(remainTop, remainBase)}
                  width={drag.column.x1 - drag.column.x0}
                  height={Math.abs(remainBase - remainTop)}
                  fill="#b45309"
                  fillOpacity={0.25}
                />
              )
            })()}
          <text
            data-testid="geotech-drag-depth-readout"
            x={drag.column.x1 + 10}
            y={yAt(drag.column, drag.depthM) + 12}
            fontSize={10}
            fill="#0f172a"
          >
            {drag.absorb !== null
              ? `release to merge into the band ${drag.absorb === 'upper' ? 'below' : 'above'} — class re-derived over the union`
              : `${drag.depthM.toFixed(2)} m — release to move, Esc to cancel`}
          </text>
        </g>
      )}

      {menu !== null &&
        createPortal(
          <>
            <div
              style={{ position: 'fixed', inset: 0, zIndex: 2147483646 }}
              onClick={() => setMenu(null)}
              onContextMenu={e => {
                e.preventDefault()
                setMenu(null)
              }}
            />
            <div
              data-testid="geotech-band-edit-menu"
              style={{
                position: 'fixed',
                left: menu.clientX,
                top: menu.clientY,
                zIndex: 2147483647,
                background: 'var(--color-surface-overlay, #1e293b)',
                border: '1px solid var(--color-border-default, #334155)',
                borderRadius: 6,
                boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
                minWidth: 200,
              }}
            >
              {menu.kind === 'split' ? (
                <>
                  <button
                    type="button"
                    data-testid="geotech-band-menu-split"
                    onClick={() => {
                      // Arms the placement rather than committing it — the boundary now
                      // follows the cursor so the litho wall is visible before anything is
                      // written. Nothing has been asked of the server at this point.
                      setPlacing(menu.seed)
                      setMenu(null)
                    }}
                    style={MENU_ITEM_STYLE}
                  >
                    Split band…
                  </button>
                  {menu.removeUp !== null && (
                    <button
                      type="button"
                      data-testid="geotech-band-menu-remove-up"
                      onClick={() => {
                        const seed = menu.removeUp!
                        onRequestMerge?.(seed.upperBandId, seed.lowerBandId, seed.boundaryDepthM)
                        setMenu(null)
                      }}
                      style={MENU_ITEM_STYLE}
                    >
                      Remove band (merge into band above)
                    </button>
                  )}
                  {menu.removeDown !== null && (
                    <button
                      type="button"
                      data-testid="geotech-band-menu-remove-down"
                      onClick={() => {
                        const seed = menu.removeDown!
                        onRequestMerge?.(seed.upperBandId, seed.lowerBandId, seed.boundaryDepthM)
                        setMenu(null)
                      }}
                      style={MENU_ITEM_STYLE}
                    >
                      Remove band (merge into band below)
                    </button>
                  )}
                </>
              ) : (
                <button
                  type="button"
                  data-testid="geotech-band-menu-merge"
                  onClick={() => {
                    onRequestMerge?.(menu.upperBandId, menu.lowerBandId, menu.boundaryDepthM)
                    setMenu(null)
                  }}
                  style={MENU_ITEM_STYLE}
                >
                  Merge bands
                </button>
              )}
            </div>
          </>,
          document.body,
        )}
    </g>
  )
}

/** Shared inline style for the menu items — matches the litho band menu's. */
const MENU_ITEM_STYLE: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '6px 12px',
  textAlign: 'left',
  fontSize: 12,
  color: 'var(--color-text-primary, #e2e8f0)',
  background: 'none',
  border: 'none',
  cursor: 'pointer',
}
