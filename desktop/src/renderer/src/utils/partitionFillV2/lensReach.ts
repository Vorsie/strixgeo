/**
 * lensReach.ts — the 0-corr lens reach (ruling 8b → 8b-rev, design partition-engine-v2.md §8).
 *
 * Owner ruling 8b-rev (2026-07-19, app dogfeed round 1 — "lenses should fill to 0.45 dist …
 * we only need to shorten lenses that collide with a sloping correlation"): the DEFAULT lens
 * reach is 0.45 of the gap (``LENS_PINCH_FRACTION``) for EVERY lens. The ~2× thickness cap is
 * NO LONGER the default — it is only the FIRST STEP of the COLLISION SHORTENER (``fitLensReach``):
 * a lens whose flank/wedge would cross tie/band line art shortens to the ~2× thickness reach,
 * then halves further if still colliding. One PLANNED apex per termination — the flank line and
 * the fill wedge consume the SAME value (a single ``lensReachFraction`` call per emission).
 *
 * The 8b-rev default is the FLAG-ON PRODUCT PATH only (``twoSidedTerminationsEnabled``). The
 * flag-OFF seam engine (the pre-cutover ``tileInterval`` path) keeps the ORIGINAL ruling-8b
 * ``min(0.45× gap, 2× thickness)`` cap byte-identical, because its enclosed-lens / lone-pinch /
 * converging-stack emitters route reach through the SAME ``lensReachFraction`` and the cut-over
 * is per-section (flag-OFF must not move until every section's shapes are correct). Gating the
 * default on the flag keeps the flag-OFF render byte-identical BY CONSTRUCTION while the flag-ON
 * lenses reach the ruled 0.45.
 *
 * This module is the SINGLE source of truth for the reach; every 0-corr lens-emission path in
 * ``partitionFillV2/`` routes its apex fraction through ``lensReachFraction`` so it cannot drift
 * between call sites. Under 8b-rev the default no longer guarantees band-clipping by shrinking
 * (a 0.45 lens can now reach a dipping tie) — so the COLLISION SHORTENER (``fitLensReach``) is
 * the band-clip mechanism, applied at the emit sites that can collide.
 *
 * User-set apex overrides (alt-click / freedraw, ``lensApexOverrides``) take PRECEDENCE and are
 * NEVER shortened — the caller applies the override before consulting this helper.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { LENS_PINCH_FRACTION } from '../sectionPartition'
import { twoSidedTerminationsEnabled } from './tileFlags'
import { type Point } from './types'

/**
 * Minimal structural view of a gap tie for reach collision — just its two column
 * endpoints. Kept STRUCTURAL (not importing ``ResolvedTie`` from ``emitCurves``) so this
 * low-level pure module never creates an import cycle back through the emitters. Any
 * ``ResolvedTie`` (``{ left, right }``) satisfies it.
 */
export interface ReachTie {
  left: Point
  right: Point
}

/**
 * Minimum apex fraction — a tiny floor so a degenerate zero-thickness unit or a
 * zero-width gap still emits a non-degenerate lens (a zero-area apex collapses the two
 * closing curves onto the column vertical and drops the face at trace time). 1e-3 of the
 * gap width is well below any real lens and far above the 1 mm × 1e-6 snap grid.
 */
const MIN_REACH_FRACTION = 1e-3

/**
 * The ruling-8b lens reach in REAL metres: ``min(0.45 × gapWidthM, 2 × unitThicknessM)``.
 *
 * Parameters
 * ----------
 * unitThicknessM : number
 *     The 0-corr unit's own thickness in metres (top elevation − base elevation).
 * gapWidthM : number
 *     The gap width in REAL alongM metres (|facingX − colX|).
 *
 * Returns
 * -------
 * number
 *     The capped reach in metres.
 */
export function lensReachM(unitThicknessM: number, gapWidthM: number): number {
  return Math.min(LENS_PINCH_FRACTION * gapWidthM, 2 * Math.abs(unitThicknessM))
}

