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
import {
  nadClassIsForeignToSoil,
  nadClassesForSoil,
  nadCompactLabel,
  nadSoilFamilyName,
} from '../../utils/nadClasses'
import { MENU_ITEM_STYLE, UnitStatisticsItem } from './unitStatisticsMenuItem'
import type { PlacedColumn } from './utils'
import { useT } from '../../i18n/translate'
import { resolveJoinPick, type JoinPick } from './joinPick'
import type { BodyDisjoinOption } from './BodyContextMenu'

/** Height in px of the strip that sits on a shared band boundary (drag + right-click). */
const MERGE_HANDLE_PX = 10

/**
 * How far in px the per-band press target stops short of its own top and bottom edges.
 *
 * The band rect is the LAST thing painted over those edges — this overlay is a sibling of
 * ``ContactsLayer`` and mounts after it (``SectionPanel.tsx``) — so whatever it covers, it
 * wins. Covering its own boundaries made it win the litho contact lines, where it owns no
 * mousedown at all: the press bubbled to the canvas and started a PAN, and the contact drag
 * built for this axis could never begin. Task 1 solved the same collision between two grab
 * strips by clamping each to the midpoint of the gap; this is that fix one layer out.
 *
 * Sized against the strip it has to clear, not chosen for looks: ``ContactsLayer`` grabs a
 * contact within ``DRAG_HIT_HALF_HEIGHT_PX`` = 5 px either side of the line, so 5 is the
 * floor — below it part of the strip stays covered and the press still lands wrong. 6 buys
 * one px of slack so the strip's outermost row falls through too, rather than sharing an
 * edge with the band rect where the later-painted one wins.
 *
 * A band under ``2 × BAND_HIT_INSET_PX`` tall gets NO press target (see the render). That
 * is not a loss: every pixel of such a band is already inside one of the two grab strips on
 * its own boundaries, so a rect there could only take presses aimed at them.
 */
