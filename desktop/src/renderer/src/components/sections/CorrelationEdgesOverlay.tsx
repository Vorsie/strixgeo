/**
 * SVG overlay for litho correlation edges on a cross-section.
 *
 * Responsibilities
 * ----------------
 * - Per-band body chip: every band whose formation has a non-null
 *   ``instance_ordinal`` gets a small ``#N`` chip in its top-right
 *   corner. The chip is the always-on "this is the same body" signal
 *   AND the primary hover surface for revealing edge lines.
 * - Edge lines (hidden by default, revealed on demand): dashed blue
 *   ``5 3`` lines between band midpoints. Visible only when the user
 *   hovers a chip whose ordinal matches one of the edge's endpoints —
 *   eliminates the crisscrossing-spaghetti effect (debt #100).
 * - Chip halo: on hover, every chip of the same body lights up with a
 *   thin ring so the connection reads visually before the lines
 *   themselves animate in.
 * - Chip right-click: body-level context menu — "Edit admixtures for
 *   this body" (propagates via ``onPropagateAdmixtures``) and "Remove
 *   all correlations for this body" (sums ``onUncorrelate`` per edge
 *   in the body's graph). Replaces the right-click-on-edge-line menu
 *   as the primary surface; the line menu is kept as a fallback for
 *   the moment the line is visible.
 * - True-spacing warning: amber header when ``correlateMode`` and any
 *   adjacent column spacing < 1 m.
 * - Correlate-mode overlays: armed source 2px accent outline + floating
 *   label; valid targets dim tint + dashed border; cross-group cursor
 *   not-allowed; invisible click-capture rects over every unit band.
 *
 * Hover state is local to this component (no cross-component plumbing).
 * Inspector-select sticky reveal is a follow-on debt item — landing it
 * needs a shared ``selectedFormationId`` state across the inspector and
 * the section overlay.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  FormationContactResponse,
  GeologicalFormationResponse,
  LithoContactCorrelationEdge,
  LithoCorrelationEdge,
} from '../../api/client'
import LithoGhostCompositionEditor from '../interpretation/LithoGhostCompositionEditor'
import type { GhostAdmixtureItem } from '../interpretation/LithoGhostCompositionEditor'
import type { CorrelationSource } from './useCorrelate'
import { columnMaxDepthM } from './utils'
import type { PlacedColumn } from './utils'

// ---------------------------------------------------------------------------
// Visual constants
// ---------------------------------------------------------------------------

/** Dash pattern for manually-drawn correlation edges. */
const EDGE_DASH = '5 3'
/** Stroke colour for contact-level correlation edges (#133 Phase 1).
 *  Chosen as Tailwind emerald-500 to visually distinguish from the
 *  formation-level blue edges.  Contact edges are point-to-point lines
 *  between the topY of each correlated contact's band; no ribbon. */
const CONTACT_EDGE_COLOR = '#10b981'
/** Stroke width for contact-level edges — slightly thicker than body
 *  edges so the two overlay types read distinctly when both are present. */
const CONTACT_EDGE_WIDTH = 1.8
/** Dash pattern for contact-level edges — solid (no dash) so they
 *  contrast visually with the dashed formation-level lines. */
const CONTACT_EDGE_DASH = 'none'
/** Ambient opacity for contact-level edges (same policy as body edges). */
const CONTACT_EDGE_OPACITY = 0.65
/** Hit target height around each contact top-boundary line (±px), used
 *  as the clickable rect height when contactCorrelateMode is active. */
const CONTACT_HIT_HEIGHT = 12
/** Stroke colour for armed contact boundary line. */
const CONTACT_ARM_COLOR = '#34d399'
/** Dash pattern for auto-correlated edges — tighter gap signals provisional. */
const EDGE_DASH_AUTO = '3 5'
/**
 * Ambient opacity for committed (manual + auto) edges — always-on at low
 * value so the connection graph is readable without dominating the section.
 * Debt #122: dropped from full opacity to address the "too many lines"
 * dogfeed complaint (2026-05-24). Suggestion edges (future source) would
 * stay prominent; current sources 'manual' and 'auto' use this path.
 */
const EDGE_OPACITY_AMBIENT = 0.20
/**
 * Hovered opacity — spikes when any chip of the same body is hovered,
 * matching the chip-halo behaviour (debt #122). Applies to committed
 * edges only; the chip hover already gates which body is active.
 */
const EDGE_OPACITY_HOVERED = 0.80
/** Edge stroke colour (Tailwind blue-500). */
const EDGE_COLOR = '#3b82f6'
/**
 * Fill opacity for the correlation-body ribbon polygon (debt #121).
 * Low enough not to obscure the CPT/borehole data behind it; the
 * boundary lines and chip chips carry the primary visual weight.
 */
