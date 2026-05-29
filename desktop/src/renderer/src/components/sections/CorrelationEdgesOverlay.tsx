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
import type {
  FormationContactResponse,
  GeologicalFormationResponse,
  LithoContactCorrelationEdge,
} from '../../api/client'
import LithoGhostCompositionEditor from '../interpretation/LithoGhostCompositionEditor'
import type { GhostAdmixtureItem } from '../interpretation/LithoGhostCompositionEditor'
import ContextMenu from '../ui/ContextMenu'
import { columnMaxDepthM } from './utils'
import type { PlacedColumn } from './utils'

// ---------------------------------------------------------------------------
// Visual constants
// ---------------------------------------------------------------------------

/** Stroke colour for contact-level correlation edges (#133 Phase 1).
 *  Emerald-500 — also used as the body-chip halo ring colour. */
const CONTACT_EDGE_COLOR = '#10b981'
/** Stroke width for contact-level edges — slightly thicker than body
 *  edges so the two overlay types read distinctly when both are present. */
const CONTACT_EDGE_WIDTH = 1.8
/** Stroke colour for unapproved (pending) contact-level edges — amber-500.
 *  Distinct from the solid emerald of approved edges so the user can see
 *  at a glance which edges still need to be accepted. */
const UNAPPROVED_EDGE_COLOR = '#f59e0b'
/** Dash pattern for unapproved edges — dashed to signal provisional state. */
const UNAPPROVED_EDGE_DASH = '4 4'
/** Half-height (px) of the seam ribbon above and below the boundary line
 *  (#131-c). Fixed regardless of zoom so the ribbon reads consistently.
 *  Kept slim so stacked correlations don't occlude each other (owner
 *  dogfeed 2026-05-28 — the original ±12 box read as too tall). */
const RIBBON_HALF_HEIGHT_PX = 6
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
/** Correlate-select reach (px) around each boundary.  A click within this of a
 *  boundary arms it; the MIDDLE of a band taller than 2× this is inert, so a
 *  mid-band click never arms a far boundary (dogfeed 2026-05-29).  Thin bands
 *  (≤ 2× this) are split at their midpoint with no inert gap. */
