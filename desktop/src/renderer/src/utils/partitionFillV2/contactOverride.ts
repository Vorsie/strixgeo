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

import { INTERIOR_PINCH_FRACTION, type LensApexOverride } from '../sectionPartition'
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

/**
 * §113 — bend a band contour through a control point CONFINED to the flush segment: bend only the
 * side between the grabbed column and a fixed WALL vertex, keeping the other side at base geometry.
 *
 * Given the straight contour ``left→right`` and a WALL at ``(wallFraction, wallElev)`` (the onlap's
 * pinch), the result is ``[left, apex, wall, right]`` (or the ordering the geometry demands): the
 * apex bends the flush segment while the wall pins the onlap-side segment to its ORIGINAL line so a
 * rider sampling that side does not move. The apex is only inserted when it falls strictly on the
 * flush side of the wall (else the plain wall-pinned contour stands). Mirrors ``bendBandContour``'s
 * degenerate-snap guard so the arrangement never sees a zero-length segment.
 *
 * Parameters
 * ----------
 * contour : readonly Point[]
 *     The straight (clipped) band contour, 2 points left→right by x.
 * fraction : number
 *     The apex's gap-local fraction (0 = left, 1 = right).
 * elevation : number
 *     The apex elevation (mTAW).
 * wallFraction : number
 *     The wall's gap-local fraction (the onlap's pinch).
 * wallElev : number
 *     The wall vertex's elevation — the contour's own value at the pinch (the onlap's current apex),
 *     so pinning it there leaves the onlap-side segment byte-identical to the base line.
 *
 * Returns
 * -------
 * Point[]
 *     The confined bent contour.
 */
export function bendBandContourConfined(
  contour: readonly Point[],
  fraction: number,
  elevation: number,
  wallFraction: number,
  wallElev: number,
): Point[] {
  if (contour.length < 2) return [...contour]
  const A = contour[0]
  const B = contour[contour.length - 1]
  const xAt = (f: number): number => A.x + f * (B.x - A.x)
  const wall: Point = { x: xAt(wallFraction), y: wallElev }
  const apex: Point = { x: xAt(fraction), y: elevation }
  const SNAP = 0.001
  // The wall side toward the grab (flush) column is [A, wall] when the flush column is LEFT (wall to
  // the RIGHT of the apex), else [wall, B]. Order the output vertices left→right by x, dropping any
  // degenerate (apex/wall coincident with a neighbour by x).
  const pts: Point[] = [A]
  const flushLeft = fraction < wallFraction
  if (flushLeft) {
    if (Math.abs(apex.x - A.x) > SNAP && Math.abs(apex.x - wall.x) > SNAP) pts.push(apex)
    if (Math.abs(wall.x - A.x) > SNAP && Math.abs(wall.x - B.x) > SNAP) pts.push(wall)
  } else {
    if (Math.abs(wall.x - A.x) > SNAP && Math.abs(wall.x - B.x) > SNAP) pts.push(wall)
    if (Math.abs(apex.x - wall.x) > SNAP && Math.abs(apex.x - B.x) > SNAP) pts.push(apex)
  }
  pts.push(B)
  return pts
}

/** Whether two elevations coincide within the contact-match epsilon. */
export function contactElevMatches(a: number, b: number): boolean {
  return Math.abs(a - b) < CONTACT_ELEV_EPS
}