const RIBBON_FILL_OPACITY = 0.18
/** Fill colour for the ribbon polygon (Tailwind blue-400). */
const RIBBON_FILL_COLOR = '#60a5fa'
/** Stroke width for the ribbon top + base boundary lines. */
const RIBBON_BOUNDARY_WIDTH = 0.8
/** Edge stroke width in pixels. */
const EDGE_WIDTH = 1.5
/** Half-width of the invisible hit rect around an edge line. */
const EDGE_HIT_PADDING = 8
/** Armed source outline width. */
const ARM_OUTLINE_WIDTH = 2
/** Armed source outline colour (Tailwind blue-400). */
const ARM_OUTLINE_COLOR = '#60a5fa'
/** Valid target tint (Tailwind blue-500 @ low opacity). */
const VALID_TARGET_FILL = 'rgba(59, 130, 246, 0.12)'
/** Valid target dashed border colour. */
const VALID_TARGET_STROKE = '#3b82f6'
/** Chip background (dark slate-blue, matches the prior edge badge). */
const CHIP_BG = '#1e3a5f'
/** Chip foreground (off-white). */
const CHIP_FG = '#e2e8f0'
/** Amber accent used for the true-spacing warning. */
const BADGE_AMBER = '#d97706'
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
/** True-spacing warning threshold in metres. */
const TRUE_SPACING_WARN_M = 1.0

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Gesture-state slice SectionsCanvas passes down for correlate-mode UI. */
export interface CorrelateGestureState {
  /** Whether correlate mode is active. */
  correlateMode: boolean
  /** Currently armed source unit, null when in mode but nothing armed. */
  correlationSource: CorrelationSource | null
  /** Arm a source unit. */
  onArm: (src: CorrelationSource) => void
  /** Clear armed state (Esc L1 — stay in mode). */
  onClearArmed: () => void
  /** Exit correlate mode entirely. */
  onExitMode: () => void
  /** Fired when a valid target is clicked — POST edge + resolve. */
  onCorrelate: (formationAId: string, formationBId: string) => Promise<void>
  /** Fired when an edge is right-clicked → Remove correlation. */
  onUncorrelate: (formationAId: string, formationBId: string) => Promise<void>
  /**
   * Fired when the user saves from "Edit admixtures for this body".
   * ``seedFormationId`` is the seed for BFS; ``admixtures`` are the new
   * admixtures to write to every formation in the connected component.
   * Optional so existing gesture-state consumers that don't provide the
   * context-menu path (e.g. test helpers) don't need to supply a stub.
   */
  onPropagateAdmixtures?: (
    seedFormationId: string,
    admixtures: GhostAdmixtureItem[],
  ) => Promise<void>
}

/**
 * Gesture state for the contact-level (boundary-to-boundary) correlate
 * gesture (#133 Phase 1).  Separate from ``CorrelateGestureState`` so
 * the new gesture does not break existing callers of the body-level path.
 *
 * State machine mirrors the body-level path: Idle → enterMode → Armed →
 * fire onContactCorrelate → Idle.  The mode toggle is surfaced in the
 * correlate-mode toolbar: a "Boundary" tab next to the existing "Body" tab.
 */
export interface ContactGestureState {
  /** Whether boundary-click gesture mode is active (sub-mode of correlateMode). */
  contactCorrelateMode: boolean
  /** Id of the currently armed source contact, null when nothing armed. */
  armedContactId: string | null
  /** Arm a source contact by id. */
  onArmContact: (contactId: string) => void
  /** Clear armed state (stay in mode). */
  onClearArmedContact: () => void
  /** Fired when a valid target contact is clicked — POST contact edge. */
  onContactCorrelate: (contactAId: string, contactBId: string) => Promise<void>
  /** Fired when a contact edge is right-clicked → remove. */
  onContactUncorrelate: (contactAId: string, contactBId: string) => Promise<void>
}

