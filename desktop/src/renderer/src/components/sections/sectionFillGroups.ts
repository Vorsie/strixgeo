/**
 * Dissolve adjacent same-lithology fill regions into ONE paint operation
 * (S61 — the app-render half of owner clause 5, "merge touching lithos").
 *
 * THE PROBLEM this solves. The litho section fill renders one translucent
 * ``<path>`` (``fillOpacity`` 0.62) per partition region + one per under-column
 * substrate quad. Two SAME-lithology regions that abut along a lens / onlap /
 * carve termination seam are therefore TWO separate SVG elements. The S60b
 * seam-stroke pass (``sectionSeamStrokes.ts``) correctly stopped stroking those
 * interior seams (the doubled self-colour stroke used to read as a diagonal
 * "helper line" inside the sand mass) — but that unmasked the SVG antialiasing
 * seam BETWEEN the two elements: at a shared edge neither element covers the
 * boundary pixels fully, so the darker app background bleeds through as a fine
 * hairline (owner dogfeed 2026-07-19, unmasked by S60b).
 *
 * WHY re-stroking is the wrong fix (rejected, S60b). A self-colour stroke at
 * 0.62 over the two adjacent 0.62 fills STACKS to a darker line — the exact
 * diagonal "helper line" the owner had just asked to remove. And an
 * epsilon-overlap of two SEPARATE 0.62 elements composites the overlap to
 * ``1-(1-0.62)² ≈ 0.855`` — a visibly DARKER band at the seam. Both the stroke
 * and the separate-element overlap re-create a visible line; they are the same
 * knob pulled opposite ways.
 *
 * THE FIX — one element per merged body. A merged same-litho body is rendered
 * as a SINGLE ``<path>`` whose ``d`` carries every sub-polygon as a subpath.
 * A single SVG element painted once at ``fillOpacity`` 0.62 composites its
 * WHOLE coverage as one mask:
 *   - no per-polygon opacity stacking, so it never darkens even where subpaths
 *     touch or overlap (the alpha is applied to the union coverage, once); and
 *   - no inter-element antialiasing seam, because the shared internal edge is
 *     interior to one element's coverage mask (the hairline only ever appears
 *     BETWEEN separate elements).
 * All subpaths are normalised to the SAME winding orientation so the default
 * ``fill-rule: nonzero`` fills the union (an opposite-wound subpath would punch
 * a hole where it overlaps a neighbour). This leaves NO hairline AND NO
 * darkened seam — the property ``owner_merged_view.html`` shows opaque, now
 * preserved translucent.
 *
 * GROUPING KEY — ``(formationId, opacityBucket)``. Grouping by lithology alone
 * would break the S1 selection-fade: when a body is selected, its regions paint
 * at their natural opacity while sibling SAME-litho regions demote to 0.25, so
 * a single formationId can span two opacities. Splitting the group on the fade
 * bucket keeps each emitted element at a single uniform opacity (paint-once
 * still holds). In the common no-selection case every region shares one bucket
 * ⇒ full dissolve. Disjoint same-litho regions in one element are harmless:
 * each disjoint area composites at 0.62 exactly as if painted separately.
 *
 * The seam-aware STROKE pass is unchanged and still runs on the per-region
 * geometry (cross-litho boundaries + outer edges keep their hairline-closing
 * stroke; same-litho interior seams carry none). Cross-litho groups stay
 * separate elements, so the AA seam there is a real litho boundary that the
 * boundary stroke closes — exactly the pre-S61 behaviour at real boundaries.
 */

/** One fill element to be grouped: a closed screen-space ring + its identity. */
export interface FillGroupElement {
  /** Closed ring (no repeated last point) in screen px. */
  points: readonly { x: number; y: number }[]
  /** Lithology identity — regions with the same id dissolve together. */
  formationId: string
  /** Fill colour (all elements of a group share the same lithology ⇒ colour). */
  color: string
  /**
   * Opacity BUCKET this element paints at. Elements with the same
   * ``formationId`` but a different bucket render as separate ``<path>``
   * elements (they genuinely paint at different opacities — e.g. an S1-faded
   * sibling of the selected body). A stable string (e.g. the numeric opacity)
   * is enough; it is only used for grouping + as part of the React key.
   */
  opacityBucket: string
  /** The opacity value to paint the group at (matches ``opacityBucket``). */
  opacity: number
}

