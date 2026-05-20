/**
 * SVG overlay for litho correlation edges on a cross-section.
 *
 * Renders always-on dashed blue lines connecting the vertical midpoints
 * of correlated formation bands across investigation columns, plus
 * interactive elements for the two-step correlate gesture (Slice 4).
 *
 * Responsibilities
 * ----------------
 * - Edge rendering: dashed blue ``5 3`` lines between band midpoints
 *   when two correlated formations are both visible on this section.
 * - Body-N badge at each edge midpoint (``instance_ordinal``); amber
 *   "?" when ordinal is null.
 * - True-spacing warning: amber header when ``correlateMode`` and any
 *   adjacent column spacing < 1 m.
 * - Correlate-mode overlays: armed source 2px accent outline + floating
 *   label; valid targets dim tint + dashed border; cross-group cursor not-
 *   allowed; invisible click-capture rects over every unit band.
 * - Uncorrelate: right-click hit rects (8 px padding) along each edge
 *   line that surface a one-item context menu "Remove correlation".
 *
 * All pointer interactions delegate to callbacks; the component holds
 * no state.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  FormationContactResponse,
  GeologicalFormationResponse,
  LithoCorrelationEdge,
} from '../../api/client'
import type { CorrelationSource } from './useCorrelate'
import type { PlacedColumn } from './utils'

// ---------------------------------------------------------------------------
// Visual constants
// ---------------------------------------------------------------------------

/** Dash pattern for correlation edges. */
const EDGE_DASH = '5 3'
/** Edge stroke colour (Tailwind blue-500). */
const EDGE_COLOR = '#3b82f6'
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
/** Badge background. */
const BADGE_BG = '#1e3a5f'
/** Badge font colour. */
const BADGE_FG = '#e2e8f0'
/** Amber badge colour when ordinal is null. */
const BADGE_AMBER = '#d97706'
/** Badge font size in px. */
const BADGE_FONT_SIZE = 9
/** Badge padding px. */
const BADGE_PAD_X = 4
const BADGE_PAD_Y = 2
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
 * surface elevation.  When no next contact exists the band bottom falls
 * to the plotBottom level.
 *
 * Parameters
 * ----------
 * contacts
 *     Section-filtered contacts.
 * columns
 *     Placed columns (carries surface elevation via proj.item.elevation_m).
 * plotBottomLevel
 *     Absolute level corresponding to the bottom of the visible plot,
 *     computed by inverting levelToScreen at plotBottom.
 *
 * Returns
 * -------
 * Map<string, Map<string, { topLevel: number; botLevel: number }>>
 */
function buildBandMap(
  contacts: readonly FormationContactResponse[],
  columns: readonly PlacedColumn[],
  plotBottomLevel: number,
): Map<string, Map<string, { topLevel: number; botLevel: number }>> {
  // investId → elevation_m (surface)
  const surfaceByInvest = new Map<string, number>()
  for (const col of columns) {
    const elev = col.proj.item.elevation_m
    if (elev !== null && elev !== undefined) {
      surfaceByInvest.set(col.proj.item.id, elev)
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

    for (let i = 0; i < sorted.length; i++) {
      const c = sorted[i]
      const topLevel = surface - c.depth_top_m
      const botLevel =
        i + 1 < sorted.length
          ? surface - sorted[i + 1].depth_top_m
          : plotBottomLevel
      bands.set(c.formation_id, { topLevel, botLevel })
    }

    result.set(investId, bands)
  }

  return result
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

// ---------------------------------------------------------------------------
// Badge sub-component
// ---------------------------------------------------------------------------

interface BadgeProps {
  x: number
  y: number
  ordinal: number | null
}

function EdgeBadge({ x, y, ordinal }: BadgeProps): JSX.Element {
  const text = ordinal !== null ? `body ${ordinal}` : '?'
  const isNull = ordinal === null
  const approxWidth = text.length * BADGE_FONT_SIZE * 0.55 + BADGE_PAD_X * 2
  const approxHeight = BADGE_FONT_SIZE + BADGE_PAD_Y * 2
  return (
    <g>
      <rect
        x={x - approxWidth / 2}
        y={y - approxHeight / 2}
        width={approxWidth}
        height={approxHeight}
        rx={3}
        fill={isNull ? BADGE_AMBER : BADGE_BG}
        opacity={0.92}
      />
      <text
        x={x}
        y={y + BADGE_FONT_SIZE / 2 - 1}
        textAnchor="middle"
        fontSize={BADGE_FONT_SIZE}
        fill={BADGE_FG}
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
  onClose: () => void
}

function EdgeContextMenu({ menu, onRemove, onClose }: EdgeContextMenuProps): JSX.Element {
  return (
    // Rendered as a foreignObject to get real HTML for the context menu
    <foreignObject
      x={menu.x}
      y={menu.y}
      width={160}
      height={36}
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
          minWidth: 160,
        }}
      >
        <button
          type="button"
          style={{
            display: 'block',
            width: '100%',
            padding: '6px 12px',
            textAlign: 'left',
            fontSize: 12,
            color: 'var(--color-text-primary, #e2e8f0)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
          }}
          onClick={onRemove}
        >
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
}: Props): JSX.Element {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)

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

  const { correlateMode, correlationSource, onArm, onClearArmed, onExitMode, onCorrelate } =
    correlateGestureState ?? {
      correlateMode: false,
      correlationSource: null,
      onArm: () => {},
      onClearArmed: () => {},
      onExitMode: () => {},
      onCorrelate: async () => {},
      onUncorrelate: async () => {},
    }

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

      {/* Always-on correlation edge lines + badges */}
      {edgeRenders.map((er, idx) => {
        const fA = formationById.get(er.edge.formation_a_id)
        const ordinal = fA?.instance_ordinal ?? null
        return (
          <g key={`edge-${er.edge.id}-${idx}`}>
            {/* Invisible hit rect for right-click uncorrelate */}
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
            {/* Visible dashed line */}
            <line
              x1={er.x1}
              y1={er.y1}
              x2={er.x2}
              y2={er.y2}
              stroke={EDGE_COLOR}
              strokeWidth={EDGE_WIDTH}
              strokeDasharray={EDGE_DASH}
              pointerEvents="none"
            />
            {/* Badge at midpoint */}
            <EdgeBadge x={er.midX} y={er.midY} ordinal={ordinal} />
          </g>
        )
      })}

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
          // Cross-group band: not-allowed cursor (Phase 5 enforcement; currently all valid above)
          return (
            <g key={`gesture-${gr.investigationId}-${gr.formationId}`} style={{ pointerEvents: 'auto' }}>
              <rect
                x={rectX}
                y={gr.topY}
                width={rectWidth}
                height={rectHeight}
                fill="transparent"
                style={{ cursor: 'not-allowed' }}
              >
                <title>Formation belongs to a different correlation group</title>
              </rect>
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

        // Source is armed but this is neither source nor valid target: neutral transparent
        return (
          <rect
            key={`gesture-${gr.investigationId}-${gr.formationId}`}
            x={rectX}
            y={gr.topY}
            width={rectWidth}
            height={rectHeight}
            fill="transparent"
            style={{ pointerEvents: 'auto' }}
          />
        )
      })}

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

      {/* Uncorrelate context menu */}
      {contextMenu && (
        <EdgeContextMenu
          menu={contextMenu}
          onRemove={handleContextMenuRemove}
          onClose={() => setContextMenu(null)}
        />
      )}
    </g>
  )
}
