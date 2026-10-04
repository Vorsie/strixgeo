/**
 * SVG overlay for litho correlation edges on a cross-section.
 *
 * Responsibilities
 * ----------------
 * - Per-band body chip: every band whose formation has a non-null
 *   ``instance_ordinal`` gets a small ``#N`` chip in its top-right
 *   corner. The chip is the always-on "this is the same body" signal
 *   AND the primary hover surface for revealing edge lines.
 * - Chip halo: on hover, every chip of the same body lights up with a
 *   thin ring so the connection reads visually before the lines
 *   themselves animate in.
 * - Chip right-click: body-level context menu — "Edit admixtures for
 *   this body" (propagates via ``onPropagateAdmixtures``) and "Remove
 *   all correlations for this body".
 * - Contact-level correlation edges (#133 Phase 1): point-to-point
 *   emerald lines between the topY of each correlated contact's band.
 * - Contact-level gesture hit-targets: when ``contactCorrelateMode``
 *   is active, thin horizontal rects let the user click a contact
 *   boundary to arm/correlate.
 *
 * Hover state is local to this component (no cross-component plumbing).
 * Inspector-select sticky reveal is a follow-on debt item — landing it
 * needs a shared ``selectedFormationId`` state across the inspector and
 * the section overlay.
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import { useT } from '../../i18n/translate'
import type {
  CrossingPinchOut,
  FormationContactResponse,
  GeologicalFormationResponse,
  LithoContactCorrelationEdge,
} from '../../api/client'
import LithoGhostCompositionEditor from '../interpretation/LithoGhostCompositionEditor'
import type { GhostAdmixtureItem } from '../interpretation/LithoGhostCompositionEditor'
import { contactAnchorId, groupContactsByAnchor } from './contactsLayerGeometry'
import {
  EdgeReviewBadge,
  isFlaggedForReview,
  REVIEW_FLAG_COLOR,
  REVIEW_FLAG_DASH,
} from './edgeReviewFlag'
import type { PlacedColumn } from './utils'

// ---------------------------------------------------------------------------
// Visual constants
// ---------------------------------------------------------------------------

/** Stroke width for contact-level edges — slightly thicker than body
 *  edges so the two overlay types read distinctly when both are present. */
const CONTACT_EDGE_WIDTH = 1.8
/** Stroke colour for unapproved (pending) contact-level edges — amber-500.
 *  Distinct from the solid emerald of approved edges so the user can see
 *  at a glance which edges still need to be accepted. */
const UNAPPROVED_EDGE_COLOR = '#f59e0b'
/** Dash pattern for unapproved edges — dashed to signal provisional state. */
const UNAPPROVED_EDGE_DASH = '4 4'
/**
 * Stroke colour for interpretive (base-side or mixed top↔base) ties.
 *
 * Cyan-300 — visually distinct from the solid emerald top↔top seam so the
 * geologist reads "interpretive continuation" vs "observed surface correlation"
 * at a glance (spec §6).
 */
const BASE_TIE_COLOR = '#4fc3f7'
/** Dash pattern for interpretive ties — distinguishes them from solid top↔top
 *  ribbons (spec §6). */
const BASE_TIE_DASH = '6 3'
/** Half-height (px) of the seam ribbon above and below the boundary line
 *  (#131-c). Fixed regardless of zoom so the ribbon reads consistently.
 *  Kept slim so stacked correlations don't occlude each other (owner
 *  dogfeed 2026-05-28 — the original ±12 box read as too tall; halved
 *  again 2026-05-31 from 6 → 3 px so the band stops fighting the
 *  lithology stripes for visual weight). */
const RIBBON_HALF_HEIGHT_PX = 3
/** The lithology-coloured ±H stripes are drawn along the raw TIE LINE, which does
 *  not follow the fill's band edges — so a stripe bleeds a DIFFERENT lithology over
 *  the partition fill (clay over silt/sand, owner dogfeed 2026-07-10, proven with the
 *  whole-document OVERLAP LOG). Disabled: the correlation stays fully visible via the
 *  ``ribbon-seam`` line below. Flip to re-enable the coloured seam ribbon (#131-c). */
const RIBBON_STRIPES_ENABLED = false
/** Minimum on-screen ribbon width (px). Closely-spaced columns leave only the
 *  ~4 px nudge edge-gap between their inner edges, so the gap-bridging ribbon
 *  collapses to an invisible sliver — and zoom can't widen it (the gap is a
 *  fixed-px constant; zooming grows the columns too). When the inner-edge gap
 *  is below this, the ribbon is expanded symmetrically about its midpoint so it
 *  stays visible + grabbable (a small overrun onto the column edges is far
 *  better than a sliver the user can't see). Dogfeed 2026-06-04. */
const RIBBON_MIN_WIDTH_PX = 16
/** Fill opacity for an approved (accepted) correlation ribbon. */
const RIBBON_APPROVED_OPACITY = 0.9
/** Fill opacity for a pending (unaccepted) correlation ribbon — faded so a
 *  section full of auto-proposed edges stays readable. */
const RIBBON_PENDING_OPACITY = 0.32
/** Near-black seam line through an approved ribbon (matches the #143 litho
 *  contact line so the boundary reads against the lithology fills). */
const RIBBON_SEAM_COLOR = '#0f172a'
/** Hit target height around each contact top-boundary line (±px), used
 *  as the clickable rect height when contactCorrelateMode is active. */
const CONTACT_HIT_HEIGHT = 12
/** Stroke colour for armed contact boundary line. */
const CONTACT_ARM_COLOR = '#34d399'
/** Lens-candidate marker colour (amber) — an enclosed contact that correlates
 *  to neither neighbour, i.e. a layer that pinches out rather than continues. */
const LENS_CANDIDATE_COLOR = '#f59e0b'
// Correlate-select zone geometry (near-boundary reach, thin-band base-line
// grab) lives in ``correlateBandZones`` — one pure rule, unit-tested, shared
// with nothing else so the two mis-click dogfeeds it reconciles are pinned in
// one place (2026-05-29 / 2026-08-05 / 2026-08-07).
/** Minimum half-height of the invisible right-click hit band drawn over each
 *  correlation edge (#163e) — used when the ribbon has no lithology stripes
 *  and would otherwise collapse to a zero-height seam. */
const EDGE_HIT_STROKE_WIDTH = 14
/** Stroke width (px) of each grabbable half-seam zone (#31). Wider than the
 *  1.4px visible seam so the edge is an easy drag target, but kept modest so it
 *  doesn't blanket the bands above/below. The seam is split at its midpoint so
 *  each half drags its nearer endpoint. */
const EDGE_DRAG_HIT_WIDTH = 18

/** Horizontal inset (px) at each end of the right-click hit band so a
 *  left-drag of the committed contact at either column endpoint still wins
 *  over the band (dogfeed 2026-05-29). */
