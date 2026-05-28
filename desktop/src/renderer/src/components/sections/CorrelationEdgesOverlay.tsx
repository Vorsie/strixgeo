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
/** Dash pattern for contact-level edges — solid (no dash) so they
 *  contrast visually with the dashed formation-level lines. */
const CONTACT_EDGE_DASH = 'none'
/** Ambient opacity for contact-level edges (same policy as body edges). */
const CONTACT_EDGE_OPACITY = 0.65
/** Stroke colour for unapproved (pending) contact-level edges — amber-500.
 *  Distinct from the solid emerald of approved edges so the user can see
 *  at a glance which edges still need to be accepted. */
const UNAPPROVED_EDGE_COLOR = '#f59e0b'
/** Dash pattern for unapproved edges — dashed to signal provisional state. */
const UNAPPROVED_EDGE_DASH = '4 4'
/** Hit target height around each contact top-boundary line (±px), used
 *  as the clickable rect height when contactCorrelateMode is active. */
const CONTACT_HIT_HEIGHT = 12
/** Stroke colour for armed contact boundary line. */
const CONTACT_ARM_COLOR = '#34d399'
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
/** Size of the drag-grab handles rendered at each endpoint of an
 *  unapproved edge so the user can re-target it (#133 Phase 2+3). */
const DRAG_HANDLE_SIZE = 8

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
 * Map<string, { x: number; topY: number }>
 *     Keyed by contact id.  Only contacts whose anchor column is on this
 *     section AND whose formation band exists in ``bandMap`` are included.
 */