const CONTACT_SELECT_NEAR_PX = 14
/** Chip background (dark slate-blue, matches the prior edge badge). */
const CHIP_BG = '#1e3a5f'
/** Chip foreground (off-white). */
const CHIP_FG = '#e2e8f0'
/** Chip font size in px. */
const CHIP_FONT_SIZE = 9
/** Per-band chip dimensions (fits "#NN" comfortably). */
const CHIP_WIDTH = 24
const CHIP_HEIGHT = 14
/** Inset from the band's top-right corner. */
const CHIP_INSET = 2
/** Below this band height the chip would overflow — skip the chip. */
const CHIP_MIN_BAND_HEIGHT = CHIP_HEIGHT + 2 * CHIP_INSET
/** Halo stroke width (the "this body is hovered" ring). */
const CHIP_HALO_WIDTH = 2
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
   * Investigation id of the most recent successful target while the same
   * source is still armed.  ``null`` when no edge has committed yet in the
   * current arm-cycle (or the source was just freshly armed).  Drives the
   * lens-pinch-out gesture (debt #135): a second click on a different
   * contact in the same target investigation fires a second correlation
   * from the still-armed source instead of clearing.
   */
  lastTargetTestId: string | null
  /** Arm a source contact by id. */
  onArmContact: (contactId: string) => void
  /** Clear armed state (stay in mode). */
  onClearArmedContact: () => void
  /** Fired when a valid target contact is clicked — POST contact edge. */
  onContactCorrelate: (contactAId: string, contactBId: string) => Promise<void>
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
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Get the investigation id (cpt_id or borehole_id) from a contact.
 */
function anchorId(c: FormationContactResponse): string | null {
  return c.cpt_id ?? c.borehole_id ?? null
}

/**
 * Build a map from (investigationId → (formationId → { topLevel, botLevel }))
 * from the contacts on this section.  Levels are absolute mTAW elevations.
 *
 * Band bottom = the next shallower contact's top level − the current
 * contact's top level converted from depth using the investigation's
 * surface elevation.  When no next contact exists the band bottom closes
 * at the investigation's own maximum depth (``max_depth_m`` for CPTs,
 * ``total_depth_m`` for boreholes), falling back to ``plotBottomLevel``
 * only when the depth field is absent.  This prevents the deepest band
 * from extending past the data column to the section-view floor (debt
 * #120).
 *
 * Parameters
 * ----------
 * contacts
 *     Section-filtered contacts.
 * columns
 *     Placed columns (carries surface elevation via proj.item.elevation_m
 *     and max depth via max_depth_m / total_depth_m).
 * plotBottomLevel
 *     Absolute level corresponding to the bottom of the visible plot,
 *     used as a fallback when the column depth field is absent.
 *
 * Returns
 * -------
 * Map<string, Map<string, { topLevel: number; botLevel: number }>>
 */
export function buildBandMap(
  contacts: readonly FormationContactResponse[],
  columns: readonly PlacedColumn[],
  plotBottomLevel: number,
): Map<string, Map<string, { topLevel: number; botLevel: number }>> {
  // investId → elevation_m (surface)
  const surfaceByInvest = new Map<string, number>()
  // investId → max measurement depth in m below surface
  const maxDepthByInvest = new Map<string, number>()
  for (const col of columns) {
    const elev = col.proj.item.elevation_m
    if (elev !== null && elev !== undefined) {
      surfaceByInvest.set(col.proj.item.id, elev)
    }
    const maxDepth = columnMaxDepthM(col)
    if (maxDepth !== null) {
      maxDepthByInvest.set(col.proj.item.id, maxDepth)
    }
  }

  // investId → sorted contacts (highest elevation first = shallowest)
  const byInvest = new Map<string, FormationContactResponse[]>()
  for (const c of contacts) {
    const inv = anchorId(c)
    if (inv === null) continue
    if (!byInvest.has(inv)) byInvest.set(inv, [])
    byInvest.get(inv)!.push(c)
  }

  const result = new Map<string, Map<string, { topLevel: number; botLevel: number }>>()

  for (const [investId, cList] of byInvest) {
    const surface = surfaceByInvest.get(investId)
    if (surface === undefined) continue

    // Sort by depth_top_m ascending (shallowest first)
    const sorted = [...cList].sort((a, b) => a.depth_top_m - b.depth_top_m)
    const bands = new Map<string, { topLevel: number; botLevel: number }>()

    const maxDepth = maxDepthByInvest.get(investId)
    // Deepest band closes at the investigation's actual bottom level, not the
    // section view's floor — prevents the band from extending past the data.
    const investigationBottomLevel =
      maxDepth !== undefined ? surface - maxDepth : plotBottomLevel

    for (let i = 0; i < sorted.length; i++) {
      const c = sorted[i]
      const topLevel = surface - c.depth_top_m
      const botLevel =
        i + 1 < sorted.length
          ? surface - sorted[i + 1].depth_top_m
          : investigationBottomLevel
      bands.set(c.formation_id, { topLevel, botLevel })
    }

    result.set(investId, bands)
  }

  return result
}

/**
 * Get the band screen rect (topY, botY, halfWidth) for correlate-mode click captures.
 */
function bandRect(
  investigationId: string,
  formationId: string,
  bandMap: Map<string, Map<string, { topLevel: number; botLevel: number }>>,
  levelToScreen: (l: number) => number,
  plotTop: number,
  plotBottom: number,
  halfWidth: number,
): { topY: number; botY: number } | null {
  const bands = bandMap.get(investigationId)
  if (!bands) return null
  const band = bands.get(formationId)
  if (!band) return null
  const topY = Math.max(plotTop, levelToScreen(band.topLevel))
  const botY = Math.min(plotBottom, levelToScreen(band.botLevel))
  if (botY <= topY) return null
  return { topY, botY }
}

/**
 * Build a map from contact id → ``{ x: number; topY: number }`` for each
 * contact that has a placed column on this section.  Used to draw
 * contact-level correlation edges as point-to-point lines anchored at the
 * top-boundary (topY) of the contact's band.
 *
 * Parameters
 * ----------
 * contacts
 *     Section-filtered contacts.
 * columns
 *     Placed columns (same list as passed to the component).
 * bandMap
 *     Pre-computed band map from ``buildBandMap``.
 * levelToScreen
 *     Elevation-to-screen converter.
 *
 * Returns
 * -------
 * Map<string, { x: number; topY: number; halfWidth: number }>
 *     Keyed by contact id.  ``x`` is the column centre, ``halfWidth`` is
 *     half the column's screen width (so the correlation ribbon can anchor
 *     at the column's inner edge instead of its centre).  Only contacts
 *     whose anchor column is on this section AND whose formation band
 *     exists in ``bandMap`` are included.
 */
export function buildContactScreenMap(
  contacts: readonly FormationContactResponse[],
  columns: readonly PlacedColumn[],
  bandMap: Map<string, Map<string, { topLevel: number; botLevel: number }>>,
  levelToScreen: (level: number) => number,
): Map<string, { x: number; topY: number; halfWidth: number }> {
  const result = new Map<string, { x: number; topY: number; halfWidth: number }>()
  for (const c of contacts) {
    const invId = anchorId(c)
    if (invId === null) continue
    const colBands = bandMap.get(invId)
    if (!colBands) continue
    const band = colBands.get(c.formation_id)
    if (!band) continue
    const col = columns.find(col => col.proj.item.id === invId)
    if (!col) continue
    result.set(c.id, {
      x: col.nudgedX,
      topY: levelToScreen(band.topLevel),
      halfWidth: col.width / 2,
    })
  }
  return result
}

/**
 * Resolve the lithology colour above and below each contact, for the
 * gradient correlation ribbon (#131-c).
 *
 * A contact marks the TOP of its formation, so the colour BELOW the
 * contact is its own formation's colour, and the colour ABOVE is the
 * next-shallower contact's formation colour on the same investigation
 * (``null`` when the contact is the topmost — only the ground surface is
 * above it).  Contacts grouped by investigation and sorted shallow-first.
 *
 * Parameters
 * ----------
 * contacts
 *     Section-filtered litho contacts.
 * formationById
 *     Formation lookup (id → formation), for the ``color`` field.
 *
 * Returns
 * -------
 * Map<string, { above: string | null; below: string }>
 *     Keyed by contact id.  Contacts whose OWN formation is missing from
 *     ``formationById`` are omitted entirely.  When only the predecessor
 *     (shallower) contact's formation is missing, the contact is still
 *     included with ``above = null`` (rendered as if topmost — no above
 *     stripe — rather than dropped).
 */
export function contactStripeColors(
  contacts: readonly FormationContactResponse[],
  formationById: ReadonlyMap<string, GeologicalFormationResponse>,
): Map<string, { above: string | null; below: string }> {
  const byInvest = new Map<string, FormationContactResponse[]>()
  for (const c of contacts) {
    const inv = anchorId(c)
    if (inv === null) continue
    const bucket = byInvest.get(inv)
    if (bucket) bucket.push(c)
    else byInvest.set(inv, [c])
  }
  const result = new Map<string, { above: string | null; below: string }>()
  for (const [, list] of byInvest) {
    const sorted = [...list].sort((a, b) => a.depth_top_m - b.depth_top_m)
    for (let i = 0; i < sorted.length; i += 1) {
      const c = sorted[i]
      const below = formationById.get(c.formation_id)?.color
      if (below === undefined) continue
      const prev = i > 0 ? sorted[i - 1] : null
      const above = prev ? (formationById.get(prev.formation_id)?.color ?? null) : null
      result.set(c.id, { above, below })
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// BodyChip sub-component
// ---------------------------------------------------------------------------

interface BodyChipProps {
  /** Top-left X of the chip in container coords. */
  x: number
  /** Top-left Y of the chip in container coords. */
  y: number
  /** Body ordinal (always non-null — caller filters before rendering). */
  ordinal: number
  /** True when the user is hovering any chip in this body's group; drives
   *  the halo ring + a slightly stronger background. */
  haloed: boolean
  /** mouseenter on the chip → caller sets hoveredBodyOrdinal = ordinal. */
  onMouseEnter: () => void
  /** mouseleave → caller clears the hovered ordinal. */
  onMouseLeave: () => void
  /** Right-click → caller opens the body-level context menu (edit
   *  admixtures + remove all correlations for this body). */
  onContextMenu: (e: React.MouseEvent<SVGGElement>) => void
  /** Test hook so the test can target a specific chip without DOM trickery. */
  testId: string
}

function BodyChip({
  x,
  y,
  ordinal,
  haloed,
  onMouseEnter,
  onMouseLeave,
  onContextMenu,
  testId,
}: BodyChipProps): JSX.Element {
  const text = `#${ordinal}`
  return (
    <g
      data-testid={testId}
      style={{ pointerEvents: 'auto', cursor: 'pointer' }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onContextMenu={onContextMenu}
    >
      {/* Halo ring — rendered FIRST so the chip body paints over it.
          Slightly larger than the chip so the ring reads as an outline. */}
      {haloed && (
        <rect
          x={x - CHIP_HALO_WIDTH / 2}
          y={y - CHIP_HALO_WIDTH / 2}
          width={CHIP_WIDTH + CHIP_HALO_WIDTH}
          height={CHIP_HEIGHT + CHIP_HALO_WIDTH}
          rx={4}
          fill="none"
          stroke={CONTACT_EDGE_COLOR}
          strokeWidth={CHIP_HALO_WIDTH}
          pointerEvents="none"
        />
      )}
      <rect
        x={x}
        y={y}
        width={CHIP_WIDTH}
        height={CHIP_HEIGHT}
        rx={3}
        fill={CHIP_BG}
        opacity={haloed ? 1 : 0.92}
      />
      <text
        x={x + CHIP_WIDTH / 2}
        y={y + CHIP_HEIGHT / 2 + CHIP_FONT_SIZE / 2 - 1}
        textAnchor="middle"
        fontSize={CHIP_FONT_SIZE}
        fill={CHIP_FG}
        fontFamily="monospace"
        pointerEvents="none"
      >
        {text}
      </text>
    </g>
  )
}

// ---------------------------------------------------------------------------
// BodyContextMenu — right-click on a body chip (debt #100)
// ---------------------------------------------------------------------------

interface BodyContextMenuState {
  x: number
  y: number
  /** Body ordinal — used to find every edge in this body's graph for the
   *  "remove all correlations" action and to seed the propagate call. */
  ordinal: number
  /** The chip's own formation id — passed as the seed for the admixture
   *  editor (the editor's seed determines initial values + propagation
   *  starting point; BFS already walks the body's graph from any seed). */
  seedFormationId: string
}

interface BodyContextMenuProps {
  menu: BodyContextMenuState
  onEditAdmixtures: () => void
  /** Removes every edge in the body's correlation graph. Caller fans the
   *  per-edge ``onUncorrelate`` calls and refreshes once on completion. */
  onRemoveAll: () => void
  /** Opens the InspectLensBodyPanel for this body (#101 Blocker 1). */
  onInspect?: () => void
  onClose: () => void
}

function BodyContextMenu({
  menu,
  onEditAdmixtures,
  onRemoveAll,
  onInspect,
  onClose,
}: BodyContextMenuProps): JSX.Element {
  return (
    <ContextMenu
      portal="svg"
      x={menu.x}
      y={menu.y}
      width={220}
      height={96}
      minWidth={220}
      testid="body-context-menu"
      onClose={onClose}
      items={[
        onInspect && {
          label: 'Inspect lens body…',
          onClick: onInspect,
          testid: 'body-context-inspect',
        },
        { label: 'Edit admixtures for this body', onClick: onEditAdmixtures },
        {
          label: 'Remove all correlations for this body',
          onClick: onRemoveAll,
          danger: true,
        },
      ]}
    />
  )
}

// ---------------------------------------------------------------------------
// EdgeContextMenu — right-click on a correlation edge (#163e)
// ---------------------------------------------------------------------------

interface EdgeContextMenuState {
  x: number
  y: number
  edge: LithoContactCorrelationEdge
}

interface EdgeContextMenuProps {
  menu: EdgeContextMenuState
  /** Deletes this correlation edge (caller owns the DELETE + refetch). */
  onDelete: () => void
  onClose: () => void
}

function EdgeContextMenu({ menu, onDelete, onClose }: EdgeContextMenuProps): JSX.Element {
  return (
    <ContextMenu
      portal="svg"
      x={menu.x}
      y={menu.y}
      width={200}
      height={48}
      minWidth={180}
      testid="edge-context-menu"
      onClose={onClose}
      items={[{ label: 'Delete correlation', onClick: onDelete, danger: true }]}
    />
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

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
}: Props): JSX.Element {
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
      correlated.add(e.contact_a_id)
      correlated.add(e.contact_b_id)
    }
    const byInv = new Map<string, FormationContactResponse[]>()
    for (const c of contacts) {
      const inv = anchorId(c)
      if (inv === null) continue
      const bucket = byInv.get(inv)
      if (bucket) bucket.push(c)
      else byInv.set(inv, [c])
    }
    const out = new Set<string>()
    for (const list of byInv.values()) {
      const sorted = [...list].sort((a, b) => a.depth_top_m - b.depth_top_m)
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
    const byInv = new Map<string, FormationContactResponse[]>()
    for (const c of contacts) {
      const inv = anchorId(c)
      if (inv === null) continue
      const bucket = byInv.get(inv)
      if (bucket) bucket.push(c)
      else byInv.set(inv, [c])
    }
    const out = new Map<string, string>()
    for (const list of byInv.values()) {
      const sorted = [...list].sort((a, b) => a.depth_top_m - b.depth_top_m)
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
    lastTargetTestId,
    onArmContact,
    onClearArmedContact,
    onContactCorrelate,
    onRequestDeleteContact,
  } = contactGestureState ?? {
    contactCorrelateMode: false,
    armedContactId: null,
    lastTargetTestId: null,
    onArmContact: (_: string) => {},
    onClearArmedContact: () => {},
    onContactCorrelate: async (_a: string, _b: string) => {},
    onRequestDeleteContact: undefined,
  }

  // Lens-aware correlate state machine (debt #135), parameterised by the
  // CLICKED contact so the upper/lower half-zones of a band can target
  // different boundaries (dogfeed 2026-05-29).  ``clickedTestId`` is the
  // clicked contact's investigation (same for both halves of a band).
  const handleCorrelateClick = (clickedId: string, clickedTestId: string | null): void => {
    if (armedContactId === clickedId) {
      // a) Click on the armed boundary → disarm.
      onClearArmedContact()
      return
    }
    if (armedContactId === null) {
      // b) Nothing armed → arm this boundary.
      onArmContact(clickedId)
      return
    }
    const armedContact = contacts.find(x => x.id === armedContactId)
    const armedTestId = armedContact ? anchorId(armedContact) : null
    if (armedTestId !== null && clickedTestId === armedTestId) {
      // c) Click in the source's own investigation → re-arm here.
      onArmContact(clickedId)
      return
    }
    if (lastTargetTestId !== null && clickedTestId !== null && clickedTestId === lastTargetTestId) {
      // d) Lens-pinch-out: another click in the same target investigation.
      void onContactCorrelate(armedContactId, clickedId)
      return
    }
    if (lastTargetTestId === null) {
      // e) First edge of this arm-cycle → fire correlation.
      void onContactCorrelate(armedContactId, clickedId)
      return
    }
    // f) Third unrelated investigation → conservative: re-arm here.
    onArmContact(clickedId)
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
      for (const [fId] of bands) {
        const formation = formationById.get(fId)
        if (!formation) continue
        if (formation.instance_ordinal === null) continue
        const rect = bandRect(invId, fId, bandMap, levelToScreen, plotTop, plotBottom, hw)
        if (!rect) continue
        const bandHeight = rect.botY - rect.topY
        if (bandHeight < CHIP_MIN_BAND_HEIGHT) continue
        const rightEdge = colX + hw
        rects.push({
          investigationId: invId,
          formationId: fId,
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

  const handleBodyContextRemoveAll = useCallback(() => {
    // Formation-level edges and their uncorrelate path were removed in
    // Task 21 (#133 Phase 2+3). The contact-level remove path will replace
    // this gesture when contact-edge uncorrelation is wired (post-Task 21).
    setBodyContextMenu(null)
  }, [])

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
            for (const [fId] of bands) {
              if (!pulsingFormationIds.has(fId)) continue
              const rect = bandRect(
                invId,
                fId,
                bandMap,
                levelToScreen,
                plotTop,
                plotBottom,
                halfW,
              )
              if (!rect) continue
              result.push(
                <rect
                  key={`pulse-${invId}-${fId}`}
                  data-testid={`correlation-pulse-${invId}-${fId}`}
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
            const ptA = contactScreenMap.get(ce.contact_a_id)
            const ptB = contactScreenMap.get(ce.contact_b_id)
            if (!ptA || !ptB) return null
            const approved = ce.user_approved
            const H = RIBBON_HALF_HEIGHT_PX
            // Anchor the ribbon at each column's INNER edge (the edge facing
            // the other column) so it bridges only the gap between columns
            // instead of running centre-to-centre over them (owner dogfeed
            // 2026-05-28). topY is unchanged — the contact level is constant
            // across the band, so the inner edge sits at the same depth.
            const aLeftOfB = ptA.x <= ptB.x
            const xA = aLeftOfB ? ptA.x + ptA.halfWidth : ptA.x - ptA.halfWidth
            const xB = aLeftOfB ? ptB.x - ptB.halfWidth : ptB.x + ptB.halfWidth
            const stripesA = stripeColorsByContactId.get(ce.contact_a_id)
            const stripesB = stripeColorsByContactId.get(ce.contact_b_id)
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
            const topY_A = showAbove ? ptA.topY - H : ptA.topY
            const topY_B = showAbove ? ptB.topY - H : ptB.topY
            const botY_A = showBelow ? ptA.topY + H : ptA.topY
            const botY_B = showBelow ? ptB.topY + H : ptB.topY
            return (
              <g
                key={`ribbon-${ce.id}`}
                data-testid={`ribbon-${ce.id}`}
                data-approved={approved ? 'true' : 'false'}
                pointerEvents="none"
              >
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
                {showAbove && (
                  <polygon
                    data-testid={`ribbon-above-${ce.id}`}
                    points={`${xA},${ptA.topY - H} ${xB},${ptB.topY - H} ${xB},${ptB.topY} ${xA},${ptA.topY}`}
                    fill={`url(#ribbon-above-grad-${ce.id})`}
                    fillOpacity={fillOpacity}
                  />
                )}
                {showBelow && (
                  <polygon
                    data-testid={`ribbon-below-${ce.id}`}
                    points={`${xA},${ptA.topY} ${xB},${ptB.topY} ${xB},${ptB.topY + H} ${xA},${ptA.topY + H}`}
                    fill={`url(#ribbon-below-grad-${ce.id})`}
                    fillOpacity={fillOpacity}
                  />
                )}
                {approved ? (
                  <line
                    data-testid={`ribbon-seam-${ce.id}`}
                    x1={xA} y1={ptA.topY} x2={xB} y2={ptB.topY}
                    stroke={RIBBON_SEAM_COLOR}
                    strokeWidth={1.5}
                    pointerEvents="none"
                  />
                ) : (
                  <polygon
                    data-testid={`ribbon-outline-${ce.id}`}
                    points={`${xA},${topY_A} ${xB},${topY_B} ${xB},${botY_B} ${xA},${botY_A}`}
                    fill="none"
                    stroke={UNAPPROVED_EDGE_COLOR}
                    strokeWidth={1.4}
                    strokeDasharray={UNAPPROVED_EDGE_DASH}
                    pointerEvents="none"
                  />
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
                      y: r ? e.clientY - r.top : (ptA.topY + ptB.topY) / 2,
                      edge: ce,
                    })
                  }
                  const canDrag = !approved && onUnapprovedDragStart !== undefined
                  if (canDrag) {
                    const dir = Math.sign(xB - xA) || 1
                    const slope = xB !== xA ? (ptB.topY - ptA.topY) / (xB - xA) : 0
                    const aX = xA + EDGE_HIT_END_INSET * dir
                    const aY = ptA.topY + (aX - xA) * slope
                    const bX = xB - EDGE_HIT_END_INSET * dir
                    const bY = ptB.topY + (bX - xB) * slope
                    const midX = (xA + xB) / 2
                    const midY = (ptA.topY + ptB.topY) / 2
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
                  const hTopA = Math.min(topY_A, ptA.topY - half)
                  const hBotA = Math.max(botY_A, ptA.topY + half)
                  const hTopB = Math.min(topY_B, ptB.topY - half)
                  const hBotB = Math.max(botY_B, ptB.topY + half)
                  const dir = Math.sign(xB - xA) || 1
                  const hxA = xA + EDGE_HIT_END_INSET * dir
                  const hxB = xB - EDGE_HIT_END_INSET * dir
                  return (
                    <polygon
                      data-testid={`edge-hit-${ce.id}`}
                      points={`${hxA},${hTopA} ${hxB},${hTopB} ${hxB},${hBotB} ${hxA},${hBotA}`}
                      fill="transparent"
                      style={{ pointerEvents: 'fill', cursor: 'context-menu' }}
                      onContextMenu={openDeleteMenu}
                    />
                  )
                })()}
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
            const isArmed = armedContactId === c.id
            // Full-band hit target (dogfeed 2026-05-29): clicking anywhere in a
            // band arms its TOP contact, so the band body — not just the thin
            // boundary line — is clickable.  Bands are contiguous and
            // non-overlapping, so a click resolves to exactly one band → one
            // contact; stacked lenses each get their own zone unambiguously
            // (no need to suppress correlation there).  Falls back to a thin
            // strip on the boundary line when the band geometry is unavailable.
            const invId = anchorId(c)
            const band = invId
              ? bandRect(invId, c.formation_id, bandMap, levelToScreen, plotTop, plotBottom, hw)
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
            const mid = (top + bot) / 2
            // Lower-zone target: the next-deeper contact's top (the boundary
            // below).  Deepest band (no next) → this contact (its only edge).
            const lowerId = nextDeeperContactId.get(c.id) ?? c.id
            // Near-boundary zones (dogfeed 2026-05-29): a click within
            // CONTACT_SELECT_NEAR_PX of a boundary arms it; the MIDDLE of a band
            // taller than 2×NEAR is inert, so a mid-band click never arms a far
            // boundary.  Thin bands collapse to a midpoint split (no inert gap).
            const topEnd = Math.min(top + CONTACT_SELECT_NEAR_PX, mid)
            const botStart = Math.max(bot - CONTACT_SELECT_NEAR_PX, mid)
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
                    onClick={e => e.stopPropagation()}
                  />
                )}
                {/* Lower zone (near the BOTTOM boundary) → arms the next-deeper. */}
                <rect
                  data-testid={`contact-hit-${c.id}-low`}
                  data-contact-id={lowerId}
                  x={pt.x - hw}
                  y={botStart}
                  width={hw * 2}
                  height={Math.max(0, bot - botStart)}
                  fill="transparent"
                  style={{ cursor: 'crosshair', pointerEvents: 'all' }}
                  onContextMenu={e => {
                    e.preventDefault()
                    onRequestDeleteContact?.(lowerId)
                  }}
                  onClick={() => handleCorrelateClick(lowerId, invId)}
                />
              </g>
            )
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
                <title>
                  Lens candidate — no correlation on either neighbour. Pinch it out
                  rather than correlate it.
                </title>
              </g>
            )
          })}
        </g>
      )}

      {/* Body-level context menu — right-click on a body chip (debt #100). */}
      {bodyContextMenu && (
        <BodyContextMenu
          menu={bodyContextMenu}
          onEditAdmixtures={handleBodyContextEditAdmixtures}
          onRemoveAll={() => void handleBodyContextRemoveAll()}
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

      {/* Edge-level context menu — right-click on a correlation edge (#163e). */}
      {edgeContextMenu && onRequestDeleteEdge && (
        <EdgeContextMenu
          menu={edgeContextMenu}
          onDelete={() => {
            const { edge } = edgeContextMenu
            setEdgeContextMenu(null)
            onRequestDeleteEdge(edge)
          }}
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
  )
}
