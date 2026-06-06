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
 *     ``isTypingTarget``    — returns true when a DOM target is a text-input element.
 *
 * Main function
 *     ``computeSlabsAndPolylines`` — Stage-A classification pass; pure of vertical axis.
 */

import type {
  FormationContactResponse,
  GeologicalFormationResponse,
} from '../../api/client'
import { formatLithoDisplayName } from '../../utils/lithoLabels'
import type { SectionLine2D } from '../../utils/sliceTin'
import { columnMaxDepthM, type PlacedColumn } from './utils'

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
 * elevation.  Mirrors the depth derivation in ``handleMove`` but
 * factored out so the value can be precomputed at drag start without
 * duplicating the ``(cursorY - surfaceY) / pxPerMetre`` arithmetic.
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
  const surfaceY = levelToScreen(item.elevation_m)
  // pxPerMetre derives from a 1m delta in level → screen Y.
  const oneMetreDown = levelToScreen(item.elevation_m - 1)
  const pxPerMetre = oneMetreDown - surfaceY
  return {
    surfaceY,
    pxPerMetre,
    surfaceElevationM: item.elevation_m,
  }
}

/**
 * Return ``true`` when ``target`` is a text-input-like element.
 *
 * The section panel's selection shortcuts must not fire when the user
 * is typing in a formation-rename input, the search box, or any other
 * text field.  Mirrors the same guard in Sidebar and BoreholeLog.
 *
 * Parameters
 * ----------
 * target
 *     The ``EventTarget`` from a keyboard event (may be null).
 *
 * Returns
 * -------
 * boolean
 *     True when the target is INPUT, TEXTAREA, SELECT, or contenteditable.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return target.isContentEditable
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
    const anchorId = c.borehole_id ?? c.cpt_id
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
      // Litho units carry a raw-token ``name`` ("KLEI", "KLEI (KL:Z)")
      // auto-generated by AcceptLithoSuggestions. Translate it at the
      // presentation boundary via ``formatLithoDisplayName`` (debt #96 —
      // the raw "Klei" was leaking onto the section band). Geological
      // formations keep their user-curated ``name``.
      const displayLabel =
        formation.litho_main_soil_code != null
          ? formatLithoDisplayName(formation.litho_main_soil_code, formation.litho_admixtures)
          : (formation.name ?? formation.regional_ref)
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
        const displayLabel =
          formation.litho_main_soil_code != null
            ? formatLithoDisplayName(formation.litho_main_soil_code, formation.litho_admixtures)
            : (formation.name ?? formation.regional_ref)
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