/**
 * One matched-contact bend: the per-column elevations of the contour to bend (``leftElev`` /
 * ``rightElev``) plus the clamped control point it is bent through.
 *
 * Two shapes, discriminated by ``heterogeneous`` (§112):
 *
 *  - FLUSH (``heterogeneous === false``) — the two bands share ONE physical contact on BOTH columns
 *    (the upper band's base == the lower band's top, coincident everywhere). ``leftElev`` /
 *    ``rightElev`` are that shared TIE contact's per-column elevations; bending BOTH the tie curve and
 *    the shared ``bandc`` contour identically re-traces both faces around one coincident bent edge
 *    (the historical matched-shared-contact case — byte-identical to before §112).
 *
 *  - HETEROGENEOUS (``heterogeneous === true``) — the boundary the owner grabbed is the UPPER band's
 *    OWN base contour, but a THIRD body (an onlap) intervenes between the two bands on some column, so
 *    the upper band's base does NOT coincide with the lower band's top there (CS1 gap-4: clay base
 *    5.21→6.44, matrix top 5.21→5.73). ``leftElev`` / ``rightElev`` are the UPPER BAND's OWN base
 *    contour (5.21, 6.44) — a NEW line emitted + bent by curve emission — so bending it moves the CLAY
 *    BASE alone and NEVER the matrix-top tie (``tieLeftElev`` / ``tieRightElev``, which stays put). The
 *    matched lower-band tie's ``ResolvedTie.bentPoints`` is set to this bent clay-base polyline (WITHOUT
 *    bending the tie's own curve), so the intervening onlap RIDES the clay base (its top laps that
 *    line, base pinned to the matrix top — thickens/thins with the drag; ruling §112 reflow).
 */
