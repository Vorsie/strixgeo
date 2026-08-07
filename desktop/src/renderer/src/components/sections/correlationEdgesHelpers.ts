/**
 * Pure band / screen-map helpers for ``CorrelationEdgesOverlay``.
 *
 * Extracted verbatim from CorrelationEdgesOverlay.tsx (debt #201 round 2) —
 * band-map construction, contact screen mapping, warp-aware edge endpoints,
 * and the approved/suggested stripe palette. No React.
 */
import type {
  FormationContactResponse,
  GeologicalFormationResponse,
} from '../../api/client'
import { contactAnchorId, groupContactsByAnchor } from './contactsLayerGeometry'
import { columnMaxDepthM } from './utils'
import type { PlacedColumn } from './utils'

/** Stroke colour for contact-level correlation edges (#133 Phase 1).
 *  Emerald-500 — also used as the body-chip halo ring colour. */
export const CONTACT_EDGE_COLOR = '#10b981'

/** Px within a boundary line that arms it on a TALL band (near-boundary
 *  zones, dogfeed 2026-05-29 — the middle of a tall band is inert). */
export const CONTACT_SELECT_NEAR_PX = 14

/** Px above a thin band's BASE line that arm the boundary below. Small on
 *  purpose: an interior strike a few px low must still mean the band's own
 *  top (the 2026-08-05 one-band-low mis-click), while a deliberate click ON
 *  the base line arms the base (owner 2026-08-07: "I click the bottom of a
 *  clay unit but the correlation drew from the top"). */
export const BASE_LINE_GRAB_PX = 4

/**
 * Split a correlate-mode band into its top-arming and base-arming zones.
 *
 * The rule — "the boundary line always wins":
 * ``[top, topEnd)`` arms the band's own top contact, ``[botStart, bot]``
 * arms the boundary below it (or the unit BASE on the deepest band), and
 * anything between the two cuts is inert.
 *
 * - Tall band (height ≥ 2×``CONTACT_SELECT_NEAR_PX``): near-boundary zones
 *   with an inert middle — unchanged since dogfeed 2026-05-29.
 * - Thin band with a deeper neighbour: the interior arms the band's own top
 *   (2026-08-05 protection), but the bottom ``BASE_LINE_GRAB_PX`` — capped
 *   at half the band so an interior strike can never mean the base — arms
 *   the boundary below (owner 2026-08-07).
 * - Thin DEEPEST band: generous midpoint split — the base tie has no twin
 *   target below (CE-THIN-DEEPEST precedent).
 *
 * Parameters
 * ----------
 * top, bot : number
 *     Band top / bottom in screen y (``bot > top``).
 * hasDeeper : boolean
 *     Whether a deeper contact exists on the column (the base zone then arms
 *     it; otherwise the base zone arms this unit's own BASE — a bottom-tie).
 *
 * Returns
 * -------
 * { topEnd: number; botStart: number }
 *     The two cut y's. ``topEnd === botStart`` means no inert gap.
 */
export function correlateBandZones(
  top: number,
  bot: number,
  hasDeeper: boolean,
): { topEnd: number; botStart: number } {
  const height = bot - top
  if (height >= 2 * CONTACT_SELECT_NEAR_PX) {
    return { topEnd: top + CONTACT_SELECT_NEAR_PX, botStart: bot - CONTACT_SELECT_NEAR_PX }
  }
  if (!hasDeeper) {
    const mid = (top + bot) / 2
    return { topEnd: mid, botStart: mid }
  }
  const cut = Math.max(bot - BASE_LINE_GRAB_PX, top + height / 2)
  return { topEnd: cut, botStart: cut }
}

/**
 * Get the investigation id (cpt_id or borehole_id) from a contact.
 * Shared shape — see ``contactAnchorId`` (the anchor pair is XOR).
 */
export const anchorId = contactAnchorId

/** One band entry on an investigation. Keyed by ``contact_id`` so two
 * contacts referencing the same formation (a repeated lithology) get
 * distinct entries — the previous ``formation_id`` key collapsed them,
 * making the shallower band's hit-rect render at the deeper band's
 * depth (manual-correlate dogfeed 2026-05-31). */
export interface BandEntry {
  /** Top of the band in absolute mTAW. */
  topLevel: number
  /** Bottom of the band in absolute mTAW. */
  botLevel: number
  /** The formation this band represents (for renderers that group by formation). */
  formationId: string
}

