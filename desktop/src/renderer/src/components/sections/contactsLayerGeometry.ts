/**
 * Pure geometry helpers and data types for the ContactsLayer overlay.
 *
 * This module is a zero-React, zero-side-effect extraction from
 * ``ContactsLayer.tsx``.  Every export here is a plain TypeScript
 * interface or a deterministic pure function — no hooks, no component
 * state, no DOM access.  That makes the module independently
 * unit-testable and keeps the parent component file focused on the
 * stateful drag state machine.
 *
 * Contents
 * --------
 * Interfaces
 *     ``LayerSlabData``     — data-only slab (Stage-A output, no screen Y).
 *     ``PolylineVertexData`` — data-only polyline vertex (Stage-A output).
 *     ``PolylineDataLine``  — one cross-column formation line (Stage-A output).
 *     ``RenderedLayer``     — projected (screen-space) layer for the renderer.
 *     ``PolylineVertex``    — projected polyline vertex.
 *
 * Pure helpers
 *     ``clamp``             — numeric clamp.
 *     ``truncateToWidth``   — ellipsis-truncate a label to a pixel budget.
 *     ``columnUnderCursor`` — nearest PlacedColumn within attraction hysteresis.
 *     ``surfaceYForColumn`` — derive screenY + pxPerMetre + elevationM for a column.
 *     ``subtractGhosts``    — subtract ghost depth ranges from a band interval.
 *     ``contactAnchorId``   — a contact's investigation id (borehole XOR cpt).
 *     ``groupContactsByAnchor`` — anchor id → contacts sorted by depth_top_m.
 *
 * Main function
 *     ``computeSlabsAndPolylines`` — Stage-A classification pass; pure of vertical axis.
 */

import type {
  FormationContactResponse,
  GeologicalFormationResponse,
} from '../../api/client'
import { lithoDisplayName } from '../../utils/lithoLabels'
import { geotechUnitColor, nadClassName } from '../../utils/nadClasses'
import type { SectionLine2D } from '../../utils/sliceTin'
import { columnMaxDepthM, depthAxisAtSurface, type PlacedColumn } from './utils'

// Average glyph width at fontSize=9 — used by the truncation budget.
const APPROX_GLYPH_WIDTH_PX = 5

// Cursor-X hysteresis (px) outside a column's visual band before the
// drag re-anchors onto a different column.  Tight enough that crossing
// to a neighbouring column is intentional; loose enough that minor
// jitter at the band edge doesn't flicker the target.
const COLUMN_ATTRACTION_PX = 15

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/**
 * Data-only slab — output of the data-classification pass.
 *
 * Holds every fact needed to render a per-column layer block EXCEPT
 * the screen-Y coordinates, which depend on the viewport's vertical
 * transform.  Splitting the screen Y out lets the data memo stay
 * cached across vertical pan / zoom (only ``levelToScreen`` changes
 * there, not ``placedColumns`` or the data inputs) — see debt #29.
 *
 * ``bottomDepthM = null`` means "no known bottom" (deepest contact at
 * an anchor with no recorded ``max_depth_m`` / ``total_depth_m``);
 * the projection step renders that as "extends to ``plotBottom``".
 */
export interface LayerSlabData {
  contactId: string
  anchorId: string
  anchorKind: 'cpt' | 'borehole'
  formationId: string
  formationName: string
  color: string
  topDepthM: number
  bottomDepthM: number | null
  surfaceElevationM: number
  /** Horizontal extent + label X — these depend on ``placedColumns``
   * (which itself can change on horizontal pan), so they live on the
   * slab; the cheap projection in the render pass copies them
   * through unchanged. */
  segLeftX: number
  segRightX: number
  labelX: number
}

/** Data-only polyline vertex — output of the data-classification pass. Screen Y is computed in the projection step. */
export interface PolylineVertexData {
  contactId: string
  formationId: string
  topDepthM: number
  surfaceElevationM: number
  screenX: number
  sortKey: number
}

/** One formation cross-column line — output of the data-classification pass. */
export interface PolylineDataLine {
  formationId: string
  color: string
  name: string
  vertices: PolylineVertexData[]
}