/**
 * The DEFAULT lens reach expressed as an apex FRACTION of the gap (the space the emission paths
 * work in). Flag-ON (ruling 8b-rev, product path): a FLAT ``LENS_PINCH_FRACTION`` (0.45) for every
 * lens — the collision shortener (``fitLensReach`` / ``interiorLensReachToTies`` / the
 * ``enclosedLensReach`` competitor cap) is what trims a lens that would cross line art. Flag-OFF
 * (frozen seam engine): the ORIGINAL ruling-8b ``min(0.45, 2 × thickness / gapWidth)`` cap,
 * byte-identical, floored at a small epsilon and never exceeding ``LENS_PINCH_FRACTION``.
 *
 * Parameters
 * ----------
 * unitThicknessM : number
 *     The 0-corr unit's own thickness in metres.
 * gapWidthM : number
 *     The gap width in REAL alongM metres (|facingX − colX|).
 *
 * Returns
 * -------
 * number
 *     Apex fraction in (0, LENS_PINCH_FRACTION].
 */
export function lensReachFraction(unitThicknessM: number, gapWidthM: number): number {
  // Ruling 8b-rev (flag-ON product path): the DEFAULT reach is a FLAT 0.45 for every lens —
  // the 2× thickness cap is no longer the default (it lives on only inside ``fitLensReach`` as
  // the first collision-shortener step). Flag-OFF keeps the original min(0.45, 2t/gap) cap so
  // the seam engine's enclosed-lens / lone-pinch emitters stay byte-identical until cut-over.
  if (twoSidedTerminationsEnabled()) return LENS_PINCH_FRACTION
  const width = Math.abs(gapWidthM)
  // Degenerate zero-width gap: no metres to convert into a fraction — fall back to the
  // uncapped 0.45 (the arrangement will collapse a truly zero-width gap anyway) but never
  // divide by zero.
  if (width < MIN_REACH_FRACTION) return LENS_PINCH_FRACTION
  const reachFrac = lensReachM(unitThicknessM, width) / width
  return Math.max(MIN_REACH_FRACTION, Math.min(LENS_PINCH_FRACTION, reachFrac))
}

