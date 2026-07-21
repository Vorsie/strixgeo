/**
 * partitionFillV2/contactOverride.ts — the free-draw override for a MATCHED TWO-BAND SHARED
 * CONTACT: the horizontal boundary an UPPER band body and the LOWER band body directly below it
 * BOTH ride. The sibling of ``apexOverride.ts`` (which shapes one-sided termination tips) — this
 * shapes the boundary two full-width bands share.
 *
 * Design §8 line 88 ("the freedraw curve is inserted into the arrangement and intersected like any
 * curve — it CANNOT cross into a neighbour face silently"): the upper band's BASE contour and the
 * lower band's TOP contour ARE the same ``bandc`` curve. Bending that ONE polyline through a
 * control point re-traces BOTH faces around it by construction, so the partition stays gap/overlap-
 * free (the boundary is shared → both bands follow, never a gap — owner 2026-07-21).
 *
 * The override is keyed by BOTH body ids so it is DISTINCT from the one-sided ``bodyId@gap`` lens/
 * onlap key (``lensApexOverrideKey``) — a lens override on the same body+gap must never collide with
 * a contact bend. The map itself is reused (``section.lensApexOverrides``): the two-body key namespace
 * (``contact:…``) cannot alias a single-body key, so no wire-shape change is needed
 * (``partitionFill/types.ts`` untouched — backwards-compat SUSPENDED, but additive-by-key anyway).
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { type LensApexOverride } from '../partitionFill'
import { type ResolvedTie } from './emitCurves'
import { type ColumnGeom } from './sectionGeom'
import { type Point } from './types'

/** Small epsilon in metres for the contour-elevation match (before the 1 mm arrangement snap). */
const CONTACT_ELEV_EPS = 1e-6

/**
 * Key a matched-contact apex override by the UPPER band body, the LOWER band body, and the gap.
 *
 * The ``contact:`` prefix namespaces it away from ``lensApexOverrideKey``'s ``bodyId@gap`` form so a
 * two-body contact override can share ``section.lensApexOverrides`` with the single-body lens/onlap
 * overrides without any collision. The (upper, lower) order is significant — the two bands play
 * distinct roles (upper base vs lower top), so the key is order-sensitive.
 *
 * Parameters
 * ----------
 * upperBodyId : string
 *     The body of the band ABOVE the shared contact.
 * lowerBodyId : string
 *     The body of the band BELOW the shared contact.
 * gapIndex : number
 *     The gap the shared contact spans.
 *
 * Returns
 * -------
 * string
 *     The override map key, e.g. ``contact:<upper>|<lower>@8``.
 */
export function contactApexOverrideKey(upperBodyId: string, lowerBodyId: string, gapIndex: number): string {
  return `contact:${upperBodyId}|${lowerBodyId}@${gapIndex}`
}

/**
 * The clamped control-point apex for a matched-contact override, or ``null`` when none applies.
 *
 * Looks up ``contactApexOverrideKey(upperBodyId, lowerBodyId, gapIndex)`` in the section's override
 * map. When found, the apex is CLAMPED to the legal envelope so the bent boundary can never cross the
 * upper band's own TOP or the lower band's own BASE and invert (which would open an overlap):
 *
 *   - elevation ∈ ``(lowerBase + EPS, upperTop − EPS)`` — strictly between the two bands' outer
 *     contacts, so the bend stays a valid divider between them;
 *   - fraction ∈ ``[FRACTION_MARGIN, 1 − FRACTION_MARGIN]`` — the same 0.02 strict-interior margin
 *     ``apexOverride.ts`` uses so a control point ON/PAST a column vertical cannot make the bent
 *     segment collinear with (or cross) that column.
 *
 * No override → ``null`` so the caller emits its straight contour byte-identical (no-override path
 * unchanged).
 *
 * Parameters
 * ----------
 * overrides : ReadonlyMap<string, LensApexOverride> | undefined
 *     ``section.lensApexOverrides``.
 * upperBodyId, lowerBodyId : string | null
 *     The two bands' body ids (the key halves). ``null`` on either → no override (a band with no
 *     drilled body cannot be keyed).
 * gapIndex : number
 *     The gap the shared contact spans.
 * upperTop, lowerBase : number
 *     The clamp envelope: the upper band's OWN top elevation and the lower band's OWN base elevation.
 *
 * Returns
 * -------
 * { fraction: number; elevation: number } | null
 *     The clamped control point, or ``null`` when no override applies.
 */