/** One dissolved fill group: a single ``<path>`` painted once at ``opacity``. */
export interface FillGroup {
  /** Stable per-group key (formationId + opacity bucket). */
  key: string
  /** SVG path data: one ``M … L … Z`` subpath per constituent ring. */
  d: string
  color: string
  opacity: number
}

/** Signed area (shoelace) of a screen-space ring; sign encodes winding. */
function signedArea(pts: readonly { x: number; y: number }[]): number {
  let a = 0
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += pts[j].x * pts[i].y - pts[i].x * pts[j].y
  }
  return a / 2
}

/**
 * Append one ring to a path-data string as a subpath, normalised to a target
 * winding sign so ``fill-rule: nonzero`` fills the union of all subpaths.
 *
 * @param ring       Closed ring (no repeated last point).
 * @param targetSign Desired signed-area sign (+1 or -1) for every subpath.
 * @returns          ``M x,y L … Z`` for the ring (reversed when its winding
 *                   disagrees with ``targetSign``), or ``''`` for a degenerate
 *                   (< 3 vertex) ring.
 */
function subpath(ring: readonly { x: number; y: number }[], targetSign: number): string {
  if (ring.length < 3) return ''
  const oriented =
    Math.sign(signedArea(ring)) === targetSign || signedArea(ring) === 0
      ? ring
      : [...ring].reverse()
  return (
    oriented
      .map((p, j) => `${j === 0 ? 'M' : 'L'} ${p.x.toFixed(2)},${p.y.toFixed(2)}`)
      .join(' ') + ' Z'
  )
}

/**
 * Dissolve fill elements into one path per ``(formationId, opacityBucket)``.
 *
 * Elements are grouped in first-seen order (stable output ordering). Within a
 * group every ring becomes a subpath of a single ``d`` string, all wound the
 * same way so the default ``nonzero`` fill-rule fills their union without
 * punching overlap holes.
 *
 * Parameters
 * ----------
 * elements : readonly FillGroupElement[]
 *     All litho-axis fill elements (under-column substrate quads + gap
 *     regions), in render order.
 *
 * Returns
 * -------
 * FillGroup[]
 *     One entry per ``(formationId, opacityBucket)`` group, each a single
 *     ``<path>`` painted once at the group's opacity. Degenerate rings are
 *     skipped; a group whose rings are all degenerate is omitted.
 */
export function buildFillGroups(elements: readonly FillGroupElement[]): FillGroup[] {
  // Preserve first-seen order for deterministic, stable-key output.
  const order: string[] = []
  const byKey = new Map<
    string,
    { color: string; opacity: number; formationId: string; opacityBucket: string; rings: readonly { x: number; y: number }[][] }
  >()
  for (const el of elements) {
    const key = `${el.formationId}::${el.opacityBucket}`
    let g = byKey.get(key)
    if (!g) {
      g = {
        color: el.color,
        opacity: el.opacity,
        formationId: el.formationId,
        opacityBucket: el.opacityBucket,
        rings: [],
      }
      byKey.set(key, g)
      order.push(key)
    }
    ;(g.rings as { x: number; y: number }[][]).push(el.points as { x: number; y: number }[])
  }

  const out: FillGroup[] = []
  for (const key of order) {
    const g = byKey.get(key)!
    // Target winding = the sign of the first non-degenerate ring in the group
    // (any consistent choice works; nonzero fills the union regardless of which
    // orientation is chosen, as long as ALL subpaths share it).
    let targetSign = 1
    for (const r of g.rings) {
      const s = Math.sign(signedArea(r))
      if (s !== 0) {
        targetSign = s
        break
      }
    }
    const subs: string[] = []
    for (const r of g.rings) {
      const sp = subpath(r, targetSign)
      if (sp) subs.push(sp)
    }
    if (subs.length === 0) continue
    out.push({ key, d: subs.join(' '), color: g.color, opacity: g.opacity })
  }
  return out
}