export interface ContactBend {
  leftElev: number
  rightElev: number
  fraction: number
  elevation: number
  /**
   * ``true`` when the grabbed boundary is the upper band's OWN base contour, decoupled from the
   * lower-band tie (an onlap intervenes). ``false`` for the flush shared-contact case (byte-identical
   * pre-§112 behaviour).
   */
  heterogeneous: boolean
  /**
   * HETEROGENEOUS only — the matched lower-band tie's per-column elevations (the matrix-top tie that
   * must HOLD). Curve emission attaches the bent clay-base polyline to THIS tie's ``bentPoints`` (so
   * the riding onlap follows it) without bending the tie's own curve. ``null`` on the flush path.
   */
  tieLeftElev: number | null
  tieRightElev: number | null
  /**
   * §113 FLUSH-SIDE CONFINEMENT — when the heterogeneous grab sits on the FLUSH side of the onlap's
   * pinch (left of the sand where the two bands share a clean contact), the bend must be CONFINED to
   * the flush segment so the onlap is a WALL and does not ride (spec "Onlap rides along —
   * SEGMENT-CONFINED"). ``wallFraction`` is the onlap's pinch fraction in the gap frame; the bent
   * clay-base polyline pins a FIXED vertex at ``(wallFraction, wallElev)`` (``wallElev`` = the onlap's
   * current apex on the matrix-top tie), so the clay-base segment on the onlap's side keeps its base
   * geometry and the onlap (sampling that segment) stays put. ``null`` when the grab is on the onlap's
   * side (the whole-gap ride, §112 unchanged) or on the flush shared-contact path.
   */
  wallFraction: number | null
  wallElev: number | null
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
      // §112 FLUSH vs HETEROGENEOUS discriminator. The upper band's OWN base contour is
      // (upperBaseLeft, upperBaseRight). FLUSH ⟺ it coincides with the matched tie's own per-column
      // elevations on BOTH columns (the two bands share ONE physical contact everywhere). When they
      // DIFFER on some column, a third body (an onlap) intervenes → HETEROGENEOUS: bend the clay's
      // OWN base line, hold the matrix-top tie. The band's body id can DIFFER per column (a
      // per-column body split; the CO2 synthetic uses ``bSandL`` / ``bSandR``), so read the upper
      // band's base by its FORMATION-and-adjacency, falling back from the direct body-id lookup.
      const upperFormation = bodyFormation(left, right, w.upper)
      const upperBaseLeft = upperBandBaseOneCol(left, w.upper, upperFormation, t.left.y)
      const upperBaseRight = upperBandBaseOneCol(right, w.upper, upperFormation, t.right.y)
      const flush =
        Number.isFinite(upperBaseLeft) &&
        Number.isFinite(upperBaseRight) &&
        Math.abs(upperBaseLeft - t.left.y) <= CONTOUR_MATCH_M &&
        Math.abs(upperBaseRight - t.right.y) <= CONTOUR_MATCH_M
      // §112 heterogeneous is the SPECIFIC onlap-intervening topology (the app's ``resolveOnlapInter-
      // veningGrab`` dispatch): the upper band's base does NOT meet the matrix-top tie on one column
      // because a THIRD body (the onlap) sits strictly between the upper band's base and the tie
      // contact there. Require that intervening body to exist before taking the heterogeneous path;
      // otherwise a ``contact:U|L`` key on a non-clean boundary (e.g. a persisted lens node keyed on a
      // multi-unit body — ``lensPersistRouting`` GAP-5 6bb744) would spuriously bend a clay-base line
      // that is not there. No intervening body → fall through to the flush branch (byte-identical) or,
      // when not flush either, emit nothing (the override is engine-inert, as before §112).
      const heterogeneous =
        !flush &&
        Number.isFinite(upperBaseLeft) &&
        Number.isFinite(upperBaseRight) &&
        hasInterveningBody(left, right, w.upper, w.lower, upperBaseLeft, upperBaseRight, t.left.y, t.right.y)
      if (flush) {
        const clamped = contactApexOverride(overrides, w.upper, w.lower, gapIndex, upperTop, lowerBase)
        if (!clamped) continue
        seen.add(key)
        out.push({
          leftElev: t.left.y,
          rightElev: t.right.y,
          fraction: clamped.fraction,
          elevation: clamped.elevation,
          heterogeneous: false,
          tieLeftElev: null,
          tieRightElev: null,
          wallFraction: null,
          wallElev: null,
        })
      } else if (heterogeneous) {
        // HETEROGENEOUS clay-base reshape. The stratigraphic-order FLOOR is the intervening onlap's
        // base at the apex position — which is the matrix-top TIE interpolated at the apex fraction
        // (the onlap base rides the matrix top; ruling §112 "the clay base CLAMPS at the onlap base").
        // Clamp the FRACTION first (the same [0.02, 0.98] strict-interior margin), then read the tie
        // floor at that fraction, so a DOWN drag stops where the onlap would die (never inverting the
        // clay below the matrix), while an UP drag is bounded only by the clay's own top.
        const rawOv = overrides?.get(key)
        if (!rawOv) continue
        const FRACTION_MARGIN = 0.02
        const fraction = Math.min(1 - FRACTION_MARGIN, Math.max(FRACTION_MARGIN, rawOv.fraction))
        const tieFloorAtApex = t.left.y + fraction * (t.right.y - t.left.y)
        const ELEV_MARGIN = 1e-3
        const hi = upperTop - ELEV_MARGIN
        const lo = tieFloorAtApex + ELEV_MARGIN
        const elevation = hi > lo ? Math.min(hi, Math.max(lo, rawOv.elevation)) : (upperTop + tieFloorAtApex) / 2
        seen.add(key)
        // §113 FLUSH-SIDE CONFINEMENT. The intervening onlap pinches from ITS OWN column (the
        // HETEROGENEOUS column, where the upper base diverges from the tie contact) toward the facing
        // column, tapering to a tip at ``INTERIOR_PINCH_FRACTION`` measured from its own column. That
        // tip is the WALL (spec "Onlap rides along — SEGMENT-CONFINED"). Map it into the gap frame:
        // onlap on the RIGHT column → pinch at ``1 − INTERIOR_PINCH_FRACTION`` (flush = [0, pinch));
        // onlap on the LEFT → pinch at ``INTERIOR_PINCH_FRACTION`` (flush = (pinch, 1]). When the APEX
        // sits on the FLUSH side of the pinch, confine the bend: pin a fixed vertex at the onlap's
        // current apex — the matrix-top tie interpolated AT the pinch fraction (``wallElev``) — so the
        // clay-base segment on the onlap's side keeps its base geometry and the onlap does NOT ride.
        // On the onlap's side of the pinch the whole-gap ride stands (§112 unchanged → wall null).
        const onlapOnRight = Math.abs(upperBaseRight - t.right.y) > CONTOUR_MATCH_M
        const pinchFraction = onlapOnRight ? 1 - INTERIOR_PINCH_FRACTION : INTERIOR_PINCH_FRACTION
        const apexIsFlushSide = onlapOnRight ? fraction < pinchFraction : fraction > pinchFraction
        const wallFraction = apexIsFlushSide ? pinchFraction : null
        const wallElev = apexIsFlushSide ? t.left.y + pinchFraction * (t.right.y - t.left.y) : null
        // Bend the CLAY's OWN base contour (upperBaseLeft → apex → upperBaseRight); carry the matched
        // tie's own elevations so curve emission can route the bent polyline onto that tie's
        // ``bentPoints`` (onlap ride) WITHOUT bending the tie curve (matrix holds). When confined, the
        // wall vertex keeps the onlap-side segment fixed.
        out.push({
          leftElev: upperBaseLeft,
          rightElev: upperBaseRight,
          fraction,
          elevation,
          heterogeneous: true,
          tieLeftElev: t.left.y,
          tieRightElev: t.right.y,
          wallFraction,
          wallElev,
        })
        // §113 FLUSH-SIDE MATRIX-TOP COMPANION. On the flush segment there is NO onlap and the clay
        // base IS the matrix top (a plain shared contact — clay base 5.21 == matrix top 5.21 on the
        // flush column), so the MATRIX TOP must follow the clay base there (both grow/shrink together)
        // and HOLD on the onlap segment [wall .. column] where the onlap laps it. The matrix-top
        // authority ``bandc`` contour (emitted by the tie-only bands loop) is keyed on the TIE's own
        // per-column elevations (5.21, 5.73), so it needs its OWN confined bend to follow — a single
        // clay-base bend (keyed 5.21, 6.44) cannot drive it (they diverge on the onlap column). This
        // companion bend confines the matrix top to the SAME apex + wall so it bends identically on the
        // flush segment and holds (byte-identical to the straight authority contour) on the onlap
        // segment — the flush-side triangle the clay vacated is then MATRIX, not a re-flooded clay
        // sliver. Emitted ONLY when confined (flush-side); the onlap-side ride never emits it, so §112
        // stays byte-identical.
        if (apexIsFlushSide && wallFraction != null && wallElev != null) {
          out.push({
            leftElev: t.left.y,
            rightElev: t.right.y,
            fraction,
            elevation,
            heterogeneous: false,
            tieLeftElev: null,
            tieRightElev: null,
            wallFraction,
            wallElev,
          })
        }
      }
    }
  }
  return out
}