/**
 * The COLLISION SHORTENER (owner ruling 8b-rev, design partition-engine-v2.md §8, 2026-07-19 —
 * "we only need to shorten lenses that collide with a sloping correlation"; the halving mechanic
 * itself is the 2026-07-16 ruling "shorten the lenses by half if there is conflict with a tie").
 *
 * A per-unit lens between two SLOPING brackets (a minority against a converging facing) can poke
 * PAST a bracket at its DEFAULT reach (0.45) — its apex point rising above the descending top
 * bracket (or dropping below the rising base bracket) at the apex x. The owner's ruled mechanism is
 * NOT to chase the sloping bracket with a seam (session 10 measured that NEGATIVE — flat/sloped
 * seams slivered) but to SHORTEN the lens. RULING 8t (owner, 2026-07-20, "retire the thickness hug,
 * just halve the length to 0.225"): on the flag-ON product path the shortening LADDER is start at
 * 0.45; if that collides, HALVE (0.45 → 0.225 → 0.1125 → …) until the whole lens polygon (topCorner
 * → apex → baseCorner) fits strictly INSIDE the wedge or the floor is hit — NO reach is ever derived
 * from unit thickness. The seams never move; the lens shrinks toward its own column. When 0.45
 * already fits (the common wide-gap case) NO shortening happens. Flag-OFF (frozen seam engine) keeps
 * the original 8b-rev ladder (0.45 → ~2× thickness → halve) byte-identical until cut-over.
 *
 * The wedge at apex-x is bounded above by the TOP bracket line ``iTop → facingTop`` and below by
 * the BASE bracket line ``iBase → facingBase`` (both straight, interpolated in fraction). The
 * lens apex sits at the unit's OWN mid-elevation (``emitLensClosing`` pins it there), so the fit
 * test is: at fraction ``f`` the apex elevation is strictly between ``baseAt(f)`` and
 * ``topAt(f)`` with a small margin (so the flanks — which run from the column corners DOWN/UP to
 * the apex — cannot cross either bracket; a straight flank from a corner ON the bracket to an
 * apex inside the wedge stays inside a convex wedge).
 *
 * Floor: ``MIN_REACH_FRACTION`` (the snap-grid-safe minimum). If even the floor conflicts (the
 * unit's mid-elevation is outside the wedge everywhere — an over-thick minority in a pinching
 * bracket), returns 0: the caller drops the lens (the ``segmentDegenerate`` guard makes it a
 * clean no-op, the enclosing fill covers the slot — session-10 TARGET 2).
 *
 * Parameters
 * ----------
 * unitThicknessM : number
 *     The 0-corr minority's own thickness in metres (for the 8b start reach).
 * gapWidthM : number
 *     The gap width in REAL alongM metres (|facingX − colX|).
 * midElev : number
 *     The minority's own mid-elevation (the apex elevation — where ``emitLensClosing`` pins it).
 * iTop, iBase : number
 *     The interval's top / base bracket elevation on the MINORITY's OWN column (fraction 0).
 * facingTop, facingBase : number
 *     The interval's top / base bracket elevation on the FACING column (fraction 1 — for a
 *     converging facing these are ≈ equal, the convergence point).
 *
 * Returns
 * -------
 * number
 *     The halved reach fraction that fits inside the wedge, or 0 when no reach fits (drop it).
 */
export function fitLensReach(
  unitThicknessM: number,
  gapWidthM: number,
  midElev: number,
  iTop: number,
  iBase: number,
  facingTop: number,
  facingBase: number,
): number {
  // A small margin (metres) so the apex sits strictly inside the wedge — never exactly on a
  // bracket line (an apex ON the descending top bracket makes the upper flank collinear with the
  // bracket and merges the lens face into the enclosing flood — the B6-class collapse).
  const MARGIN = 1e-3
  // The sloping bracket elevations at fraction ``f`` (straight-line interpolation, fraction 0 =
  // own column, fraction 1 = facing convergence). An INFINITE sentinel on BOTH ends of a side
  // (``interiorLensReachToTies`` passes ±∞ for an unbounded side) means "no bracket here" — that
  // side is always clear (±∞); interpolating ``Inf + f·(Inf−Inf)`` would be NaN, so short-circuit.
  const topAt = (f: number): number => (!Number.isFinite(iTop) && !Number.isFinite(facingTop) ? Infinity : iTop + f * (facingTop - iTop))
  const baseAt = (f: number): number => (!Number.isFinite(iBase) && !Number.isFinite(facingBase) ? -Infinity : iBase + f * (facingBase - iBase))
  const fits = (f: number): boolean => midElev < topAt(f) - MARGIN && midElev > baseAt(f) + MARGIN
  // RULING 8t (owner, 2026-07-20, paint-round on 23/125-S7's peat vs tie83, verbatim: "retire the
  // thickness hug, just halve the length to 0.225"): on COLLISION the reach HALVES from 0.45 —
  // 0.45 → 0.225 → 0.1125 → … → floor — and NO reach is ever derived from unit thickness. The
  // ~2× thickness rung is DELETED on the flag-ON product path. Flag-OFF (the frozen seam engine)
  // KEEPS the original 8b-rev ladder (0.45 → ~2× thickness → halve) byte-identical: the flag-OFF
  // ``tileConvergingStack`` caller must not move until cut-over.
  const defaultReach = lensReachFraction(unitThicknessM, gapWidthM)
  if (fits(defaultReach)) return defaultReach
  if (twoSidedTerminationsEnabled()) {
    // 8t flag-ON ladder: HALVE from 0.45 with no thickness rung.
    let f = defaultReach / 2
    while (f >= MIN_REACH_FRACTION) {
      if (fits(f)) return f
      f /= 2
    }
    return 0
  }
  // Flag-OFF: the original 8b-rev ladder (thickness rung then halve), byte-identical.
  const width = Math.abs(gapWidthM)
  const thicknessReach =
    width < MIN_REACH_FRACTION
      ? defaultReach
      : Math.max(MIN_REACH_FRACTION, Math.min(LENS_PINCH_FRACTION, lensReachM(unitThicknessM, width) / width))
  let f = Math.min(defaultReach, thicknessReach)
  while (f >= MIN_REACH_FRACTION) {
    if (fits(f)) return f
    f /= 2
  }
  return 0
}