export function buildContactScreenMap(
  contacts: readonly FormationContactResponse[],
  columns: readonly PlacedColumn[],
  bandMap: Map<string, Map<string, { topLevel: number; botLevel: number }>>,
  levelToScreen: (level: number) => number,
): Map<string, { x: number; topY: number }> {
  const result = new Map<string, { x: number; topY: number }>()
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
  const itemStyle: React.CSSProperties = {
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
  return (
    <foreignObject
      x={menu.x}
      y={menu.y}
      width={220}
      height={96}
      style={{ overflow: 'visible' }}
    >
      <div
        data-testid="body-context-menu"
        style={{
          position: 'absolute',
          background: 'var(--color-surface-overlay, #1e293b)',
          border: '1px solid var(--color-border-default, #334155)',
          borderRadius: 6,
          boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          zIndex: 9999,
          minWidth: 220,
        }}
      >
        {onInspect && (
          <button type="button" style={itemStyle} onClick={onInspect}
            data-testid="body-context-inspect"
          >
            Inspect lens body…
          </button>
        )}
        <button type="button" style={itemStyle} onClick={onEditAdmixtures}>
          Edit admixtures for this body
        </button>
        <button
          type="button"
          style={{ ...itemStyle, color: 'var(--color-text-danger, #f87171)' }}
          onClick={onRemoveAll}
        >
          Remove all correlations for this body
        </button>
      </div>
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
        onClick={onClose}
        onContextMenu={e => {
          e.preventDefault()
          onClose()
        }}
      />
    </foreignObject>
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
}: Props): JSX.Element {
  /** Ref on the root <g> so we can convert viewport coords to SVG-local
   *  coords for the drag ghost line by reading ownerSVGElement.getBoundingClientRect(). */
  const rootGRef = useRef<SVGGElement>(null)

  /** Body-level context menu (debt #100) — opened by right-clicking a
   *  body chip. */
  const [bodyContextMenu, setBodyContextMenu] = useState<BodyContextMenuState | null>(null)

  /** Hovered body ordinal (debt #100). null = no hover; chip halos hidden. */
  const [hoveredBodyOrdinal, setHoveredBodyOrdinal] = useState<number | null>(null)

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

      {/* Contact-level correlation edges (#133 Phase 1).
          Point-to-point solid emerald lines between the topY of each
          correlated contact's band.  Distinct from the formation-level
          dashed blue lines so both overlay types are readable when active
          simultaneously.  Each line renders from contact_a's column
          nudgedX at its band topY to contact_b's equivalent.
          Absent when ``contactEdges`` is undefined (no regression). */}
      {contactEdges && contactEdges.length > 0 && (
        <g data-testid="contact-edges-overlay">
          {contactEdges.map(ce => {
            const ptA = contactScreenMap.get(ce.contact_a_id)
            const ptB = contactScreenMap.get(ce.contact_b_id)
            if (!ptA || !ptB) return null
            const approved = ce.user_approved
            const hs = DRAG_HANDLE_SIZE
            return (
              <g key={`contact-edge-${ce.id}`} pointerEvents="none">
                <line
                  data-testid={`contact-edge-${ce.id}`}
                  data-approved={approved ? 'true' : 'false'}
                  x1={ptA.x}
                  y1={ptA.topY}
                  x2={ptB.x}
                  y2={ptB.topY}
                  stroke={approved ? CONTACT_EDGE_COLOR : UNAPPROVED_EDGE_COLOR}
                  strokeWidth={CONTACT_EDGE_WIDTH}
                  strokeDasharray={approved ? CONTACT_EDGE_DASH : UNAPPROVED_EDGE_DASH}
                  opacity={CONTACT_EDGE_OPACITY}
                  pointerEvents="none"
                />
                {/* Grab handles — only on unapproved edges, visible + interactive
                    so the user can drag an endpoint to a different contact. */}
                {!approved && onUnapprovedDragStart && (
                  <>
                    <rect
                      data-testid={`unapproved-handle-a-${ce.id}`}
                      x={ptA.x - hs / 2}
                      y={ptA.topY - hs / 2}
                      width={hs}
                      height={hs}
                      rx={2}
                      fill={UNAPPROVED_EDGE_COLOR}
                      opacity={0.85}
                      style={{ cursor: 'grab', pointerEvents: 'auto' }}
                      onMouseDown={e => {
                        e.stopPropagation()
                        onUnapprovedDragStart(e, ce, 'a')
                      }}
                    />
                    <rect
                      data-testid={`unapproved-handle-b-${ce.id}`}
                      x={ptB.x - hs / 2}
                      y={ptB.topY - hs / 2}
                      width={hs}
                      height={hs}
                      rx={2}
                      fill={UNAPPROVED_EDGE_COLOR}
                      opacity={0.85}
                      style={{ cursor: 'grab', pointerEvents: 'auto' }}
                      onMouseDown={e => {
                        e.stopPropagation()
                        onUnapprovedDragStart(e, ce, 'b')
                      }}
                    />
                  </>
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
            const rectY = pt.topY - CONTACT_HIT_HEIGHT / 2
            const isArmed = armedContactId === c.id
            return (
              <g key={`contact-hit-${c.id}`}>
                {/* Visible indicator line when this contact is armed */}
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
                {/* Invisible click-capture rect */}
                <rect
                  data-testid={`contact-hit-${c.id}`}
                  data-contact-id={c.id}
                  x={pt.x - hw}
                  y={rectY}
                  width={hw * 2}
                  height={CONTACT_HIT_HEIGHT}
                  fill="transparent"
                  stroke={isArmed ? CONTACT_ARM_COLOR : 'transparent'}
                  strokeWidth={isArmed ? 1 : 0}
                  strokeDasharray="3 2"
                  style={{ cursor: 'crosshair', pointerEvents: 'all' }}
                  onContextMenu={e => {
                    e.preventDefault()
                    onRequestDeleteContact?.(c.id)
                  }}
                  onClick={() => {
                    // Lens-aware state machine (debt #135).  After the first
                    // successful correlation in an arm-cycle the source stays
                    // armed and ``lastTargetTestId`` carries the target's
                    // investigation.  A subsequent click on a different
                    // contact in the SAME target investigation fires a second
                    // edge from the same source — the lens-pinch-out gesture.
                    // Clicks elsewhere clear the sticky state instead of
                    // auto-firing across unrelated tests.
                    if (isArmed) {
                      // a) Click on the armed source → disarm everything.
                      onClearArmedContact()
                      return
                    }
                    if (armedContactId === null) {
                      // b) Nothing armed → arm this contact.
                      onArmContact(c.id)
                      return
                    }
                    // Source is armed and the click is on some other contact.
                    const clickedTestId = anchorId(c)
                    const armedContact = contacts.find(x => x.id === armedContactId)
                    const armedTestId = armedContact ? anchorId(armedContact) : null
                    if (armedTestId !== null && clickedTestId === armedTestId) {
                      // c) Click in the source's own investigation → re-arm
                      //    to this contact (start a new gesture from here).
                      //    Also clears the sticky lens window.
                      onArmContact(c.id)
                      return
                    }
                    if (
                      lastTargetTestId !== null &&
                      clickedTestId !== null &&
                      clickedTestId === lastTargetTestId
                    ) {
                      // d) Lens-pinch-out: another click in the same target
                      //    investigation while the source is still armed.
                      //    Generalises to N≥2 clicks (stacked lenses).
                      void onContactCorrelate(armedContactId, c.id)
                      return
                    }
                    if (lastTargetTestId === null) {
                      // e) First edge of this arm-cycle → fire correlation.
                      //    SectionsCanvas will keep the source armed and
                      //    record ``lastTargetTestId`` on success.
                      void onContactCorrelate(armedContactId, c.id)
                      return
                    }
                    // f) Click in some third investigation (neither source's
                    //    nor the last-target's) → conservative: do NOT
                    //    auto-fire across an unrelated test.  Clear sticky
                    //    + re-arm to this contact so the user can start a
                    //    fresh gesture from here.
                    onArmContact(c.id)
                  }}
                />
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