/** Outer map keyed by investigation id; inner keyed by contact id. */
export type BandMap = Map<string, Map<string, BandEntry>>

/**
 * Build a map from (investigationId → (contactId → BandEntry)) from the
 * contacts on this section.  Levels are absolute mTAW elevations.
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
 * Keyed by ``contact_id`` (not ``formation_id``) so two contacts pointing
 * at the same formation at different depths each get their own entry —
 * the formation_id key collapsed the two, drawing the shallower contact's
 * hit-rect at the deeper contact's screen position.
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
 * BandMap
 */
export function buildBandMap(
  contacts: readonly FormationContactResponse[],
  columns: readonly PlacedColumn[],
  plotBottomLevel: number,
): BandMap {
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

  // investId → contacts sorted by depth_top_m ascending (shallowest first)
  const byInvest = groupContactsByAnchor(contacts)

  const result: BandMap = new Map()

  for (const [investId, sorted] of byInvest) {
    const surface = surfaceByInvest.get(investId)
    if (surface === undefined) continue

    const bands = new Map<string, BandEntry>()

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
      bands.set(c.id, { topLevel, botLevel, formationId: c.formation_id })
    }

    result.set(investId, bands)
  }

  return result
}

/**
 * Get the band screen rect (topY, botY) for the contact's own band.
 * Looked up by contact id so two contacts on the same investigation
 * referencing the same formation get distinct rects.
 */
export function bandRect(
  investigationId: string,
  contactId: string,
  bandMap: BandMap,
  levelToScreen: (l: number) => number,
  plotTop: number,
  plotBottom: number,
  halfWidth: number,
): { topY: number; botY: number } | null {
  const bands = bandMap.get(investigationId)
  if (!bands) return null
  const band = bands.get(contactId)
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
  bandMap: BandMap,
  levelToScreen: (level: number) => number,
): Map<string, { x: number; along: number; topY: number; botY: number; halfWidth: number }> {
  const result = new Map<string, { x: number; along: number; topY: number; botY: number; halfWidth: number }>()
  for (const c of contacts) {
    const invId = anchorId(c)
    if (invId === null) continue
    const colBands = bandMap.get(invId)
    if (!colBands) continue
    // Look up by contact id — same formation appearing twice on one column
    // has two distinct band entries, each anchored at its own depth.
    const band = colBands.get(c.id)
    if (!band) continue
    const col = columns.find(col => col.proj.item.id === invId)
    if (!col) continue
    result.set(c.id, {
      x: col.nudgedX,
      // along-section metres of the anchor column — lets a tie that spans
      // intervening columns BEND at each one (warp-aware), instead of drawing a
      // single straight screen segment. Under non-uniform column spacing a
      // straight screen segment between two columns does not pass through the
      // intervening columns where the fill does, so the fill appears to cross the
      // tie (dogfeed 2026-07-10). Interpolating the tie by along-fraction and
      // placing each vertex at the column's nudgedX matches the fill exactly.
      along: col.proj.along,
      topY: levelToScreen(band.topLevel),
      // botY is the screen Y of the band's base — needed for base-side ties
      // (spec §6 bug 1: a base-side endpoint must render at the band bottom,
      // not its top).
      botY: levelToScreen(band.botLevel),
      halfWidth: col.width / 2,
    })
  }
  return result
}

/**
 * Warp-aware polyline points for a correlation edge that may span intervening
 * columns.
 *
 * A correlation surface is straight in (along, elevation) space, but the columns
 * it spans are NOT placed proportionally to along-section distance (spacing nudge
 * + scroll), so a single straight screen segment between the two endpoints does
 * not pass through the intervening columns where the per-gap fill does — the fill
 * then appears to cross the edge (dogfeed 2026-07-10). This returns a polyline
 * that BENDS at each intervening column, FLAT across that column's width (a column
 * is one along-point but renders with width, and its own footprint carries no gap
 * fill), so the edge meets the gap fill exactly at the inner edges and runs
 * horizontal under a shallow test — matching the fill.
 *
 * Used by BOTH the cross-lithology surface tie AND the same-lithology ribbon seam
 * so every correlation edge flattens under a shallow test identically.
 *
 * Parameters
 * ----------
 * xStart, yStart, alongStart : the A endpoint's screen x (inner-edge anchored),
 *     screen y, and along-section metres.
 * xEnd, yEnd, alongEnd : the B endpoint's screen x, screen y, along metres.
 * columns : all placed columns (carry ``proj.along`` + ``nudgedX`` + ``width``).
 *
 * Returns
 * -------
 * string
 *     ``points`` attribute for an SVG ``<polyline>``.
 */
