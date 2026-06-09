/**
 * True-partition fill between two adjacent litho columns.
 *
 * Problem this replaces
 * ----------------------
 * ``morphFill.ts`` paints body-envelope bands then overpaints pinch triangles
 * with z-order. The envelopes of two bodies can overlap in the gap (a clay that
 * sweeps over a silt), and morph/pinch mismatches leave gaps. The result is only
 * a visual approximation, not a partition — bodies overlap.
 *
 * This is load-bearing: the 2D section defines the 3D geological model. Any
 * overlap or gap in 2D becomes an overlap or gap in 3D.
 *
 * The partition algorithm
 * -----------------------
 * 0.  **Enclosed-lens pre-pass.** Before alignment, extract any unit U on either
 *     column where (a) U.bodyId does not appear on the OTHER column (it is a
 *     one-test body in this gap), AND (b) the units immediately above AND below U
 *     on U's own column share the SAME bodyId (the enclosing matrix), AND (c) that
 *     matrix body IS present on the other column.  U is removed from its column and
 *     the two enclosing matrix units are merged into one contiguous unit.  The
 *     extraction repeats until no more enclosed lenses exist (a matrix can enclose
 *     several lenses).  Each extracted lens is stored for step 3.
 *
 *     Why horizontal apex: a one-test lens physically terminates AT ITS OWN
 *     ELEVATION inside the gap — it does not curve along the enclosing interfaces.
 *     The apex is at (e_top + e_base)/2 of the lens on its own column, so the
 *     pinch-out triangle has a flat horizontal top and flat horizontal base with
 *     an apex at the lens's own mid-elevation.  This is geometrically distinct from
 *     the interval-fraction mechanism (step 3), which slants along the enclosing
 *     interfaces.
 *
 * 1.  **Monotonic LCS alignment.** Match units across columns by ``bodyId``
 *     using a longest-common-subsequence that preserves order. Matching is
 *     order-preserving (monotonic) — a body that appears *before* a shared
 *     marker on one column cannot be matched to an occurrence *after* that
 *     marker on the other column. This is exactly what splits an interrupted
 *     body into two pieces: if body K appears on the left after silt Si, and
 *     on the right both before and after Si, the pre-Si right K is unmatched
 *     (monotonicity blocks it); the post-Si right K is matched.  Units with
 *     ``bodyId === null`` never match (each is its own pinch).
 *
 * 2.  **Interval groups.** Between each pair of consecutive matched quads (and
 *     between the surface/floor and the outermost quads) all unmatched units
 *     belong to the same "interval" — a trapezoidal region bounded by the same
 *     top and base interfaces.  Units from the left column advance the LEFT
 *     boundary of that interface; units from the right column advance the RIGHT
 *     boundary.  The interval's top is the base of the previous quad (or
 *     the column surface), and the base is the top of the next quad (or the
 *     column floor).
 *
 * 3.  **Meeting fraction inside an interval.** When an interval has both left-
 *     only and right-only pinches, the entire interval is split at a single
 *     fraction f weighted by total thickness: f = sumLeft / (sumLeft + sumRight).
 *     Left-only pinches tile [0, f]; right-only tile [f, 1].  Each pinch is a
 *     TRAPEZOID cut from the interval's enclosing interfaces.  A lone pinch
 *     collapses fully (f = 1 for left, f = 0 for right — triangle geometry).
 *
 * 4.  **Monotonic elevation clamp.** Interface elevations are clamped so that
 *     each successive interface is non-decreasing in depth, preventing a
 *     crossing correlation from inverting a region.
 *
 * 5.  **Lens append.** Each extracted enclosed lens is appended to the region
 *     list AFTER the main partition regions.  The overlay draws regions in array
 *     order, so lenses paint on top of their enclosing matrix band — the standard
 *     geological nested-body representation.  These lens regions deliberately
 *     OVERLAY their matrix quad and are therefore excluded from ``assertTiles``.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 * The overlay maps ``fraction → screenX`` and ``elevation → screenY``.
 */

/** One unit (accepted litho layer) on a column, in depth-below-surface metres. */
export interface PartitionUnit {
  topDepthM: number
  baseDepthM: number
  /** Drives the fill colour (lithology). */
  formationId: string
  /**
   * Resolver-stamped body. Kept for region IDENTITY only (overlay freedraw /
   * context-menu / labels) — NOT used for matching, because the resolver
   * over-lumps body_id (one body spanning several lithologies/beds). Matching
   * uses the explicit correlation edges instead (see ``layerId``).
   */
  bodyId: string | null
  /**
   * The ``litho_layer.id`` — the stable identity a correlation edge references.
   * Two units BAND iff an approved ``LithoContactCorrelationEdge`` connects their
   * ``layerId``s (the trustworthy correlation signal, vs the over-lumped body_id).
   */
  layerId: string
}

/** One column's placement + its gap-free unit stack (sorted by ``topDepthM``). */
export interface PartitionColumn {
  investigationId: string
  /** Surface elevation (mTAW) — converts depth → absolute elevation. */
  surfaceElevM: number
  units: readonly PartitionUnit[]
}

/**
 * An approved correlation edge — a pair of ``litho_layer`` ids that the user/auto
 * explicitly correlated. Two units BAND across a gap iff such an edge connects
 * their ``layerId``s. This is the trustworthy band signal (vs the resolver's
 * over-lumped ``body_id``).
 */
export interface CorrelationEdge {
  a: string
  b: string
}

const EPS = 1e-9

/**
 * How far across the gap (fraction of the total column spacing) an enclosed
 * lens reaches before its pinch-out apex.  0.45 means the lens tapers to a
 * point at 45 % of the way across; the engineer can adjust this later via a
 * per-lens override.
 */
export const LENS_PINCH_FRACTION = 0.45

/**
 * Fraction of the gap at which a lone interior pinch tapers to its tip
 * (owner directive 2026-06-07). 0.5 = halfway on the interface dip — the unit
 * thins to a point mid-gap and the enclosing matrix closes up beyond it,
 * instead of running to the neighbour (the "drooping" pinch). Reshaped
 * afterward via the freedraw apex handle.
 */
export const INTERIOR_PINCH_FRACTION = 0.5

/**
 * A user override for a lens's pinch apex (shaping, dogfeed 2026-06-05).
 *
 * ``fraction`` is the apex's horizontal position 0 (left column) → 1 (right
 * column); ``elevation`` is its mTAW elevation. Replaces the auto default
 * (``LENS_PINCH_FRACTION`` / ``1 − LENS_PINCH_FRACTION`` at the lens's
 * mid-elevation) so the engineer can set how far a lens reaches + at what depth.
 */