interface Props {
  /** Correlation edges for the active litho model. */
  edges: readonly LithoCorrelationEdge[]
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
  /** Optional gesture state; absent = read-only mode (no click capture). */
  correlateGestureState?: CorrelateGestureState
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
   * Callback fired when the user clicks a band that cannot be used as
   * a correlation target — cross-group bands (different formation type)
   * or same-investigation bands (self-edge blocked).  Carries a human-
   * readable reason string so the caller can surface a toast.
   * Optional; omitting it leaves the interaction silently blocked
   * (safe default for read-only or test contexts).
   */
  onRejectCorrelate?: (reason: string) => void
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
 * One column's contribution to a ribbon polygon.
 *
 * ``x``      — screen X of the column (nudgedX).
 * ``topY``   — screen Y of the band's top edge at this column.
 * ``botY``   — screen Y of the band's bottom edge at this column.
 */
export interface RibbonColumn {
  x: number
  topY: number
  botY: number
}

/**
 * Build the SVG ``points`` attribute for a correlation-body ribbon polygon.
 *
 * The ribbon is a closed polygon spanning N ordered columns.  It is rendered
 * as a single shape rather than N−1 separate quads so adjacent-column
 * boundaries don't produce distracting interior seam lines.
 *
 * Shape: forward along the top edge (left→right), then back along the bottom
 * edge (right→left), closed back to the first top point.  Each column
 * contributes two vertices on the top edge and two on the bottom edge, giving
 * the fill a piecewise-linear profile that matches the band extent exactly.
 *
 * Parameters
 * ----------
 * columns
 *     The columns that carry this body, ordered left-to-right by screen X.
 *     Must have at least 2 entries — a single-column body has no edge to
 *     draw.
 *
 * Returns
 * -------
 * string
 *     SVG ``points`` attribute value (space-separated ``x,y`` pairs), or
 *     empty string when ``columns.length < 2``.
 */
export function computeRibbonPoints(columns: readonly RibbonColumn[]): string {
  if (columns.length < 2) return ''
  const topPts = columns.map(c => `${c.x.toFixed(2)},${c.topY.toFixed(2)}`)
  const botPts = [...columns].reverse().map(c => `${c.x.toFixed(2)},${c.botY.toFixed(2)}`)
  return [...topPts, ...botPts].join(' ')
}

/**
 * Compute the column screen X (nudgedX) for a given investigation id.
 */
function columnXForInvest(
  investigationId: string,
  columns: readonly PlacedColumn[],
): number | null {
  const col = columns.find(c => c.proj.item.id === investigationId)
  return col ? col.nudgedX : null
}

/**
 * Get the band-midpoint screen Y for a formation at an investigation.
 * Returns null if the investigation or formation is not on this section.
 */
function bandMidY(
  investigationId: string,
  formationId: string,
  bandMap: Map<string, Map<string, { topLevel: number; botLevel: number }>>,
  levelToScreen: (l: number) => number,
): number | null {
  const bands = bandMap.get(investigationId)
  if (!bands) return null
  const band = bands.get(formationId)
  if (!band) return null
  const midLevel = (band.topLevel + band.botLevel) / 2
  return levelToScreen(midLevel)
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
          stroke={EDGE_COLOR}
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
// Context-menu sub-component (uncorrelate)
// ---------------------------------------------------------------------------

interface ContextMenuState {
  x: number
  y: number
  formationAId: string
  formationBId: string
}

interface EdgeContextMenuProps {
  menu: ContextMenuState
  onRemove: () => void
  onEditAdmixtures: () => void
  onClose: () => void
}

function EdgeContextMenu({
  menu,
  onRemove,
  onEditAdmixtures,
  onClose,
}: EdgeContextMenuProps): JSX.Element {
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
    // Rendered as a foreignObject to get real HTML for the context menu
    <foreignObject
      x={menu.x}
      y={menu.y}
      width={190}
      height={64}
      style={{ overflow: 'visible' }}
    >
      <div
        style={{
          position: 'absolute',
          background: 'var(--color-surface-overlay, #1e293b)',
          border: '1px solid var(--color-border-default, #334155)',
          borderRadius: 6,
          boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          zIndex: 9999,
          minWidth: 190,
        }}
      >
        <button type="button" style={itemStyle} onClick={onEditAdmixtures}>
          Edit admixtures for this body
        </button>
        <button type="button" style={{ ...itemStyle, color: 'var(--color-text-danger, #f87171)' }} onClick={onRemove}>
          Remove correlation
        </button>
      </div>
      {/* Dismiss on outside click */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9998,
        }}
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
 * edges
 *     Correlation edges for the active litho model.
 * contacts
 *     Section-filtered contacts (used to compute band positions).
 * formations
 *     Active litho formation vocabulary.
 * placedColumns
 *     Placed columns with screen X (nudgedX) and width.
 * levelToScreen
 *     Converts absolute elevation (mTAW) → screen Y.
 * plotTop
 *     Top of the plot area in screen px.
 * plotBottom
 *     Bottom of the plot area in screen px.
 * correlateGestureState
 *     Gesture callbacks; absent = read-only (edges visible, no gesture UI).
 *
 * Returns
 * -------
 * JSX.Element
 *     An SVG ``<g>`` containing all edge lines, badges, and gesture rects.
 */
export default function CorrelationEdgesOverlay({
  edges,
  contacts,
  formations,
  placedColumns,
  levelToScreen,
  plotTop,
  plotBottom,
  correlateGestureState,
  pulsingFormationIds,
  onInspectLensBody,
  onRejectCorrelate,
  contactEdges,
  contactGestureState,
}: Props): JSX.Element {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  /** Body-level context menu (debt #100) — opened by right-clicking a
   *  body chip. Distinct from ``contextMenu`` (edge-level, kept as the
   *  fallback for a hovered/visible edge line). Only one menu open at
   *  a time. */
  const [bodyContextMenu, setBodyContextMenu] = useState<BodyContextMenuState | null>(null)

  /** Hovered body ordinal (debt #100). null = no hover; edges hidden.
   *  When set, every edge whose endpoint formations both carry this
   *  ordinal reveals, and every chip with this ordinal lights up with
   *  the halo. Cleared on mouseleave. */
  const [hoveredBodyOrdinal, setHoveredBodyOrdinal] = useState<number | null>(null)

  // State for the admixture editor modal opened from the context menu.
  // Stores the seed formation (formation_a_id of the right-clicked edge)
  // so the editor can be seeded with the current main code + admixtures
  // and the propagate call has the right seed id.
  const [admixEditorState, setAdmixEditorState] = useState<{
    open: boolean
    seedFormationId: string
    initialMainSoilCode: string
    initialAdmixtures: GhostAdmixtureItem[]
  } | null>(null)

  // Drag-arm state (debt #78 — drag-inside-correlate-mode). A mousedown
  // on an un-armed band arms the source AND starts tracking the pointer
  // in SVG coords so we can render a preview line. The mouseup handler
  // then hit-tests the cursor against another band rect via the DOM
  // `data-testid="correlate-arm-*" / "correlate-target-*"` attribute
  // and fires onCorrelate if it lands on a different band.
  //
  // currentSvgX/Y track the cursor in the overlay's SVG coordinate
  // space (clientX − svgRect.left, identity transform — no zoom inside
  // SectionPanel's SVG). srcCx / srcCy are the source band's centre in
  // the same coord space so the preview line is a single SVG <line>.
  const [drag, setDrag] = useState<{
    srcInvestigationId: string
    srcFormationId: string
    srcCx: number
    srcCy: number
    currentSvgX: number
    currentSvgY: number
  } | null>(null)

  // Anchor used to invert clientX/Y → SVG coords. Placed on the root
  // <g> so getBoundingClientRect() gives the overlay's screen origin.
  const rootRef = useRef<SVGGElement | null>(null)

  /**
   * Convert a clientX/Y pair to SVG-local coords for the preview line.
   * Identity transform inside SectionPanel's SVG so a simple subtract
   * from the root's bounding-rect origin is exact. Returns null when
   * the ref isn't mounted yet (test environments before first render).
   */
  function clientToSvg(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = rootRef.current?.getBoundingClientRect()
    if (!rect) return null
    return { x: clientX - rect.left, y: clientY - rect.top }
  }

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
    onArmContact,
    onClearArmedContact,
    onContactCorrelate,
    onContactUncorrelate,
  } = contactGestureState ?? {
    contactCorrelateMode: false,
    armedContactId: null,
    onArmContact: (_: string) => {},
    onClearArmedContact: () => {},
    onContactCorrelate: async (_a: string, _b: string) => {},
    onContactUncorrelate: async (_a: string, _b: string) => {},
  }

  // True-spacing warning: when correlate mode is active and any adjacent
  // column is < TRUE_SPACING_WARN_M apart in true along-axis distance.
  const showTrueSpacingWarning = useMemo(() => {
    if (!correlateGestureState?.correlateMode) return false
    if (placedColumns.length < 2) return false
    const sorted = [...placedColumns].sort((a, b) => a.trueX - b.trueX)
    for (let i = 1; i < sorted.length; i++) {
      // trueX is screen pixels; we need real metres.
      // trueX is computed as xToScreen(proj.along), so spacing in screen
      // px is proportional to metres. We can check column spacings by
      // comparing proj.along directly (the raw along-section distance in m).
      const prevM = sorted[i - 1].proj.along
      const currM = sorted[i].proj.along
      if (currM - prevM < TRUE_SPACING_WARN_M) return true
    }
    return false
  }, [correlateGestureState, placedColumns])

  const handleContextMenuRemove = useCallback(async () => {
    if (contextMenu && correlateGestureState) {
      await correlateGestureState.onUncorrelate(contextMenu.formationAId, contextMenu.formationBId)
    }
    setContextMenu(null)
  }, [contextMenu, correlateGestureState])

  // Opens the admixture editor for the correlated body whose seed is the
  // right-clicked edge's formation_a_id.  Seeds the editor with formation_a's
  // current main soil code + admixtures so the user starts from the existing
  // state.
  const handleContextMenuEditAdmixtures = useCallback(() => {
    if (!contextMenu) return
    const seedFormation = formationById.get(contextMenu.formationAId)
    setContextMenu(null)
    setAdmixEditorState({
      open: true,
      seedFormationId: contextMenu.formationAId,
      initialMainSoilCode: seedFormation?.litho_main_soil_code ?? 'ZAND',
      initialAdmixtures: (seedFormation?.litho_admixtures ?? []) as GhostAdmixtureItem[],
    })
  }, [contextMenu, formationById])

  // Build per-column half-width map (used for band rect clicks).
  const halfWidthByInvest = useMemo(() => {
    const m = new Map<string, number>()
    for (const col of placedColumns) m.set(col.proj.item.id, col.width / 2)
    return m
  }, [placedColumns])

  // Compute edge render data: for each edge, find the two column X + midpoint Y.
  interface EdgeRenderItem {
    edge: LithoCorrelationEdge
    x1: number
    y1: number
    x2: number
    y2: number
    midX: number
    midY: number
    // columns that have this formation visible on section, for gesture UI
    aColumns: string[] // investigation ids with formation_a present
    bColumns: string[] // investigation ids with formation_b present
  }

  const edgeRenders = useMemo((): EdgeRenderItem[] => {
    const result: EdgeRenderItem[] = []
    for (const edge of edges) {
      // Find ALL investigation columns that have formation_a or formation_b on this section
      const aColIds: string[] = []
      const bColIds: string[] = []
      for (const col of placedColumns) {
        const invId = col.proj.item.id
        const bands = bandMap.get(invId)
        if (!bands) continue
        if (bands.has(edge.formation_a_id)) aColIds.push(invId)
        if (bands.has(edge.formation_b_id)) bColIds.push(invId)
      }
      // We render one line per pair (aCol, bCol) that are different investigations
      for (const aInvId of aColIds) {
        for (const bInvId of bColIds) {
          if (aInvId === bInvId) continue // same column — suppress dangling end
          const x1 = columnXForInvest(aInvId, placedColumns)
          const y1 = bandMidY(aInvId, edge.formation_a_id, bandMap, levelToScreen)
          const x2 = columnXForInvest(bInvId, placedColumns)
          const y2 = bandMidY(bInvId, edge.formation_b_id, bandMap, levelToScreen)
          if (x1 === null || y1 === null || x2 === null || y2 === null) continue
          result.push({
            edge,
            x1, y1, x2, y2,
            midX: (x1 + x2) / 2,
            midY: (y1 + y2) / 2,
            aColumns: aColIds,
            bColumns: bColIds,
          })
        }
      }
    }
    return result
  }, [edges, placedColumns, bandMap, levelToScreen])

  /**
   * Per-body ribbon render data.
   *
   * For each unique ``instance_ordinal`` that has at least one edge, collect
   * every column on this section that carries a formation with that ordinal,
   * sort left-to-right, and build the ribbon's ``RibbonColumn[]``.  Bodies
   * with ordinal ``null`` (pre-Resolve) fall through to the per-edge dashed
   * line path in the render block instead.
   *
   * A body must span at least TWO columns to have a ribbon — a single-column
   * body has no neighbouring investigation to connect to.
   */
  interface RibbonRenderItem {
    /** Shared instance ordinal — the body's identity. */
    ordinal: number
    /** One entry per column that carries any formation of this body,
     *  ordered left-to-right by screen X. */
    columns: RibbonColumn[]
    /** Any formation id belonging to this body — used for right-click
     *  context menu (the per-edge fallback surfaces its own menu). */
    sampleEdgeFormationAId: string
    sampleEdgeFormationBId: string
    /** Representative edge id — used for the per-ribbon context-menu
     *  data-testid so tests can query the ribbon. */
    sampleEdgeId: string
  }

  const ribbonRenders = useMemo((): RibbonRenderItem[] => {
    // Build ordinal → { formationIds, sampleEdge } map from edges whose
    // endpoints BOTH have a non-null instance_ordinal (resolved bodies only).
    const byOrdinal = new Map<number, {
      formationIds: Set<string>
      sampleEdgeFormationAId: string
      sampleEdgeFormationBId: string
      sampleEdgeId: string
    }>()

    for (const edge of edges) {
      const fA = formationById.get(edge.formation_a_id)
      const fB = formationById.get(edge.formation_b_id)
      const ordinal = fA?.instance_ordinal
      if (
        ordinal === null ||
        ordinal === undefined ||
        fA?.instance_ordinal !== fB?.instance_ordinal
      ) {
        continue
      }
      if (!byOrdinal.has(ordinal)) {
        byOrdinal.set(ordinal, {
          formationIds: new Set(),
          sampleEdgeFormationAId: edge.formation_a_id,
          sampleEdgeFormationBId: edge.formation_b_id,
          sampleEdgeId: edge.id,
        })
      }
      const entry = byOrdinal.get(ordinal)!
      entry.formationIds.add(edge.formation_a_id)
      entry.formationIds.add(edge.formation_b_id)
    }

    const result: RibbonRenderItem[] = []

    for (const [ordinal, entry] of byOrdinal) {
      // Find every column on this section that carries any formation in
      // this body, collect the band extent for rendering.
      const ribbonCols: RibbonColumn[] = []
      for (const col of placedColumns) {
        const invId = col.proj.item.id
        const colBands = bandMap.get(invId)
        if (!colBands) continue
        // Each formation in this body can appear at most once per column.
        for (const fId of entry.formationIds) {
          const band = colBands.get(fId)
          if (!band) continue
          ribbonCols.push({
            x: col.nudgedX,
            topY: levelToScreen(band.topLevel),
            botY: levelToScreen(band.botLevel),
          })
          break // one formation per column (body-per-column constraint)
        }
      }
      // Sort left-to-right by screen X.
      ribbonCols.sort((a, b) => a.x - b.x)
      // Need at least 2 columns for a ribbon.
      if (ribbonCols.length < 2) continue

      result.push({
        ordinal,
        columns: ribbonCols,
        sampleEdgeFormationAId: entry.sampleEdgeFormationAId,
        sampleEdgeFormationBId: entry.sampleEdgeFormationBId,
        sampleEdgeId: entry.sampleEdgeId,
      })
    }

    return result
  }, [edges, formationById, placedColumns, bandMap, levelToScreen])

  // In correlate mode: build per-formation-per-column gesture rect data.
  interface GestureRect {
    investigationId: string
    formationId: string
    x: number
    topY: number
    botY: number
    halfWidth: number
    isSource: boolean
    isValidTarget: boolean
    isCrossGroup: boolean
    label: string
  }

  const gestureRects = useMemo((): GestureRect[] => {
    if (!correlateGestureState?.correlateMode) return []
    const rects: GestureRect[] = []
    const source = correlateGestureState.correlationSource

    for (const col of placedColumns) {
      const invId = col.proj.item.id
      const bands = bandMap.get(invId)
      if (!bands) continue
      const hw = col.width / 2
      const colX = col.nudgedX

      for (const [fId] of bands) {
        const rect = bandRect(invId, fId, bandMap, levelToScreen, plotTop, plotBottom, hw)
        if (!rect) continue
        const formation = formationById.get(fId)

        const isSource = source !== null && source.formationId === fId && source.investigationId === invId

        let isValidTarget = false
        let isCrossGroup = false

        if (source !== null && !isSource) {
          // Target must be on a DIFFERENT investigation (no self-edge, no
          // within-column edge).
          if (invId !== source.investigationId) {
            const srcFormation = formationById.get(source.formationId)
            const tgtFormation = formation
            if (srcFormation && tgtFormation) {
              // Correlation eligibility is the SERVER's group key:
              // (parent_formation_id, litho_main_soil_code). A cross-group
              // pair is rejected 422 by CorrelateLithoUnits — pre-empt it
              // client-side with a not-allowed cursor instead of relying
              // on the server error (review B3 / owner-approved ux spec).
              // NOT instance_ordinal: that is the RESULT of correlation,
              // not the eligibility key.
              const sameCorrelationGroup =
                srcFormation.parent_formation_id === tgtFormation.parent_formation_id &&
                srcFormation.litho_main_soil_code === tgtFormation.litho_main_soil_code
              if (sameCorrelationGroup) {
                isValidTarget = true
              } else {
                isCrossGroup = true
              }
            } else {
              // Formation rows not resolvable (shouldn't happen) — treat
              // as valid; the server stays the final guard.
              isValidTarget = true
            }
          }
        }

        rects.push({
          investigationId: invId,
          formationId: fId,
          x: colX,
          topY: rect.topY,
          botY: rect.botY,
          halfWidth: hw,
          isSource,
          isValidTarget,
          isCrossGroup,
          label: formation?.name ?? fId,
        })
      }
    }
    return rects
  }, [
    correlateGestureState,
    placedColumns,
    bandMap,
    levelToScreen,
    plotTop,
    plotBottom,
    formationById,
  ])

  const {
    correlateMode,
    correlationSource,
    onArm,
    onClearArmed,
    onExitMode,
    onCorrelate,
    onUncorrelate,
    onPropagateAdmixtures,
  } = correlateGestureState ?? {
    correlateMode: false,
    correlationSource: null,
    onArm: () => {},
    onClearArmed: () => {},
    onExitMode: () => {},
    onCorrelate: async () => {},
    onUncorrelate: async () => {},
    onPropagateAdmixtures: async () => {},
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

  /** Body-level right-click handlers. Edit-admixtures is the existing
   *  propagate path seeded with the chip's own formation; remove-all
   *  fans the per-edge ``onUncorrelate`` calls across every edge in
   *  the body's graph (both endpoints carry the hovered ordinal). */
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

  const handleBodyContextRemoveAll = useCallback(async () => {
    if (!bodyContextMenu) return
    const targetOrdinal = bodyContextMenu.ordinal
    setBodyContextMenu(null)
    // Find every edge whose two endpoints both carry the body's ordinal —
    // that's the body's connected component in the correlation graph after
    // Resolve. Pre-Resolve (ordinal == null on either endpoint) edges are
    // not reachable from a chip anyway (no chip without an ordinal).
    const bodyEdges = edges.filter(e => {
      const a = formationById.get(e.formation_a_id)
      const b = formationById.get(e.formation_b_id)
      return (
        a?.instance_ordinal === targetOrdinal &&
        b?.instance_ordinal === targetOrdinal
      )
    })
    for (const edge of bodyEdges) {
      await onUncorrelate(edge.formation_a_id, edge.formation_b_id)
    }
  }, [bodyContextMenu, edges, formationById, onUncorrelate])

  /**
   * Drag-arm mousedown handler (debt #78). Arms the source via the
   * existing onArm callback AND opens the drag state so the mouseup
   * handler below can fire onCorrelate when the cursor lands on
   * another band. The eligibility check (cross-group / same-band)
   * happens at mouseup against the resolved target — we don't pre-
   * filter the gesture target because the cursor may pass over many
   * bands before release.
   */
  function handleArmMouseDown(
    e: React.MouseEvent<SVGRectElement>,
    src: CorrelationSource,
    cx: number,
    cy: number,
  ): void {
    // Only left-button drag — right-click would conflict with the
    // edge-uncorrelate context menu and ContextMenu events fire their
    // own path.
    if (e.button !== 0) return
    e.stopPropagation()
    onArm(src)
    const svgPt = clientToSvg(e.clientX, e.clientY) ?? { x: cx, y: cy }
    setDrag({
      srcInvestigationId: src.investigationId,
      srcFormationId: src.formationId,
      srcCx: cx,
      srcCy: cy,
      currentSvgX: svgPt.x,
      currentSvgY: svgPt.y,
    })
  }

  // Document mousemove + mouseup while drag-arm is active. Tracks
  // the cursor in SVG coords for the preview line and, on release,
  // hit-tests via document.elementsFromPoint to find a target band
  // by its data-testid. Esc cancels the drag (the existing
  // useCorrelate Esc handler clears the armed source separately).
  useEffect(() => {
    if (!drag) return
    function handleMove(e: MouseEvent): void {
      const svgPt = clientToSvg(e.clientX, e.clientY)
      if (!svgPt) return
      setDrag(d => (d ? { ...d, currentSvgX: svgPt.x, currentSvgY: svgPt.y } : null))
    }
    function handleUp(e: MouseEvent): void {
      const elements = document.elementsFromPoint(e.clientX, e.clientY)
      let targetInvId: string | null = null
      let targetFormationId: string | null = null
      // Hit-test via dedicated data attributes — using the testid
      // string would fail on real UUID ids with dashes (greedy split).
      for (const el of elements) {
        const invId = el.getAttribute('data-correlate-investigation-id')
        const formId = el.getAttribute('data-correlate-formation-id')
        if (invId && formId) {
          targetInvId = invId
          targetFormationId = formId
          break
        }
      }
      setDrag(null)
      // Same-band drop — leave the source armed for the user to
      // either click a target normally or Esc out. Do NOT clear,
      // since the user clearly opened correlate mode for a reason.
      if (
        targetInvId === drag!.srcInvestigationId &&
        targetFormationId === drag!.srcFormationId
      ) {
        return
      }
      if (targetInvId !== null && targetFormationId !== null) {
        void onCorrelate(drag!.srcFormationId, targetFormationId)
      }
      // Dropped on empty space — leave armed so the user can complete
      // the gesture with a normal click on a target.
    }
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setDrag(null)
    }
    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
      document.removeEventListener('keydown', handleKey)
    }
  }, [drag, onCorrelate])

