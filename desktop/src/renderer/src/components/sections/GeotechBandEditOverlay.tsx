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
 * committed rows and every edit is a server round-trip. A thin band of one class enclosed
 * by same-class hosts additionally gets a passive amber badge + a "Merge into surrounding
 * band" menu item — the assisted-manual suggestion (detection in
 * ``geotechLensSuggestion.ts``), committed as ONE merge over the host·lens·host run.
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
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import {
  type EnclosedLens,
  enclosedLensAt,
  findSmallEnclosedLenses,
} from './geotechLensSuggestion'
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
   * Ask to absorb an enclosed lens into its two same-class hosts — ONE merge over the
   * ``[upperHost, lens, lowerHost]`` run. The two boundary depths are the lens's top and
   * base today (the undo anchors). Absent → the lens suggestion does not exist.
   */
  onRequestAbsorbLens?: (
    upperHostId: string,
    lensId: string,
    lowerHostId: string,
    upperBoundaryDepthM: number,
    lowerBoundaryDepthM: number,
  ) => void
  /**
   * Geotech formation id → NAD class (``refinement.nadMeta`` flattened). The lens
   * suggestion needs it to see host classes; absent → no badge, no menu item.
   */
  nadClassByFormationId?: ReadonlyMap<string, number | null>
  /**
   * The model's "thinnest packing band kept" preference — the badge's size gate. The
   * MENU offers the absorb on any enclosed lens regardless (the enclosure is real either
   * way); only the unprompted badge is reserved for bands the model itself calls thin.
   */
  smallLensThicknessM?: number
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
  /**
   * The internal boundaries {@link ColumnModel.mergeable} REJECTED — litho contacts,
   * where the two bands sit in different litho bodies. They own no gesture on this axis;
   * they are here so the overlay can SAY so (the hover padlock) and so a neighbouring
   * strip knows to stop short of one.
   */
  lithoContacts: { upper: GeotechBandInterval; lower: GeotechBandInterval }[]
  /**
   * Screen-space strip extents, one per {@link ColumnModel.mergeable} entry and in the
   * same order, allocated so neighbours never overlap.
   */
  stripExtents: { top: number; bottom: number }[]
  /** Thin enclosed class lenses — the bands that get the unprompted badge. */
  smallLenses: EnclosedLens[]
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
      /** The enclosure, when the clicked band IS an enclosed class lens. */
      absorbLens: EnclosedLens | null
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
  onRequestAbsorbLens,
  nadClassByFormationId,
  smallLensThicknessM,
  suspended = false,
}: Props): JSX.Element | null {
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [placing, setPlacing] = useState<SplitPlacement | null>(null)
  const [drag, setDrag] = useState<BoundaryDrag | null>(null)
  // Which litho contact is under the cursor. HOVER-only, never at rest: one
  // interbedded column here carries 14 litho contacts, and 14 padlocks stacked
  // down it would be noise the engineer learns to stop reading.
  const [hoveredContactId, setHoveredContactId] = useState<string | null>(null)
  // The drag mirrored in a ref. The window handlers need the LIVE gesture, and
  // reading it from a ref keeps every state updater pure: React re-runs
  // updaters (StrictMode does it twice, deliberately), so a preview call made
  // from inside one is made once per invocation, not once per release.
  const dragRef = useRef<BoundaryDrag | null>(null)
  const applyDrag = useCallback((next: BoundaryDrag | null): void => {
    dragRef.current = next
    setDrag(next)
  }, [])

  const editable =
    !suspended &&
    (onRequestSplit !== undefined ||
      onRequestMerge !== undefined ||
      onRequestMoveBoundary !== undefined ||
      onRequestAbsorbLens !== undefined)
  const draggable = !suspended && onRequestMoveBoundary !== undefined
  // The suggestion needs all three legs: someone to tell, classes to compare,
  // and a size the model itself calls thin. Missing any → the badge never lies.
  const lensAware = onRequestAbsorbLens !== undefined && nadClassByFormationId !== undefined

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
      const lithoContacts: { upper: GeotechBandInterval; lower: GeotechBandInterval }[] = []
      // Every internal boundary's screen Y, in the bands' own top-down order, and which
      // of them a strip is drawn on. Both kinds are collected because both COMPETE for
      // pixels even though only one is grabbable — see the clamp below.
      const internalYs: number[] = []
      const mergeableIndices: number[] = []
      for (let i = 0; i < bands.length - 1; i++) {
        const pair = { upper: bands[i], lower: bands[i + 1] }
        internalYs.push(surface.surfaceY + pair.upper.baseDepthM * surface.pxPerMetre)
        if (canMergeBands(bands[i], bands[i + 1], lithoBodies).ok) {
          mergeableIndices.push(i)
          mergeable.push(pair)
        } else {
          lithoContacts.push(pair)
        }
      }
      // Each strip wants MERGE_HANDLE_PX centred on its boundary, but two boundaries
      // closer than that on screen would hand every press to whichever strip SVG paints
      // last — the deeper one, since these are emitted top-down — and the engineer would
      // aim at one boundary and drag the other. At the default 60 m window (~13 px/m)
      // that is any band under ~0.75 m, well above the 0.35 m the model itself keeps, so
      // it is the common case rather than an edge one. Each strip therefore stops at the
      // MIDPOINT to its neighbour: the nearest boundary wins the press, which is the only
      // split of contested pixels that cannot be wrong. The far side keeps its full half
      // whenever there is room, so a strip squeezed on one side is only squeezed there.
      //
      // NOT ``allocateMinHitExpansions`` (the litho axis's #158 answer): that allocator
      // only GROWS a thin band into a fat neighbour's slack, i.e. it deliberately overlaps
      // strips and leans on render order to resolve them. Here overlap IS the defect.
      //
      // Litho contacts join the reckoning as BOUNDING PARTICIPANTS: they claim no strip
      // (nothing on this axis edits one), they only stop their neighbours. Without that a
      // packing boundary a few px from a contact keeps its full half and lies across it —
      // ~0.38 m of overhang at the default ~13 px/m — so a press aimed at the contact
      // lands on the packing boundary. That is the same collision as above, between the
      // two kinds instead of within one, and it is now real: the contact carries hover
      // chrome of its own, and a later step makes it draggable.
      const stripExtents = mergeableIndices.map(idx => {
        const y = internalYs[idx]
        // The stack's outer edges are open: nothing above the first boundary or below the
        // last competes for the press, so those halves are never contested.
        const toPrev = idx > 0 ? (y - internalYs[idx - 1]) / 2 : Infinity
        const toNext = idx + 1 < internalYs.length ? (internalYs[idx + 1] - y) / 2 : Infinity
        return {
          top: y - Math.min(MERGE_HANDLE_PX / 2, toPrev),
          bottom: y + Math.min(MERGE_HANDLE_PX / 2, toNext),
        }
      })
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
        lithoContacts,
        stripExtents,
        smallLenses:
          lensAware && nadClassByFormationId !== undefined && smallLensThicknessM !== undefined
            ? findSmallEnclosedLenses(bands, lithoBodies, nadClassByFormationId, smallLensThicknessM)
            : [],
      })
    }
    return out
  }, [
    editable,
    placedColumns,
    levelToScreen,
    geotechLayers,
    lithoLayers,
    lensAware,
    nadClassByFormationId,
    smallLensThicknessM,
  ])

  // The menu closes the ways a menu is expected to close. Mirrored from
  // ``ContactsLayer``'s litho band menu, wheel handler included: a menu is
  // positioned in FIXED viewport coordinates, so scrolling or zooming the
  // section slides the content out from under it and strands it over unrelated
  // bands — the owner already reported that shape once ("sometimes i get this
  // random add new suggestion here box when zooming or so"). Escape is the
  // baseline every CAD tool trains.
  useEffect(() => {
    if (menu === null) return
    const dismiss = (): void => setMenu(null)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') dismiss()
    }
    document.addEventListener('wheel', dismiss, { capture: true })
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('wheel', dismiss, { capture: true })
      document.removeEventListener('keydown', onKey)
    }
  }, [menu])

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
      const prev = dragRef.current
      if (prev === null) return
      if (e.buttons === 0) {
        applyDrag(null) // released outside the window
        return
      }
      const raw = depthAtClientY(e.clientY, prev.svgTop, prev.column.surfaceY, prev.column.pxPerMetre)
      const clamped = clampDragDepth(prev.upper, prev.lower, raw)
      const absorb = dragAbsorbPrediction(prev.upper, prev.lower, clamped.depthM)
      applyDrag({
        ...prev,
        depthM: clamped.depthM,
        atLimit: clamped.atLimit,
        absorb: absorb?.side ?? null,
      })
    }
    function onUp(): void {
      const prev = dragRef.current
      applyDrag(null)
      if (prev === null) return
      if (Math.abs(prev.depthM - prev.preDragDepthM) <= 1e-6) return
      if (prev.absorb !== null) {
        // The squeeze collapsed a band: the honest verb is the MERGE of the
        // pair, previewed and committed by the shipped endpoints.
        onRequestMerge?.(prev.upper.layerId, prev.lower.layerId, prev.preDragDepthM)
        return
      }
      onRequestMoveBoundary?.(
        prev.upper.layerId,
        prev.lower.layerId,
        prev.depthM,
        prev.preDragDepthM,
      )
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') applyDrag(null)
    }
    function onBlur(): void {
      applyDrag(null)
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
  }, [drag, applyDrag, onRequestMerge, onRequestMoveBoundary])

  // Correlate mode taking the canvas mid-drag abandons the drag, exactly as the hit
  // targets vanish: a gesture whose surface disappeared must not commit on release.
  useEffect(() => {
    if (suspended) {
      applyDrag(null)
      setPlacing(null)
      setMenu(null)
    }
  }, [suspended, applyDrag])

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
                    // The enclosure is named on ANY enclosed lens (no size gate
                    // here — the badge alone is reserved for thin ones): the
                    // engineer right-clicked the band, so the menu answers for it.
                    const absorbLens =
                      lensAware && nadClassByFormationId !== undefined && index >= 0
                        ? enclosedLensAt(column.bands, index, column.lithoBodies, nadClassByFormationId)
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
                      absorbLens,
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
            column.mergeable.map((pair, i) => {
              const extent = column.stripExtents[i]
              const y = yAt(column, pair.upper.baseDepthM)
              if (y < plotTop || y > plotBottom) return null
              return (
                <Fragment key={`gbe-boundary-${pair.upper.layerId}`}>
                  <rect
                    data-testid={`geotech-band-boundary-${pair.upper.layerId}`}
                    x={column.x0}
                    y={extent.top}
                    width={column.x1 - column.x0}
                    height={Math.max(0, extent.bottom - extent.top)}
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
                            applyDrag({
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
                  {/* The grip: what makes THIS boundary legible as the draggable kind at
                      rest. The owner reported "sometimes after merging, i can't grab the
                      contact handles anymore" — on his data one column carries 17 internal
                      boundaries of which 3 are packing boundaries and 14 are litho contacts,
                      which correctly refuse the drag. Drawn identically, a refusal reads as
                      a broken gesture, so the two kinds have to differ before being touched.

                      Beside the column, never on the line: anything drawn on the
                      boundary becomes another press target, and Task 1 exists
                      precisely because that surface is already crowded. */}
                  <g pointerEvents="none" data-testid={`geotech-boundary-grip-${pair.upper.layerId}`}>
                    <circle cx={column.x1 + 7} cy={y - 2} r={1} fill="var(--section-edit-line, #0f172a)" />
                    <circle cx={column.x1 + 7} cy={y + 2} r={1} fill="var(--section-edit-line, #0f172a)" />
                    <circle cx={column.x1 + 11} cy={y - 2} r={1} fill="var(--section-edit-line, #0f172a)" />
                    <circle cx={column.x1 + 11} cy={y + 2} r={1} fill="var(--section-edit-line, #0f172a)" />
                  </g>
                  </Fragment>
              )
            })}

          {/* The other half of the answer: a litho contact is not draggable HERE, and the
              padlock says which of the two kinds it is. Hover-only — a column of
              interbeds carries a dozen of these, and a dozen padlocks at rest is chrome
              the engineer stops reading. The mark is the ONLY thing offered: the contact
              is edited on the litho axis, not by arguing with this one. */}
          {column.lithoContacts.map(pair => {
            const y = yAt(column, pair.upper.baseDepthM)
            if (y < plotTop || y > plotBottom) return null
            return (
              <text
                key={`gbe-lock-${pair.upper.layerId}`}
                data-testid={`geotech-contact-marker-${pair.upper.layerId}`}
                // Clear of BOTH marks that already claim space beside the column: the
                // grip lane (x1+6 .. x1+12) and the lens badge (x1+4 .. x1+16). A
                // packing boundary can sit a few px from a contact — that is the whole
                // point of the strip clamp above — so the grip and the padlock land at
                // nearly the same height routinely, and two marks whose job is to
                // DIFFER must not be drawn on top of each other.
                x={column.x1 + 18}
                y={y + 4}
                fontSize={9}
                opacity={hoveredContactId === pair.upper.layerId ? 1 : 0}
                onMouseEnter={() => setHoveredContactId(pair.upper.layerId)}
                onMouseLeave={() => setHoveredContactId(null)}
              >
                {/* Not a refusal — a redirect. The contact IS editable, on the axis that
                    owns it, and that is the sentence worth spending a tooltip on. */}
                <title>Lithostratigraphic contact — edit it on the litho axis</title>
                🔒
              </text>
            )
          })}

          {/* The lens suggestion badge — PASSIVE. ``pointerEvents: none`` because a badge
              that swallowed a press would re-break panning (GS11); the verb lives in the
              band's right-click menu, this only points at the candidates. Amber, the
              project's suggestion colour. */}
          {column.smallLenses.map(lens => {
            const midY = yAt(column, (lens.lens.topDepthM + lens.lens.baseDepthM) / 2)
            if (midY < plotTop || midY > plotBottom) return null
            return (
              <g
                key={`gbe-lens-${lens.lens.layerId}`}
                data-testid={`geotech-lens-badge-${lens.lens.layerId}`}
                pointerEvents="none"
              >
                {/* The ring is not decoration: amber-500 alone is ~2.1:1 on the
                    LIGHT plot background, under the 3:1 floor for a graphical
                    object that carries meaning. */}
                <circle
                  cx={column.x1 + 10}
                  cy={midY}
                  r={6}
                  fill="var(--section-edit-suggest, #f59e0b)"
                  fillOpacity={0.9}
                  stroke="var(--section-edit-suggest-ring, #b45309)"
                  strokeWidth={1}
                />
                {/* Two chevrons collapsing inward — "this band can fold into its hosts". */}
                <path
                  d={`M ${column.x1 + 7} ${midY - 3.5} L ${column.x1 + 10} ${midY - 1} L ${column.x1 + 13} ${midY - 3.5}`}
                  stroke="#ffffff"
                  strokeWidth={1.2}
                  fill="none"
                />
                <path
                  d={`M ${column.x1 + 7} ${midY + 3.5} L ${column.x1 + 10} ${midY + 1} L ${column.x1 + 13} ${midY + 3.5}`}
                  stroke="#ffffff"
                  strokeWidth={1.2}
                  fill="none"
                />
              </g>
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
              stroke={
                placing.clampedAt === 'none'
                  ? 'var(--section-edit-line, #0f172a)'
                  : 'var(--section-edit-warn, #b45309)'
              }
              strokeWidth={1.5}
              strokeDasharray="4 3"
            />
            <text
              data-testid="geotech-split-depth-readout"
              x={placing.column.x1 + 10}
              y={yAt(placing.column, placing.depthM) + 12}
              fontSize={10}
              fill="var(--section-edit-text, #0f172a)"
            >
              {`${placing.depthM.toFixed(2)} m — click to place, Esc to cancel`}
            </text>
            {placing.clampReason !== null && (
              <text
                data-testid="geotech-split-clamp-readout"
                x={placing.column.x1 + 10}
                y={yAt(placing.column, placing.depthM) - 5}
                fontSize={10}
                fill="var(--section-edit-warn, #b45309)"
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
            stroke={
              drag.atLimit === 'none'
                ? 'var(--section-edit-line, #0f172a)'
                : 'var(--section-edit-warn, #b45309)'
            }
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
                  fill="var(--section-edit-warn, #b45309)"
                  fillOpacity={0.25}
                />
              )
            })()}
          <text
            data-testid="geotech-drag-depth-readout"
            x={drag.column.x1 + 10}
            y={yAt(drag.column, drag.depthM) + 12}
            fontSize={10}
            fill="var(--section-edit-text, #0f172a)"
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
                  {menu.absorbLens !== null && (
                    <button
                      type="button"
                      data-testid="geotech-band-menu-absorb-lens"
                      onClick={() => {
                        const lens = menu.absorbLens!
                        onRequestAbsorbLens?.(
                          lens.upperHost.layerId,
                          lens.lens.layerId,
                          lens.lowerHost.layerId,
                          lens.lens.topDepthM,
                          lens.lens.baseDepthM,
                        )
                        setMenu(null)
                      }}
                      style={MENU_ITEM_STYLE}
                    >
                      Merge into surrounding band
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