export interface LensApexOverride {
  fraction: number
  elevation: number
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

/** A point in (fraction, elevation) space. fraction 0 = left column, 1 = right. */
export interface PartitionPoint {
  /** 0 = left column edge, 1 = right column edge. */
  fraction: number
  /** Absolute elevation in mTAW. */
  elevation: number
}

/**
 * One filled region of the partition.
 *
 * ``polygon`` is a closed ring (no repeated last point) in
 * (fraction, elevation) space.  The overlay maps it to screen coordinates.
 */
export interface PartitionRegion {
  formationId: string
  bodyId: string | null
  /**
   * ``quad``  = body present on both columns (four-corner trapezoid).
   * ``pinch`` = body present on one column only; cut at the meeting fraction
   *             inside its interval (triangular when alone, trapezoidal when
   *             sharing the interval with an opposite pinch).
   * ``lens``  = enclosed lens extracted in the pre-pass; horizontal pinch-out
   *             triangle that overlays its enclosing matrix quad.  Excluded
   *             from the tiling invariant (it deliberately overlaps its matrix).
   */
  kind: 'quad' | 'pinch' | 'lens'
  /** Closed polygon ring, no repeated last point. */
  polygon: PartitionPoint[]
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** One horizontal interface line: left-depth ↔ right-depth. */
interface Interface {
  leftDepth: number
  rightDepth: number
}

/** A pinch unit pending placement inside an interval. */
interface PinchUnit {
  bodyId: string | null
  formationId: string
  side: 'left' | 'right'
  /** Depth span on the unit's own column. */
  ownTopDepth: number
  ownBaseDepth: number
}

/**
 * A lens pinched out of a column. Which gap-side it renders on is decided at
 * emit time (a column's lens is a LEFT lens in the gap to its right and a RIGHT
 * lens in the gap to its left), so no ``side`` is stored here.
 */
interface ExtractedLens {
  /** ``null`` for a lens whose minority body was never correlated. */
  bodyId: string | null
  formationId: string
  depthTopM: number
  depthBaseM: number
}

/**
 * Snap each unit's base to the next unit's top, in place, so the column is
 * gap-free and overlap-free before tiling.
 *
 * The accepted litho layers feeding a column can carry a depth GAP (a
 * rejected/collapsed segment whose ``depth_base`` no longer meets the next
 * unit's ``depth_top``). The litho bands hide this by rendering
 * contact→next-contact; the partition fill must do the same or it shows a HOLE
 * (dogfeed 2026-06-08). Units must already be sorted by ``topDepthM``.
 *
 * Parameters
 * ----------
 * units : PartitionUnit[]
 *     The column's units, sorted shallow→deep. Mutated in place (the deepest
 *     unit keeps its own base — the column floor).
 */
function closeColumnGaps(units: PartitionUnit[]): void {
  for (let i = 0; i < units.length - 1; i++) {
    units[i].baseDepthM = units[i + 1].topDepthM
  }
}

/**
 * Merge runs of adjacent same-``formationId`` units into one (lithology is the
 * fill primitive — a stack of same-lithology beds is one matrix band, regardless
 * of how the resolver split it into bodies). Without this, when one column's
 * matrix is one unit and the other's is split into N (different ``bodyId``s, or
 * exposed by removing an interbedded lens), the matcher orphans the surplus
 * pieces into spurious pinches. Keeps the shallowest unit's ``bodyId`` as the
 * run's representative. Mutates in place.
 */
function collapseAdjacentSameFormation(units: PartitionUnit[]): void {
  for (let i = units.length - 2; i >= 0; i--) {
    if (units[i].formationId === units[i + 1].formationId) {
      units[i].baseDepthM = units[i + 1].baseDepthM
      units.splice(i + 1, 1)
    }
  }
}

/**
 * Per-gap column reduction: pull the LENS units (those with 0 correlated
 * bounding contacts toward the facing neighbour — see ``classifyTermination``),
 * leaving the bands + onlaps for ``emitGap`` to shape.
 *
 * Owner model (2026-06-09) — a unit's shape toward a neighbour is set purely by
 * how many of its two bounding contacts are correlated to it (2 band / 1 onlap /
 * 0 lens). Only the 0-contact lenses are removed here: pulling a lens lets the
 * SAME-lithology matrix above + below it merge so it connects continuously
 * across the gap via its OUTER correlated boundaries (the lens overlays it). The
 * matrix's INTERNAL boundary (the lens contact) is uncorrelated by construction;
 * its outer boundaries carry the band.
 *
 * Called PER GAP against the SINGLE facing neighbour (its layer ids), so a unit
 * can be a lens toward one neighbour and a band/onlap toward the other.
 *
 * Parameters
 * ----------
 * units : PartitionUnit[]
 *     The column's units (mutated in place — lenses removed, matrix merged).
 * neighbourLayerIds : ReadonlySet<string>
 *     Every ``layerId`` on the facing neighbour column (for the contact-correlation count).
 * correlated : Correlated
 *     Edge lookup (approved correlation between two ``layerId``s).
 *
 * Returns
 * -------
 * ExtractedLens[]
 *     The pinched-out lenses, in removal order.
 */
function reduceColumn(
  units: PartitionUnit[],
  neighbourLayerIds: ReadonlySet<string>,
  correlated: Correlated,
): ExtractedLens[] {
  const lenses: ExtractedLens[] = []
  // A pulled lens records its ORIGINAL extent, not the live (possibly flood-
  // mutated) depths: when a thin interbed is pulled, the thicker neighbour floods
  // UP into its space (``below.topDepthM = u.topDepthM`` below); if THAT neighbour
  // is later pulled as a lens too, its live top is the flooded value, so two lens
  // triangles on the same column would overlap. Snapshot the entry depths by
  // layerId and emit those.
  const origTop = new Map(units.map((u) => [u.layerId, u.topDepthM]))
  const origBase = new Map(units.map((u) => [u.layerId, u.baseDepthM]))
  const thick = (x: PartitionUnit): number => x.baseDepthM - x.topDepthM
  let changed = true
  while (changed) {
    changed = false
    for (let i = 1; i < units.length - 1; i++) {
      // An INTERIOR unit pinches out as a LENS toward this neighbour iff NEITHER
      // of its two bounding contacts is correlated (the owner's 0-contact rule).
      // Bands (2 contacts) and onlaps (1) are kept and shaped by emitGap. Pulling
      // the lens lets the SAME-lithology matrix above + below it merge and connect
      // continuously (a silt lens in sand → the sand stays one band via its OUTER
      // correlated boundaries, the silt overlays). The matrix's INTERNAL boundary
      // (the lens contact) is uncorrelated; its outer boundaries carry the band.
      if (classifyTermination(units, i, neighbourLayerIds, correlated) !== 'lens') continue
      const u = units[i]
      const above = units[i - 1]
      const below = units[i + 1]
      lenses.push({
        bodyId: u.bodyId,
        formationId: u.formationId,
        depthTopM: origTop.get(u.layerId) ?? u.topDepthM,
        depthBaseM: origBase.get(u.layerId) ?? u.baseDepthM,
      })
      if (above.formationId === below.formationId) {
        above.baseDepthM = below.baseDepthM // same matrix both sides → merge so it connects continuously
        units.splice(i, 2) // remove u + below (below folded into above)
      } else {
        // Between two DIFFERENT bands → the thicker neighbour floods over the
        // vacated space (closes the gap); the bed pinches out as a lens.
        if (thick(above) >= thick(below)) above.baseDepthM = u.baseDepthM
        else below.topDepthM = u.topDepthM
        units.splice(i, 1)
      }
      changed = true
      break // restart after a merge
    }
  }
  return lenses
}

/** A minority unit pulled from an interval, classified by its pinch-out kind. */
interface ExtractedMinority {
  unit: PinchUnit
  /**
   * ``lens``  — enclosed by the matrix above AND below (0 correlated contacts);
   *             horizontal apex at its own elevation.
   * ``onlap`` — touches exactly ONE bracket tie-line (1 correlated contact);
   *             laps against that bracket, tip on the bracket interface.
   */
  kind: 'lens' | 'onlap'
  /** For an onlap: which bracket it laps against (``top`` → laps up). */
  edge?: 'top' | 'base'
}

/**
 * Extract minority units from ONE interval's left + right unit stacks,
 * classifying each as a lens or an onlap, and reducing each column to its
 * connecting matrix.
 *
 * Interval-scoped companion to ``extractEnclosedLenses`` (the global ``bodyId``
 * pre-pass). Within an interval bracketed by matched bands, the "matrix" is the
 * lithology present on BOTH columns' interval stacks. A minority unit is:
 *
 *   - a **lens** when, on its own column, the units immediately above AND below
 *     it share the SAME lithology M, M ≠ the unit's own lithology, and M is the
 *     matrix (present on the OTHER column's interval stack). 0 correlated
 *     bounding contacts.
 *   - an **onlap** when it is the TOP unit of the stack (its top is the top
 *     bracket tie-line) and the unit BELOW it is the matrix M — or the mirror at
 *     the bottom. 1 correlated bounding contact (the bracket it touches).
 *
 * Each extracted unit is removed and the matrix it was embedded in is grown to
 * fill its place, so the matrix reduces to one contiguous unit per column and
 * then connects across as a band via ``emitInterval``'s same-formation
 * single-unit-per-side case.
 *
 * Keying the connectivity guard on the OTHER column's INTERVAL stack (not the
 * whole column) is what distinguishes a lens-in-matrix (silt inside sand →
 * extract) from a matrix-between-brackets (sand between two clay BANDS → the
 * enclosing clay is a bracket, absent from the other column's interval, so the
 * sand is NOT extracted and stays the matrix). The same guard makes onlap
 * extraction fire only when the matrix actually connects across — a one-sided
 * interval (empty other column) keeps its existing boundary-pinch behaviour.
 *
 * Parameters
 * ----------
 * leftStack, rightStack : PinchUnit[]
 *     The interval's unmatched units per column, sorted shallow→deep. Both are
 *     mutated in place (minorities removed, matrix grown).
 * aboveLith, belowLith : string | null
 *     The top / base bracket lithology (matched band above / below the
 *     interval), or ``null`` at the surface / floor (no bracket → no onlap).
 *
 * Returns
 * -------
 * ExtractedMinority[]
 *     The extracted minorities, in removal order.
 */
function extractIntervalMinorities(
  leftStack: PinchUnit[],
  rightStack: PinchUnit[],
  aboveLith: string | null,
  belowLith: string | null,
): ExtractedMinority[] {
  const out: ExtractedMinority[] = []
  const sides: Array<['left' | 'right', PinchUnit[], PinchUnit[]]> = [
    ['left', leftStack, rightStack],
    ['right', rightStack, leftStack],
  ]
  for (const [side, stack, other] of sides) {
    let changed = true
    while (changed) {
      changed = false
      const otherFormations = new Set(other.map((u) => u.formationId))

      // (1) Interior lens — enclosed by the same matrix above AND below.
      for (let i = 1; i < stack.length - 1; i++) {
        const u = stack[i]
        const above = stack[i - 1]
        const below = stack[i + 1]
        if (above.formationId !== below.formationId) continue
        const m = above.formationId
        if (m === u.formationId) continue
        if (!otherFormations.has(m)) continue
        out.push({ unit: { ...u }, kind: 'lens' })
        stack.splice(i - 1, 3, {
          bodyId: above.bodyId,
          formationId: m,
          side,
          ownTopDepth: above.ownTopDepth,
          ownBaseDepth: below.ownBaseDepth,
        })
        changed = true
        break // restart after a merge
      }
      if (changed) continue

      // (2) Onlap-top — the topmost unit touches the top bracket, matrix below.
      if (aboveLith !== null && stack.length >= 2) {
        const u = stack[0]
        const below = stack[1]
        const m = below.formationId
        if (m !== u.formationId && otherFormations.has(m)) {
          out.push({ unit: { ...u }, kind: 'onlap', edge: 'top' })
          below.ownTopDepth = u.ownTopDepth // matrix grows up to the bracket
          stack.splice(0, 1)
          changed = true
          continue
        }
      }

      // (3) Onlap-base — the bottommost unit touches the base bracket, matrix above.
      if (belowLith !== null && stack.length >= 2) {
        const last = stack.length - 1
        const u = stack[last]
        const above = stack[last - 1]
        const m = above.formationId
        if (m !== u.formationId && otherFormations.has(m)) {
          out.push({ unit: { ...u }, kind: 'onlap', edge: 'base' })
          above.ownBaseDepth = u.ownBaseDepth // matrix grows down to the bracket
          stack.splice(last, 1)
          changed = true
          continue
        }
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Section-wide lithology-aware matcher
// ---------------------------------------------------------------------------

/** A unit prepared for cross-column matching, elevations precomputed (mTAW). */
export interface MatchUnit {
  formationId: string
  /** ``litho_layer.id`` — what correlation edges reference (the band signal). */
  layerId: string
  /** Higher elevation — the unit's top. */
  topElev: number
  /** Lower elevation — the unit's base. */
  baseElev: number
}

/** True iff an approved correlation edge directly connects layers ``a`` and ``b``. */
export type Correlated = (a: string, b: string) => boolean

/**
 * How a unit terminates toward ONE neighbour, derived from its bounding-contact
 * correlations (owner's model, 2026-06-09):
 *
 *   ``band``  — BOTH bounding contacts correlated → spans the gap as a quad.
 *   ``onlap`` — exactly ONE contact correlated → laps against the correlated
 *               tie-line, the other boundary pinching to meet it at the midpoint.
 *   ``lens``  — NEITHER contact correlated → both boundaries converge to a point
 *               at the midpoint (a pinch-out into the void).
 */
export type ContactTermination = 'band' | 'onlap' | 'lens'

/**
 * Classify a unit's termination toward a single neighbour column.
 *
 * A unit is bounded by a TOP contact and a BASE contact. A contact correlates to
 * the neighbour iff an approved edge connects the relevant layer to any layer on
 * that neighbour:
 *
 *   - **top** contact  ⟺ an edge on THIS unit's ``layerId`` (a layer's id keys
 *     the contact at its top — see ``LithoContactCorrelationEdge``);
 *   - **base** contact ⟺ an edge on the layer immediately BELOW (its top contact
 *     IS this unit's base). The deepest unit has no unit below, so its base
 *     cannot correlate (counts as uncorrelated).
 *
 * The count (0/1/2) maps directly to lens/onlap/band. This is per-SIDE: pass the
 * facing neighbour's layer ids, so the same unit can band toward one neighbour
 * and pinch toward the other.
 *
 * Parameters
 * ----------
 * units : readonly PartitionUnit[]
 *     The unit's column, sorted shallow→deep.
 * index : int
 *     The unit's position in ``units``.
 * neighbourLayerIds : ReadonlySet<string>
 *     Every ``layerId`` on the facing neighbour column.
 * correlated : Correlated
 *     Approved-edge lookup between two ``layerId``s.
 *
 * Returns
 * -------
 * ContactTermination
 *     ``band`` (2 contacts), ``onlap`` (1), or ``lens`` (0).
 */
export function classifyTermination(
  units: readonly PartitionUnit[],
  index: number,
  neighbourLayerIds: ReadonlySet<string>,
  correlated: Correlated,
): ContactTermination {
  const contactCorrelated = (layerId: string): boolean => {
    for (const v of neighbourLayerIds) if (correlated(layerId, v)) return true
    return false
  }
  const below = units[index + 1]
  const topCorr = contactCorrelated(units[index].layerId)
  const baseCorr = below !== undefined && contactCorrelated(below.layerId)
  const count = (topCorr ? 1 : 0) + (baseCorr ? 1 : 0)
  return count === 2 ? 'band' : count === 1 ? 'onlap' : 'lens'
}

/**
 * Score a candidate cross-column pairing — edges first, geometry as the fallback.
 *
 * Lithology must agree (never pair across lithology). An explicit correlation
 * edge between the two layers is the authoritative BAND signal — it connects them
 * at ANY elevation (a correlated bed that dips between columns, e.g. the peat).
 * Geometric overlap (no edge) is the LAST-resort fill tier for the matrix:
 *
 *   same litho + edge + overlap   → 4   (explicit correlation, aligned)
 *   same litho + edge             → 3   (explicit correlation — a dipping correlated bed)
 *   same litho + overlap (no edge) → 1  (geometry — matrix coverage fill only)
 *   otherwise                     → 0   (no match → pinches out)
 *
 * ``body_id`` is deliberately NOT used — it is the resolver's over-lumped
 * transitive closure (one body spanning several lithologies/beds), which falsely
 * banded uncorrelated beds. Only the direct edges are trusted.
 */
function pairScore(l: MatchUnit, r: MatchUnit, correlated: Correlated): number {
  if (l.formationId !== r.formationId) return 0
  const overlap = l.topElev > r.baseElev + EPS && r.topElev > l.baseElev + EPS
  const edge = correlated(l.layerId, r.layerId)
  if (edge && overlap) return 4
  if (edge) return 3
  if (overlap) return 1
  return 0
}

/**
 * Monotonic (order-preserving) cross-column matching — edge-correlated pairs
 * band, with geometric overlap as the fallback fill tier. A weighted
 * longest-common-subsequence over ``pairScore`` that maximises total confidence,
 * so explicit correlations win and the uncorrelated matrix still connects by
 * overlap; never pairs across lithology.
 *
 * Parameters
 * ----------
 * left, right : MatchUnit[]
 *     The two columns' units, sorted shallow→deep.
 * correlated : Correlated
 *     Edge lookup (approved correlation between two ``layerId``s).
 *
 * Returns
 * -------
 * Array<[number, number]>
 *     Matched (leftIndex, rightIndex) pairs in ascending order.
 */
export function matchColumns(
  left: MatchUnit[],
  right: MatchUnit[],
  correlated: Correlated,
): Array<[number, number]> {
  const n = left.length
  const m = right.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const s = pairScore(left[i - 1], right[j - 1], correlated)
      let best = Math.max(dp[i - 1][j], dp[i][j - 1])
      if (s > 0) best = Math.max(best, dp[i - 1][j - 1] + s)
      dp[i][j] = best
    }
  }
  const pairs: Array<[number, number]> = []
  let i = n
  let j = m
  while (i > 0 && j > 0) {
    const s = pairScore(left[i - 1], right[j - 1], correlated)
    if (s > 0 && dp[i][j] === dp[i - 1][j - 1] + s) {
      pairs.push([i - 1, j - 1])
      i--
      j--
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--
    } else {
      j--
    }
  }
  pairs.reverse()
  return pairs
}

// ---------------------------------------------------------------------------
// Interface helpers
// ---------------------------------------------------------------------------

/**
 * Clamp a candidate interface so it is not shallower than the previous one
 * on either side.
 */
function clampIface(iface: Interface, prev: Interface): Interface {
  return {
    leftDepth: Math.max(iface.leftDepth, prev.leftDepth),
    rightDepth: Math.max(iface.rightDepth, prev.rightDepth),
  }
}

/**
 * Interpolate the mTAW elevation on an interface at a given fraction.
 *
 * An interface is a straight line from (f=0, leftSurface − leftDepth) to
 * (f=1, rightSurface − rightDepth).
 */
function ifaceElev(
  iface: Interface,
  fraction: number,
  leftSurface: number,
  rightSurface: number,
): number {
  const leftElev = leftSurface - iface.leftDepth
  const rightElev = rightSurface - iface.rightDepth
  return leftElev + fraction * (rightElev - leftElev)
}

// ---------------------------------------------------------------------------
// Polygon builders
// ---------------------------------------------------------------------------

/**
 * Build the 4-point quad polygon for a matched body.
 *
 * Corner order: top-left → top-right → base-right → base-left.
 */
function buildQuadPolygon(
  topIface: Interface,
  baseIface: Interface,
  leftSurface: number,
  rightSurface: number,
): PartitionPoint[] {
  return [
    { fraction: 0, elevation: leftSurface - topIface.leftDepth },
    { fraction: 1, elevation: rightSurface - topIface.rightDepth },
    { fraction: 1, elevation: rightSurface - baseIface.rightDepth },
    { fraction: 0, elevation: leftSurface - baseIface.leftDepth },
  ]
}

/**
 * Build the polygon for a LEFT-only pinch that occupies [0, meetFraction].
 *
 * The enclosing interval spans from ``topIface`` to ``baseIface``.  The cut at
 * ``meetFraction`` is the dividing line shared with the right-only pinches in
 * the same interval, computed from both interfaces independently so the cut is
 * a straight (possibly slanted) line and the two trapezoids tile exactly.
 *
 * Corner order: top-left → top-cut → base-cut → base-left.
 * When meetFraction = 1 the cut IS the right column — triangle shape.
 */
function buildLeftPinchPolygon(
  topIface: Interface,
  baseIface: Interface,
  meetFraction: number,
  leftSurface: number,
  rightSurface: number,
): PartitionPoint[] {
  const topLeftElev = leftSurface - topIface.leftDepth
  const baseLeftElev = leftSurface - baseIface.leftDepth
  const topCutElev = ifaceElev(topIface, meetFraction, leftSurface, rightSurface)
  const baseCutElev = ifaceElev(baseIface, meetFraction, leftSurface, rightSurface)

  if (Math.abs(topCutElev - baseCutElev) < EPS) {
    // Degenerate: both interfaces meet at the cut → triangle.
    return [
      { fraction: 0, elevation: topLeftElev },
      { fraction: meetFraction, elevation: (topCutElev + baseCutElev) / 2 },
      { fraction: 0, elevation: baseLeftElev },
    ]
  }
  return [
    { fraction: 0, elevation: topLeftElev },
    { fraction: meetFraction, elevation: topCutElev },
    { fraction: meetFraction, elevation: baseCutElev },
    { fraction: 0, elevation: baseLeftElev },
  ]
}

/**
 * Build the polygon for a RIGHT-only pinch that occupies [meetFraction, 1].
 *
 * Corner order: top-cut → top-right → base-right → base-cut.
 */
function buildRightPinchPolygon(
  topIface: Interface,
  baseIface: Interface,
  meetFraction: number,
  leftSurface: number,
  rightSurface: number,
): PartitionPoint[] {
  const topRightElev = rightSurface - topIface.rightDepth
  const baseRightElev = rightSurface - baseIface.rightDepth
  const topCutElev = ifaceElev(topIface, meetFraction, leftSurface, rightSurface)
  const baseCutElev = ifaceElev(baseIface, meetFraction, leftSurface, rightSurface)

  if (Math.abs(topCutElev - baseCutElev) < EPS) {
    return [
      { fraction: meetFraction, elevation: (topCutElev + baseCutElev) / 2 },
      { fraction: 1, elevation: topRightElev },
      { fraction: 1, elevation: baseRightElev },
    ]
  }
  return [
    { fraction: meetFraction, elevation: topCutElev },
    { fraction: 1, elevation: topRightElev },
    { fraction: 1, elevation: baseRightElev },
    { fraction: meetFraction, elevation: baseCutElev },
  ]
}

/**
 * Build the horizontal triangle polygon for an enclosed LEFT lens.
 *
 * The apex is at the lens's OWN mid-elevation (not interpolated from the
 * enclosing interfaces), so the pinch-out is horizontal — geologically correct
 * because the lens terminates at its own stratigraphic level, not along the
 * dipping interfaces of the enclosing body.
 *
 * Polygon: base edge at fraction=0 (the source column), apex at fraction=LENS_PINCH_FRACTION.
 * Corner order: top-left → apex → base-left.
 *
 * Parameters
 * ----------
 * topElev : number
 *     Top elevation of the lens (mTAW) = leftSurface − depthTopM.
 * baseElev : number
 *     Base elevation of the lens (mTAW) = leftSurface − depthBaseM.
 */
function buildLeftLensPolygon(
  topElev: number,
  baseElev: number,
  apex?: LensApexOverride,
): PartitionPoint[] {
  const apexFraction = apex?.fraction ?? LENS_PINCH_FRACTION
  const apexElev = apex?.elevation ?? (topElev + baseElev) / 2
  return [
    { fraction: 0, elevation: topElev },
    { fraction: apexFraction, elevation: apexElev },
    { fraction: 0, elevation: baseElev },
  ]
}

/**
 * Build the horizontal triangle polygon for an enclosed RIGHT lens.
 *
 * Mirror of ``buildLeftLensPolygon``: base edge at fraction=1, apex at
 * fraction=1−LENS_PINCH_FRACTION.
 *
 * Corner order: top-right → apex → base-right.
 */
function buildRightLensPolygon(
  topElev: number,
  baseElev: number,
  apex?: LensApexOverride,
): PartitionPoint[] {
  const apexFraction = apex?.fraction ?? 1 - LENS_PINCH_FRACTION
  const apexElev = apex?.elevation ?? (topElev + baseElev) / 2
  return [
    { fraction: 1, elevation: topElev },
    { fraction: apexFraction, elevation: apexElev },
    { fraction: 1, elevation: baseElev },
  ]
}

/**
 * Build the triangle polygon for an ONLAP — a minority that laps against one
 * bracket tie-line.
 *
 * The flat edge sits on the unit's source column (fraction 0 left / 1 right);
 * the unit tapers to a tip at ``INTERIOR_PINCH_FRACTION`` whose elevation is
 * taken from the BRACKET interface it laps against (``top`` → the top interface,
 * so the base laps UP; ``base`` → the base interface, so the top laps DOWN).
 * This is geometrically distinct from a lens (apex at the unit's OWN
 * mid-elevation) — the onlap is anchored on its correlated bracket.
 *
 * The onlap overlays the connected matrix band, so its region is emitted as
 * ``kind: 'lens'`` (excluded from the tiling invariant), like an enclosed lens.
 *
 * Parameters
 * ----------
 * unit : PinchUnit
 *     The onlap unit (carries its column side + own depth span).
 * edge : 'top' | 'base'
 *     The bracket the onlap laps against.
 * topIface, baseIface : Interface
 *     The interval's enclosing interfaces (the brackets).
 * leftSurface, rightSurface : number
 *     Column surface elevations (mTAW).
 */
function buildOnlapPolygon(
  unit: PinchUnit,
  edge: 'top' | 'base',
  topIface: Interface,
  baseIface: Interface,
  leftSurface: number,
  rightSurface: number,
): PartitionPoint[] {
  const surface = unit.side === 'left' ? leftSurface : rightSurface
  const colFrac = unit.side === 'left' ? 0 : 1
  const tipFrac = unit.side === 'left' ? INTERIOR_PINCH_FRACTION : 1 - INTERIOR_PINCH_FRACTION
  const topElev = surface - unit.ownTopDepth
  const baseElev = surface - unit.ownBaseDepth
  const anchor = edge === 'top' ? topIface : baseIface
  const tipElev = ifaceElev(anchor, tipFrac, leftSurface, rightSurface)
  return [
    { fraction: colFrac, elevation: topElev },
    { fraction: tipFrac, elevation: tipElev },
    { fraction: colFrac, elevation: baseElev },
  ]
}

// ---------------------------------------------------------------------------
// Overlay carve — turn lens/onlap overlays into a TRUE partition
// ---------------------------------------------------------------------------

/** Fraction tolerance for "this vertex sits on column edge 0 or 1". */
const FRAC_EPS = 1e-6
/** Elevation tolerance when testing whether a matrix edge-span contains an overlay. */
const SPAN_EPS = 1e-6

/**
 * A notch to cut into a matrix's column edge. ``ob``/``ot`` are the lower/upper
 * elevations where the notch meets the column edge; ``chain`` is the overlay's
 * interior boundary between them (ordered low → high), which is a single apex for
 * a fully-enclosed lens or a seam-riding chain for a straddle lens (owner's
 * "rest on the clay" rule — the lens base follows the sloping body beneath it
 * rather than crossing into it).
 */
interface OverlayNotch {
  /** Lower elevation (mTAW) where the notch meets the column edge. */
  ob: number
  /** Upper elevation (mTAW) where the notch meets the column edge. */
  ot: number
  /** Interior boundary points between ``ob`` and ``ot`` (ordered low → high). */
  chain: PartitionPoint[]
}

/** Elevations of a polygon's vertices that sit on column edge ``side`` (0 or 1). */
function edgeElevations(poly: PartitionPoint[], side: 0 | 1): number[] {
  return poly
    .filter((p) => Math.abs(p.fraction - side) < FRAC_EPS)
    .map((p) => p.elevation)
}

/** Signed area × 2 of a ring in (fraction, elevation) space (> 0 = CCW). */
function signedArea2(poly: PartitionPoint[]): number {
  let s = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    s += a.fraction * b.elevation - b.fraction * a.elevation
  }
  return s
}

/**
 * Clip a subject polygon to a CONVEX clip polygon (Sutherland-Hodgman) in
 * (fraction, elevation) space.
 *
 * Used to make an overlay (lens/onlap) "rest on" its enclosing matrix: the part
 * of the overlay that would stick out past a matrix edge is folded onto that
 * edge, so the overlay never crosses into a neighbouring body (owner's Solution
 * 2). A fully-enclosed overlay (every vertex already inside the matrix) is
 * returned unchanged.
 *
 * Parameters
 * ----------
 * subject : PartitionPoint[]
 *     The overlay ring to clip.
 * clip : PartitionPoint[]
 *     The convex matrix ring to clip against.
 *
 * Returns
 * -------
 * PartitionPoint[]
 *     The clipped ring (possibly empty if subject and clip are disjoint).
 */
function clipToConvex(subject: PartitionPoint[], clip: PartitionPoint[]): PartitionPoint[] {
  const orient = signedArea2(clip) >= 0 ? 1 : -1
  const m = clip.length
  let output = subject.slice()
  for (let e = 0; e < m && output.length > 0; e++) {
    const c1 = clip[e]
    const c2 = clip[(e + 1) % m]
    const dx = c2.fraction - c1.fraction
    const dy = c2.elevation - c1.elevation
    // Left-test L(p) = (c2−c1) × (p−c1): > 0 = left of the directed edge. The
    // interior is left for a CCW ring, right for CW, so inside ⇔ orient·L ≥ 0.
    const L = (p: PartitionPoint): number =>
      dx * (p.elevation - c1.elevation) - dy * (p.fraction - c1.fraction)
    const intersect = (a: PartitionPoint, b: PartitionPoint): PartitionPoint => {
      const la = L(a)
      const lb = L(b)
      const t = Math.abs(la - lb) < 1e-12 ? 0 : la / (la - lb)
      return {
        fraction: a.fraction + t * (b.fraction - a.fraction),
        elevation: a.elevation + t * (b.elevation - a.elevation),
      }
    }
    const input = output
    output = []
    for (let i = 0; i < input.length; i++) {
      const a = input[i]
      const b = input[(i + 1) % input.length]
      const aIn = orient * L(a) >= -SPAN_EPS
      const bIn = orient * L(b) >= -SPAN_EPS
      if (aIn) {
        output.push(a)
        if (!bIn) output.push(intersect(a, b))
      } else if (bIn) {
        output.push(intersect(a, b))
      }
    }
  }
  // Drop consecutive duplicate vertices (clipping along an existing edge emits
  // coincident points) so downstream edge-vertex counting stays exact.
  return dedupeRing(output)
}

/** Remove consecutive (and wrap-around) near-duplicate vertices from a ring. */
function dedupeRing(poly: PartitionPoint[]): PartitionPoint[] {
  const out: PartitionPoint[] = []
  for (const p of poly) {
    const last = out[out.length - 1]
    if (
      last &&
      Math.abs(last.fraction - p.fraction) < FRAC_EPS &&
      Math.abs(last.elevation - p.elevation) < SPAN_EPS
    ) {
      continue
    }
    out.push(p)
  }
  if (
    out.length > 1 &&
    Math.abs(out[0].fraction - out[out.length - 1].fraction) < FRAC_EPS &&
    Math.abs(out[0].elevation - out[out.length - 1].elevation) < SPAN_EPS
  ) {
    out.pop()
  }
  return out
}

/**
 * Extract the column-edge notch of a clipped overlay: where it meets edge
 * ``side`` (``ob``/``ot``) and the interior chain between (ordered low → high).
 *
 * The clipped overlay has exactly two vertices on the column edge (its base) and
 * one or more interior vertices (apex, or seam-riding chain). Returns ``null`` if
 * the shape is degenerate (fewer than two edge vertices) so the caller can skip.
 */
function notchFromClipped(clipped: PartitionPoint[], side: 0 | 1): OverlayNotch | null {
  const n = clipped.length
  const onEdge = (p: PartitionPoint): boolean => Math.abs(p.fraction - side) < FRAC_EPS
  const edgeIdx: number[] = []
  for (let i = 0; i < n; i++) if (onEdge(clipped[i])) edgeIdx.push(i)
  if (edgeIdx.length !== 2) return null
  const [i, j] = edgeIdx
  const ob = Math.min(clipped[i].elevation, clipped[j].elevation)
  const ot = Math.max(clipped[i].elevation, clipped[j].elevation)
  // The two ring arcs between the edge vertices: one runs along the column edge
  // (no interior vertices), the other carries the interior boundary.
  const arc = (from: number, to: number): PartitionPoint[] => {
    const r: PartitionPoint[] = []
    for (let k = (from + 1) % n; k !== to; k = (k + 1) % n) r.push(clipped[k])
    return r
  }
  const arcA = arc(i, j) // i → j
  const arcB = arc(j, i) // j → i
  const hasInterior = (a: PartitionPoint[]): boolean => a.some((p) => !onEdge(p))
  let chain: PartitionPoint[]
  let fromIdx: number
  if (hasInterior(arcA) || arcB.length === 0) {
    chain = arcA
    fromIdx = i
  } else {
    chain = arcB
    fromIdx = j
  }
  // Normalise to low → high: reverse if the chain starts at the upper edge vertex.
  if (clipped[fromIdx].elevation > (ob + ot) / 2) chain = chain.slice().reverse()
  return { ob, ot, chain }
}

/**
 * Insert notches into a polygon ring along the single edge whose BOTH endpoints
 * sit on column edge ``side``.
 *
 * Each overlay shares its base with the matrix on column edge ``side``; its
 * (clipped) interior boundary becomes a notch on that edge — one concave ring,
 * never a hole or a split (a LEFT overlay lives in the left half, a RIGHT one in
 * the right half, so an overlay only ever sits in a matrix it shares a column
 * edge with). No general polygon-boolean is needed.
 *
 * Walking the ring, when we traverse the edge ``a → b`` with both endpoints at
 * ``side``, we cut each notch as ``near → chain → far`` where near/far follow the
 * traversal direction (up the edge → near = the lower elevation, chain low→high).
 * Stacked notches (multiple overlays on one edge) are inserted in elevation order
 * so they don't cross; overlays never overlap each other (LL1), so the cuts are
 * disjoint.
 *
 * Parameters
 * ----------
 * poly : PartitionPoint[]
 *     The matrix polygon ring (closed, no repeated last point).
 * side : 0 | 1
 *     The column edge to notch (0 = left, 1 = right).
 * notches : OverlayNotch[]
 *     The notches to cut into that edge.
 *
 * Returns
 * -------
 * PartitionPoint[]
 *     A new ring with the notches cut in (concave).
 */
function insertNotches(
  poly: PartitionPoint[],
  side: 0 | 1,
  notches: OverlayNotch[],
): PartitionPoint[] {
  if (notches.length === 0) return poly
  const out: PartitionPoint[] = []
  const n = poly.length
  let cut = false // only the first qualifying edge is notched (a simple ring touches `side` once)
  for (let i = 0; i < n; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % n]
    out.push(a)
    const aOn = Math.abs(a.fraction - side) < FRAC_EPS
    const bOn = Math.abs(b.fraction - side) < FRAC_EPS
    if (!cut && aOn && bOn) {
      cut = true
      const dir = b.elevation - a.elevation // > 0 → traversing up the edge
      // Drop any notch whose [ob, ot] overlaps an earlier one. Overlays never
      // overlap each other today (LL1), so this is a defensive guard for the
      // future nested-lens case (a lens inside a lens) — overlapping notches
      // would self-intersect the matrix ring; the skipped overlay stays a
      // harmless overlay instead.
      const byElev = [...notches].sort((p, q) => p.ob - q.ob)
      const safe: OverlayNotch[] = []
      let lastOt = -Infinity
      for (const nt of byElev) {
        if (nt.ob < lastOt - SPAN_EPS) continue
        safe.push(nt)
        lastOt = nt.ot
      }
      const ordered = dir >= 0 ? safe : [...safe].reverse()
      for (const nt of ordered) {
        const near = dir >= 0 ? nt.ob : nt.ot
        const far = dir >= 0 ? nt.ot : nt.ob
        const chain = dir >= 0 ? nt.chain : [...nt.chain].reverse()
        out.push(
          { fraction: side, elevation: near },
          ...chain.map((p) => ({ fraction: p.fraction, elevation: p.elevation })),
          { fraction: side, elevation: far },
        )
      }
    }
  }
  return out
}

/**
 * Subtract every lens/onlap overlay from the matrix region it sits in, in place,
 * so the gap's regions become a TRUE partition: each point belongs to exactly
 * one region.
 *
 * Owner's Solution 2 ("rest on the clay"): each overlay is first CLIPPED to its
 * enclosing matrix (so a straddle lens's base follows the sloping seam of the
 * body beneath it rather than crossing into it), then that clipped shape is
 * carved out of the matrix as a notch. A fully-enclosed lens clips to itself
 * unchanged, so the simple apex notch is the special case.
 *
 * Run as a post-pass at the end of ``emitGap`` — after all mains + overlays are
 * emitted. Only the matrix polygons gain notches; each overlay's polygon is
 * replaced by its clipped (seam-riding) shape so it exactly fills its notch.
 *
 * Parameters
 * ----------
 * regions : PartitionRegion[]
 *     One gap's regions (mutated in place: overlay + matrix ``polygon``s change).
 */
function carveOverlays(regions: PartitionRegion[]): void {
  const mains = regions.filter((r) => r.kind === 'quad' || r.kind === 'pinch')
  const overlays = regions.filter((r) => r.kind === 'lens')
  if (overlays.length === 0 || mains.length === 0) return

  // Group notches per matrix region, per side. Matrices are clipped against
  // before any are mutated, so every clip sees the original (convex) polygon.
  const byMatrix = new Map<PartitionRegion, { 0: OverlayNotch[]; 1: OverlayNotch[] }>()
  for (const ov of overlays) {
    const onLeft = edgeElevations(ov.polygon, 0)
    const onRight = edgeElevations(ov.polygon, 1)
    let side: 0 | 1
    let edgeElevs: number[]
    if (onLeft.length >= 2) {
      side = 0
      edgeElevs = onLeft
    } else if (onRight.length >= 2) {
      side = 1
      edgeElevs = onRight
    } else {
      continue // defensive: overlay not anchored on a column edge
    }
    const ob = Math.min(...edgeElevs)
    const ot = Math.max(...edgeElevs)

    // The matrix this overlay sits in: a main with >= 2 verts on `side` whose
    // edge-span contains [ob, ot]. After LL1 (overlays never overlap each other)
    // and main×main = 0, exactly one main contains a given elevation band, so the
    // match is unambiguous; pick the tightest span defensively.
    let best: PartitionRegion | null = null
    let bestSpan = Infinity
    for (const m of mains) {
      const me = edgeElevations(m.polygon, side)
      if (me.length < 2) continue
      const lo = Math.min(...me)
      const hi = Math.max(...me)
      if (lo <= ob + SPAN_EPS && hi >= ot - SPAN_EPS) {
        const span = hi - lo
        if (span < bestSpan) {
          best = m
          bestSpan = span
        }
      }
    }
    if (!best) continue // defensive: no enclosing matrix (e.g. lens at the column floor)

    // Clip the overlay to the matrix so it rides the seam, then derive its notch.
    const clipped = clipToConvex(ov.polygon, best.polygon)
    if (clipped.length < 3) continue // degenerate after clipping — leave overlay as-is
    const notch = notchFromClipped(clipped, side)
    if (!notch) continue
    ov.polygon = clipped // the overlay now exactly fills its notch (seam-riding)

    let g = byMatrix.get(best)
    if (!g) {
      g = { 0: [], 1: [] }
      byMatrix.set(best, g)
    }
    g[side].push(notch)
  }

  for (const [m, g] of byMatrix) {
    if (g[0].length > 0) m.polygon = insertNotches(m.polygon, 0, g[0])
    if (g[1].length > 0) m.polygon = insertNotches(m.polygon, 1, g[1])
  }
}

/**
 * Emit a ONE-SIDED pinch interval as apex-sharing triangles (Thread A).
 *
 * Every pinch unit lives on ``side`` (the unit is absent on the opposite column,
 * so the interval converges there). One shared apex is placed at fraction ``f``
 * from the pinch side; each stacked pinch becomes a sub-triangle to the apex, and
 * a SINGLE matrix extension closes the wedge beyond the apex:
 *
 *   - matrix above present → apex on the BASE interface; the above matrix
 *     descends to fill the wedge while the unit BELOW keeps its flat correlated
 *     top (no extension for it);
 *   - no matrix above (surface) → apex on the TOP interface (surface); the
 *     below matrix rises to fill.
 *
 * The result tiles exactly (N pinch sub-triangles + one matrix triangle all
 * share the apex), so the pinch tips mid-gap (no droop to the neighbour) while
 * the fill stays hole-free. Two-sided (interfingering) intervals are NOT handled
 * here — the caller routes those to ``emitInterval``.
 *
 * Parameters
 * ----------
 * pinches : PinchUnit[]
 *     The unmatched units, all on ``side`` (sorted internally top→bottom).
 * side : 'left' | 'right'
 *     The column the pinches live on.
 * topIface, baseIface : Interface
 *     The interval's enclosing interfaces.
 * above, below : the matrix quad ABOVE / BELOW the interval, or ``null`` at the
 *     surface / floor respectively.
 * leftSurface, rightSurface : column surface elevations (mTAW).
 * f : tip fraction measured from the pinch side (``INTERIOR_PINCH_FRACTION``).
 *
 * Returns
 * -------
 * PartitionRegion[]
 *     ``[...pinch sub-triangles, above extension?, below extension?]``.
 */
function emitOneSidedPinch(
  pinches: PinchUnit[],
  side: 'left' | 'right',
  topIface: Interface,
  baseIface: Interface,
  above: { formationId: string; bodyId: string | null } | null,
  below: { formationId: string; bodyId: string | null } | null,
  leftSurface: number,
  rightSurface: number,
  f: number,
): PartitionRegion[] {
  const apexFraction = side === 'left' ? f : 1 - f

  const pinchFrac = side === 'left' ? 0 : 1
  const oppFrac = side === 'left' ? 1 : 0
  const pinchSurface = side === 'left' ? leftSurface : rightSurface
  const oppSurface = side === 'left' ? rightSurface : leftSurface
  const topOppDepth = side === 'left' ? topIface.rightDepth : topIface.leftDepth
  const baseOppDepth = side === 'left' ? baseIface.rightDepth : baseIface.leftDepth
  const topPinchDepth = side === 'left' ? topIface.leftDepth : topIface.rightDepth
  const basePinchDepth = side === 'left' ? baseIface.leftDepth : baseIface.rightDepth

  // LENS vs BOUNDARY pinch.
  //   - Same matrix FORMATION above AND below → the unit is a LENS inside one
  //     material (clay/silt/clay). It must pinch at its OWN elevation (no
  //     droop), with the matrix filling around it from BOTH sides.
  //   - Otherwise → a BOUNDARY pinch: the unit below keeps its flat correlated
  //     top and only the ABOVE matrix descends to fill (or, at the surface, the
  //     below matrix rises). (owner directive 2026-06-08: an enclosed silt was
  //     drooping all the way down to the lower clay's base.)
  const isLens = above !== null && below !== null && above.formationId === below.formationId

  let apexElev: number
  if (isLens) {
    // The pinch block's own mid-elevation — the lens tapers horizontally.
    apexElev = pinchSurface - (topPinchDepth + basePinchDepth) / 2
  } else if (above) {
    apexElev = ifaceElev(baseIface, apexFraction, leftSurface, rightSurface)
  } else {
    apexElev = ifaceElev(topIface, apexFraction, leftSurface, rightSurface)
  }
  const apex: PartitionPoint = { fraction: apexFraction, elevation: apexElev }

  // The interval has zero thickness on the OPPOSITE column (the unit is absent
  // there) — the two interfaces meet at this convergence point.
  const conv: PartitionPoint = {
    fraction: oppFrac,
    elevation: oppSurface - (topOppDepth + baseOppDepth) / 2,
  }

  const out: PartitionRegion[] = []
  // Each stacked pinch → a sub-triangle from its own depth span on the pinch
  // edge to the SHARED apex (one apex for the whole stack), so N stacked units
  // tile the pinch block exactly.
  const sorted = [...pinches].sort((a, b) => a.ownTopDepth - b.ownTopDepth)
  for (const p of sorted) {
    const top: PartitionPoint = { fraction: pinchFrac, elevation: pinchSurface - p.ownTopDepth }
    const base: PartitionPoint = { fraction: pinchFrac, elevation: pinchSurface - p.ownBaseDepth }
    out.push({ formationId: p.formationId, bodyId: p.bodyId, kind: 'pinch', polygon: [top, apex, base] })
  }
  const topCorner: PartitionPoint = { fraction: pinchFrac, elevation: pinchSurface - topPinchDepth }
  const baseCorner: PartitionPoint = { fraction: pinchFrac, elevation: pinchSurface - basePinchDepth }
  // Matrix extensions close the wedge beyond the apex (merged contact apex→conv).
  // A LENS fills from BOTH sides (same material) so the unit keeps its own level;
  // a BOUNDARY pinch fills from the ABOVE side only (the unit below stays flat),
  // or from BELOW at the surface.
  if (above && below && above.formationId === below.formationId) {
    out.push({ formationId: above.formationId, bodyId: above.bodyId, kind: 'quad', polygon: [topCorner, conv, apex] })
    out.push({ formationId: below.formationId, bodyId: below.bodyId, kind: 'quad', polygon: [baseCorner, apex, conv] })
  } else if (above) {
    out.push({ formationId: above.formationId, bodyId: above.bodyId, kind: 'quad', polygon: [topCorner, conv, apex] })
  } else if (below) {
    out.push({ formationId: below.formationId, bodyId: below.bodyId, kind: 'quad', polygon: [baseCorner, apex, conv] })
  }
  return out
}

// ---------------------------------------------------------------------------
// Interval emission
// ---------------------------------------------------------------------------

/**
 * Emit regions for one interval (the span between two quads, or between the
 * surface/floor and a quad).
 *
 * An interval has a fixed enclosing ``topIface`` and ``baseIface``.  Any number
 * of left-only and right-only pinches share this interval and are tiled inside
 * it side-by-side.
 *
 * Meeting fraction = totalLeftThickness / (totalLeft + totalRight) — the
 * thicker side keeps more of the interval width.  When only one side has
 * pinches the lone side fills the whole interval (meetFraction 0 or 1).
 *
 * Parameters
 * ----------
 * pinches : PinchUnit[]
 *     The unmatched units in this interval, in top→bottom order per side.
 * topIface : Interface
 *     Top boundary of the interval.
 * baseIface : Interface
 *     Base boundary of the interval.
 * leftSurface, rightSurface : number
 *     Column surface elevations (mTAW).
 *
 * Returns
 * -------
 * PartitionRegion[]
 *     The pinch regions tiling this interval.  Empty when ``pinches`` is empty.
 */
function emitInterval(
  pinches: PinchUnit[],
  topIface: Interface,
  baseIface: Interface,
  leftSurface: number,
  rightSurface: number,
  bracketed = false,
): PartitionRegion[] {
  if (pinches.length === 0) return []

  const leftPinches = pinches.filter((p) => p.side === 'left')
  const rightPinches = pinches.filter((p) => p.side === 'right')

  // Geometric-connectivity inference (owner directive 2026-06-08): when the
  // interval reduces to exactly one left unit and one right unit of the SAME
  // lithology (formationId), they are the same matrix body bridging the gap even
  // though they were never explicitly correlated (different bodyId). Connect
  // them as one band quad spanning the interval, inheriting the bracketing
  // interfaces — instead of tiling them as opposing pinches meeting at a seam
  // (the "droop"). Minority lithologies are extracted as lenses by the pre-pass,
  // so after extraction the matrix is this single-unit-per-side case.
  if (
    leftPinches.length === 1 &&
    rightPinches.length === 1 &&
    leftPinches[0].formationId === rightPinches[0].formationId
  ) {
    const p = leftPinches[0]
    const polygon: PartitionPoint[] = [
      { fraction: 0, elevation: leftSurface - topIface.leftDepth },
      { fraction: 1, elevation: rightSurface - topIface.rightDepth },
      { fraction: 1, elevation: rightSurface - baseIface.rightDepth },
      { fraction: 0, elevation: leftSurface - baseIface.leftDepth },
    ]
    return [{ formationId: p.formationId, bodyId: p.bodyId, kind: 'quad', polygon }]
  }

  // Compute total elevation thickness on each side for the meeting-fraction weight.
  const sumLeft = leftPinches.reduce((s, p) => {
    return s + Math.max(0, (leftSurface - p.ownTopDepth) - (leftSurface - p.ownBaseDepth))
  }, 0)
  const sumRight = rightPinches.reduce((s, p) => {
    return s + Math.max(0, (rightSurface - p.ownTopDepth) - (rightSurface - p.ownBaseDepth))
  }, 0)

  // Mismatched matrix: inside an interval bracketed by correlated bands ABOVE
  // and BELOW, exactly one left + one right unit of DIFFERENT lithology fill it
  // — no matrix connects across. The transition position is unknown, so the two
  // halves meet at the MIDPOINT (0.5, "halfway", not the thickness-weighted
  // fraction). The seam is a straight contact: the owner's model (2026-06-09)
  // has NO auto-facies wriggle — a lateral facies/disturbed contact is the
  // engineer's call, not a geometric inference. The ``bracketed`` gate keeps
  // surface/floor opposing pinches (PF3) on the weighted fraction.
  const mismatchedMatrix =
    bracketed &&
    leftPinches.length === 1 &&
    rightPinches.length === 1 &&
    leftPinches[0].formationId !== rightPinches[0].formationId

  let meetFraction: number
  if (mismatchedMatrix) {
    meetFraction = 0.5
  } else if (leftPinches.length > 0 && rightPinches.length > 0) {
    meetFraction = sumLeft + sumRight > EPS ? sumLeft / (sumLeft + sumRight) : 0.5
  } else if (leftPinches.length > 0) {
    meetFraction = 1 // lone left-only: full triangle to right column
  } else {
    meetFraction = 0 // lone right-only: full triangle to left column
  }

  const regions: PartitionRegion[] = []

  // Each left pinch is a SEPARATE region.  They all use the SAME topIface and
  // baseIface (the interval boundaries) and the SAME meetFraction — they tile
  // the same [0, meetFraction] slice, one per pinch body.
  // When there are multiple left pinches they are stacked vertically inside
  // [0, meetFraction]: each gets its own sub-interval.
  if (leftPinches.length === 1) {
    const p = leftPinches[0]
    const polygon = buildLeftPinchPolygon(topIface, baseIface, meetFraction, leftSurface, rightSurface)
    regions.push({ formationId: p.formationId, bodyId: p.bodyId, kind: 'pinch', polygon })
  } else if (leftPinches.length > 1) {
    // Multiple left pinches: subdivide the interval vertically on the left side.
    // Each pinch's own depth span defines its sub-interval on the left.
    // The right side (at meetFraction) is shared — interpolated from topIface/baseIface.
    const intervalLeftSpan = baseIface.leftDepth - topIface.leftDepth
    for (const p of leftPinches) {
      if (p.ownBaseDepth - p.ownTopDepth < EPS) continue
      // Sub-interface for this pinch: left side from the unit's own depths,
      // right side linearly interpolated from the interval's right progression.
      const tTop = intervalLeftSpan < EPS ? 0 : (p.ownTopDepth - topIface.leftDepth) / intervalLeftSpan
      const tBase = intervalLeftSpan < EPS ? 1 : (p.ownBaseDepth - topIface.leftDepth) / intervalLeftSpan
      const subTopRight = topIface.rightDepth + tTop * (baseIface.rightDepth - topIface.rightDepth)
      const subBaseRight = topIface.rightDepth + tBase * (baseIface.rightDepth - topIface.rightDepth)
      const subTop: Interface = { leftDepth: p.ownTopDepth, rightDepth: subTopRight }
      const subBase: Interface = { leftDepth: p.ownBaseDepth, rightDepth: subBaseRight }
      const polygon = buildLeftPinchPolygon(subTop, subBase, meetFraction, leftSurface, rightSurface)
      regions.push({ formationId: p.formationId, bodyId: p.bodyId, kind: 'pinch', polygon })
    }
  }

  // Similarly for right pinches.
  if (rightPinches.length === 1) {
    const p = rightPinches[0]
    const polygon = buildRightPinchPolygon(topIface, baseIface, meetFraction, leftSurface, rightSurface)
    regions.push({ formationId: p.formationId, bodyId: p.bodyId, kind: 'pinch', polygon })
  } else if (rightPinches.length > 1) {
    const intervalRightSpan = baseIface.rightDepth - topIface.rightDepth
    for (const p of rightPinches) {
      if (p.ownBaseDepth - p.ownTopDepth < EPS) continue
      const tTop = intervalRightSpan < EPS ? 0 : (p.ownTopDepth - topIface.rightDepth) / intervalRightSpan
      const tBase = intervalRightSpan < EPS ? 1 : (p.ownBaseDepth - topIface.rightDepth) / intervalRightSpan
      const subTopLeft = topIface.leftDepth + tTop * (baseIface.leftDepth - topIface.leftDepth)
      const subBaseLeft = topIface.leftDepth + tBase * (baseIface.leftDepth - topIface.leftDepth)
      const subTop: Interface = { leftDepth: subTopLeft, rightDepth: p.ownTopDepth }
      const subBase: Interface = { leftDepth: subBaseLeft, rightDepth: p.ownBaseDepth }
      const polygon = buildRightPinchPolygon(subTop, subBase, meetFraction, leftSurface, rightSurface)
      regions.push({ formationId: p.formationId, bodyId: p.bodyId, kind: 'pinch', polygon })
    }
  }

  return regions
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Emit the partition regions for ONE adjacent-column gap, given the already
 * reduced + collapsed unit stacks and each column's pinched-out lenses.
 *
 * Matching (``matchColumns``), the interval walk, onlap + facies handling, and
 * the lens/onlap overlays live here. The section-wide reduction (done ONCE per
 * column, against BOTH neighbours, so a shared column is identical in both its
 * gaps) happens upstream in ``computeSectionFill`` — never per gap.
 *
 * Parameters
 * ----------
 * leftUnits, rightUnits : PartitionUnit[]
 *     The two columns' reduced + collapsed units (gap-free, sorted, non-empty).
 * leftSurface, rightSurface : number
 *     Column surface elevations (mTAW).
 * leftLensesIn, rightLensesIn : readonly ExtractedLens[]
 *     The lenses pinched out of each column, rendered as LEFT / RIGHT overlays.
 * lensApexOverrides : optional per-body apex shaping.
 *
 * Returns
 * -------
 * PartitionRegion[]
 *     Top-to-bottom MAIN regions that tile the gap, followed by lens/onlap overlays.
 */
function emitGap(
  leftUnits: PartitionUnit[],
  leftSurface: number,
  rightUnits: PartitionUnit[],
  rightSurface: number,
  leftLensesIn: readonly ExtractedLens[],
  rightLensesIn: readonly ExtractedLens[],
  correlated: Correlated,
  lensApexOverrides?: ReadonlyMap<string, LensApexOverride>,
): PartitionRegion[] {
  // Local copies — the interval walk appends interval-extracted lenses to these.
  const leftLenses: ExtractedLens[] = [...leftLensesIn]
  const rightLenses: ExtractedLens[] = [...rightLensesIn]

  // -------------------------------------------------------------------------
  // Step 1: Edge-driven monotonic alignment (post-reduction units). An explicit
  // correlation edge bands a pair (at any elevation); geometric overlap is the
  // fallback fill tier for the matrix; never matches across lithology.
  // -------------------------------------------------------------------------
  const toMatchUnits = (units: readonly PartitionUnit[], surface: number): MatchUnit[] =>
    units.map((u) => ({
      formationId: u.formationId,
      layerId: u.layerId,
      topElev: surface - u.topDepthM,
      baseElev: surface - u.baseDepthM,
    }))
  const matchedPairs = matchColumns(
    toMatchUnits(leftUnits, leftSurface),
    toMatchUnits(rightUnits, rightSurface),
    correlated,
  )

  const leftMatched = new Set(matchedPairs.map(([li]) => li))
  const rightMatched = new Set(matchedPairs.map(([, ri]) => ri))

  // -------------------------------------------------------------------------
  // Step 2: Walk the matched pairs, collecting interval groups.
  //
  // Each "interval" is defined by its top and base interface:
  //   - top = previous quad's baseIface (or the surface interface).
  //   - base = next quad's topIface (or the floor interface).
  //
  // Within each interval we collect all unmatched left and right units, then
  // call emitInterval to tile them side-by-side.
  // -------------------------------------------------------------------------
  const leftTop = leftUnits[0].topDepthM
  const rightTop = rightUnits.length > 0 ? rightUnits[0].topDepthM : leftTop
  const leftFloor = leftUnits[leftUnits.length - 1].baseDepthM
  const rightFloor = rightUnits.length > 0 ? rightUnits[rightUnits.length - 1].baseDepthM : leftFloor

  const surfaceIface: Interface = { leftDepth: leftTop, rightDepth: rightTop }
  const floorIface: Interface = { leftDepth: leftFloor, rightDepth: rightFloor }

  const regions: PartitionRegion[] = []

  // Onlaps collected during the walk, emitted AFTER the main regions (they
  // overlay the connected matrix band, like lenses). Each carries the interval
  // interfaces it laps against, snapshotted because ``prevQuadBase`` is reused.
  const intervalOnlaps: Array<{
    unit: PinchUnit
    edge: 'top' | 'base'
    topIface: Interface
    baseIface: Interface
  }> = []

  // prevQuadBase: the base interface of the most recently emitted quad (or the
  // surface interface before any quads).
  let prevQuadBase: Interface = surfaceIface
  // Identity of the most recently emitted quad (the matrix ABOVE the next
  // interval) — fed to emitLoneInteriorPinch so the above-matrix extension is
  // coloured correctly (Slice 1).
  let prevQuadFormationId: string | null = null
  let prevQuadBodyId: string | null = null

  // Also track the left and right unit cursors so we can collect unmatched units.
  // For each inter-quad gap, unmatched left units are those between the previous
  // match's left index and the next match's left index (exclusive, left-unmatched),
  // and similarly for right.
  let prevMatchLi = -1 // last matched left index (-1 = before first)
  let prevMatchRi = -1 // last matched right index

  for (let pairIdx = 0; pairIdx <= matchedPairs.length; pairIdx++) {
    const isFloor = pairIdx === matchedPairs.length
    const nextMatchLi = isFloor ? leftUnits.length : matchedPairs[pairIdx][0]
    const nextMatchRi = isFloor ? rightUnits.length : matchedPairs[pairIdx][1]

    // Collect unmatched units in this interval, per column.
    const leftStack: PinchUnit[] = []
    for (let li = prevMatchLi + 1; li < nextMatchLi; li++) {
      if (leftMatched.has(li)) continue
      const lu = leftUnits[li]
      leftStack.push({
        bodyId: lu.bodyId,
        formationId: lu.formationId,
        side: 'left',
        ownTopDepth: lu.topDepthM,
        ownBaseDepth: lu.baseDepthM,
      })
    }
    const rightStack: PinchUnit[] = []
    for (let ri = prevMatchRi + 1; ri < nextMatchRi; ri++) {
      if (rightMatched.has(ri)) continue
      const ru = rightUnits[ri]
      rightStack.push({
        bodyId: ru.bodyId,
        formationId: ru.formationId,
        side: 'right',
        ownTopDepth: ru.topDepthM,
        ownBaseDepth: ru.baseDepthM,
      })
    }

    // Interval interfaces + bracket matrices — computed BEFORE extraction so an
    // onlap can be anchored on the bracket interface it laps against.
    let intervalBase: Interface
    if (isFloor) {
      intervalBase = clampIface(floorIface, prevQuadBase)
    } else {
      const [mli, mri] = matchedPairs[pairIdx]
      intervalBase = clampIface(
        { leftDepth: leftUnits[mli].topDepthM, rightDepth: rightUnits[mri].topDepthM },
        prevQuadBase,
      )
    }
    const intervalTop = prevQuadBase
    const hasAbove = prevMatchLi >= 0 && prevQuadFormationId !== null
    const aboveMatrix = hasAbove
      ? { formationId: prevQuadFormationId!, bodyId: prevQuadBodyId }
      : null
    let belowMatrix: { formationId: string; bodyId: string | null } | null = null
    if (!isFloor) {
      const [mli] = matchedPairs[pairIdx]
      const u = leftUnits[mli]
      belowMatrix = { formationId: u.formationId, bodyId: u.bodyId }
    }

    // Interval-scoped minority extraction: pull lenses (enclosed by the matrix)
    // and onlaps (touching one bracket) so the matrix reduces to one unit per
    // column and connects across as a band (the reduced stacks feed
    // emitInterval). Lenses append after the main regions (horizontal apex);
    // onlaps are collected with their interfaces and emitted after the main
    // regions too — both overlay the connected matrix band.
    for (const min of extractIntervalMinorities(
      leftStack,
      rightStack,
      aboveMatrix?.formationId ?? null,
      belowMatrix?.formationId ?? null,
    )) {
      if (min.kind === 'lens') {
        ;(min.unit.side === 'left' ? leftLenses : rightLenses).push({
          bodyId: min.unit.bodyId,
          formationId: min.unit.formationId,
          depthTopM: min.unit.ownTopDepth,
          depthBaseM: min.unit.ownBaseDepth,
        })
      } else {
        intervalOnlaps.push({
          unit: min.unit,
          edge: min.edge!,
          topIface: { ...intervalTop },
          baseIface: { ...intervalBase },
        })
      }
    }

    const pinches: PinchUnit[] = [...leftStack, ...rightStack]

    let pinchPool = pinches
    if (isFloor) {
      // Too-shallow carry-through (Slice 2): a unit whose TOP is at/below the
      // shallower column's deepest data lies entirely in "no-neighbour-data"
      // depth — render it as a full-gap-width flat band (the deep data governs
      // the whole gap below the shallow test) instead of pinching to the
      // shallow neighbour. A data gap is not a pinch-out.
      const shallowFloor = Math.min(leftFloor, rightFloor)
      const carry: PinchUnit[] = []
      const rest: PinchUnit[] = []
      for (const p of pinches) {
        if (p.ownTopDepth >= shallowFloor - EPS) carry.push(p)
        else rest.push(p)
      }
      // The carry units all sit on the DEEPER column (they're below the shallow
      // floor); the shallow column has no data there. The carried band must span
      // from the SHALLOW column's floor (its data ends) down — its top SLOPES from
      // the shallow floor (shallow side) to the carry unit's own top (deep side).
      // A flat full-width top (the old behaviour) left a wedge between the shallow
      // floor and a deeper carry top either uncovered (gap) or, with the deepest-
      // floor interval base, filled by a rest-pinch dipping in (overlap — CS1
      // gap-11). When the carry top equals the shallow floor (CT1) the slope is
      // flat, so CT1 is unchanged.
      carry.sort((a, b) => a.ownTopDepth - b.ownTopDepth) // shallowest carry first
      const shallowIsLeft = leftFloor <= rightFloor
      const shallowSurface = shallowIsLeft ? leftSurface : rightSurface
      const shallowFloorElev = shallowSurface - shallowFloor
      carry.forEach((p, ci) => {
        const deepSurface = p.side === 'left' ? leftSurface : rightSurface
        const deepTopElev = deepSurface - p.ownTopDepth
        const deepBaseElev = deepSurface - p.ownBaseDepth
        // Only the SHALLOWEST carry unit's top reaches the shallow floor; deeper
        // carry units stack flat below it (a fine approximation for the rare
        // multi-carry stack).
        const shallowTopElev = ci === 0 ? shallowFloorElev : deepTopElev
        // Fraction 0 = left column edge, 1 = right. Build the quad so the DEEP
        // side carries the unit's own elevations and the SHALLOW side its top
        // reaches the shallow floor (sloped top), with a flat full-width base.
        const polygon: PartitionPoint[] =
          p.side === 'left'
            ? [
                { fraction: 0, elevation: deepTopElev },
                { fraction: 1, elevation: shallowTopElev },
                { fraction: 1, elevation: deepBaseElev },
                { fraction: 0, elevation: deepBaseElev },
              ]
            : [
                { fraction: 0, elevation: shallowTopElev },
                { fraction: 1, elevation: deepTopElev },
                { fraction: 1, elevation: deepBaseElev },
                { fraction: 0, elevation: deepBaseElev },
              ]
        regions.push({ formationId: p.formationId, bodyId: p.bodyId, kind: 'quad', polygon })
      })
      pinchPool = rest
      // The remaining pinches tile ONLY above the carried bands — clamp their
      // interval base to the carried band's (sloped) top so they meet it instead
      // of filling down into it.
      if (carry.length > 0 && rest.length > 0) {
        const carryTop0 = carry[0]
        intervalBase = clampIface(
          shallowIsLeft
            ? { leftDepth: shallowFloor, rightDepth: carryTop0.ownTopDepth }
            : { leftDepth: carryTop0.ownTopDepth, rightDepth: shallowFloor },
          intervalTop,
        )
      }
    }

    // "One-sided" when every remaining pinch is on the same column — only then
    // can the matrix close cleanly to a single apex.
    const pinchSides = new Set(pinchPool.map((p) => p.side))
    const oneSide = pinchSides.size === 1 ? pinchPool[0].side : null
    if (pinchPool.length > 0 && oneSide !== null && (aboveMatrix || belowMatrix)) {
      regions.push(
        ...emitOneSidedPinch(
          pinchPool,
          oneSide,
          intervalTop,
          intervalBase,
          aboveMatrix,
          belowMatrix,
          leftSurface,
          rightSurface,
          INTERIOR_PINCH_FRACTION,
        ),
      )
    } else {
      // ``bracketed`` (correlated bands above AND below) enables the
      // mismatched-matrix facies seam; surface/floor intervals stay weighted.
      const bracketed = aboveMatrix !== null && belowMatrix !== null
      regions.push(
        ...emitInterval(pinchPool, intervalTop, intervalBase, leftSurface, rightSurface, bracketed),
      )
    }

    // Emit the quad (if not the floor sentinel).
    if (!isFloor) {
      const [mli, mri] = matchedPairs[pairIdx]
      const lu = leftUnits[mli]
      const ru = rightUnits[mri]
      const quadTop = clampIface(
        { leftDepth: lu.topDepthM, rightDepth: ru.topDepthM },
        prevQuadBase,
      )
      const quadBase = clampIface(
        { leftDepth: lu.baseDepthM, rightDepth: ru.baseDepthM },
        quadTop,
      )
      const leftH = quadBase.leftDepth - quadTop.leftDepth
      const rightH = quadBase.rightDepth - quadTop.rightDepth
      if (leftH >= EPS || rightH >= EPS) {
        regions.push({
          formationId: lu.formationId,
          bodyId: lu.bodyId,
          kind: 'quad',
          polygon: buildQuadPolygon(quadTop, quadBase, leftSurface, rightSurface),
        })
        prevQuadBase = quadBase
        prevQuadFormationId = lu.formationId
        prevQuadBodyId = lu.bodyId
      } else {
        prevQuadBase = quadTop
      }
      prevMatchLi = mli
      prevMatchRi = mri
    }
  }

  // -------------------------------------------------------------------------
  // Step 3a: Append onlap regions.
  //
  // An onlap laps against ONE bracket tie-line — anchored flat on its source
  // column, tapering to a tip on the bracket interface. It overlays the
  // connected matrix band (emitted as kind:'lens', excluded from the tiling
  // invariant), so it must come AFTER the main regions in array order.
  // -------------------------------------------------------------------------
  for (const onlap of intervalOnlaps) {
    regions.push({
      formationId: onlap.unit.formationId,
      bodyId: onlap.unit.bodyId,
      kind: 'lens',
      polygon: buildOnlapPolygon(
        onlap.unit,
        onlap.edge,
        onlap.topIface,
        onlap.baseIface,
        leftSurface,
        rightSurface,
      ),
    })
  }

  // -------------------------------------------------------------------------
  // Step 3: Append extracted lens regions.
  //
  // Each lens is a horizontal pinch-out triangle that overlays its enclosing
  // matrix quad.  The apex elevation is the lens's OWN mid-elevation so it
  // terminates at its own stratigraphic level (horizontal), not along the
  // dipping enclosing interfaces.  The overlay draws these on top of the main
  // regions (array order) so the lens colour is visible over the matrix.
  // These regions deliberately overlap their matrix and are excluded from the
  // tiling invariant.
  // -------------------------------------------------------------------------
  for (const lens of leftLenses) {
    const topElev = leftSurface - lens.depthTopM
    const baseElev = leftSurface - lens.depthBaseM
    const apex = lens.bodyId ? lensApexOverrides?.get(lens.bodyId) : undefined
    regions.push({
      formationId: lens.formationId,
      bodyId: lens.bodyId,
      kind: 'lens',
      polygon: buildLeftLensPolygon(topElev, baseElev, apex),
    })
  }
  for (const lens of rightLenses) {
    const topElev = rightSurface - lens.depthTopM
    const baseElev = rightSurface - lens.depthBaseM
    const apex = lens.bodyId ? lensApexOverrides?.get(lens.bodyId) : undefined
    regions.push({
      formationId: lens.formationId,
      bodyId: lens.bodyId,
      kind: 'lens',
      polygon: buildRightLensPolygon(topElev, baseElev, apex),
    })
  }

  // Subtract each lens/onlap overlay out of the matrix it sits in, so the gap is
  // a TRUE volumetric partition (every point in exactly one region) — required by
  // the 3D extraction, which assigns each CPT point to exactly one body.
  carveOverlays(regions)

  return regions
}

// ---------------------------------------------------------------------------
// Whole-section resolve
// ---------------------------------------------------------------------------

/** A partition region tagged with the gap (0-based, left-column index) it fills. */
export interface SectionRegion extends PartitionRegion {
  gapIndex: number
}

/**
 * Resolve the WHOLE section at once: reduce each column ONCE against BOTH its
 * neighbours, then emit each gap from the shared reduced columns.
 *
 * Reducing per column (not per gap) is what keeps a body continuous through a
 * shared column: the column has ONE reduced form, so the band anchored on it is
 * identical in both its gaps (no per-gap drift — the dogfeed peat-discontinuity
 * bug). A unit is pinched out as a lens only when it connects to NO neighbour
 * (``reduceColumn``); a unit connecting to one neighbour is kept and EMERGES as
 * an onlap (band in the connected gap, pinch in the other). ``body_id``
 * correlations are honoured even across non-overlapping elevations (a dipping
 * correlated bed stays one band — see ``connectsToNeighbour``).
 *
 * Rendering stays per-gap (the column strips interrupt the fill); each region is
 * tagged with its ``gapIndex`` so the overlay maps it with that gap's column edges.
 *
 * Parameters
 * ----------
 * columns : readonly PartitionColumn[]
 *     The section's columns, left→right (along-section order). Empty columns are
 *     skipped. Each column's ``units`` must be sorted by ``topDepthM``.
 * edges : readonly CorrelationEdge[]
 *     The APPROVED correlation edges (layer-id pairs). Two units band iff an edge
 *     connects their ``layerId``s; geometry only fills the uncorrelated remainder.
 * lensApexOverrides : optional per-body apex shaping (keyed by bodyId).
 *
 * Returns
 * -------
 * SectionRegion[]
 *     All gaps' regions, each tagged with ``gapIndex``.
 */
export function computeSectionFill(
  columns: readonly PartitionColumn[],
  edges: readonly CorrelationEdge[] = [],
  lensApexOverrides?: ReadonlyMap<string, LensApexOverride>,
): SectionRegion[] {
  // Build the edge lookup once (order-independent layer-id pair key).
  const edgeKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`)
  const edgeSet = new Set(edges.map((e) => edgeKey(e.a, e.b)))
  const correlated: Correlated = (a, b) => edgeSet.has(edgeKey(a, b))

  // Drop empty columns; a gap is between two consecutive non-empty columns.
  const cols = columns
    .filter((c) => c.units.length > 0)
    .map((c) => ({ surface: c.surfaceElevM, units: c.units.map((u) => ({ ...u })) }))
  if (cols.length < 2) return []
  cols.forEach((c) => closeColumnGaps(c.units))

  // PER-GAP, PER-SIDE resolve (owner directive 2026-06-09): each gap is
  // self-contained. A unit's shape toward its LEFT neighbour and toward its
  // RIGHT neighbour are independent (it can band one way, pinch the other), so
  // each gap reduces FRESH COPIES of its two columns against EACH OTHER — no
  // shared per-column state carried between gaps. The reduce pulls only the
  // lenses (units uncorrelated to the facing neighbour on both contacts) and
  // merges the matrix around them; bands + onlaps are shaped by emitGap.
  const out: SectionRegion[] = []
  for (let i = 0; i < cols.length - 1; i++) {
    const left = { surface: cols[i].surface, units: cols[i].units.map((u) => ({ ...u })) }
    const right = { surface: cols[i + 1].surface, units: cols[i + 1].units.map((u) => ({ ...u })) }
    const leftIds = new Set(left.units.map((u) => u.layerId))
    const rightIds = new Set(right.units.map((u) => u.layerId))
    const lensesLeft = reduceColumn(left.units, rightIds, correlated)
    const lensesRight = reduceColumn(right.units, leftIds, correlated)
    collapseAdjacentSameFormation(left.units)
    collapseAdjacentSameFormation(right.units)
    const gapRegions = emitGap(
      left.units,
      left.surface,
      right.units,
      right.surface,
      lensesLeft,
      lensesRight,
      correlated,
      lensApexOverrides,
    )
    for (const r of gapRegions) out.push({ ...r, gapIndex: i })
  }
  return out
}

/**
 * Compute the partition fill for ONE adjacent column gap.
 *
 * Thin two-column wrapper over ``computeSectionFill`` (the whole-section resolve)
 * — kept for the pure-geometry unit tests and any single-gap caller. Empty left
 * column → ``[]``.
 *
 * Parameters
 * ----------
 * left, right : PartitionColumn
 *     The two columns (``units`` sorted by ``topDepthM``).
 * edges : readonly CorrelationEdge[]
 *     Approved correlation edges (layer-id pairs).
 * lensApexOverrides : optional per-body apex shaping.
 */
export function computePartitionFill(
  left: PartitionColumn,
  right: PartitionColumn,
  edges: readonly CorrelationEdge[] = [],
  lensApexOverrides?: ReadonlyMap<string, LensApexOverride>,
): PartitionRegion[] {
  return computeSectionFill([left, right], edges, lensApexOverrides).map(
    ({ gapIndex: _gapIndex, ...r }) => r,
  )
}