  return (
    <g
      ref={rootRef}
      data-testid="correlation-edges-overlay"
      style={{ pointerEvents: 'none' }}
    >
      {/* True-spacing warning header */}
      {showTrueSpacingWarning && (
        <text
          x="50%"
          y={plotTop - 4}
          textAnchor="middle"
          fontSize={10}
          fill={BADGE_AMBER}
          fontStyle="italic"
          pointerEvents="none"
        >
          Investigations are close together — true spacing &lt; 1 m
        </text>
      )}

      {/* Pre-Resolve edge lines — dashed lines for edges whose endpoints
          have not yet been assigned an instance_ordinal by the resolver.
          Resolved bodies (ordinal set on both endpoints) are rendered as
          ribbon polygons below; this block handles only the pre-Resolve
          "stale" state (debt #122 always-on ambient, spike on hover). */}
      {edgeRenders.map((er, idx) => {
        const fA = formationById.get(er.edge.formation_a_id)
        const fB = formationById.get(er.edge.formation_b_id)
        // Pre-Resolve edges: either ordinal is null — rendered as a dashed
        // line here. Resolved bodies (both ordinals non-null + equal) are
        // rendered as continuous ribbon polygons in the block below.
        const aOrdinal = fA?.instance_ordinal
        const bOrdinal = fB?.instance_ordinal
        const isResolved =
          aOrdinal !== null &&
          aOrdinal !== undefined &&
          bOrdinal !== null &&
          bOrdinal !== undefined &&
          aOrdinal === bOrdinal
        if (isResolved) return null
        // Pre-Resolve: always ambient; no spike possible (no chip to hover).
        return (
          <g key={`edge-${er.edge.id}-${idx}`} data-testid={`correlation-edge-${er.edge.id}`} opacity={EDGE_OPACITY_AMBIENT}>
            {/* Invisible hit rect — per-edge "remove this correlation"
                right-click fallback. */}
            <line
              x1={er.x1}
              y1={er.y1}
              x2={er.x2}
              y2={er.y2}
              stroke="transparent"
              strokeWidth={EDGE_HIT_PADDING * 2}
              style={{ pointerEvents: 'stroke', cursor: 'context-menu' }}
              onContextMenu={e => {
                e.preventDefault()
                setContextMenu({
                  x: er.midX,
                  y: er.midY - 8,
                  formationAId: er.edge.formation_a_id,
                  formationBId: er.edge.formation_b_id,
                })
              }}
            />
            {/* Visible dashed line — auto edges use tighter dash pattern. */}
            <line
              x1={er.x1}
              y1={er.y1}
              x2={er.x2}
              y2={er.y2}
              stroke={EDGE_COLOR}
              strokeWidth={EDGE_WIDTH}
              strokeDasharray={er.edge.source === 'auto' ? EDGE_DASH_AUTO : EDGE_DASH}
              pointerEvents="none"
            />
          </g>
        )
      })}

      {/* Resolved-body ribbon polygons (debt #121). One continuous polygon
          ribbon per body ordinal, spanning all columns that carry a
          formation of that body. The ribbon replaces per-edge dashed lines
          for resolved bodies (both endpoints have instance_ordinal set).
          Ambient opacity (0.20) at rest; spikes to 0.80 when the body's
          chip is hovered — same gate as the per-edge dashed-line path. */}
      {ribbonRenders.map(ribbon => {
        const isBodyHovered = hoveredBodyOrdinal === ribbon.ordinal
        const opacity = isBodyHovered ? EDGE_OPACITY_HOVERED : EDGE_OPACITY_AMBIENT
        const pts = computeRibbonPoints(ribbon.columns)
        if (!pts) return null
        // Boundary points for top and bottom lines.
        const topPts = ribbon.columns.map(c => `${c.x.toFixed(2)},${c.topY.toFixed(2)}`).join(' ')
        const botPts = ribbon.columns.map(c => `${c.x.toFixed(2)},${c.botY.toFixed(2)}`).join(' ')
        return (
          <g
            key={`ribbon-${ribbon.ordinal}`}
            data-testid={`correlation-ribbon-${ribbon.ordinal}`}
            opacity={opacity}
          >
            {/* Filled ribbon polygon — Tailwind blue-400 fill at low
                opacity so the CPT/borehole data behind is readable. */}
            <polygon
              points={pts}
              fill={RIBBON_FILL_COLOR}
              fillOpacity={RIBBON_FILL_OPACITY}
              stroke="none"
              pointerEvents="none"
            />
            {/* Top boundary line — thin stroke so the ribbon extent is
                legible even at ambient opacity. */}
            <polyline
              points={topPts}
              fill="none"
              stroke={EDGE_COLOR}
              strokeWidth={RIBBON_BOUNDARY_WIDTH}
              strokeDasharray={EDGE_DASH}
              pointerEvents="none"
            />
            {/* Bottom boundary line. */}
            <polyline
              points={botPts}
              fill="none"
              stroke={EDGE_COLOR}
              strokeWidth={RIBBON_BOUNDARY_WIDTH}
              strokeDasharray={EDGE_DASH}
              pointerEvents="none"
            />
            {/* Invisible polygon hit area for right-click context menu
                (fallback to the per-edge "remove this correlation" path). */}
            <polygon
              points={pts}
              fill="transparent"
              stroke="transparent"
              strokeWidth={EDGE_HIT_PADDING * 2}
              style={{ pointerEvents: 'all', cursor: 'context-menu' }}
              onContextMenu={e => {
                e.preventDefault()
                const mx = ribbon.columns[Math.floor(ribbon.columns.length / 2)].x
                const my = ribbon.columns[Math.floor(ribbon.columns.length / 2)].topY
                setContextMenu({
                  x: mx,
                  y: my - 8,
                  formationAId: ribbon.sampleEdgeFormationAId,
                  formationBId: ribbon.sampleEdgeFormationBId,
                })
              }}
            />
          </g>
        )
      })}

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

      {/* Correlate-mode gesture overlays — click-capture rects + source/target UI */}
      {correlateMode && gestureRects.map(gr => {
        const rectHeight = gr.botY - gr.topY
        const rectX = gr.x - gr.halfWidth
        const rectWidth = gr.halfWidth * 2

        if (gr.isSource) {
          // Armed source: 2px accent outline + floating label above
          return (
            <g key={`gesture-${gr.investigationId}-${gr.formationId}`} style={{ pointerEvents: 'auto' }}>
              {/* Accent outline */}
              <rect
                x={rectX}
                y={gr.topY}
                width={rectWidth}
                height={rectHeight}
                fill="none"
                stroke={ARM_OUTLINE_COLOR}
                strokeWidth={ARM_OUTLINE_WIDTH}
                style={{ pointerEvents: 'none' }}
              />
              {/* Floating label */}
              <text
                x={gr.x}
                y={gr.topY - 4}
                textAnchor="middle"
                fontSize={9}
                fill={ARM_OUTLINE_COLOR}
                pointerEvents="none"
              >
                {gr.label}
              </text>
              {/* Click on the armed source un-arms it (clear armed, stay
                  in mode — the Esc-L1 equivalent). DELIBERATE departure
                  from the spec's "same-band click = no-op / shake": a
                  click on the highlighted source is unambiguous intent to
                  cancel that source, and click-to-toggle is the lower-
                  friction gesture (no separate Esc reach). Owner-aligned
                  via the ux spec's reversible-action principle (review
                  C1; the useCorrelate state-machine doc note is the only
                  place still describing the old no-op variant). */}
              <rect
                x={rectX}
                y={gr.topY}
                width={rectWidth}
                height={rectHeight}
                fill="transparent"
                style={{ cursor: 'pointer' }}
                onClick={() => onClearArmed()}
              />
            </g>
          )
        }

        if (gr.isValidTarget) {
          // Valid target: dim tint + dashed border + pointer cursor
          return (
            <g key={`gesture-${gr.investigationId}-${gr.formationId}`} style={{ pointerEvents: 'auto' }}>
              <rect
                data-testid={`correlate-target-${gr.investigationId}-${gr.formationId}`}
                data-correlate-investigation-id={gr.investigationId}
                data-correlate-formation-id={gr.formationId}
                x={rectX}
                y={gr.topY}
                width={rectWidth}
                height={rectHeight}
                fill={VALID_TARGET_FILL}
                stroke={VALID_TARGET_STROKE}
                strokeWidth={1}
                strokeDasharray="3 2"
                style={{ cursor: 'pointer' }}
                onClick={async () => {
                  if (correlationSource) {
                    await onCorrelate(correlationSource.formationId, gr.formationId)
                  }
                }}
              />
            </g>
          )
        }

        if (gr.isCrossGroup) {
          // Cross-group band: not-allowed cursor + rejection toast on click.
          // Previously silent — the title tooltip was not discoverable.
          return (
            <g key={`gesture-${gr.investigationId}-${gr.formationId}`} style={{ pointerEvents: 'auto' }}>
              <rect
                data-testid={`correlate-reject-crossgroup-${gr.investigationId}-${gr.formationId}`}
                x={rectX}
                y={gr.topY}
                width={rectWidth}
                height={rectHeight}
                fill="transparent"
                style={{ cursor: 'not-allowed' }}
                onClick={() =>
                  onRejectCorrelate?.(
                    `"${gr.label}" belongs to a different formation group — only same-type units can be correlated.`,
                  )
                }
              />
            </g>
          )
        }

        // No source armed yet: invisible click target to arm as source.
        // Also accepts a mousedown to start a drag-to-target gesture
        // (debt #78) — the same gesture, collapsed from click+click to
        // one drag. The original click path stays so existing tests +
        // users keep working.
        if (correlationSource === null) {
          const src: CorrelationSource = {
            formationId: gr.formationId,
            investigationId: gr.investigationId,
            label: gr.label,
          }
          const cy = (gr.topY + gr.botY) / 2
          return (
            <rect
              key={`gesture-${gr.investigationId}-${gr.formationId}`}
              data-testid={`correlate-arm-${gr.investigationId}-${gr.formationId}`}
              data-correlate-investigation-id={gr.investigationId}
              data-correlate-formation-id={gr.formationId}
              x={rectX}
              y={gr.topY}
              width={rectWidth}
              height={rectHeight}
              fill="transparent"
              style={{ pointerEvents: 'auto', cursor: 'crosshair' }}
              onClick={() => onArm(src)}
              onMouseDown={e => handleArmMouseDown(e, src, gr.x, cy)}
            />
          )
        }

        // Source is armed but this is neither source nor valid target.
        // This occurs when the band is on the same investigation as the
        // armed source (self-edge blocked). Fire a rejection toast so
        // the user knows why the click did nothing.
        return (
          <rect
            key={`gesture-${gr.investigationId}-${gr.formationId}`}
            data-testid={`correlate-reject-sameinv-${gr.investigationId}-${gr.formationId}`}
            x={rectX}
            y={gr.topY}
            width={rectWidth}
            height={rectHeight}
            fill="transparent"
            style={{ pointerEvents: 'auto', cursor: 'not-allowed' }}
            onClick={() =>
              onRejectCorrelate?.(
                'Select a unit on a different investigation to correlate.',
              )
            }
          />
        )
      })}

      {/* Contact-level correlation edges (#133 Phase 1).
          Point-to-point solid emerald lines between the topY of each
          correlated contact's band.  Distinct from the formation-level
          dashed blue lines so both overlay types are readable when active
          simultaneously.  Each line renders from contact_a's column
          nudgedX at its band topY to contact_b's equivalent.
          Absent when ``contactEdges`` is undefined (no regression). */}
      {contactEdges && contactEdges.length > 0 && (
        <g data-testid="contact-edges-overlay" pointerEvents="none">
          {contactEdges.map(ce => {
            const ptA = contactScreenMap.get(ce.contact_a_id)
            const ptB = contactScreenMap.get(ce.contact_b_id)
            if (!ptA || !ptB) return null
            return (
              <line
                key={`contact-edge-${ce.id}`}
                data-testid={`contact-edge-${ce.id}`}
                x1={ptA.x}
                y1={ptA.topY}
                x2={ptB.x}
                y2={ptB.topY}
                stroke={CONTACT_EDGE_COLOR}
                strokeWidth={CONTACT_EDGE_WIDTH}
                strokeDasharray={CONTACT_EDGE_DASH}
                opacity={CONTACT_EDGE_OPACITY}
                pointerEvents="none"
              />
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
                  onClick={() => {
                    if (isArmed) {
                      // Click on the armed source → clear the arm
                      onClearArmedContact()
                    } else if (armedContactId !== null) {
                      // A different contact is armed → fire correlation
                      void onContactCorrelate(armedContactId, c.id)
                    } else {
                      // Nothing armed → arm this contact
                      onArmContact(c.id)
                    }
                  }}
                />
              </g>
            )
          })}
        </g>
      )}

      {/* Drag-arm preview line (debt #78). Dashed blue line from the
          source band centre to the live cursor, while a drag-arm
          gesture is in flight. Pointer-events:none so it never
          intercepts the mouseup that completes the gesture. */}
      {drag && (
        <line
          data-testid="correlate-drag-preview"
          x1={drag.srcCx}
          y1={drag.srcCy}
          x2={drag.currentSvgX}
          y2={drag.currentSvgY}
          stroke={EDGE_COLOR}
          strokeWidth={EDGE_WIDTH}
          strokeDasharray={EDGE_DASH}
          pointerEvents="none"
          opacity={0.6}
        />
      )}

      {/* Edge-level context menu — right-click on a revealed edge line.
          Kept as the per-edge "remove this one correlation" fallback;
          the chip's body-level menu is the primary surface. */}
      {contextMenu && (
        <EdgeContextMenu
          menu={contextMenu}
          onRemove={handleContextMenuRemove}
          onEditAdmixtures={handleContextMenuEditAdmixtures}
          onClose={() => setContextMenu(null)}
        />
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