const EDGE_HIT_END_INSET = 6

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Gesture state for the contact-level (boundary-to-boundary) correlate
 * gesture (#133 Phase 1).
 *
 * State machine: Idle → enterMode → Armed → fire onContactCorrelate → Idle.
 */
export interface ContactGestureState {
  /** Whether boundary-click gesture mode is active. */
  contactCorrelateMode: boolean
  /** Id of the currently armed source contact, null when nothing armed. */
  armedContactId: string | null
  /**
   * Which side of the armed contact is being correlated.  ``'top'`` for a
   * band-click arm (the upper boundary of a unit); ``'base'`` when the user
   * clicks the bottom-of-test handle (the open base of the deepest unit on a
   * column).  Resets to ``'top'`` when the armed source is cleared so a fresh
   * arm-cycle always starts as top-by-default.
   */
  armedContactSide: 'top' | 'base'
  /**
   * Investigation id of the most recent successful target while the same
   * source is still armed.  ``null`` when no edge has committed yet in the
   * current arm-cycle (or the source was just freshly armed).  Drives the
   * lens-pinch-out gesture (debt #135): a second click on a different
   * contact in the same target investigation fires a second correlation
   * from the still-armed source instead of clearing.
   */
  lastTargetTestId: string | null
  /**
   * Arm a source contact by id, optionally specifying which side is being
   * correlated.  Defaults to ``'top'`` so existing band-click call sites
   * don't need to be updated.
   */
  onArmContact: (contactId: string, side?: 'top' | 'base') => void
  /** Clear armed state (stay in mode). */
  onClearArmedContact: () => void
  /**
   * Fired when a valid target contact is clicked — POST contact edge.
   * ``layerASide`` / ``layerBSide`` carry which side each endpoint
   * represents so the API can distinguish top↔top from base↔base or
   * top↔base ties.
   */
  onContactCorrelate: (
    layerAId: string,
    layerBId: string,
    layerASide: 'top' | 'base',
    layerBSide: 'top' | 'base',
  ) => Promise<void>
  /**
   * Fired when the user right-clicks a contact hit-rect — caller presents
   * a confirmation dialog and calls DELETE on the contact.  Optional so
   * callers that only need the arm/correlate path (e.g. tests) don't have
   * to stub it.
   */
  onRequestDeleteContact?: (contactId: string) => void
}

interface Props {
  /** Section-filtered contacts (seeded_formation_contact_ids set). */
  contacts: readonly FormationContactResponse[]
  /**
   * Auto-lens (2026-06-02): pinch-out lens candidates from the last
   * auto-correlate run. Rendered as filled amber diamonds at the midpoint of
   * the pinching layer on the source column.
   */
  crossingPinchOuts?: readonly CrossingPinchOut[]
  /** Active litho formations (vocabulary for colour + ordinal). */
  formations: readonly GeologicalFormationResponse[]
  /** Placed columns with screen X positions. */
  placedColumns: readonly PlacedColumn[]
  /** Map level (absolute elevation mTAW) → screen Y. */
  levelToScreen: (level: number) => number
  /** Top of the plot area in screen px (MARGIN.top). */
  plotTop: number
  /** Bottom of the plot area in screen px. */
  plotBottom: number
  /**
   * Formation ids whose committed bands should pulse amber briefly —
   * the "your correlation succeeded" cue (dogfeed 2026-05-23 "we
   * need like a visual signal that a correlation succeeded").
   * Set transiently after a successful correlate by the caller;
   * cleared after PULSE_MS. Bands in this set render with an amber
   * stroke + slightly boosted fill opacity during the window.
   */
  pulsingFormationIds?: ReadonlySet<string>
  /**
   * Callback fired when the user picks "Inspect lens body…" from the
   * body chip context menu (#101 Blocker 1).  The caller opens
   * InspectLensBodyPanel with the supplied formation id + ordinal.
   * Optional so callers that don't need the inspect path (e.g. tests)
   * don't have to stub it.
   */
  onInspectLensBody?: (formationId: string, bodyOrdinal: number) => void
  /**
   * Fired when the user saves from "Edit admixtures for this body".
   * ``seedFormationId`` is the seed for BFS; ``admixtures`` are the new
   * admixtures to write to every formation in the connected component.
   * Optional so callers that don't need the admixture path don't have
   * to stub it.
   */
  onPropagateAdmixtures?: (
    seedFormationId: string,
    admixtures: GhostAdmixtureItem[],
  ) => Promise<void>
  /**
   * Contact-level correlation edges (#133 Phase 1).  When present, draws
   * point-to-point lines between the topY of each correlated contact's
   * band.  Absent / undefined = no contact-edge overlay.
   */
  contactEdges?: readonly LithoContactCorrelationEdge[]
  /**
   * Gesture state for the boundary-click correlate gesture (#133 Phase 1).
   * When present alongside a truthy ``contactCorrelateMode``, hit-targets
   * appear at the top boundary of each band so the user can click a
   * contact line rather than a body body.
   * Absent / undefined = read-only (contact edges visible, no gesture UI).
   */
  contactGestureState?: ContactGestureState
  /**
   * Fired when the user starts dragging a grab handle on an unapproved edge
   * (#133 Phase 2+3 Task 26).
   *
   * Parameters
   * ----------
   * e
   *     The originating mousedown event.
   * edge
   *     The unapproved edge whose endpoint handle was grabbed.
   * handle
   *     Which endpoint: ``'a'`` = contact_a end, ``'b'`` = contact_b end.
   */
  onUnapprovedDragStart?: (
    e: React.MouseEvent,
    edge: LithoContactCorrelationEdge,
    handle: 'a' | 'b',
  ) => void
  /**
   * Live drag state set by the caller (SectionsCanvas) during a
   * drag-to-retarget gesture (#133 Phase 2+3 Task 26).
   *
   * When present, the overlay draws a dashed amber ghost line from the
   * anchor endpoint (``anchorContactId``) to the current cursor viewport
   * coordinates so the user has visual feedback while dragging.
   */
  unapprovedEdgeDrag?: {
    /** Contact id of the endpoint that is NOT being dragged (the anchor). */
    anchorContactId: string
    /** Current cursor X in **viewport** coords (from mousemove clientX). */
    cursorViewportX: number
    /** Current cursor Y in **viewport** coords (from mousemove clientY). */
    cursorViewportY: number
  }
  /**
   * Fired when the user picks "Delete correlation" from the edge's
   * right-click menu (#163e).  The caller (SectionsCanvas) removes the
   * edge (optimistic local removal + DELETE + refetch).  Absent = no
   * right-click-delete affordance is rendered (read-only / tests that
   * don't need it).
   */
  onRequestDeleteEdge?: (edge: LithoContactCorrelationEdge) => void
  /**
   * Fired when the user picks "Accept correlation" from the edge's
   * right-click menu (dogfeed 2026-05-31).  The caller (SectionsCanvas)
   * POSTs the single-edge accept endpoint and refetches.  Absent = the
   * Accept item is suppressed (read-only callers).  The Accept item is
   * also suppressed for already-approved edges regardless of this prop —
   * an approved edge has nothing to accept.
   */
  onRequestAcceptEdge?: (edge: LithoContactCorrelationEdge) => void
  /**
   * Wording of the accept row in the edge's right-click menu.
   *
   * The geotech axis passes "Accept tie" so the per-tie gesture and the
   * toolbar's "3 · Accept all ties" name the same object. Defaults to the litho
   * wording ("Accept correlation").
   */
  acceptEdgeLabel?: string
  /**
   * Confirms a tie the rebuild flagged — clears its `review_reason`.
   *
   * The non-destructive answer to a flag; deleting is the other one. Absent when
   * the caller has not wired it, in which case a flagged tie still renders its
   * badge but can only be resolved by deleting.
   */
  onRequestConfirmEdgeReview?: (edge: LithoContactCorrelationEdge) => void
  /**
   * Correlation edge to pulse, or ``null``.
   *
   * Set transiently by ``SectionPanel`` after the geotech pending-tie chip
   * centred a tie (owner ask 2026-08-25), and cleared on its own after
   * ``FLASH_HIGHLIGHT_MS``. An id the overlay does not draw is simply not
   * pulsed — the caller learns that from the reveal result, not from here.
   */
  flashEdgeId?: string | null
  /**
   * Order-invariant ``edgeKey``s of every tie currently in a crossing conflict.
   *
   * Owner ruling 2026-08-26 (*"mark the crossing ties"*). Two accepted ties that cross
   * suspend EACH OTHER, and the fill engine that detects that is the only thing that
   * knows — so the set arrives from it, via ``PartitionFillOverlay``, rather than being
   * worked out again here. Re-deriving it would let the mark disagree with the chip that
   * counts the same conflicts, which is the one failure this feature cannot have.
   *
   * Absent or empty = nothing is fighting, and no tie is marked.
   */
  conflictEdgeKeys?: ReadonlySet<string>
  /**
   * Stamped ``body_id`` per band id (a contact's id IS its band's id — the LL→FC
   * trigger writes matching ids), litho and geotech bands alike.
   *
   * Owner ruling 2026-10-04 (*"identity follows the drawing"*): an accepted tie the
   * fill does not paint as a band joins nothing, so its two bands can stay two
   * bodies. With this map the overlay marks such a tie "accepted, not banded" on
   * hover. Absent = the overlay makes no statement (additive prop).
   */
  bodyIdByLayerId?: ReadonlyMap<string, string | null>
}


import TieFlashHalo from './TieFlashHalo'
import TieConflictHalo from './TieConflictHalo'
import { edgeKey } from '../../utils/partitionFillV2'
import { massKeyOfFormation, tieBandingStatus } from './tieBanding'
import {
  anchorId,
  bandRect,
  buildBandMap,
  buildContactScreenMap,
  contactStripeColors,
  CONTACT_EDGE_COLOR,
  correlateBandZones,
  warpAwareEdgePoints,
  warpAwareRibbonOutline,
} from './correlationEdgesHelpers'
// Re-export for existing callers/tests that import the helpers from this module.
export { buildBandMap, contactStripeColors, type BandEntry } from './correlationEdgesHelpers'
import {
  BodyChip,
  BodyContextMenu,
  CHIP_HEIGHT,
  CHIP_INSET,
  CHIP_MIN_BAND_HEIGHT,
  CHIP_WIDTH,
  EdgeContextMenu,
  type BodyContextMenuState,
  type EdgeContextMenuState,
} from './CorrelationEdgesMenus'
/**
 * SVG overlay for litho correlation edges.
 *
 * Parameters
 * ----------
 * contacts
 *     Section-filtered contacts (used to compute band positions).
 * formations
 *     Active litho formation vocabulary (for ``instance_ordinal`` chips).
 * placedColumns
 *     Placed columns with screen X (nudgedX) and width.
 * levelToScreen
 *     Converts absolute elevation (mTAW) → screen Y.
 * plotTop
 *     Top of the plot area in screen px.
 * plotBottom
 *     Bottom of the plot area in screen px.
 * contactEdges
 *     Contact-level correlation edges (#133 Phase 1); absent = no contact overlay.
 * contactGestureState
 *     Boundary-click gesture state; absent = read-only (edges visible, no gesture UI).
 * onUnapprovedDragStart
 *     Fired on mousedown of a grab handle on an unapproved edge (#133 Task 26).
 *     Absent = no handles rendered (read-only).
 * unapprovedEdgeDrag
 *     Live drag state while the user is mid-drag; drives the ghost line preview.
 *
 * Returns
 * -------
 * JSX.Element
 *     An SVG ``<g>`` containing contact-edge lines, body chips, and gesture rects.
 */
export default function CorrelationEdgesOverlay({
  contacts,
  crossingPinchOuts,
  formations,
  placedColumns,
  levelToScreen,
  plotTop,
  plotBottom,
  pulsingFormationIds,
  onInspectLensBody,
  onPropagateAdmixtures,
  contactEdges,
  contactGestureState,
  onUnapprovedDragStart,
  unapprovedEdgeDrag,
  onRequestDeleteEdge,
  onRequestAcceptEdge,
  acceptEdgeLabel,
  onRequestConfirmEdgeReview,
  flashEdgeId = null,
  conflictEdgeKeys,
  bodyIdByLayerId,
}: Props): JSX.Element {
  const t = useT()
  /** Ref on the root <g> so we can convert viewport coords to SVG-local
   *  coords for the drag ghost line by reading ownerSVGElement.getBoundingClientRect(). */
  const rootGRef = useRef<SVGGElement>(null)

  /** Body-level context menu (debt #100) — opened by right-clicking a
   *  body chip. */
  const [bodyContextMenu, setBodyContextMenu] = useState<BodyContextMenuState | null>(null)

  /** Hovered body ordinal (debt #100). null = no hover; chip halos hidden. */
  const [hoveredBodyOrdinal, setHoveredBodyOrdinal] = useState<number | null>(null)

  /** Edge-level right-click menu (#163e) — opened by right-clicking a
   *  correlation edge's hit band; carries the edge to delete. */
  const [edgeContextMenu, setEdgeContextMenu] = useState<EdgeContextMenuState | null>(null)

  /** Correlate-mode hover preview (owner 2026-08-07): the boundary line a
   *  click at the current cursor position WOULD arm. Thin bands make
   *  top-vs-base ambiguous by position alone ("I click the bottom of a clay
   *  unit but the correlation drew from the top"), so the answer is shown
   *  BEFORE the click commits. null = no zone hovered. */
  const [armPreview, setArmPreview] = useState<{ y: number; x1: number; x2: number } | null>(null)

  // State for the admixture editor modal opened from the body chip context menu.
  const [admixEditorState, setAdmixEditorState] = useState<{
    open: boolean
    seedFormationId: string
    initialMainSoilCode: string
    initialAdmixtures: GhostAdmixtureItem[]
  } | null>(null)

  // Invert levelToScreen at plotBottom to get the minimum visible level.
  // We approximate: levelToScreen is monotone-decreasing (higher level = smaller Y),
  // so the bottom of the plot corresponds to the lowest visible level.
  // We derive this by asking: what level maps to plotBottom?
  // levelToScreen(level) = plotBottom  →  level ≈ plotTop + (plotBottom - plotTop) * (1/scale)
  // We use a coarse approximation: scan for level where levelToScreen ≈ plotBottom.
  // In practice we just pass 0 as the floor — deep enough for any section.
  const plotBottomLevel = useMemo(() => {
    // Binary search: find the level L such that levelToScreen(L) ≈ plotBottom.
    // levelToScreen is monotone-decreasing in level.
    let lo = -200
    let hi = 200
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2
      if (levelToScreen(mid) < plotBottom) hi = mid
      else lo = mid
    }
    return (lo + hi) / 2
  }, [levelToScreen, plotBottom])

  const bandMap = useMemo(
    () => buildBandMap(contacts, placedColumns, plotBottomLevel),
    [contacts, placedColumns, plotBottomLevel],
  )

  const formationById = useMemo(() => {
    const m = new Map<string, GeologicalFormationResponse>()
    for (const f of formations) m.set(f.id, f)
    return m
  }, [formations])

  // The mass each band belongs to (its litho unit; + NAD class on the geotech
  // axis) — only a tie between two bands of ONE mass can be "not banded"; a tie
  // across two masses is a surface tie by design (owner 2026-10-04 / 2026-10-03).
  const massKeyByContactId = useMemo(() => {
    const m = new Map<string, string | null>()
    for (const c of contacts) m.set(c.id, massKeyOfFormation(formationById.get(c.formation_id)))
    return m
  }, [contacts, formationById])

  // Contact-level screen position map (#133 Phase 1): contact id → { x, topY }.
  // Re-computed whenever contacts, columns, bandMap, or the transform changes.
  const contactScreenMap = useMemo(
    () => buildContactScreenMap(contacts, placedColumns, bandMap, levelToScreen),
    [contacts, placedColumns, bandMap, levelToScreen],
  )

  // Above/below lithology colour per contact, for the gradient ribbon
  // (#131-c). Re-derived only when the contacts or the formation lookup
  // change.
  const stripeColorsByContactId = useMemo(
    () => contactStripeColors(contacts, formationById),
    [contacts, formationById],
  )

  // Lithology per contact (thread B — cross-lithology surface ties): a
  // contact's ``litho_main_soil_code`` via its formation. An edge whose two
  // endpoints differ in lithology is a SURFACE TIE (drawn as a line, no body
  // ribbon) rather than a body correlation. Derived — no schema, no new state.
  const lithoByContactId = useMemo(() => {
    const m = new Map<string, string | null>()
    for (const c of contacts) {
      m.set(c.id, formationById.get(c.formation_id)?.litho_main_soil_code ?? null)
    }
    return m
  }, [contacts, formationById])

  // Lens candidates (dogfeed 2026-05-29): a contact with NO correlation edge on
  // either neighbour, but ENCLOSED by correlated contacts above AND below on
  // its own column, is a stranded layer — a lens that pinches out, not a
  // continuous horizon (the conceptual "no-target middle layer" case).  Mark it
  // so the user reaches for the lens / pinch-out path rather than trying — and
  // failing — to correlate it.  A non-enclosed un-correlated contact is just
  // not-yet-processed, not a lens, so it is NOT flagged.
  const lensCandidateIds = useMemo(() => {
    const correlated = new Set<string>()
    for (const e of contactEdges ?? []) {
      correlated.add(e.layer_a_id)
      correlated.add(e.layer_b_id)
    }
    const byInv = groupContactsByAnchor(contacts)
    const out = new Set<string>()
    for (const sorted of byInv.values()) {
      for (let i = 0; i < sorted.length; i += 1) {
        const c = sorted[i]
        if (correlated.has(c.id)) continue
        const hasAbove = sorted.slice(0, i).some(x => correlated.has(x.id))
        const hasBelow = sorted.slice(i + 1).some(x => correlated.has(x.id))
        if (hasAbove && hasBelow) out.add(c.id)
      }
    }
    return out
  }, [contacts, contactEdges])

  // contact id → the next-deeper contact's id on the same column (the boundary
  // BELOW this band).  Drives the lower-half correlate hit-zone so clicking the
  // bottom of a band arms the bottom boundary, not the band's top (dogfeed
  // 2026-05-29: full-band targets armed the top, so clicking a unit's bottom
  // edge selected its top edge).
  const nextDeeperContactId = useMemo(() => {
    const byInv = groupContactsByAnchor(contacts)
    const out = new Map<string, string>()
    for (const sorted of byInv.values()) {
      for (let i = 0; i < sorted.length - 1; i += 1) {
        out.set(sorted[i].id, sorted[i + 1].id)
      }
    }
    return out
  }, [contacts])

  // Destructure contactGestureState with safe defaults so the render
  // block can use these without repeated optional-chain guards.
  const {
    contactCorrelateMode,
    armedContactId,
    armedContactSide,
    lastTargetTestId,
    onArmContact,
    onClearArmedContact,
    onContactCorrelate,
    onRequestDeleteContact,
  } = contactGestureState ?? {
    contactCorrelateMode: false,
    armedContactId: null,
    armedContactSide: 'top' as const,
    lastTargetTestId: null,
    onArmContact: (_: string, _side?: 'top' | 'base') => {},
    onClearArmedContact: () => {},
    onContactCorrelate: async (
      _a: string,
      _b: string,
      _aSide: 'top' | 'base',
      _bSide: 'top' | 'base',
    ) => {},
    onRequestDeleteContact: undefined,
  }

  // Lens-aware correlate state machine (debt #135), parameterised by the
  // CLICKED contact so the upper/lower half-zones of a band can target
  // different boundaries (dogfeed 2026-05-29).  ``clickedTestId`` is the
  // clicked contact's investigation (same for both halves of a band).
  // ``clickedSide`` is which side of the clicked contact is being
  // targeted — ``'top'`` for band-click arms, ``'base'`` for the
  // bottom-of-test handle.
  const handleCorrelateClick = (
    clickedId: string,
    clickedTestId: string | null,
    clickedSide: 'top' | 'base' = 'top',
  ): void => {
    if (armedContactId === clickedId && armedContactSide === clickedSide) {
      // a) Click on the exact same armed boundary+side → disarm.
      onClearArmedContact()
      return
    }
    if (armedContactId === null) {
      // b) Nothing armed → arm this boundary.
      onArmContact(clickedId, clickedSide)
      return
    }
    const armedContact = contacts.find(x => x.id === armedContactId)
    const armedTestId = armedContact ? anchorId(armedContact) : null
    if (armedTestId !== null && clickedTestId === armedTestId) {
      // c) Click in the source's own investigation → re-arm here.
      onArmContact(clickedId, clickedSide)
      return
    }
    if (lastTargetTestId !== null && clickedTestId !== null && clickedTestId === lastTargetTestId) {
      // d) Lens-pinch-out: another click in the same target investigation.
      void onContactCorrelate(armedContactId, clickedId, armedContactSide, clickedSide)
      return
    }
    if (lastTargetTestId === null) {
      // e) First edge of this arm-cycle → fire correlation.
      void onContactCorrelate(armedContactId, clickedId, armedContactSide, clickedSide)
      return
    }
    // f) Third unrelated investigation → conservative: re-arm here.
    onArmContact(clickedId, clickedSide)
  }

  // Per-band chip data (debt #100). One chip per (investigation × formation)
  // band whose formation carries a non-null ``instance_ordinal``. Chips
  // anchor at the band's top-right corner; skipped when the band is
  // shorter than ``CHIP_MIN_BAND_HEIGHT`` so the chip never overflows
  // a thin band into the one below.
  interface ChipRect {
    investigationId: string
    formationId: string
    ordinal: number
    /** Top-left x of the chip in container coords. */
    x: number
    /** Top-left y of the chip in container coords. */
    y: number
  }

  const chipRects = useMemo((): ChipRect[] => {
    const rects: ChipRect[] = []
    for (const col of placedColumns) {
      const invId = col.proj.item.id
      const bands = bandMap.get(invId)
      if (!bands) continue
      const hw = col.width / 2
      const colX = col.nudgedX
      // Iterate by contact id so repeated formations get one chip per
      // instance (each at its own band's top), not one chip at the deepest
      // band's top.
      const seenInstancesOnCol = new Set<string>()
      for (const [contactId, entry] of bands) {
        const formation = formationById.get(entry.formationId)
        if (!formation) continue
        if (formation.instance_ordinal === null) continue
        // De-dup: when two contacts on this column share the same formation
        // AND it carries a single ordinal, render only the first chip we
        // encounter — the chip displays the formation's ordinal, not a
        // per-instance number, so two chips with identical text would be
        // visual noise.
        if (seenInstancesOnCol.has(entry.formationId)) continue
        seenInstancesOnCol.add(entry.formationId)
        const rect = bandRect(invId, contactId, bandMap, levelToScreen, plotTop, plotBottom, hw)
        if (!rect) continue
        const bandHeight = rect.botY - rect.topY
        if (bandHeight < CHIP_MIN_BAND_HEIGHT) continue
        const rightEdge = colX + hw
        rects.push({
          investigationId: invId,
          formationId: entry.formationId,
          ordinal: formation.instance_ordinal,
          x: rightEdge - CHIP_WIDTH - CHIP_INSET,
          y: rect.topY + CHIP_INSET,
        })
      }
    }
    return rects
  }, [placedColumns, bandMap, formationById, levelToScreen, plotTop, plotBottom])

  /** Body-level right-click handlers. Edit-admixtures propagates via
   *  ``onPropagateAdmixtures``; remove-all is a no-op pending the
   *  contact-level remove path (Task 23 drops the formation edges table). */
  const handleBodyContextEditAdmixtures = useCallback(() => {
    if (!bodyContextMenu) return
    const seedFormation = formationById.get(bodyContextMenu.seedFormationId)
    setBodyContextMenu(null)
    setAdmixEditorState({
      open: true,
      seedFormationId: bodyContextMenu.seedFormationId,
      initialMainSoilCode: seedFormation?.litho_main_soil_code ?? 'ZAND',
      initialAdmixtures: (seedFormation?.litho_admixtures ?? []) as GhostAdmixtureItem[],
    })
  }, [bodyContextMenu, formationById])

  // Compute drag ghost anchor + cursor positions in SVG-local coords.
  // The SVG has no viewBox scaling — viewport px and SVG px are 1:1 after
  // subtracting the SVG element's bounding rect top-left.
  const dragGhost = useMemo(() => {
    if (!unapprovedEdgeDrag) return null
    const anchorPt = contactScreenMap.get(unapprovedEdgeDrag.anchorContactId)
    if (!anchorPt) return null
    // Convert viewport cursor to SVG-local by reading ownerSVGElement rect.
    const svgRect = rootGRef.current?.ownerSVGElement?.getBoundingClientRect()
    const svgLeft = svgRect?.left ?? 0
    const svgTop = svgRect?.top ?? 0
    return {
      x1: anchorPt.x,
      y1: anchorPt.topY,
      x2: unapprovedEdgeDrag.cursorViewportX - svgLeft,
      y2: unapprovedEdgeDrag.cursorViewportY - svgTop,
    }
  // re-compute whenever cursor moves (viewport coords change) or anchor map changes
  // reason: unapprovedEdgeDrag is the live drag cursor object that updates on every
  //   mousemove; contactScreenMap captures the anchor's SVG position which is stable
  //   during a drag. Including rootGRef would add no value (refs are mutable, not
  //   reactive) but omitting it is safe — the SVG rect only changes on window resize.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unapprovedEdgeDrag, contactScreenMap])

  return (
    <>
    <g
      ref={rootGRef}
      data-testid="correlation-edges-overlay"
      style={{ pointerEvents: 'none' }}
    >

      {/* Per-band body chips (debt #100). One chip per (investigation ×
          formation) band that carries an ``instance_ordinal``. Hover a
          chip → reveal lines for that body + halo every chip in the
          body. Right-click → body-level context menu. */}
      {chipRects.map(cr => (
        <BodyChip
          key={`chip-${cr.investigationId}-${cr.formationId}`}
          testId={`body-chip-${cr.investigationId}-${cr.formationId}`}
          x={cr.x}
          y={cr.y}
          ordinal={cr.ordinal}
          haloed={hoveredBodyOrdinal === cr.ordinal}
          onMouseEnter={() => setHoveredBodyOrdinal(cr.ordinal)}
          onMouseLeave={() => setHoveredBodyOrdinal(null)}
          onContextMenu={e => {
            e.preventDefault()
            e.stopPropagation()
            setBodyContextMenu({
              x: cr.x + CHIP_WIDTH,
              y: cr.y + CHIP_HEIGHT,
              ordinal: cr.ordinal,
              seedFormationId: cr.formationId,
            })
          }}
        />
      ))}

      {/* Correlation success pulse (dogfeed 2026-05-23). Amber stroke
          around every committed band whose formation_id is in the
          transient ``pulsingFormationIds`` set. Set by the caller
          immediately after a successful correlate; cleared after
          ~PULSE_MS. The chip + edge line already appear once Resolve
          refetches, but those updates are async and not anchored to
          the bands the user just clicked — the pulse IS anchored,
          giving the immediate "your gesture worked" cue. */}
      {pulsingFormationIds && pulsingFormationIds.size > 0 && (
        <g data-testid="correlation-pulse" pointerEvents="none">
          {placedColumns.flatMap(col => {
            const invId = col.proj.item.id
            const bands = bandMap.get(invId)
            if (!bands) return []
            const halfW = col.width / 2
            const result: JSX.Element[] = []
            for (const [contactId, entry] of bands) {
              if (!pulsingFormationIds.has(entry.formationId)) continue
              const rect = bandRect(
                invId,
                contactId,
                bandMap,
                levelToScreen,
                plotTop,
                plotBottom,
                halfW,
              )
              if (!rect) continue
              result.push(
                <rect
                  key={`pulse-${invId}-${contactId}`}
                  data-testid={`correlation-pulse-${invId}-${entry.formationId}`}
                  x={col.nudgedX - halfW - 1}
                  y={rect.topY - 1}
                  width={halfW * 2 + 2}
                  height={rect.botY - rect.topY + 2}
                  fill="none"
                  stroke="#f59e0b"
                  strokeWidth={2.5}
                  rx={2}
                  className="animate-pulse"
                />,
              )
            }
            return result
          })}
        </g>
      )}

      {/* Contact-level correlation ribbons (#131-c). Each edge renders a
          seam ribbon straddling the correlated boundary: a top stripe in
          the lithology ABOVE the contact and a bottom stripe in the
          lithology BELOW, each a horizontal gradient from contact A's
          colour to contact B's (so a lens reads as a colour fade). The
          above stripe is omitted when either end is the topmost contact
          (no lithology above). Approved → solid + near-black seam line;
          pending → faded + dashed amber outline + drag handles. */}
      {contactEdges && contactEdges.length > 0 && (
        <g data-testid="contact-edges-overlay">
          {contactEdges.map(ce => {
            const ptA = contactScreenMap.get(ce.layer_a_id)
            const ptB = contactScreenMap.get(ce.layer_b_id)
            if (!ptA || !ptB) return null
            const approved = ce.user_approved

            // Is this tie one of a crossing pair? Matched through the SAME ``edgeKey``
            // the engine keyed the conflict with, so the mark and the warning chip can
            // only ever name the same two ties.
            const inConflict =
              conflictEdgeKeys !== undefined
              && conflictEdgeKeys.has(
                edgeKey({
                  a: ce.layer_a_id,
                  b: ce.layer_b_id,
                  aSide: ce.layer_a_side,
                  bSide: ce.layer_b_side,
                }),
              )

            // Resolve Y for each endpoint based on the persisted side.
            // A base-side endpoint anchors at the band's base (botY); a
            // top-side endpoint anchors at the band's top (topY).
            // Bug fix (spec §6): previously all edges used topY regardless
            // of layer_a_side / layer_b_side, so base ties rendered
            // from the wrong boundary.
            const yA = ce.layer_a_side === 'base' ? ptA.botY : ptA.topY
            const yB = ce.layer_b_side === 'base' ? ptB.botY : ptB.topY

            // An edge is interpretive (base or mixed) when either endpoint
            // is a base tie — renders dashed + cyan (spec §6).
            const isInterpretive =
              ce.layer_a_side === 'base' || ce.layer_b_side === 'base'

            // Cross-lithology edge → SURFACE TIE: draw the clean connecting
            // line only (no seam ribbon; a tie forms no body). The resolver
            // drops cross-lithology edges from body formation, so this is a
            // pure "same surface, different material" correlation (thread B).
            const lithoA = lithoByContactId.get(ce.layer_a_id) ?? null
            const lithoB = lithoByContactId.get(ce.layer_b_id) ?? null
            if (lithoA !== null && lithoB !== null && lithoA !== lithoB) {
              // Awaiting confirmation outranks the rest: the engineer has to
              // find these, and a flagged tie is by definition one whose
              // ordinary styling would be telling them the wrong thing.
              const needsReview = isFlaggedForReview(ce)
              // Interpretive ties always use BASE_TIE_COLOR; approved top↔top
              // use emerald; pending use amber.
              const tieColor = needsReview
                ? REVIEW_FLAG_COLOR
                : isInterpretive
                  ? BASE_TIE_COLOR
                  : approved
                    ? CONTACT_EDGE_COLOR
                    : UNAPPROVED_EDGE_COLOR
              const tieDash = needsReview
                ? REVIEW_FLAG_DASH
                : isInterpretive
                  ? BASE_TIE_DASH
                  : approved
                    ? undefined
                    : UNAPPROVED_EDGE_DASH
              // Anchor at each column's INNER (facing) edge — same as the
              // ribbon — so the tie spans only the gap, not centre-to-centre
              // across the columns (dogfeed 2026-06-08).
              const aLeft = ptA.x <= ptB.x
              const tieX1 = aLeft ? ptA.x + ptA.halfWidth : ptA.x - ptA.halfWidth
              const tieX2 = aLeft ? ptB.x - ptB.halfWidth : ptB.x + ptB.halfWidth
              const openTieMenu = (e: React.MouseEvent<SVGElement>): void => {
                if (!onRequestDeleteEdge) return
                e.preventDefault()
                e.stopPropagation()
                const r = e.currentTarget.ownerSVGElement?.getBoundingClientRect()
                setEdgeContextMenu({
                  x: r ? e.clientX - r.left : (tieX1 + tieX2) / 2,
                  y: r ? e.clientY - r.top : (yA + yB) / 2,
                  edge: ce,
                })
              }
              // WARP-AWARE tie path: a surface tie that spans intervening columns
              // must BEND at each one (flat across the column), exactly like the
              // per-gap fill — see warpAwareEdgePoints. Endpoints keep their
              // inner-edge anchoring (tieX1/tieX2).
              const tiePts = warpAwareEdgePoints(tieX1, yA, ptA.along, tieX2, yB, ptB.along, placedColumns)
              return (
                <g key={`tie-${ce.id}`}>
                  {/* Crossing-conflict mark — furthest back, because it is a STATE the
                      tie is in; the landing pulse is a momentary event and reads over
                      it. Traces the tie's own points so it cannot drift. */}
                  {inConflict && (
                    <TieConflictHalo points={tiePts} closed={false} edgeId={ce.id} />
                  )}
                  {/* Landing pulse — BEHIND the tie so its dashes read through. */}
                  {flashEdgeId === ce.id && (
                    <TieFlashHalo points={tiePts} closed={false} edgeId={ce.id} />
                  )}
                  {/* Transparent wide hit-line so the thin tie is right-clickable
                      to delete, like the ribbon's seam (dogfeed 2026-06-08). */}
                  <polyline
                    data-testid={`tie-hit-${ce.id}`}
                    points={tiePts}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={EDGE_DRAG_HIT_WIDTH}
                    style={{ pointerEvents: 'stroke', cursor: 'context-menu' }}
                    onContextMenu={openTieMenu}
                  />
                  <polyline
                    data-testid={`tie-line-${ce.id}`}
                    data-approved={approved ? 'true' : 'false'}
                    data-interpretive={isInterpretive ? 'true' : 'false'}
                    points={tiePts}
                    fill="none"
                    stroke={tieColor}
                    strokeWidth={CONTACT_EDGE_WIDTH}
                    strokeDasharray={tieDash}
                    style={{ pointerEvents: 'none' }}
                  />
                  {needsReview && (
                    <EdgeReviewBadge
                      edge={ce}
                      x={(tieX1 + tieX2) / 2}
                      y={(yA + yB) / 2}
                      onContextMenu={onRequestDeleteEdge ? openTieMenu : undefined}
                    />
                  )}
                </g>
              )
            }

            const H = RIBBON_HALF_HEIGHT_PX
            // Anchor the ribbon at each column's INNER edge (the edge facing
            // the other column) so it bridges only the gap between columns
            // instead of running centre-to-centre over them (owner dogfeed
            // 2026-05-28). yA/yB already pick topY vs botY per endpoint
            // side, so the seam tracks the correct boundary.
            const aLeftOfB = ptA.x <= ptB.x
            let xA = aLeftOfB ? ptA.x + ptA.halfWidth : ptA.x - ptA.halfWidth
            let xB = aLeftOfB ? ptB.x - ptB.halfWidth : ptB.x + ptB.halfWidth
            // Floor the on-screen ribbon width so closely-spaced columns don't
            // collapse it to an unreadable sliver (zoom can't fix that — the
            // inner-edge gap is a fixed-px nudge constant). Expand symmetrically
            // about the midpoint, preserving A→B order so the colour gradient
            // and inner-edge anchoring stay correct for separated columns.
            if (Math.abs(xB - xA) < RIBBON_MIN_WIDTH_PX) {
              const mid = (xA + xB) / 2
              const half = RIBBON_MIN_WIDTH_PX / 2
              const sign = xA <= xB ? 1 : -1
              xA = mid - sign * half
              xB = mid + sign * half
            }
            // Interpretive (base/mixed) ties: draw as a plain dashed line
            // (no colour-stripe ribbon — there is no single "surface" to
            // straddle). The seam + hit geometry below handles the
            // right-click delete target.
            const stripesA = isInterpretive ? null : stripeColorsByContactId.get(ce.layer_a_id)
            const stripesB = isInterpretive ? null : stripeColorsByContactId.get(ce.layer_b_id)
            const aboveA = stripesA?.above ?? null
            const aboveB = stripesB?.above ?? null
            const belowA = stripesA?.below ?? null
            const belowB = stripesB?.below ?? null
            // Above stripe only when BOTH ends have a lithology above —
            // a one-sided gradient that fades into nothing is omitted.
            const showAbove = aboveA !== null && aboveB !== null
            const showBelow = belowA !== null && belowB !== null
            const fillOpacity = approved ? RIBBON_APPROVED_OPACITY : RIBBON_PENDING_OPACITY
            // Perimeter for the pending dashed outline — wraps whichever
            // stripes are present (top edge sits at −H only when the above
            // stripe shows, otherwise at the seam line).
            const topY_A = showAbove ? yA - H : yA
            const topY_B = showAbove ? yB - H : yB
            const botY_A = showBelow ? yA + H : yA
            const botY_B = showBelow ? yB + H : yB
            // Approved-seam gradient (owner ask 2026-07-13): the seam fades
            // from the tied unit's litho colour at one test into its colour
            // at the next — the colour of the unit BELOW each tied contact
            // (the band whose top the seam marks), falling back to the unit
            // above, then to the solid near-black when unknown at either end.
            // A stroke cannot deposit colour over the partition fill the way
            // the retired stripe polygons did (2026-07-10 disable), so this
            // restores the colour cue without the overlap regression.
            const seamA = belowA ?? aboveA
            const seamB = belowB ?? aboveB
            const seamGradient = approved && !isInterpretive && seamA !== null && seamB !== null
            // The seam line every branch below draws — hoisted because the third caller
            // (the conflict mark) is the point at which three copies of one expression
            // stop being a coincidence, and a mark computed from its own copy could
            // drift off the seam it marks.
            const seamPts = warpAwareEdgePoints(
              xA, yA, ptA.along, xB, yB, ptB.along, placedColumns,
            )
            // Identity follows the drawing (owner 2026-10-04): an accepted tie
            // whose two bands the fill did not paint as one mass leaves two
            // bodies. Read from the resolver's stamps, never re-derived; absent
            // stamps = no statement.
            const banding = bodyIdByLayerId
              ? tieBandingStatus({
                  approved,
                  bodyA: bodyIdByLayerId.get(ce.layer_a_id),
                  bodyB: bodyIdByLayerId.get(ce.layer_b_id),
                  massA: massKeyByContactId.get(ce.layer_a_id) ?? null,
                  massB: massKeyByContactId.get(ce.layer_b_id) ?? null,
                })
              : null
            return (
              <g
                key={`ribbon-${ce.id}`}
                data-testid={`ribbon-${ce.id}`}
                data-approved={approved ? 'true' : 'false'}
                data-interpretive={isInterpretive ? 'true' : 'false'}
                data-banded={banding === null ? undefined : banding === 'banded' ? 'true' : 'false'}
                pointerEvents="none"
              >
                {/* Crossing-conflict mark — first child, so every stripe, seam and
                    handle of the ribbon reads over it. */}
                {inConflict && (
                  <TieConflictHalo points={seamPts} closed={false} edgeId={ce.id} />
                )}
                {RIBBON_STRIPES_ENABLED && (
                  <defs>
                    {showAbove && (
                      <linearGradient
                        id={`ribbon-above-grad-${ce.id}`}
                        gradientUnits="userSpaceOnUse"
                        x1={xA} y1={0} x2={xB} y2={0}
                      >
                        <stop offset="0" stopColor={aboveA as string} />
                        <stop offset="1" stopColor={aboveB as string} />
                      </linearGradient>
                    )}
                    {showBelow && (
                      <linearGradient
                        id={`ribbon-below-grad-${ce.id}`}
                        gradientUnits="userSpaceOnUse"
                        x1={xA} y1={0} x2={xB} y2={0}
                      >
                        <stop offset="0" stopColor={belowA as string} />
                        <stop offset="1" stopColor={belowB as string} />
                      </linearGradient>
                    )}
                  </defs>
                )}
                {RIBBON_STRIPES_ENABLED && showAbove && (
                  <polygon
                    data-testid={`ribbon-above-${ce.id}`}
                    points={`${xA},${yA - H} ${xB},${yB - H} ${xB},${yB} ${xA},${yA}`}
                    fill={`url(#ribbon-above-grad-${ce.id})`}
                    fillOpacity={fillOpacity}
                  />
                )}
                {RIBBON_STRIPES_ENABLED && showBelow && (
                  <polygon
                    data-testid={`ribbon-below-${ce.id}`}
                    points={`${xA},${yA} ${xB},${yB} ${xB},${yB + H} ${xA},${yA + H}`}
                    fill={`url(#ribbon-below-grad-${ce.id})`}
                    fillOpacity={fillOpacity}
                  />
                )}
                {isInterpretive ? (
                  /* Interpretive tie: dashed cyan seam, no colour stripes.
                     Warp-aware so it runs flat under a shallow test like the fill. */
                  <polyline
                    data-testid={`ribbon-seam-${ce.id}`}
                    points={seamPts}
                    fill="none"
                    stroke={BASE_TIE_COLOR}
                    strokeWidth={CONTACT_EDGE_WIDTH}
                    strokeDasharray={BASE_TIE_DASH}
                    pointerEvents="none"
                  />
                ) : approved ? (
                  /* Same-lithology band seam — warp-aware (bends flat across each
                     intervening column) so a correlated band's boundary runs
                     horizontal under a shallow test, matching the fill and the
                     cross-lithology tie (owner directive 2026-07-10: flatten ALL
                     correlation bands below the shallow test). */
                  <>
                    {seamGradient && (
                      <defs>
                        <linearGradient
                          id={`seam-grad-${ce.id}`}
                          gradientUnits="userSpaceOnUse"
                          x1={xA} y1={0} x2={xB} y2={0}
                        >
                          <stop offset="0" stopColor={seamA as string} />
                          <stop offset="1" stopColor={seamB as string} />
                        </linearGradient>
                      </defs>
                    )}
                    <polyline
                      data-testid={`ribbon-seam-${ce.id}`}
                      points={seamPts}
                      fill="none"
                      stroke={seamGradient ? `url(#seam-grad-${ce.id})` : RIBBON_SEAM_COLOR}
                      strokeWidth={1.5}
                      pointerEvents="none"
                    />
                  </>
                ) : (
                  (() => {
                    // WARP-AWARE, exactly like the accepted seam: a proposal that
                    // spans intervening columns bends at each one. Drawing the
                    // proposal straight and the accepted tie bent would tell the
                    // engineer the surface MOVES when he accepts it — and on the
                    // geotech axis a jump tie over an undivided borehole is the
                    // ordinary case, not the exception (pipeline step 2).
                    const outline = warpAwareRibbonOutline(
                      xA, topY_A, botY_A, ptA.along,
                      xB, topY_B, botY_B, ptB.along,
                      placedColumns,
                    )
                    return (
                      <>
                        {/* Landing pulse — BEHIND the outline, tracing the SAME
                            ring, so the halo can never drift from its tie. */}
                        {flashEdgeId === ce.id && (
                          <TieFlashHalo points={outline} closed edgeId={ce.id} />
                        )}
                        <polygon
                          data-testid={`ribbon-outline-${ce.id}`}
                          points={outline}
                          fill="none"
                          stroke={UNAPPROVED_EDGE_COLOR}
                          strokeWidth={1.4}
                          strokeDasharray={UNAPPROVED_EDGE_DASH}
                          pointerEvents="none"
                        />
                      </>
                    )
                  })()
                )}
                {/* Seam interaction (#31). The seam is split at its midpoint
                    into two grabbable half-zones so each half drags its NEARER
                    endpoint: left-drag = retarget that end; Ctrl/Cmd-drag =
                    leave the edge + create another (→ wedge when dropped on the
                    layer's other boundary). Right-click opens the delete menu.
                    The zones are EDGE_DRAG_HIT_WIDTH wide (an easy target, no
                    more tiny handles) and inset at the contacts so a contact
                    drag still wins there. Approved edges aren't draggable —
                    they keep a delete-only hit band over the visible ribbon. */}
                {(() => {
                  const openDeleteMenu = (e: React.MouseEvent<SVGElement>): void => {
                    if (!onRequestDeleteEdge) return
                    e.preventDefault()
                    e.stopPropagation()
                    // Render the menu AT the cursor, not the edge midpoint.
                    const svg = e.currentTarget.ownerSVGElement
                    const r = svg?.getBoundingClientRect()
                    setEdgeContextMenu({
                      x: r ? e.clientX - r.left : (xA + xB) / 2,
                      y: r ? e.clientY - r.top : (yA + yB) / 2,
                      edge: ce,
                    })
                  }
                  const canDrag = !approved && onUnapprovedDragStart !== undefined
                  if (canDrag) {
                    const dir = Math.sign(xB - xA) || 1
                    const slope = xB !== xA ? (yB - yA) / (xB - xA) : 0
                    const aX = xA + EDGE_HIT_END_INSET * dir
                    const aY = yA + (aX - xA) * slope
                    const bX = xB - EDGE_HIT_END_INSET * dir
                    const bY = yB + (bX - xB) * slope
                    const midX = (xA + xB) / 2
                    const midY = (yA + yB) / 2
                    return (
                      <>
                        <line
                          data-testid={`edge-grab-a-${ce.id}`}
                          x1={aX}
                          y1={aY}
                          x2={midX}
                          y2={midY}
                          stroke="transparent"
                          strokeWidth={EDGE_DRAG_HIT_WIDTH}
                          strokeLinecap="round"
                          style={{ pointerEvents: 'stroke', cursor: 'grab' }}
                          onMouseDown={e => {
                            if (e.button !== 0) return
                            e.stopPropagation()
                            onUnapprovedDragStart!(e, ce, 'a')
                          }}
                          onContextMenu={openDeleteMenu}
                        />
                        <line
                          data-testid={`edge-grab-b-${ce.id}`}
                          x1={midX}
                          y1={midY}
                          x2={bX}
                          y2={bY}
                          stroke="transparent"
                          strokeWidth={EDGE_DRAG_HIT_WIDTH}
                          strokeLinecap="round"
                          style={{ pointerEvents: 'stroke', cursor: 'grab' }}
                          onMouseDown={e => {
                            if (e.button !== 0) return
                            e.stopPropagation()
                            onUnapprovedDragStart!(e, ce, 'b')
                          }}
                          onContextMenu={openDeleteMenu}
                        />
                      </>
                    )
                  }
                  if (!onRequestDeleteEdge) return null
                  const half = EDGE_HIT_STROKE_WIDTH / 2
                  const hTopA = Math.min(topY_A, yA - half)
                  const hBotA = Math.max(botY_A, yA + half)
                  const hTopB = Math.min(topY_B, yB - half)
                  const hBotB = Math.max(botY_B, yB + half)
                  const dir = Math.sign(xB - xA) || 1
                  const hxA = xA + EDGE_HIT_END_INSET * dir
                  const hxB = xB - EDGE_HIT_END_INSET * dir
                  return (
                    <polygon
                      data-testid={`edge-hit-${ce.id}`}
                      // Follows the drawn ribbon, warps and all — a right-click
                      // target that runs straight across the columns a jump tie
                      // bends around is a target sitting where nothing is drawn.
                      points={warpAwareRibbonOutline(
                        hxA, hTopA, hBotA, ptA.along,
                        hxB, hTopB, hBotB, ptB.along,
                        placedColumns,
                      )}
                      fill="transparent"
                      style={{ pointerEvents: 'fill', cursor: 'context-menu' }}
                      onContextMenu={openDeleteMenu}
                    >
                      {/* Hover text: the tie is accepted but the fill did not band
                          it, so its bands stay two bodies (owner 2026-10-04). */}
                      {banding === 'not_banded' && (
                        <title>{t('sections.tie.acceptedNotBanded')}</title>
                      )}
                    </polygon>
                  )
                })()}
                {/* Awaiting-confirmation badge. A flagged tie is APPROVED work
                    whose anchor the rebuild could not identify with confidence,
                    so it keeps its accepted styling and gains a marker rather
                    than being restyled as a proposal. Right-clickable in its own
                    right — the ribbon can be a sliver at low spacing, and hunting
                    for the seam to clear a warning is how warnings get ignored. */}
                {isFlaggedForReview(ce) && (
                  <EdgeReviewBadge
                    edge={ce}
                    x={(xA + xB) / 2}
                    y={(yA + yB) / 2}
                    onContextMenu={
                      onRequestDeleteEdge
                        ? (e: React.MouseEvent<SVGElement>) => {
                            e.preventDefault()
                            e.stopPropagation()
                            const r = e.currentTarget.ownerSVGElement?.getBoundingClientRect()
                            setEdgeContextMenu({
                              x: r ? e.clientX - r.left : (xA + xB) / 2,
                              y: r ? e.clientY - r.top : (yA + yB) / 2,
                              edge: ce,
                            })
                          }
                        : undefined
                    }
                  />
                )}
              </g>
            )
          })}
        </g>
      )}

      {/* Contact-level gesture hit-targets (#133 Phase 1).
          When ``contactCorrelateMode`` is active, thin horizontal rects
          render centred on the topY of each contact's band across all
          placed columns.  Clicking a rect arms the contact as source (if
          nothing is armed yet) or fires ``onContactCorrelate`` (if the
          same contact boundary is clicked from a different column).
          Same-contact click (armed contact clicked again) clears the arm.
          Absent when ``contactGestureState`` is not provided or
          ``contactCorrelateMode`` is false. */}
      {contactCorrelateMode && (
        <g data-testid="contact-gesture-rects" style={{ pointerEvents: 'auto' }}>
          {contacts.map(c => {
            const pt = contactScreenMap.get(c.id)
            if (!pt) return null
            const col = placedColumns.find(col => {
              const inv = col.proj.item.id
              return inv === c.cpt_id || inv === c.borehole_id
            })
            if (!col) return null
            const hw = col.width / 2
            // Only light the band's TOP indicator when this contact's TOP is the
            // armed endpoint. A base-side arm (the bottom-of-test handle) lights
            // the floor marker instead — lighting the top here made clicking the
            // bottom marker "select the upper boundary" (dogfeed 2026-06-19).
            const isArmed = armedContactId === c.id && armedContactSide === 'top'
            // Full-band hit target (dogfeed 2026-05-29): clicking anywhere in a
            // band arms its TOP contact, so the band body — not just the thin
            // boundary line — is clickable.  Bands are contiguous and
            // non-overlapping, so a click resolves to exactly one band → one
            // contact; stacked lenses each get their own zone unambiguously
            // (no need to suppress correlation there).  Falls back to a thin
            // strip on the boundary line when the band geometry is unavailable.
            const invId = anchorId(c)
            // Look up by contact id (not formation_id) — same formation
            // appearing twice on one column gets distinct band entries; the
            // formation_id lookup collapsed them, drawing the shallower
            // contact's hit-rect at the deeper contact's depth (dogfeed
            // 2026-05-31: click upper SAND → lower SAND armed).
            const band = invId
              ? bandRect(invId, c.id, bandMap, levelToScreen, plotTop, plotBottom, hw)
              : null
            // Split the band into an UPPER half (arms THIS contact = the
            // band's top boundary) and a LOWER half (arms the boundary BELOW =
            // the next-deeper contact).  Clicking near a boundary thus arms the
            // NEAREST one, while the whole band stays clickable (dogfeed
            // 2026-05-29: full-band targets armed the top, so clicking a unit's
            // bottom edge wrongly selected its top edge).  No band geometry →
            // a single thin strip centred on the line.
            const top = band ? band.topY : pt.topY - CONTACT_HIT_HEIGHT / 2
            const bot = band ? band.botY : pt.topY + CONTACT_HIT_HEIGHT / 2
            // Lower-zone target: the next-deeper contact's top (the boundary
            // below).  The DEEPEST band has no contact below it (its base is the
            // column floor / where the test stopped), so ``lowerId`` is
            // undefined and its lower zone is INERT — clicking there must not
            // silently arm the band's own TOP (dogfeed 2026-06-08: "tried to
            // connect the bottom of the deepest sand and it grabbed the top").
            const lowerId = nextDeeperContactId.get(c.id)
            // Zone split — "the boundary line always wins" (correlateBandZones):
            // tall bands keep near-boundary zones + an inert middle (2026-05-29);
            // a thin band's interior arms its OWN top (the 2026-08-05 one-band-low
            // mis-click), while its bottom few px arm the base line (2026-08-07:
            // "I click the bottom of a clay unit but the correlation drew from
            // the top").
            const { topEnd, botStart } = correlateBandZones(
              top,
              bot,
              nextDeeperContactId.has(c.id),
            )
            return (
              <g key={`contact-hit-${c.id}`}>
                {/* Visible indicator line when this contact's boundary is armed */}
                {isArmed && (
                  <line
                    x1={pt.x - hw}
                    y1={pt.topY}
                    x2={pt.x + hw}
                    y2={pt.topY}
                    stroke={CONTACT_ARM_COLOR}
                    strokeWidth={2.5}
                    pointerEvents="none"
                  />
                )}
                {/* Upper zone (near the TOP boundary) → arms THIS contact. */}
                <rect
                  data-testid={`contact-hit-${c.id}`}
                  data-contact-id={c.id}
                  x={pt.x - hw}
                  y={top}
                  width={hw * 2}
                  height={Math.max(0, topEnd - top)}
                  fill="transparent"
                  stroke={isArmed ? CONTACT_ARM_COLOR : 'transparent'}
                  strokeWidth={isArmed ? 1 : 0}
                  strokeDasharray="3 2"
                  style={{ cursor: 'crosshair', pointerEvents: 'all' }}
                  onMouseEnter={() =>
                    setArmPreview({ y: pt.topY, x1: pt.x - hw, x2: pt.x + hw })
                  }
                  onMouseLeave={() => setArmPreview(null)}
                  onContextMenu={e => {
                    e.preventDefault()
                    onRequestDeleteContact?.(c.id)
                  }}
                  onClick={() => handleCorrelateClick(c.id, invId)}
                />
                {/* Inert middle (only when the band is taller than 2×NEAR):
                    captures the click — so it neither arms a far boundary nor
                    falls through to the band fill — but does nothing. */}
                {botStart > topEnd && (
                  <rect
                    data-testid={`contact-hit-${c.id}-mid`}
                    x={pt.x - hw}
                    y={topEnd}
                    width={hw * 2}
                    height={botStart - topEnd}
                    fill="transparent"
                    style={{ cursor: 'default', pointerEvents: 'all' }}
                    onMouseEnter={() => setArmPreview(null)}
                    onClick={e => e.stopPropagation()}
                  />
                )}
                {/* Lower zone (near the BOTTOM boundary) → arms the next-deeper
                    contact. For the DEEPEST band (no contact below it) this arms
                    THIS unit's BASE (side='base') — the bottom-tie. (Was inert
                    pre base-side support, to avoid wrongly grabbing the top;
                    dogfeed 2026-06-19: a 12px floor marker was too small to hit,
                    so the band's lower half is now the generous base hit-target —
                    bottom↔bottom ties via two lower zones.) */}
                {bot - botStart > 0 && (
                <rect
                  data-testid={`contact-hit-${c.id}-low`}
                  data-contact-id={lowerId ?? c.id}
                  x={pt.x - hw}
                  y={botStart}
                  width={hw * 2}
                  height={Math.max(0, bot - botStart)}
                  fill="transparent"
                  style={{ cursor: 'crosshair', pointerEvents: 'all' }}
                  onMouseEnter={() =>
                    setArmPreview({
                      // The boundary a click here arms: the next-deeper
                      // contact's line, or this band's own base (bottom-tie).
                      y: lowerId ? (contactScreenMap.get(lowerId)?.topY ?? bot) : bot,
                      x1: pt.x - hw,
                      x2: pt.x + hw,
                    })
                  }
                  onMouseLeave={() => setArmPreview(null)}
                  onContextMenu={
                    lowerId
                      ? e => {
                          e.preventDefault()
                          onRequestDeleteContact?.(lowerId)
                        }
                      : undefined
                  }
                  onClick={
                    lowerId
                      ? () => handleCorrelateClick(lowerId, invId)
                      : () => handleCorrelateClick(c.id, invId, 'base')
                  }
                />
                )}
              </g>
            )
          })}
          {/* Hover preview (owner 2026-08-07): the boundary line a click at
              the hovered zone WOULD arm — dashed and dimmer than the armed
              line, purely visual. Thin bands make top-vs-base ambiguous by
              position alone; this shows the answer before the click. */}
          {armPreview && (
            <line
              data-testid="contact-arm-preview"
              x1={armPreview.x1}
              y1={armPreview.y}
              x2={armPreview.x2}
              y2={armPreview.y}
              stroke={CONTACT_ARM_COLOR}
              strokeWidth={2}
              strokeDasharray="4 3"
              opacity={0.55}
              pointerEvents="none"
            />
          )}
        </g>
      )}

      {/* Bottom-of-test handles: one small interactive diamond per column in
          correlate mode so the user can draw a base↔base (or base↔top) tie
          from the open base of the deepest unit.  Only rendered in correlate
          mode to avoid visual noise in the normal section view.

          A column must have at least one contact to get a handle; columns
          with no contacts are skipped (nothing to tie from).  The handle
          targets the DEEPEST contact's id with side='base', which the API
          distinguishes from the same contact with side='top'. */}
      {contactCorrelateMode && (
        <g data-testid="bottom-handles">
          {placedColumns.flatMap(col => {
            const invId = col.proj.item.id
            const bands = bandMap.get(invId)
            if (!bands || bands.size === 0) return []

            // Find the deepest contact on this column (max depth_top_m).
            const contactsOnCol = contacts.filter(c => anchorId(c) === invId)
            if (contactsOnCol.length === 0) return []
            const deepest = contactsOnCol.reduce((a, b) =>
              b.depth_top_m > a.depth_top_m ? b : a,
            )

            // Column floor = botLevel of the deepest band entry, converted to
            // screen y.  Fall back to plotBottom if the band is missing.
            const deepestBand = bands.get(deepest.id)
            const floorY = deepestBand ? levelToScreen(deepestBand.botLevel) : plotBottom

            const colX = col.nudgedX
            const isBottomArmed =
              armedContactId === deepest.id && armedContactSide === 'base'

            return [
              <rect
                key={`bottom-handle-${invId}`}
                data-testid={`correlate-bottom-handle-${invId}`}
                x={colX - 6}
                y={floorY - 6}
                width={12}
                height={12}
                rx={2}
                fill={isBottomArmed ? CONTACT_ARM_COLOR : 'rgba(100,116,139,0.3)'}
                stroke={CONTACT_ARM_COLOR}
                strokeWidth={isBottomArmed ? 2 : 1}
                style={{ cursor: 'crosshair', pointerEvents: 'all' }}
                onClick={() => handleCorrelateClick(deepest.id, invId, 'base')}
              />,
            ]
          })}
        </g>
      )}

      {/* Lens-candidate markers (dogfeed 2026-05-29): enclosed contacts with no
          correlation on either neighbour — amber diamonds telling the user to
          pinch out, not correlate. Correlate-mode only so the normal view stays
          clean; purely visual (pointer-events none) — the band hit-rect beneath
          still owns clicks. */}
      {contactCorrelateMode && lensCandidateIds.size > 0 && (
        <g data-testid="lens-candidate-markers" style={{ pointerEvents: 'none' }}>
          {[...lensCandidateIds].map(id => {
            const pt = contactScreenMap.get(id)
            if (!pt) return null
            const s = 5
            return (
              <g key={`lens-cand-${id}`} data-testid={`lens-candidate-${id}`}>
                <path
                  d={`M ${pt.x} ${pt.topY - s} L ${pt.x + s} ${pt.topY} L ${pt.x} ${pt.topY + s} L ${pt.x - s} ${pt.topY} Z`}
                  fill="none"
                  stroke={LENS_CANDIDATE_COLOR}
                  strokeWidth={1.6}
                />
                <title>{t('sections.lens.candidateEither')}</title>
              </g>
            )
          })}
        </g>
      )}

      {/* Auto-lens pinch-out markers (2026-06-02): filled amber diamonds at the
          midpoint of each pinching layer surfaced by the last auto-correlate
          run. A crossing's edges were dropped (not drawn) and reported here —
          the diamond tells the user "this layer pinches out toward the
          neighbour; claim it as a lens". Purely visual (pointer-events none);
          shown on the litho axis regardless of correlate mode so it survives
          after Correlate. */}
      {crossingPinchOuts && crossingPinchOuts.length > 0 && (
        <g data-testid="crossing-pinch-out-markers" style={{ pointerEvents: 'none' }}>
          {crossingPinchOuts.map((po, i) => {
            const above = contactScreenMap.get(po.above_contact_id)
            const below = contactScreenMap.get(po.below_contact_id)
            if (!above || !below) return null
            const x = above.x
            const y = (above.topY + below.topY) / 2
            const s = 6
            return (
              <g
                key={`crossing-po-${po.above_contact_id}-${po.below_contact_id}-${i}`}
                data-testid={`crossing-pinch-out-${po.above_contact_id}`}
              >
                <path
                  d={`M ${x} ${y - s} L ${x + s} ${y} L ${x} ${y + s} L ${x - s} ${y} Z`}
                  fill={LENS_CANDIDATE_COLOR}
                  fillOpacity={0.85}
                  stroke={LENS_CANDIDATE_COLOR}
                  strokeWidth={1.4}
                />
                <title>{t('sections.lens.pinchOutCandidateFull')}</title>
              </g>
            )
          })}
        </g>
      )}

    </g>

      {/* Interactive layer — the context menus and the drag ghost live OUTSIDE
          the pointer-events:none root group (debt #68). The menus are
          <foreignObject>s: nesting them under a pointer-events:none ancestor
          made them clickable only because the ContextMenu re-enables
          pointer-events on the foreignObject, an SVG-spec quirk a Chromium bump
          could regress. As a sibling group they have no pointer-events:none
          ancestor to override, so the menu is reachable regardless of the
          overlay's pointer-events model. The drag ghost sets its own
          pointerEvents=none on the <line>, so its interactivity is unchanged. */}
    <g data-testid="correlation-edges-interactive">
      {/* Body-level context menu — right-click on a body chip (debt #100). */}
      {bodyContextMenu && (
        <BodyContextMenu
          menu={bodyContextMenu}
          onEditAdmixtures={handleBodyContextEditAdmixtures}
          onInspect={
            onInspectLensBody
              ? () => {
                  const { seedFormationId, ordinal } = bodyContextMenu
                  setBodyContextMenu(null)
                  onInspectLensBody(seedFormationId, ordinal)
                }
              : undefined
          }
          onClose={() => setBodyContextMenu(null)}
        />
      )}

      {/* Edge-level context menu — right-click on a correlation edge (#163e).
          Accept row appears only when the edge is still pending AND the
          caller wired an accept handler — an approved edge has nothing to
          accept (dogfeed 2026-05-31). */}
      {edgeContextMenu && onRequestDeleteEdge && (
        <EdgeContextMenu
          menu={edgeContextMenu}
          onDelete={() => {
            const { edge } = edgeContextMenu
            setEdgeContextMenu(null)
            onRequestDeleteEdge(edge)
          }}
          onAccept={
            onRequestAcceptEdge && !edgeContextMenu.edge.user_approved
              ? () => {
                  const { edge } = edgeContextMenu
                  setEdgeContextMenu(null)
                  onRequestAcceptEdge(edge)
                }
              : undefined
          }
          onConfirmReview={
            onRequestConfirmEdgeReview && isFlaggedForReview(edgeContextMenu.edge)
              ? () => {
                  const { edge } = edgeContextMenu
                  setEdgeContextMenu(null)
                  onRequestConfirmEdgeReview(edge)
                }
              : undefined
          }
          acceptLabel={acceptEdgeLabel}
          onClose={() => setEdgeContextMenu(null)}
        />
      )}

      {/* Drag-to-retarget ghost line (#133 Phase 2+3 Task 26).
          Rendered as a dashed amber line from the anchor endpoint to the
          cursor while the user is mid-drag.  pointerEvents=none so it
          does not interfere with the drop hit-test. */}
      {dragGhost && (
        <line
          data-testid="unapproved-drag-ghost"
          x1={dragGhost.x1}
          y1={dragGhost.y1}
          x2={dragGhost.x2}
          y2={dragGhost.y2}
          stroke={UNAPPROVED_EDGE_COLOR}
          strokeWidth={CONTACT_EDGE_WIDTH}
          strokeDasharray={UNAPPROVED_EDGE_DASH}
          opacity={0.75}
          pointerEvents="none"
        />
      )}

      {/* Admixture propagation editor — rendered outside the SVG <g> via a
          foreignObject so it can escape the SVG stacking context. The modal
          itself is Portal-ed; we only need to gate the mount here. */}
      {admixEditorState && (
        <foreignObject x={0} y={0} width={0} height={0} style={{ overflow: 'visible' }}>
          <LithoGhostCompositionEditor
            open={admixEditorState.open}
            initialMainSoilCode={admixEditorState.initialMainSoilCode}
            initialAdmixtures={admixEditorState.initialAdmixtures}
            mainSoilLocked
            onSave={async (_mainSoilCode, admixtures) => {
              setAdmixEditorState(null)
              if (onPropagateAdmixtures) {
                await onPropagateAdmixtures(admixEditorState.seedFormationId, admixtures)
              }
            }}
            onCancel={() => setAdmixEditorState(null)}
          />
        </foreignObject>
      )}
    </g>
    </>
  )
}