export function contactApexOverride(
  overrides: ReadonlyMap<string, LensApexOverride> | undefined,
  upperBodyId: string | null,
  lowerBodyId: string | null,
  gapIndex: number,
  upperTop: number,
  lowerBase: number,
): { fraction: number; elevation: number } | null {
  if (!overrides || upperBodyId == null || lowerBodyId == null) return null
  const ov = overrides.get(contactApexOverrideKey(upperBodyId, lowerBodyId, gapIndex))
  if (!ov) return null
  const FRACTION_MARGIN = 0.02
  const fraction = Math.min(1 - FRACTION_MARGIN, Math.max(FRACTION_MARGIN, ov.fraction))
  // Clamp elevation strictly between the two outer contacts so the divider never inverts.
  const ELEV_MARGIN = 1e-3
  const hi = upperTop - ELEV_MARGIN
  const lo = lowerBase + ELEV_MARGIN
  // Degenerate envelope (bands too thin to divide) → pin to the midpoint (a no-op bend).
  const elevation = hi > lo ? Math.min(hi, Math.max(lo, ov.elevation)) : (upperTop + lowerBase) / 2
  return { fraction, elevation }
}

/**
 * Bend a straight band contour ``left→right`` through a control point, inserting the apex vertex
 * at the x it maps to across the gap. Returns a 3-point polyline (left, apex, right); the apex x is
 * the gap-fraction interpolated between the two column x positions.
 *
 * The contour is emitted for BOTH the upper band's base and the lower band's top with the SAME
 * elevations, so bending both identically re-traces both faces around the one shared, coincident
 * bent edge (the DCEL unions the coincident segments — design §8 line 88).
 *
 * Parameters
 * ----------
 * contour : readonly Point[]
 *     The straight (clipped) band contour, 2 points left→right by x.
 * fraction : number
 *     The control point's gap-local fraction (0 = left column, 1 = right).
 * elevation : number
 *     The control point's elevation (mTAW).
 *
 * Returns
 * -------
 * Point[]
 *     The bent contour (left, apex, right), or the original 2 points when it is degenerate (the
 *     apex snaps onto an endpoint) so the arrangement never sees a zero-length segment.
 */
export function bendBandContour(
  contour: readonly Point[],
  fraction: number,
  elevation: number,
): Point[] {
  if (contour.length < 2) return [...contour]
  const A = contour[0]
  const B = contour[contour.length - 1]
  const apexX = A.x + fraction * (B.x - A.x)
  const apex: Point = { x: apexX, y: elevation }
  // Skip a degenerate insert (apex coincident with an endpoint by x) — the straight contour stands.
  const SNAP = 0.001
  if (Math.abs(apexX - A.x) <= SNAP || Math.abs(apexX - B.x) <= SNAP) return [A, B]
  return [A, apex, B]
}

/** Whether two elevations coincide within the contact-match epsilon. */
export function contactElevMatches(a: number, b: number): boolean {
  return Math.abs(a - b) < CONTACT_ELEV_EPS
}

/**
 * One matched-contact bend: the shared contour's per-column elevations (which contour to bend) plus
 * the clamped control point the contour is bent through. Both the upper band's BASE contour and the
 * lower band's TOP contour carry these SAME per-column elevations, so a contour whose endpoints
 * match ``(leftElev, rightElev)`` is bent identically — the DCEL unions the coincident bent edge.
 */
export interface ContactBend {
  leftElev: number
  rightElev: number
  fraction: number
  elevation: number
}

/** Contour-match epsilon in metres (the ties/bands are pre-snap; 1 mm is the arrangement grid). */
const CONTOUR_MATCH_M = 1e-3

/** Every body id whose unit BASE (side 'base') or TOP (side 'top') sits at ``elev`` across both columns. */
function bodiesBoundingContact(left: ColumnGeom, right: ColumnGeom, elevLeft: number, elevRight: number, side: 'top' | 'base'): Set<string> {
  const out = new Set<string>()
  const scan = (col: ColumnGeom, e: number): void => {
    for (const u of col.units) {
      if (u.bodyId == null) continue
      const contact = side === 'base' ? u.baseElev : u.topElev
      if (Math.abs(contact - e) <= CONTOUR_MATCH_M) out.add(u.bodyId)
    }
  }
  scan(left, elevLeft)
  scan(right, elevRight)
  return out
}

/**
 * Collect the matched-contact bends for ONE gap from its TIES + overrides.
 *
 * A matched two-band shared contact is a correlation TIE on the boundary an UPPER band and the LOWER
 * band below it both ride (ruling 8a: the tie sits on the surface both units share). The engine's
 * ``UnitGeom.bodyId`` and the RENDERED ``PartitionRegion.bodyId`` can differ (the render's
 * ``resolveLabel`` picks the bounding unit's id, which may be a different column's unit of the same
 * band). So the override key is matched against the SET of every body whose contact sits at the tie's
 * elevation — the upper body is any unit whose BASE is the tie contact, the lower is any unit whose
 * TOP is the tie contact — so whichever id the app sends (from the region it drew on) matches its
 * band's real contact. When the override map carries ``contactApexOverrideKey(upper, lower, gap)``
 * for such a pair, this returns a ``ContactBend`` at the tie's per-column elevations + the clamped
 * control point. Bending the ONE shared boundary (the tie curve AND its coincident band contour)
 * re-traces BOTH faces (design §8 line 88).
 *
 * Parameters
 * ----------
 * gapIndex : number
 *     The gap.
 * left, right : ColumnGeom
 *     The gap's two columns (their units carry the bodyIds).
 * ties : readonly ResolvedTie[]
 *     The gap's active ties (the shared-contact carriers).
 * overrides : ReadonlyMap<string, LensApexOverride> | undefined
 *     ``section.lensApexOverrides``.
 *
 * Returns
 * -------
 * ContactBend[]
 *     One bend per overridden shared contact (empty when no override applies — byte-identical).
 */