/**
 * A tie's elevation at along-x ``x`` (its endpoints run left→right column x). FLAT OUTSIDE its
 * own endpoints — a correlation states nothing past the two contacts it joins, and extrapolating
 * it is how a steep short-gap tie becomes a phantom bracket far away. That only became reachable
 * when a termination started measuring against a column several gaps off (2026-08-21,
 * ``terminationRun``): CS1's 1.17 m S7A→S7 silt tie (dipping 0.37 m/m) extrapolated 31 m into gap
 * 16 crossed S7's +7.75..+6.65 interbed at a place it never goes, and halved that lens twice.
 * Inside a single gap every sample already sits within the tie's own span, so the clamp is a
 * measured no-op there.
 */
function reachTieElevAt(t: ReachTie, x: number): number {
  const w = t.right.x - t.left.x
  if (Math.abs(w) < MIN_REACH_FRACTION) return t.left.y
  const f = Math.max(0, Math.min(1, (x - t.left.x) / w))
  return t.left.y + f * (t.right.y - t.left.y)
}

/**
 * The 8b-rev COLLISION-SHORTENED reach for an INTERIOR lens, bracketed by the GAP TIES (owner
 * ruling 8b-rev, 2026-07-19 — "we only need to shorten lenses that collide with a sloping
 * correlation"). A tie is given line art (a "sloping correlation"); a lens whose diamond would
 * cross it must not (8n "stay inside the lines"). This finds the nearest tie ABOVE and the
 * nearest tie BELOW the unit's mid-elevation — sampled at BOTH the own column (colX) and the
 * facing column (facingX) — and uses them as the ``fitLensReach`` wedge, so the returned reach is
 * the LARGEST value at which the lens apex (at ``midElev``) stays strictly between the two ties.
 *
 * When NO tie brackets the unit on a side (no "sloping correlation" to collide with there) that
 * side is UNBOUNDED (±∞), so ``fitLensReach`` keeps the full 0.45 default — 8b-rev's common case.
 * The result is the SINGLE planned apex: the caller uses it for BOTH the lens flanks and the
 * flood-wedge apex-x (one value, no line-vs-fill split).
 *
 * Parameters
 * ----------
 * unitThicknessM : number
 *     The unit's own thickness in metres (flag-OFF ``fitLensReach`` thickness rung only; the
 *     flag-ON 8t ladder ignores it).
 * colX, facingX : number
 *     The own column x and the facing column x (REAL alongM).
 * midElev : number
 *     The unit's mid-elevation (the apex elevation — where the lens closing pins the apex).
 * topElev, baseElev : number
 *     The unit's own top / base contact elevations — the diamond's corners. A tie is only a
 *     collision bracket if it passes THROUGH the unit's own extent somewhere in the gap (a tie
 *     entirely above ``topElev`` or below ``baseElev`` across the whole gap cannot cross the
 *     diamond, so it never shortens the lens).
 * gapTies : readonly ReachTie[]
 *     The gap's ties (already filtered to this gap by the caller).
 *
 * Ruling 8s (owner, 2026-07-19, "0.45 stands, matrix detours"): a corr-0 lens whose 0.45 wedge
 * crosses NO correlation line art keeps the FULL 0.45 even when its enclosing hosts are two
 * different lithos and the wedge opens into surrounding fill. The FACING-SAMPLE caps are DELETED
 * (no ``facingCompetes`` param) — the SOLE reach shortener is a genuine wedge-vs-correlation-art
 * collision: a gap TIE that crosses the diamond. The surrounding litho detours AROUND the wedge
 * (the wedge lines split the surrounding region), so fill-between-the-lines makes overlap
 * impossible BY CONSTRUCTION; an overlap that survives is a region-construction defect (the
 * enclosing contour must clip around the wedge — a later build), never a reason to re-cap.
 *
 * Returns
 * -------
 * number
 *     The collision-shortened apex fraction in [0, LENS_PINCH_FRACTION]; 0.45 when no tie collides.
 */