/**
 * Whether a THIRD body (the intervening onlap) sits strictly between the upper band's OWN base and
 * the matrix-top TIE contact on the column where they diverge (the §112 onlap-intervening topology).
 *
 * On the FLUSH column the upper base == the tie contact (no gap). On the HETEROGENEOUS column they
 * differ; a genuine onlap-intervening boundary has a body — neither the upper nor the lower band —
 * whose span lies strictly inside ``(min(upperBase, tie), max(upperBase, tie))`` there. This is the
 * signal the app's ``resolveOnlapInterveningGrab`` fires on; requiring it in the engine keeps a
 * ``contact:U|L`` override keyed on a non-clean boundary (a persisted lens node) from spuriously
 * bending a clay-base line that no onlap laps.
 *
 * Parameters
 * ----------
 * left, right : ColumnGeom
 *     The gap's two columns.
 * upperBodyId, lowerBodyId : string
 *     The two bands' body ids (the override key halves) — excluded from the intervening candidates.
 * upperBaseLeft, upperBaseRight : number
 *     The upper band's OWN base elevation on each column.
 * tieLeftElev, tieRightElev : number
 *     The matched (matrix-top) tie's per-column contact elevations.
 *
 * Returns
 * -------
 * boolean
 *     True when a third body intervenes between the upper base and the tie contact on either column.
 */