export const BAND_HIT_INSET_PX = 6

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
   * Geotech formation id → the ``litho_main_soil_code`` of the litho unit it
   * subdivides (``refinement.nadMeta`` flattened on its other field).
   *
   * This is what the class menu is built from, never the band's current class:
   * a packing class describes one soil column, so the GROUND says which classes
   * exist here (owner ruling 2026-08-26, *"the nad coupling is absolute"*).
   * Absent, or a soil the norm table does not know → no menu, because there is
   * no family to offer and guessing one is the failure being fixed.
   */
  soilCodeByFormationId?: ReadonlyMap<string, string | null>
  /**
   * Set a BOREHOLE band's NAD class by hand (owner ask 2026-08-18). Offered on
   * borehole bands ONLY — a CPT band's class is measured from its own qc, and
   * the server refuses it there. Absent → borehole bands stay view-only.
   *
   * ``previousClass`` is ``null`` for a band nothing had classified yet — the
   * state the soil-family clamp produces wherever the only evidence belonged to
   * another soil, and precisely the state an engineer reaches for this verb to
   * settle.
   */
  onRequestSetClass?: (bandId: string, nadClass: number, previousClass: number | null) => void
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
  /**
   * Jump to the Parameters stage scoped to the right-clicked band's UNIT (owner
   * ballot 2026-08-26). Absent → the menu item is not offered at all, the GS7
   * no-affordance pattern the rest of this menu follows.
   *
   * Reports the band's ``formationId``, never its ``layerId``: the statistics
   * are a property of the unit, pooled over every band of it in the project,
   * not of the one band under the cursor. The second argument is the band's
   * resolver ``body_id`` (owner ruling 2026-08-27: a jump that knows which
   * body was clicked must report it), ``null`` when unstamped.
   *
   * NOTE: an unclassified (skeleton) borehole band has no right-click target on
   * this overlay at all — the borehole menu is built only where a NAD class
   * exists to re-pick — so the jump is unavailable there by inheritance. Those
   * units are reached from the per-unit table on the Parameters stage instead.
   */
  onShowUnitStatistics?: (unitId: string, bodyId?: string | null) => void
  // --- Body Join / Ontkoppelen on a COLUMN (owner ruling 2026-09-01 "Both") ----
  // The owner wanted to start AND complete a Join from a borehole/CPT column, not
  // only in the between-column fill. These mirror the fill overlay's join wiring.
  /**
   * The active Join arm, or null. When set, a LEFT-click on a band resolves the
   * band's body through its layer and fires {@link onJoinPick} — so the second
   * click of a Join lands on a column just as it does on the fill. Byte-identical
   * when null / unwired.
   */
  joinArm?: { bodyId: string; anchorLayerId: string } | null
  /** Fired on an armed band left-click with the classified Join outcome. */
  onJoinPick?: (pick: JoinPick) => void
  /** ``litho_layer id → body_id`` for the armed pick's body resolution. */
  bodyIdByLayerId?: ReadonlyMap<string, string | null>
  /** ``litho_layer id → packing-class label`` for the Join cross-class guard. */
  classByLayerId?: ReadonlyMap<string, string>
  /**
   * ARM a Join FROM the right-clicked band's body (the "Voeg samen met…" band-menu
   * item). Reports the band's body, the band's own layer (a valid anchor, since it
   * is stamped to that body) and the band's formation (for the hint label). Absent
   * → the item is not offered.
   */
  onArmJoinBody?: (bodyId: string, anchorLayerId: string, formationId: string) => void
  /**
   * The standing groups (unions) touching a body, for the band menu's "Ontkoppelen"
   * items. Absent → no un-join items. Built by the caller (buildDisjoinOptions).
   */
  unjoinOptionsForBody?: (bodyId: string) => readonly BodyDisjoinOption[]
  /** Lift a standing group (the "Ontkoppelen" band-menu item). */
  onUnjoinBody?: (unionId: string) => void
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
   * where the two bands sit in different litho bodies.
   *
   * They own no gesture in THIS overlay: no strip, no grip, no menu. Since 2026-08-08
   * they are draggable on this axis all the same, through ContactsLayer's hit strip
   * beneath us (SectionsCanvas → ``handleGeotechContactDrag``), and that drag moves the
   * litho row rather than a packing band. They are collected here so the overlay can say
   * WHICH kind a boundary is (the hover padlock) and so a neighbouring strip knows to
   * stop short of one.
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
      /** The clicked band's geotech unit — what the statistics jump is scoped to. */
      unitId: string
      /** The clicked band's resolver body (owner ruling 2026-08-27); null when unstamped. */
      unitBodyId: string | null
      /** The clicked band's own layer id — the Join anchor when arming from a column. */
      bandLayerId: string
    }
  | { kind: 'merge'; clientX: number; clientY: number; upperBandId: string; lowerBandId: string; boundaryDepthM: number }
  | {
      kind: 'setClass'
      clientX: number
      clientY: number
      bandId: string
      /**
       * The band's class today — the undo anchor the handler carries. ``null``
       * for a band nothing has classified yet, which the soil-family clamp
       * makes a normal state rather than a rarity.
       */
      currentClass: number | null
      /** The band's OWN soil family's classes — the only legal hand choices. */
      family: readonly number[]
      /**
       * The band's current class when it belongs to another soil family — a
       * legacy row written before the coupling was enforced. Listed alongside
       * the family so the engineer can SEE the state; never selectable, because
       * choosing it would restate the thing that is wrong.
       */
      foreignClass: number | null
      /** The clicked band's geotech unit — what the statistics jump is scoped to. */
      unitId: string
      /** The clicked band's resolver body (owner ruling 2026-08-27); null when unstamped. */
      unitBodyId: string | null
    }

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
  soilCodeByFormationId,
  onRequestSetClass,
  smallLensThicknessM,
  suspended = false,
  onShowUnitStatistics,
  joinArm,
  onJoinPick,
  bodyIdByLayerId,
  classByLayerId,
  onArmJoinBody,
  unjoinOptionsForBody,
  onUnjoinBody,
}: Props): JSX.Element | null {
  const t = useT()
  // The armed-Join left-click is live only when the arm + its resolution inputs
  // are all present, and never while another gesture owns the canvas.
  const joinArmActive =
    joinArm != null && onJoinPick !== undefined && bodyIdByLayerId !== undefined && !suspended
  // Resolve the clicked band's body through its own layer and report the Join
  // outcome up — the same resolution the fill overlay runs, so a column click is
  // the exact equivalent of a between-column click (owner: "Both").
  const fireJoinPickForBand = useCallback(
    (bandLayerId: string): void => {
      if (joinArm == null || onJoinPick === undefined || bodyIdByLayerId === undefined) return
      onJoinPick(
        resolveJoinPick(joinArm, [bandLayerId], bodyIdByLayerId, classByLayerId ?? new Map()),
      )
    },
    [joinArm, onJoinPick, bodyIdByLayerId, classByLayerId],
  )

  // The body verbs shared by both band menus (split + setClass): "Voeg samen
  // met…" (ARM a Join from this band's body) + one "Ontkoppelen" per standing
  // group. Offered only when the body is resolvable AND the handler is wired
  // (the GS7 no-affordance rule the rest of these menus follow). ``anchorLayerId``
  // is the clicked band's own layer — a valid Join anchor since it is stamped to
  // ``bodyId``. Returns null (no rows) when nothing is offerable.
  const renderBodyVerbs = (
    bodyId: string | null,
    anchorLayerId: string,
    formationId: string,
  ): JSX.Element | null => {
    if (bodyId === null) return null
    const unjoinOptions = onUnjoinBody !== undefined ? (unjoinOptionsForBody?.(bodyId) ?? []) : []
    if (onArmJoinBody === undefined && unjoinOptions.length === 0) return null
    return (
      <>
        {onArmJoinBody !== undefined && (
          <button
            type="button"
            data-testid="geotech-band-menu-join"
            onClick={() => {
              onArmJoinBody(bodyId, anchorLayerId, formationId)
              setMenu(null)
            }}
            style={{ ...MENU_ITEM_STYLE, borderTop: '1px solid var(--color-border-default, #334155)' }}
          >
            {t('sections.menu.joinBody')}
          </button>
        )}
        {unjoinOptions.map(opt => (
          <button
            key={`gbe-unjoin-${opt.unionId}`}
            type="button"
            data-testid={`geotech-band-menu-unjoin-${opt.unionId}`}
            onClick={() => {
              onUnjoinBody?.(opt.unionId)
              setMenu(null)
            }}
            style={MENU_ITEM_STYLE}
          >
            {t('sections.menu.unjoinBody', { label: opt.label })}
          </button>
        ))}
      </>
    )
  }
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

  /**
   * Borehole columns — the ones the editable model above SKIPS. Their one verb
   * is "Set NAD class" (owner ask 2026-08-18): the class is donor-extrapolated
   * there, so the engineer's judgement outranks it. No strips, no split, no
   * drag — geometry on a borehole column stays exactly as view-only as before.
   */
  const boreholeColumns = useMemo(() => {
    // The soil map is what the verb now depends on — the menu is built from the
    // band's ground, so without it there is no family to offer. The class map
    // only supplies the undo anchor, and a band that carries no class is a
    // normal state the clamp produces, so its absence is never a reason to
    // withhold the verb.
    if (suspended || onRequestSetClass === undefined || soilCodeByFormationId === undefined)
      return []
    const out: {
      investigationId: string
      x0: number
      x1: number
      surfaceY: number
      pxPerMetre: number
      bands: GeotechBandInterval[]
    }[] = []
    for (const col of placedColumns) {
      const item = col.proj.item as { id: string }
      const surface = surfaceYForColumn(col, levelToScreen)
      if (surface.surfaceElevationM === null || surface.pxPerMetre === 0) continue
      const bands = columnBands(geotechLayers, item.id)
      if (bands.length === 0 || bands.some(band => band.anchorIsCpt)) continue
      const half = col.width / 2
      out.push({
        investigationId: item.id,
        x0: col.nudgedX - half,
        x1: col.nudgedX + half,
        surfaceY: surface.surfaceY,
        pxPerMetre: surface.pxPerMetre,
        bands,
      })
    }
    return out
  }, [
    suspended,
    onRequestSetClass,
    soilCodeByFormationId,
    placedColumns,
    levelToScreen,
    geotechLayers,
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

  // Escape abandons a placement, matching every other armed mode in the section
  // editor — and so does the WHEEL, for the same reason the menu dismisses on it
  // (audit F26): the placement freezes svgTop / surfaceY / pxPerMetre at arm
  // time, so a zoom or scroll re-draws the bands under a preview line that is
  // still converting through the old geometry, and the committed split would
  // land at a depth visibly different from where the cursor points. Cheaper and
  // more honest than re-deriving the frozen geometry per frame: the engineer
  // re-arms with one right-click.
  useEffect(() => {
    if (placing === null) return
    const dismiss = (): void => setPlacing(null)
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') dismiss()
    }
    document.addEventListener('wheel', dismiss, { capture: true })
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('wheel', dismiss, { capture: true })
      window.removeEventListener('keydown', onKey)
    }
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

  if (!editable && boreholeColumns.length === 0) return null

  const yAt = (column: ColumnModel, depthM: number): number =>
    column.surfaceY + depthM * column.pxPerMetre

  return (
    <g data-testid="geotech-band-edit-overlay">
      {/* Borehole bands: right-click → "Set NAD class" (their ONE verb). */}
      {boreholeColumns.map(column => (
        <g key={`gbe-bh-${column.investigationId}`}>
          {column.bands.map(band => {
            const currentClass = nadClassByFormationId?.get(band.formationId) ?? null
            // The GROUND decides what this band may be, not the class it
            // happens to carry (owner ruling 2026-08-26: "the nad coupling is
            // absolute"). Keying off the class made a band stamped with a
            // foreign one offer only more of that wrong family — the one state
            // that needs correcting was the one the UI could not correct. It
            // also left every unclassified band with no menu at all, which the
            // clamp turned from a rarity into a normal state.
            const soilCode = soilCodeByFormationId?.get(band.formationId) ?? null
            const family = nadClassesForSoil(soilCode)
            if (family.length === 0) return null
            const foreignClass = nadClassIsForeignToSoil(currentClass, soilCode)
              ? currentClass
              : null
            const top = Math.max(plotTop, column.surfaceY + band.topDepthM * column.pxPerMetre)
            const bottom = Math.min(
              plotBottom,
              column.surfaceY + band.baseDepthM * column.pxPerMetre,
            )
            if (bottom <= top) return null
            return (
              <rect
                key={`gbe-bh-band-${band.layerId}`}
                data-testid={`geotech-borehole-band-${band.layerId}`}
                x={column.x0}
                y={top}
                width={column.x1 - column.x0}
                height={bottom - top}
                fill="transparent"
                pointerEvents="all"
                style={{ cursor: joinArmActive ? 'crosshair' : 'context-menu' }}
                // Armed Join: a left-click on this band completes the join at the
                // column (owner "Both"). Off-arm the band has no left-click.
                onClick={
                  joinArmActive
                    ? e => {
                        e.preventDefault()
                        e.stopPropagation()
                        fireJoinPickForBand(band.layerId)
                      }
                    : undefined
                }
                onContextMenu={e => {
                  e.preventDefault()
                  e.stopPropagation()
                  setMenu({
                    kind: 'setClass',
                    clientX: e.clientX,
                    clientY: e.clientY,
                    bandId: band.layerId,
                    currentClass,
                    family,
                    foreignClass,
                    unitId: band.formationId,
                    unitBodyId: band.bodyId ?? null,
                  })
                }}
              >
                <title>Right-click to set this band's NAD class by hand</title>
              </rect>
            )
          })}
        </g>
      ))}
      {columns.map(column => (
        <g key={`gbe-${column.investigationId}`}>
          {/* Per-band hit target — RIGHT-CLICK ONLY. It deliberately owns no mousedown:
              left-drag on this canvas pans the section, and a band-wide press target would
              either swallow that or fight it.

              Which is exactly why it stops BAND_HIT_INSET_PX short of its own top and
              bottom: those pixels are the boundaries, and a boundary belongs to whichever
              grab strip is drawn on it — this overlay's own where the boundary is a packing
              one, ContactsLayer's contact strip beneath us where it is a litho contact.
              Painted last and spanning the full height, this rect won the contact lines and
              owned no press to answer with, so the press bubbled to the canvas and panned:
              the contact drag this axis gained on 2026-08-08 could not be started by mouse
              at all. Freeing the edges lets a press there fall through to the strip. */}
          {onRequestSplit !== undefined &&
            column.bands.map(band => {
              const y = yAt(column, band.topDepthM)
              const h = (band.baseDepthM - band.topDepthM) * column.pxPerMetre
              const top = Math.max(y + BAND_HIT_INSET_PX, plotTop)
              const bottom = Math.min(y + h - BAND_HIT_INSET_PX, plotBottom)
              // Nothing left in the middle → no target. A band under 2 × the inset is
              // entirely inside the two strips on its own boundaries, so a rect here could
              // only take presses aimed at them; the band is still reachable through those
              // strips, and zooming in restores its own interior.
              if (bottom <= top) return null
              return (
                <rect
                  key={`gbe-band-${band.layerId}`}
                  data-testid={`geotech-band-hit-${band.layerId}`}
                  x={column.x0}
                  y={top}
                  width={column.x1 - column.x0}
                  height={bottom - top}
                  fill="transparent"
                  pointerEvents="all"
                  style={joinArmActive ? { cursor: 'crosshair' } : undefined}
                  // Armed Join: a left-click on this band completes the join at
                  // the column (owner "Both"). Off-arm the band has no left-click.
                  onClick={
                    joinArmActive
                      ? e => {
                          e.preventDefault()
                          e.stopPropagation()
                          fireJoinPickForBand(band.layerId)
                        }
                      : undefined
                  }
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
                      unitId: band.formationId,
                      unitBodyId: band.bodyId ?? null,
                      bandLayerId: band.layerId,
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
                  {/* NO grip glyph here. A four-dot mark beside every draggable boundary
                      shipped first and the owner rejected it on sight ("i thought we
                      locked in solid and dashed lines, not these ugly marks on the right
                      side") — on a column of 20-odd bands it stacks a column of dots down
                      the section.

                      It was only ever load-bearing because the half of the design that
                      was SUPPOSED to carry this never got built: a packing boundary is a
                      thin dashed line and a restated litho contact a heavy solid one
                      (spec §5, "weight carries the meaning"). With the line itself now
                      saying which kind it is (``ContactsLayer``'s ``restatingContactIds``),
                      a second mark repeating it is noise. The padlock stays — it appears
                      on HOVER only, and it names a consequence rather than repeating a
                      classification. */}
                  </Fragment>
              )
            })}

          {/* NO padlock here. It used to live in this overlay, keyed by the band ABOVE
              the boundary and shown at ``opacity 0`` until its OWN onMouseEnter fired —
              so it appeared only if the cursor found an invisible 9 px glyph beside the
              column. The owner reported exactly that: "no padlock appearing when hovering
              a solid line". A unit test passed the whole time, because it fired the hover
              on the element directly.

              The mark now lives in ``ContactsLayer``, raised by the grab strip the cursor
              is actually over, and keyed by the band BELOW the boundary (a contact IS that
              band's top). One component owns the line, its press target and its hover, so
              the three can no longer disagree about which boundary is under the cursor. */}

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
                    {t('sections.menu.splitBand')}
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
                      {t('sections.bandMenu.removeUp')}
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
                      {t('sections.bandMenu.removeDown')}
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
                      {t('sections.menu.mergeIntoSurrounding')}
                    </button>
                  )}
                  {/* Last, under a rule: everything above EDITS this band,
                      this one navigates away from it. */}
                  <UnitStatisticsItem
                    unitId={menu.unitId}
                    bodyId={menu.unitBodyId}
                    onShow={onShowUnitStatistics}
                    onClose={() => setMenu(null)}
                    topBorder
                  />
                  {/* Body verbs — start a Join from this column, or un-join a group
                      it is already in (owner "Both", 2026-09-01). */}
                  {renderBodyVerbs(menu.unitBodyId, menu.bandLayerId, menu.unitId)}
                </>
              ) : menu.kind === 'setClass' ? (
                <>
                  {/* The band's own SOIL family, current one named and inert. Built
                      from litho_main_soil_code, so this list is exactly what the
                      server's own soil check would accept. */}
                  {menu.family.map(cls => (
                    <button
                      key={`gbe-set-class-${cls}`}
                      type="button"
                      data-testid={`geotech-band-menu-set-class-${cls}`}
                      disabled={cls === menu.currentClass}
                      onClick={() => {
                        onRequestSetClass?.(menu.bandId, cls, menu.currentClass)
                        setMenu(null)
                      }}
                      style={
                        cls === menu.currentClass
                          ? { ...MENU_ITEM_STYLE, opacity: 0.5, cursor: 'default' }
                          : MENU_ITEM_STYLE
                      }
                    >
                      {nadCompactLabel(cls)}
                      {cls === menu.currentClass ? ' (current)' : ''}
                    </button>
                  ))}
                  {/* A legacy row whose class belongs to another soil. Shown so the
                      engineer can see WHAT the band says today and that it is wrong —
                      a menu that silently omitted it would leave him choosing a
                      replacement for a value he cannot see. Never selectable: picking
                      it would restate the contradiction. Any item above heals it. */}
                  {menu.foreignClass !== null && (
                    <button
                      key={`gbe-set-class-foreign-${menu.foreignClass}`}
                      type="button"
                      data-testid={`geotech-band-menu-set-class-${menu.foreignClass}`}
                      data-foreign-class="true"
                      disabled
                      style={{ ...MENU_ITEM_STYLE, opacity: 0.5, cursor: 'default' }}
                    >
                      {nadCompactLabel(menu.foreignClass)}
                      {` (current — a ${nadSoilFamilyName(menu.foreignClass)} class on this soil)`}
                    </button>
                  )}
                  <UnitStatisticsItem
                    unitId={menu.unitId}
                    bodyId={menu.unitBodyId}
                    onShow={onShowUnitStatistics}
                    onClose={() => setMenu(null)}
                    topBorder
                  />
                  {/* Body verbs — start a Join from this borehole column, or
                      un-join a group it is in. The band's own layer is the anchor. */}
                  {renderBodyVerbs(menu.unitBodyId, menu.bandId, menu.unitId)}
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
                  {t('sections.menu.mergeBands')}
                </button>
              )}
            </div>
          </>,
          document.body,
        )}
    </g>
  )
}

// ``UnitStatisticsItem`` and ``MENU_ITEM_STYLE`` moved to
// ``unitStatisticsMenuItem.tsx`` when the litho band menu became their second
// consumer (rulings R1/R2, 2026-08-27).