export function interiorLensReachToTies(
  unitThicknessM: number,
  colX: number,
  facingX: number,
  midElev: number,
  topElev: number,
  baseElev: number,
  gapTies: readonly ReachTie[],
): number {
  const gapWidthM = facingX - colX
  const defaultReach = lensReachFraction(unitThicknessM, gapWidthM)
  // Nearest tie above / below the unit's mid-elevation, tracked at BOTH columns so the wedge the
  // ``fitLensReach`` fit uses is the sloping tie line, not a single-point snapshot. A tie is a
  // candidate bracket only if it lies within the unit's own [baseElev, topElev] extent at either
  // column end (a tie far outside the unit cannot cross the diamond, so it must not shorten it).
  let topColY = Infinity
  let topFacY = Infinity
  let baseColY = -Infinity
  let baseFacY = -Infinity
  let hasTop = false
  let hasBase = false
  // A tie is a collision candidate if it ENTERS the unit's own [base..top] extent ANYWHERE across
  // the DEFAULT-reach span [0..0.45] — not just at the column endpoints. A steeply-dipping tie can
  // pass its whole endpoint range OUTSIDE the extent yet cut THROUGH the diamond in between (CS1
  // gap18: the ZAND-top tie runs KLEI-base 4.23 [below the VEEN base] → ZAND-top 7.027 [above the
  // VEEN top], crossing the VEEN extent around f≈0.4). Sampling only the endpoints missed it.
  const within = (y: number): boolean => y >= baseElev - MIN_REACH_FRACTION && y <= topElev + MIN_REACH_FRACTION
  const SAMPLES = 12
  const entersExtent = (t: ReachTie): boolean => {
    for (let s = 0; s <= SAMPLES; s++) {
      const f = (s / SAMPLES) * defaultReach
      if (within(reachTieElevAt(t, colX + f * gapWidthM))) return true
    }
    return false
  }
  for (const t of gapTies) {
    if (!entersExtent(t)) continue
    // Classify by the tie's position relative to the mid at the OWN column, and record BOTH the
    // own-column and facing-column elevations so ``fitLensReach`` fits against the sloping tie
    // line. Keep the NEAREST tie on each side (the innermost — the one the diamond meets first).
    const atCol = reachTieElevAt(t, colX)
    const atFac = reachTieElevAt(t, facingX)
    if (atCol >= midElev) {
      if (atCol < topColY) {
        topColY = atCol
        topFacY = atFac
        hasTop = true
      }
    } else {
      if (atCol > baseColY) {
        baseColY = atCol
        baseFacY = atFac
        hasBase = true
      }
    }
  }
  // (1) Reach that fits inside the TIE brackets (the sloping correlations). ±∞ on an unbounded
  //     side so ``fitLensReach`` only bounds against the tie(s) that actually cross the diamond.
  //     ``fitLensReach`` returns 0 when NOTHING fits (a converging bracket pinching below the mid
  //     everywhere). Ruling 8b-rev SHORTENS, it does not DELETE — the pre-8b-rev flag-ON interior
  //     lens always emitted at its flat reach — so FLOOR the tie reach at the snap-grid minimum: the
  //     lens still emits its tiny hug and ``emitLensClosing``'s own degenerate guard drops only a
  //     truly sub-snap flank. (The old ``fitLensReach``-drops-to-0 contract survives only where its
  //     flag-OFF ``tileConvergingStack`` caller reads the raw 0 directly.)
  const rawTieReach =
    hasTop || hasBase
      ? fitLensReach(
          unitThicknessM,
          gapWidthM,
          midElev,
          hasTop ? topColY : Infinity,
          hasBase ? baseColY : -Infinity,
          hasTop ? topFacY : Infinity,
          hasBase ? baseFacY : -Infinity,
        )
      : defaultReach
  const tieReach = rawTieReach > 0 ? rawTieReach : MIN_REACH_FRACTION
  // Ruling 8s: the tie-bracket collision is the SOLE override. No facing-sample cap — a wedge that
  // crosses no line art keeps the full 0.45 (the surrounding region detours around it).
  return tieReach
}