/**
 * Projected (screen-space) layer — output of the cheap render-time projection.
 *
 * Carries everything the renderer + drag handler need; the drag handler
 * reads ``pxPerMetre`` / ``surfaceY`` / ``segY`` to compute live depth
 * without re-walking ``placedColumns``.
 */
export interface RenderedLayer {
  key: string
  contactId: string
  anchorId: string
  anchorKind: 'cpt' | 'borehole'
  formationId: string
  formationName: string
  color: string
  /** Horizontal segment extent + Y. */
  segLeftX: number
  segRightX: number
  segY: number
  /** Layer body vertical extent (clamped to plot area). */
  bodyTopY: number
  bodyBottomY: number
  /** Column anchor X for the name label. */
  labelX: number
  /** Anchor metadata needed by the drag handler — saved on the layer
   * so we don't re-walk placedColumns on every mousemove. */
  surfaceElevationM: number
  pxPerMetre: number
  surfaceY: number
  /** Original (un-dragged) depth, kept on the layer so the drag
   * commit can no-op when the user releases at the same depth. */
  originalDepthM: number
  /** True when the contact sits BELOW the column's recorded TD, so its
   * slab is degenerate (top deeper than the TD-capped bottom). The
   * contact row is real (paint-through / manual pick persist it), so it
   * stays clickable / draggable / deletable — the render flags it as an
   * extrapolated below-TD contact (dashed line, no fill body) instead of
   * dropping it silently (owner ruling walk22b). */
  belowTd: boolean
}