export function collectContactBends(
  gapIndex: number,
  left: ColumnGeom,
  right: ColumnGeom,
  ties: readonly ResolvedTie[],
  overrides: ReadonlyMap<string, LensApexOverride> | undefined,
): ContactBend[] {
  if (!overrides || overrides.size === 0) return []
  // Parse the gap's matched-contact override keys once into (upper, lower) pairs.
  const prefix = 'contact:'
  const suffix = `@${gapIndex}`
  const wanted: { upper: string; lower: string }[] = []
  for (const key of overrides.keys()) {
    if (!key.startsWith(prefix) || !key.endsWith(suffix)) continue
    const bodies = key.slice(prefix.length, key.length - suffix.length).split('|')
    if (bodies.length === 2) wanted.push({ upper: bodies[0], lower: bodies[1] })
  }
  if (wanted.length === 0) return []
  const out: ContactBend[] = []
  const seen = new Set<string>()
  for (const t of ties) {
    if (t.gapIndex !== gapIndex) continue
    // Bodies whose BASE sits at the tie contact = the UPPER-band candidates; whose TOP sits there =
    // the LOWER-band candidates. Whichever id the app keyed (rendered or engine) is in one of these.
    const upperCands = bodiesBoundingContact(left, right, t.left.y, t.right.y, 'base')
    const lowerCands = bodiesBoundingContact(left, right, t.left.y, t.right.y, 'top')
    for (const w of wanted) {
      if (!upperCands.has(w.upper) || !lowerCands.has(w.lower)) continue
      const key = contactApexOverrideKey(w.upper, w.lower, gapIndex)
      if (seen.has(key)) continue
      // Clamp envelope: the upper body's OWN top + the lower body's OWN base (across both columns).
      const upperTop = bodyTopElev(left, right, w.upper)
      const lowerBase = bodyBaseElev(left, right, w.lower)
      const clamped = contactApexOverride(overrides, w.upper, w.lower, gapIndex, upperTop, lowerBase)
      if (!clamped) continue
      seen.add(key)
      out.push({ leftElev: t.left.y, rightElev: t.right.y, fraction: clamped.fraction, elevation: clamped.elevation })
    }
  }
  return out
}

/** The highest top elevation of a body across the two columns (its OWN top — the clamp ceiling). */
function bodyTopElev(left: ColumnGeom, right: ColumnGeom, bodyId: string): number {
  let top = -Infinity
  for (const c of [left, right]) for (const u of c.units) if (u.bodyId === bodyId && u.topElev > top) top = u.topElev
  return Number.isFinite(top) ? top : Infinity
}

/** The lowest base elevation of a body across the two columns (its OWN base — the clamp floor). */
function bodyBaseElev(left: ColumnGeom, right: ColumnGeom, bodyId: string): number {
  let base = Infinity
  for (const c of [left, right]) for (const u of c.units) if (u.bodyId === bodyId && u.baseElev < base) base = u.baseElev
  return Number.isFinite(base) ? base : -Infinity
}

/**
 * Bend a straight band contour through the matched-contact control point when its per-column
 * elevations match one of the gap's bends; otherwise return it unchanged. Applied to BOTH the upper
 * base and the lower top contour (identical elevations → identical bend → one shared bent edge).
 *
 * Parameters
 * ----------
 * contour : readonly Point[]
 *     The straight (clipped) band contour (2 points left→right).
 * leftElev, rightElev : number
 *     The contour's per-column elevations (the bend-match key).
 * bends : readonly ContactBend[]
 *     The gap's matched-contact bends (``collectContactBends``).
 *
 * Returns
 * -------
 * Point[]
 *     The bent contour, or the original when no bend matches.
 */
export function applyContactBend(
  contour: readonly Point[],
  leftElev: number,
  rightElev: number,
  bends: readonly ContactBend[],
): Point[] {
  for (const bend of bends) {
    if (Math.abs(bend.leftElev - leftElev) <= CONTOUR_MATCH_M && Math.abs(bend.rightElev - rightElev) <= CONTOUR_MATCH_M) {
      return bendBandContour(contour, bend.fraction, bend.elevation)
    }
  }
  return [...contour]
}