export function warpAwareEdgePoints(
  xStart: number,
  yStart: number,
  alongStart: number,
  xEnd: number,
  yEnd: number,
  alongEnd: number,
  columns: readonly PlacedColumn[],
): string {
  return warpAwareEdgeVertices(xStart, yStart, alongStart, xEnd, yEnd, alongEnd, columns)
    .map((p) => `${p.x},${p.y}`)
    .join(' ')
}

/**
 * The same polyline as :func:`warpAwareEdgePoints`, as vertices.
 *
 * A CLOSED shape that follows the edge — the pending proposal's dashed outline
 * — needs its top and bottom boundaries as arrays so it can walk one forward
 * and the other back. Extracted when the pending outline had to bend at the
 * columns a JUMP tie crosses, exactly as the accepted seam already did: an
 * outline and a seam are the same claim about the same surface, and drawing
 * them differently says the tie MOVES when it is accepted.
 *
 * Parameters
 * ----------
 * xStart, yStart, alongStart : the A endpoint's screen x, screen y, along metres.
 * xEnd, yEnd, alongEnd : the B endpoint's screen x, screen y, along metres.
 * columns : all placed columns.
 *
 * Returns
 * -------
 * { x: number; y: number }[]
 *     Vertices from A to B, two per intervening column (flat across its width).
 */
export function warpAwareEdgeVertices(
  xStart: number,
  yStart: number,
  alongStart: number,
  xEnd: number,
  yEnd: number,
  alongEnd: number,
  columns: readonly PlacedColumn[],
): { x: number; y: number }[] {
  const verts: { x: number; y: number }[] = [{ x: xStart, y: yStart }]
  if (Math.abs(alongEnd - alongStart) > 1e-6) {
    const loA = Math.min(alongStart, alongEnd)
    const hiA = Math.max(alongStart, alongEnd)
    const mids = columns
      .filter(c => c.proj.along > loA + 1e-6 && c.proj.along < hiA - 1e-6)
      .sort((a, b) => a.proj.along - b.proj.along)
    const ordered = alongStart <= alongEnd ? mids : mids.reverse()
    const dir = alongStart <= alongEnd ? 1 : -1
    for (const c of ordered) {
      const f = (c.proj.along - alongStart) / (alongEnd - alongStart)
      const yK = yStart + f * (yEnd - yStart)
      const hw = c.width / 2
      // A-facing edge first, then B-facing edge → flat across the column width.
      verts.push({ x: c.nudgedX - dir * hw, y: yK })
      verts.push({ x: c.nudgedX + dir * hw, y: yK })
    }
  }
  verts.push({ x: xEnd, y: yEnd })
  return verts
}

/**
 * Closed, warp-aware ``points`` for a ribbon-shaped edge overlay.
 *
 * Walks the TOP boundary A → B and the BOTTOM boundary B → A, both bent at
 * every intervening column, so the ring hugs the same path the seam draws. Used
 * by the pending proposal's dashed outline and by the right-click hit polygon —
 * one shape, one geometry, no chance of the target drifting off the drawing.
 *
 * Parameters
 * ----------
 * xA, topA, botA, alongA : the A endpoint's screen x, its top and bottom screen
 *     y, and its along-section metres.
 * xB, topB, botB, alongB : the same for the B endpoint.
 * columns : all placed columns.
 *
 * Returns
 * -------
 * string
 *     ``points`` attribute for an SVG ``<polygon>``.
 */
export function warpAwareRibbonOutline(
  xA: number,
  topA: number,
  botA: number,
  alongA: number,
  xB: number,
  topB: number,
  botB: number,
  alongB: number,
  columns: readonly PlacedColumn[],
): string {
  const top = warpAwareEdgeVertices(xA, topA, alongA, xB, topB, alongB, columns)
  const bottom = warpAwareEdgeVertices(xA, botA, alongA, xB, botB, alongB, columns)
  return [...top, ...bottom.reverse()].map(p => `${p.x},${p.y}`).join(' ')
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
  const byInvest = groupContactsByAnchor(contacts)
  const result = new Map<string, { above: string | null; below: string }>()
  for (const [, sorted] of byInvest) {
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