/**
 * The 8b-rev / 8s reach for an ENCLOSED lens (``emitEnclosedLensCurves``).
 *
 * Ruling 8s (owner, 2026-07-19, "0.45 stands, matrix detours"): the default 0-corr reach is 0.45,
 * kept even when the facing carries a DIFFERENT lithology and the wedge opens into surrounding
 * fill. The prior FACING-DIFFERS cap is DELETED — the enclosing region detours AROUND the wedge
 * (its lines split the surrounding region → fill-between-the-lines makes overlap impossible by
 * construction). The SOLE shortener is a genuine wedge-vs-correlation-art collision, so this
 * delegates to ``interiorLensReachToTies`` (a gap TIE crossing the diamond HALVES the reach per
 * ruling 8t — 0.45 → 0.225 → …; nothing else caps).
 *
 * Flag-OFF ALWAYS returns the original ruling-8b ``lensReachFraction`` cap (``min(0.45, 2t/gap)``),
 * byte-identical to the pre-8b-rev seam engine — the delegate (and its tie-bracket search) is
 * flag-ON only, so flag-OFF never runs the tie scan and stays unchanged.
 *
 * Parameters
 * ----------
 * unitThicknessM : number
 *     The enclosed lens's own thickness in metres.
 * colX, facingX : number
 *     The lens's own column x and the facing column x (REAL alongM). ``facingX − colX`` is the
 *     signed gap width; ``interiorLensReachToTies`` derives the width from them.
 * midElev, topElev, baseElev : number
 *     The lens's mid / top / base elevations — the diamond's apex + corners for the tie-cross test.
 * gapTies : readonly ReachTie[]
 *     The gap's ties (filtered to this gap by the caller) — the SOLE collision brackets under 8s.
 *
 * Returns
 * -------
 * number
 *     Apex fraction in (0, LENS_PINCH_FRACTION]: 0.45 (8s default) unless a gap tie crosses the
 *     diamond, then the tie-fitted reach. Flag-OFF: the original ``min(0.45, 2t/gap)`` cap.
 */
export function enclosedLensReach(
  unitThicknessM: number,
  colX: number,
  facingX: number,
  midElev: number,
  topElev: number,
  baseElev: number,
  gapTies: readonly ReachTie[],
): number {
  const gapWidthM = facingX - colX
  // Flag-OFF: the frozen seam engine's original ruling-8b cap, byte-identical (never runs the tie
  // scan). Flag-ON: ruling 8s — 0.45 unless a gap tie collides with the diamond.
  if (!twoSidedTerminationsEnabled()) return lensReachFraction(unitThicknessM, gapWidthM)
  return interiorLensReachToTies(unitThicknessM, colX, facingX, midElev, topElev, baseElev, gapTies)
}