function hasInterveningBody(
  left: ColumnGeom,
  right: ColumnGeom,
  upperBodyId: string,
  lowerBodyId: string,
  upperBaseLeft: number,
  upperBaseRight: number,
  tieLeftElev: number,
  tieRightElev: number,
): boolean {
  const columnHas = (col: ColumnGeom, upperBase: number, tieElev: number): boolean => {
    const lo = Math.min(upperBase, tieElev) + CONTOUR_MATCH_M
    const hi = Math.max(upperBase, tieElev) - CONTOUR_MATCH_M
    if (hi <= lo) return false // the upper base already meets the tie contact here (flush column)
    for (const u of col.units) {
      if (u.bodyId == null || u.bodyId === upperBodyId || u.bodyId === lowerBodyId) continue
      // A body whose span overlaps the (upperBase, tie) interval on this column is the onlap between.
      const uHi = Math.max(u.topElev, u.baseElev)
      const uLo = Math.min(u.topElev, u.baseElev)
      if (uHi > lo && uLo < hi) return true
    }
    return false
  }
  return columnHas(left, upperBaseLeft, tieLeftElev) || columnHas(right, upperBaseRight, tieRightElev)
}

/** The formation id of a body across the two columns (its litho identity), or null if absent. */
function bodyFormation(left: ColumnGeom, right: ColumnGeom, bodyId: string): string | null {
  for (const c of [left, right]) for (const u of c.units) if (u.bodyId === bodyId) return u.formationId
  return null
}

/**
 * The UPPER band's own base elevation on ONE column, or NaN when the band is absent there.
 *
 * The band's body id can differ per column (a per-column body split — CO2's ``bSandL`` / ``bSandR``),
 * so the lookup is: (1) the unit whose bodyId matches directly; else (2) the unit of the band's
 * FORMATION whose base sits nearest the matched tie contact (``tieContactElev``) from AT OR ABOVE it —
 * the same-formation band member on this column. Returns NaN when neither resolves (the band does not
 * reach this column). Used only to compare against the tie contact for the flush/heterogeneous split.
 */
function upperBandBaseOneCol(
  col: ColumnGeom,
  upperBodyId: string,
  upperFormation: string | null,
  tieContactElev: number,
): number {
  // Prefer the unit of the SAME BODY whose base is CLOSEST to the tie contact. A body can appear as
  // several units on one column (a body split — CS1 gap-5 6bb744 is two units); picking the FIRST
  // would report a base far from the contact and spuriously read heterogeneous. Nearest-to-tie makes
  // a genuinely flush multi-unit body read flush (the unit sharing the tie contact wins).
  let best = NaN
  let bestDist = Infinity
  for (const u of col.units) {
    if (u.bodyId !== upperBodyId) continue
    const d = Math.abs(u.baseElev - tieContactElev)
    if (d < bestDist) {
      bestDist = d
      best = u.baseElev
    }
  }
  if (Number.isFinite(best)) return best
  if (upperFormation == null) return NaN
  // Same-formation fallback (a per-column body split — CO2's ``bSandL`` / ``bSandR``): the band
  // member on this column is the unit of the upper formation whose base is closest to the tie contact.
  for (const u of col.units) {
    if (u.formationId !== upperFormation) continue
    const d = Math.abs(u.baseElev - tieContactElev)
    if (d < bestDist) {
      bestDist = d
      best = u.baseElev
    }
  }
  return best
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
      // §113: a flush-side heterogeneous bend confines to the flush segment (the onlap's pinch is a
      // wall) so the onlap-side segment keeps its base geometry and the onlap does not ride.
      if (bend.wallFraction != null && bend.wallElev != null) {
        return bendBandContourConfined(contour, bend.fraction, bend.elevation, bend.wallFraction, bend.wallElev)
      }
      return bendBandContour(contour, bend.fraction, bend.elevation)
    }
  }
  return [...contour]
}