/** Projected polyline vertex — adds screen Y on top of the data form. */
export interface PolylineVertex {
  contactId: string
  screenX: number
  screenY: number
  sortKey: number
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Clamp ``value`` to ``[min, max]``.
 *
 * Parameters
 * ----------
 * value
 *     The number to clamp.
 * min
 *     Lower bound (inclusive).
 * max
 *     Upper bound (inclusive).
 *
 * Returns
 * -------
 * number
 *     The clamped value.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/**
 * Truncate ``text`` to fit within ``widthPx`` pixels, appending an ellipsis.
 *
 * Uses ``APPROX_GLYPH_WIDTH_PX`` (5 px) as the average character width at
 * fontSize=9.  Reserves 4 px total as left+right padding inside the band.
 *
 * Parameters
 * ----------
 * text
 *     The label to truncate.
 * widthPx
 *     Available pixel width.
 *
 * Returns
 * -------
 * string
 *     The (possibly truncated) label.
 */
export function truncateToWidth(text: string, widthPx: number): string {
  // Reserve a couple of px on each side as padding inside the band.
  const usable = Math.max(0, widthPx - 4)
  const maxChars = Math.max(3, Math.floor(usable / APPROX_GLYPH_WIDTH_PX))
  if (text.length <= maxChars) return text
  return `${text.slice(0, Math.max(1, maxChars - 1))}…`
}

/**
 * Find the column whose centre is closest to ``cursorSvgX``.
 *
 * Returns the best match only when the cursor is within the column's
 * half-width plus the ``COLUMN_ATTRACTION_PX`` hysteresis band.
 * Returns ``null`` when the cursor is in dead space between columns.
 *
 * Used by the cross-column drag (current-target detection) and
 * the marquee hit-test.
 *
 * Parameters
 * ----------
 * cursorSvgX
 *     Cursor position in SVG coordinates.
 * placedColumns
 *     All columns currently placed on the section.
 *
 * Returns
 * -------
 * PlacedColumn | null
 *     The matching column, or null when no column is in range.
 */
export function columnUnderCursor(
  cursorSvgX: number,
  placedColumns: readonly PlacedColumn[],
): PlacedColumn | null {
  let best: PlacedColumn | null = null
  let bestDistance = Infinity
  for (const col of placedColumns) {
    const distance = Math.abs(cursorSvgX - col.nudgedX)
    const reach = col.width / 2 + COLUMN_ATTRACTION_PX
    if (distance <= reach && distance < bestDistance) {
      bestDistance = distance
      best = col
    }
  }
  return best
}

/**
 * Derive screen-space vertical metrics for a placed column.
 *
 * Helper for the snap math when the active target column has a surface
 * elevation.  Thin wrapper over ``depthAxisAtSurface`` (the single
 * source of the section's depth ↔ pixel rate) that adds the
 * ``PlacedColumn`` unwrap + the null-elevation guard.
 *
 * Parameters
 * ----------
 * col
 *     The placed column to derive metrics for.
 * levelToScreen
 *     Vertical transform (absolute elevation → SVG Y).
 *
 * Returns
 * -------
 * object
 *     ``surfaceY``          — SVG Y of the column's surface elevation.
 *     ``pxPerMetre``        — pixels per metre of depth at this column.
 *     ``surfaceElevationM`` — the column's surface elevation (m TAW), or null.
 */
export function surfaceYForColumn(
  col: PlacedColumn,
  levelToScreen: (level: number) => number,
): { surfaceY: number; pxPerMetre: number; surfaceElevationM: number | null } {
  const item = col.proj.item as { elevation_m: number | null }
  if (item.elevation_m === null) {
    return { surfaceY: 0, pxPerMetre: 0, surfaceElevationM: null }
  }
  const axis = depthAxisAtSurface(levelToScreen, item.elevation_m)
  return {
    surfaceY: axis.surfaceY,
    pxPerMetre: axis.pxPerMetreDown,
    surfaceElevationM: item.elevation_m,
  }
}

/**
 * Subtract pending-ghost depth ranges from a band's ``[top, base]``
 * interval, producing zero or more surviving sub-intervals (debt #151
 * dogfeed refinement 2026-05-27 — split the accepted band where a
 * ghost is being inserted so the ghost is visible on top).
 *
 * Pure interval subtraction in depth-metres space; shared by the
 * per-column litho-band memo and the slab label-shift render path.
 *
 * Parameters
 * ----------
 * bandTopM
 *     Band top depth (m below surface).
 * bandBaseM
 *     Band base depth (m below surface).
 * holes
 *     Ghost depth ranges to cut out of the band.
 *
 * Returns
 * -------
 * Array<{ topM, baseM }>
 *     The surviving pieces, in top-to-base order (empty when the
 *     ghosts cover the whole band).
 */
export function subtractGhosts(
  bandTopM: number,
  bandBaseM: number,
  holes: readonly { depth_top_m: number; depth_base_m: number }[],
): Array<{ topM: number; baseM: number }> {
  let pieces: Array<{ topM: number; baseM: number }> = [
    { topM: bandTopM, baseM: bandBaseM },
  ]
  for (const hole of holes) {
    pieces = pieces.flatMap(p => {
      if (hole.depth_base_m <= p.topM || hole.depth_top_m >= p.baseM) {
        return [p]
      }
      const out: Array<{ topM: number; baseM: number }> = []
      if (hole.depth_top_m > p.topM) {
        out.push({ topM: p.topM, baseM: hole.depth_top_m })
      }
      if (hole.depth_base_m < p.baseM) {
        out.push({ topM: hole.depth_base_m, baseM: p.baseM })
      }
      return out
    })
  }
  return pieces
}

// ---------------------------------------------------------------------------
// Stage-A classification pass
// ---------------------------------------------------------------------------

/**
 * Stage-A data-classification pass — pure function of data + horizontal layout.
 *
 * Deliberately receives no vertical-axis inputs (``levelToScreen`` /
 * ``plotTop`` / ``plotBottom``) so callers can keep it memoised across
 * vertical pan and zoom.
 *
 * Produces:
 * - ``slabs``: one ``LayerSlabData`` per (column, contact) pair, carrying
 *   everything the render pass needs except screen-Y coordinates.
 * - ``polylineData``: one ``PolylineDataLine`` per formation, vertices sorted
 *   left-to-right and in stratigraphic age order (ascending display_order).
 *
 * Synthetic lens-tip contacts (no borehole/CPT anchor, world position set)
 * are folded into the polyline accumulator when ``sectionLine`` and
 * ``alongMToScreenX`` are provided; they contribute no slabs.
 *
 * Parameters
 * ----------
 * contacts
 *     All formation contacts for the active model, including synthetic tip contacts.
 * formations
 *     All formations in the project vocabulary.
 * placedColumns
 *     Investigation columns currently placed on the section.
 * excludedBoreholeIds
 *     Borehole ids the active model excludes; their contacts are skipped at render time.
 * sectionLine
 *     Section-line endpoints in the project horizontal CRS, required to project
 *     synthetic contacts.  When absent, synthetic contacts are silently skipped.
 * alongMToScreenX
 *     Maps along-section distance (m) to SVG screen X.  Required for synthetic
 *     contacts; when absent they are silently skipped.
 *
 * Returns
 * -------
 * object
 *     ``slabs``        — per-column layer slabs.
 *     ``polylineData`` — per-formation polyline accumulator.
 */
/**
 * Choose the section-band display label for a formation.
 *
 * Precedence:
 *  1. **NAD-classed (geotech) formation** → its NAD packing name
 *     ("SAND, medium dense"). A geotech formation INHERITS
 *     ``litho_main_soil_code`` from the litho unit it subdivides, so without
 *     this first branch the litho rule below would label it by lithology
 *     ("SAND") and the packing class would never reach the band — the column
 *     would read litho-only while only the connecting fill showed the packing.
 *     The per-column render compacts this full name ("SAND, medium dense" →
 *     "SAND·MD"); the full name stays the band's hover tooltip.
 *  2. **Litho unit** (``litho_main_soil_code`` set) → translated lithology name
 *     (debt #96 — the raw auto-generated "Klei" token must not leak onto the band).
 *  3. **Geological / other** → the user-curated ``name`` (``regional_ref`` fallback).
 *
 * @param formation  The formation whose band label is needed.
 * @returns  The display label string.
 */
export function formationDisplayLabel(formation: GeologicalFormationResponse): string {
  if (formation.nad_class != null) {
    return nadClassName(formation.nad_class)
  }
  if (formation.litho_main_soil_code != null) {
    return lithoDisplayName(formation.litho_main_soil_code, formation.litho_admixtures)
  }
  return formation.name ?? formation.regional_ref ?? ''
}

/**
 * The geotech-axis display override for a formation — the SINGLE
 * source of the NAD name/colour rule shared by ``labelFormations``
 * (band labels) and the per-column litho-band maps in ContactsLayer.
 *
 * On the geotechnical axis a classified formation displays as its NAD
 * packing class: name = ``nadClassName(nad_class)`` (falling back to
 * the formation name while unclassified — ``nadClassName(null)``
 * yields ``""``), colour = ``geotechUnitColor`` (the engineer's pick
 * where he made one, else the packing density ramp — matching the fill
 * overlay). On every other axis the stored ``name`` / ``color`` pass
 * through unchanged.
 *
 * Note the colour override is opt-in per call site: the band-label
 * path keeps the stored formation colour for label contrast and only
 * consumes ``name``.
 *
 * @param formation  The formation to display.
 * @param axisMode   The section's model axis.
 * @returns  The display ``name`` and ``color`` for that axis.
 */
export function geotechDisplayFormation(
  formation: GeologicalFormationResponse,
  axisMode: 'geological' | 'lithostratigraphic' | 'geotechnical',
): { name: string; color: string } {
  if (axisMode !== 'geotechnical') {
    return { name: formation.name, color: formation.color }
  }
  return {
    name: nadClassName(formation.nad_class ?? null) || formation.name,
    // ``geotechUnitColor``, not ``nadClassColor``: a colour the engineer picked
    // on the units pane wins here too, or the section disagrees with the pane
    // he picked it on (owner ruling 2026-08-26).
    color: geotechUnitColor(formation),
  }
}

/**
 * A contact's anchoring investigation id.
 *
 * The anchor is XOR by contract — exactly one of ``borehole_id`` /
 * ``cpt_id`` is set on every contact row — so the read order is
 * immaterial.
 *
 * Parameters
 * ----------
 * c
 *     Any contact-shaped record carrying the anchor pair.
 *
 * Returns
 * -------
 * string | null
 *     The investigation id, or ``null`` on a (malformed) anchorless row.
 */
export function contactAnchorId(c: {
  borehole_id: string | null
  cpt_id: string | null
}): string | null {
  return c.borehole_id ?? c.cpt_id
}

/**
 * Group contacts by anchoring investigation id, each group sorted
 * ascending by ``depth_top_m`` (shallowest first).
 *
 * The "bucket by anchor, sort by depth" shape recurs across the section
 * overlays (slabs, stripe colours, lens candidates, next-deeper lookup,
 * band maps) — this is the single copy. Anchorless contacts are skipped.
 *
 * Parameters
 * ----------
 * contacts
 *     Contact-shaped records (anchor pair + ``depth_top_m``).
 *
 * Returns
 * -------
 * Map<string, T[]>
 *     Anchor id → its contacts, sorted shallowest-first.
 */
export function groupContactsByAnchor<
  T extends { borehole_id: string | null; cpt_id: string | null; depth_top_m: number },
>(contacts: readonly T[]): Map<string, T[]> {
  const byAnchor = new Map<string, T[]>()
  for (const c of contacts) {
    const inv = contactAnchorId(c)
    if (inv === null) continue
    const bucket = byAnchor.get(inv)
    if (bucket) bucket.push(c)
    else byAnchor.set(inv, [c])
  }
  for (const list of byAnchor.values()) {
    list.sort((a, b) => a.depth_top_m - b.depth_top_m)
  }
  return byAnchor
}

export function computeSlabsAndPolylines(
  contacts: readonly FormationContactResponse[],
  formations: readonly GeologicalFormationResponse[],
  placedColumns: readonly PlacedColumn[],
  excludedBoreholeIds: ReadonlySet<string> | undefined,
  sectionLine: SectionLine2D | undefined,
  alongMToScreenX: ((alongM: number) => number) | undefined,
): { slabs: LayerSlabData[]; polylineData: PolylineDataLine[] } {
  if (contacts.length === 0) {
    return { slabs: [] as LayerSlabData[], polylineData: [] as PolylineDataLine[] }
  }

  const formationById = new Map<string, GeologicalFormationResponse>()
  for (const f of formations) formationById.set(f.id, f)

  // Pre-index contacts by anchor id so the per-column loop is O(K)
  // (K = contacts at this anchor) rather than O(M) (M = all contacts
  // in the project). On a 200-column / 500-contact project this drops
  // the inner work from ~100k iterations per pan to ~500.
  const contactsByAnchorId = new Map<string, FormationContactResponse[]>()
  for (const c of contacts) {
    const anchorId = contactAnchorId(c)
    if (!anchorId) continue
    if (c.borehole_id && excludedBoreholeIds?.has(c.borehole_id)) continue
    const bucket = contactsByAnchorId.get(anchorId)
    if (bucket) {
      bucket.push(c)
    } else {
      contactsByAnchorId.set(anchorId, [c])
    }
  }

  const slabsOut: LayerSlabData[] = []
  // Polyline accumulator keyed by formation id; each entry collects
  // vertices in any order, sorted left-to-right at the end.
  type PolyAcc = { color: string; name: string; vertices: PolylineVertexData[] }
  const byFormation = new Map<string, PolyAcc>()

  for (const col of placedColumns) {
    const item = col.proj.item as { id: string; elevation_m: number | null }
    if (item.elevation_m === null) continue
    const colContacts = contactsByAnchorId.get(item.id)
    if (!colContacts || colContacts.length === 0) continue
    // Sort ascending by depth — the per-column slab loop assumes
    // it; the polyline pass doesn't care but using the same order
    // keeps memory access patterns contiguous.
    const sorted = [...colContacts].sort((a, b) => a.depth_top_m - b.depth_top_m)
    const surfaceElevationM = item.elevation_m
    const bottomCap = columnMaxDepthM(col)
    const halfW = col.width / 2

    for (let i = 0; i < sorted.length; i += 1) {
      const contact = sorted[i]
      const formation = formationById.get(contact.formation_id)
      if (!formation) continue
      const topDepth = contact.depth_top_m
      const nextDepth = sorted[i + 1]?.depth_top_m
      // bottomDepth: nearest-known lower bound. Fall-through order
      // matches geological convention — next pick wins, then the
      // investigation's recorded bottom, finally null (renders as
      // "extends to plotBottom" in the projection step).
      const bottomDepthM = nextDepth !== undefined ? nextDepth : (bottomCap ?? null)
      // Display label: prefer the human/resolved NAME over the raw DOV
      // formal code. (Revised 2026-05-18.) The previous regional_ref-first
      // rule meant a formation that was first created from a formal-
      // primary borehole displayed its raw code (e.g. "KoRo") while a
      // sibling formation that happened to be created informal-first
      // showed its full name — an inconsistent, code-vs-name mix on the
      // same section, and a direct violation of the project rule "store
      // the raw upstream token, translate at the presentation boundary"
      // (the #59 lexicon + #58 bridge already put the correct full name
      // in `name`; regional_ref stays the raw code purely for
      // provenance). Fall back to regional_ref only when name is somehow
      // empty. Long names still truncate to the band width below, so the
      // zoomed-out scannability concern is handled by truncation, not by
      // surfacing codes.
      const displayLabel = formationDisplayLabel(formation)
      slabsOut.push({
        contactId: contact.id,
        anchorId: item.id,
        anchorKind: col.kind,
        formationId: contact.formation_id,
        formationName: displayLabel,
        color: formation.color,
        topDepthM: topDepth,
        bottomDepthM,
        surfaceElevationM,
        segLeftX: col.nudgedX - halfW,
        segRightX: col.nudgedX + halfW,
        labelX: col.nudgedX,
      })

      // Same iteration also populates the polyline accumulator —
      // saves a second walk of the sorted list.
      const acc =
        byFormation.get(contact.formation_id) ??
        ({ color: formation.color, name: displayLabel, vertices: [] } as PolyAcc)
      acc.vertices.push({
        contactId: contact.id,
        formationId: contact.formation_id,
        topDepthM: topDepth,
        surfaceElevationM,
        screenX: col.nudgedX,
        sortKey: col.nudgedX,
      })
      byFormation.set(contact.formation_id, acc)
    }
  }

  // Synthetic lens-tip contacts (#101 Slice 6).
  // These have no borehole/CPT anchor — skipped by the anchorId
  // pre-index above.  Their world position (synthetic_x/y) is
  // projected onto the section line to get an along-distance in
  // metres, then mapped to a screen X via alongMToScreenX.
  // Requires both sectionLine and alongMToScreenX to be wired;
  // when absent the synthetics silently render nothing.
  if (sectionLine && alongMToScreenX) {
    const { startX, startY, endX, endY } = sectionLine
    const dx = endX - startX
    const dy = endY - startY
    const len = Math.hypot(dx, dy)
    if (len > 0) {
      const ux = dx / len
      const uy = dy / len
      for (const c of contacts) {
        // Only synthetic contacts (no anchor, world position set).
        if (c.borehole_id || c.cpt_id) continue
        if (c.synthetic_x === null || c.synthetic_y === null || c.synthetic_elevation_m === null)
          continue
        const formation = formationById.get(c.formation_id)
        if (!formation) continue
        const rx = c.synthetic_x - startX
        const ry = c.synthetic_y - startY
        const alongM = rx * ux + ry * uy
        const screenX = alongMToScreenX(alongM)
        // Set surfaceElevationM = synthetic_elevation_m, topDepthM = 0
        // so the projection step computes:
        //   screenY = levelToScreen(surfaceElevationM - topDepthM)
        //           = levelToScreen(synthetic_elevation_m)
        // which places the vertex at the correct absolute elevation.
        const displayLabel = formationDisplayLabel(formation)
        const acc =
          byFormation.get(c.formation_id) ??
          ({
            color: formation.color,
            name: displayLabel,
            vertices: [],
          } as PolyAcc)
        acc.vertices.push({
          contactId: c.id,
          formationId: c.formation_id,
          topDepthM: 0,
          surfaceElevationM: c.synthetic_elevation_m,
          screenX,
          sortKey: screenX,
        })
        byFormation.set(c.formation_id, acc)
      }
    }
  }

  const polylinesOut: PolylineDataLine[] = []
  for (const [formationId, acc] of byFormation) {
    acc.vertices.sort((a, b) => a.sortKey - b.sortKey)
    polylinesOut.push({
      formationId,
      color: acc.color,
      name: acc.name,
      vertices: acc.vertices,
    })
  }
  // Stratigraphic order = age axis. Lower display_order = older
  // formation; sort ASCENDING so older paints first and younger
  // formations render ON TOP. Ties + unknown formations sink to
  // the back (defensive — formationById should always have it).
  polylinesOut.sort(
    (a, b) =>
      (formationById.get(a.formationId)?.display_order ?? Number.MAX_SAFE_INTEGER) -
      (formationById.get(b.formationId)?.display_order ?? Number.MAX_SAFE_INTEGER),
  )

  return { slabs: slabsOut, polylineData: polylinesOut }
}
