/**
 * partitionFillV2/tileCoherentStack.ts — the SESSION-8 ruling-8h SIX-PHASE BIDIRECTIONAL
 * SWEEP (design partition-engine-v2.md §8 ruling 8h — the owner's per-side phase order).
 *
 * Ruling 8h SUPERSEDES the session-7 interval-level meet-at-seam construction where they
 * conflict: emission is PER SIDE and UNCONDITIONAL — the interval-level bail concept is
 * RETIRED. The owner's exact phase order:
 *
 *   Phase 1: every 0-corr unit-side on the LEFT  → emit its lens (left).
 *   Phase 2: every 0-corr unit-side on the RIGHT → emit its lens (right).
 *   Phase 3: every 1-corr unit-side on the LEFT  → emit its onlap riding its tie.
 *   Phase 4: every 1-corr unit-side on the RIGHT → emit its onlap.
 *   Phases 5-6: the section's outermost columns close every body's loop at the frame — the
 *     arrangement's column verticals (``emitColumnVerticals``) already provide this BY
 *     CONSTRUCTION; the sweep VERIFIES the invariant rather than emitting new curves.
 *   Fill: containment-ordered, LITTLE TO BIG — a face belongs to the SMALLEST enclosing loop;
 *     an encompassing body's fill never overwrites an enclosed body's face. In the DCEL
 *     face-trace + ``labelFaces`` model this is automatic (faces ARE minimal; a lens's own
 *     face wins the lens label by boundary composition — the enclosing band is a SEPARATE
 *     face that cannot overwrite it). All small closures exist before any large fill because
 *     ALL curves are in the arrangement before the trace.
 *
 * THE POINT (owner's session-7 diagnosis: "you don't seem to be closing bidirectionally?"):
 * emission becomes PER SIDE and UNCONDITIONAL. Every 0-corr side ALWAYS gets its lens (reach
 * per ruling 8b ``lensReachFraction``, user overrides exempt), every 1-corr side ALWAYS its
 * onlap. Where two sides' emissions meet, they meet BY CONSTRUCTION — the meet-at-seam trapezoid
 * (sessions 6/7 proved: trapezoid slabs are hole-free; N independent freeform wedges are +457
 * holes; additive carves over claimed space are +43 overlaps), now a CONSEQUENCE of the two
 * per-side slabs sharing the 0.5 vertical, not a routing branch.
 *
 * DISPATCH BY FACING GEOMETRY (each construction proven hole-free elsewhere; the phase order
 * is the same in every branch — 0-corr lenses first, 1-corr onlaps second):
 *
 *   - BOTH sides real thickness + both carry units → MEET-AT-SEAM slabs (the session-6/7
 *     ``emitSideSlabs`` construction: each unit fills its own [uTop..uBase] slab from ITS
 *     column to the shared 0.5 seam as a right-trapezoid, the two sides meeting at the seam).
 *   - ONE side empty (lone) → the facing enclosing floods that whole half; the present side's
 *     units terminate toward the seam (a special case of the same slab code).
 *   - CONVERGING facing (one side ~0 thickness — the pinch-to-conv shape) → NO BAIL (ruling
 *     8h(a)): the present side's units terminate toward the facing CONVERGENCE POINT ``conv``
 *     via the proven per-unit primitives (``emitSharedContactOnlap`` for a shared-contact onlap,
 *     ``emitLonePinch`` ``forceLens`` for a 0-corr lens), the enclosing flooding the wedge past
 *     the tip. This is exactly what ``routeLoneSidePinch`` already emits hole-free for the
 *     converging case — the sweep OWNS it instead of returning false to the caller's seam.
 *
 * 8g(b) (base-tied same-formation = band) and the conformance gate are UNCHANGED. Ruling 8b
 * (lens reach cap) governs every lens apex. ``intersect.ts`` / ``seamAnchor.ts`` UNTOUCHABLE
 * (613-hole trap). Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { INTERIOR_PINCH_FRACTION } from '../partitionFill'
import { emitLensClosing, type IntervalUnit } from './emitIntervalLenses'
import { emitLonePinch, type LonePinchBracket } from './emitLonePinch'
import { type LensLabel } from './emitLenses'
import { emitSharedContactOnlap } from './emitSharedContactOnlap'
import { chooseOnlapEnclosing } from './emitTerminations'
import { facingMatrixLabel } from './facingMatrix'
import { type ColumnGeom } from './sectionGeom'
import { emitConvergingStack } from './tileConvergingStack'
import { type ConvergingSide } from './tileCoherentStackTypes'
import { type CorrUnit } from './tileGap'
import { type InputCurve, type Point } from './types'

/** Small epsilon in metres for elevation comparisons before the 1 mm snap. */
const ELEV_EPS = 1e-6

/** A facing bracket thinner than this (metres) CONVERGES to a point on that column. */
const CONVERGE_EPS = 0.02

/** The shared meet-seam fraction — both sides pinch toward it (ruling 8g/8h halfway). */
const SEAM_FRACTION = INTERIOR_PINCH_FRACTION

/** THROWAWAY diag — bail / fire counters (session 7/8). Orchestrator strips at cut-over. */
export const COHERENT_STACK_DIAG: Record<string, number> = {}
function sbump(r: string): void {
  COHERENT_STACK_DIAG[r] = (COHERENT_STACK_DIAG[r] ?? 0) + 1
}
export function coherentStackDiagReset(): void {
  for (const k of Object.keys(COHERENT_STACK_DIAG)) delete COHERENT_STACK_DIAG[k]
}

/** One side's resolved geometry for the phase sweep. Extends the narrow ``ConvergingSide``
 *  (ownX/facing/facingX/facingTop/facingBase) the extracted converging-stack tiler consumes. */
interface SideGeom extends ConvergingSide {
  side: 'left' | 'right'
  /** The interval's top / base elevation on THIS column. */
  iTop: number
  iBase: number
  /** Whether the FACING bracket converges to a point (zero thickness). */
  facingConverges: boolean
  /** This side's interval matrix units (top→down), each with its per-gap corr. */
  units: readonly CorrUnit[]
  /** This side's enclosed lenses (kept as their own 8b-capped notches). */
  lenses: readonly IntervalUnit[]
}

/**
 * Tile one two-sided (or lone) interval by the ruling-8h six-phase sweep. Returns ``true`` on
 * success (owns the interval, hole-free by construction). Returns ``false`` ONLY for a
 * genuinely degenerate interval (both sides zero thickness) — every other shape is emitted by
 * the sweep (the interval-level bail is retired per ruling 8h(a)).
 *
 * Parameters
 * ----------
 * leftUnits, rightUnits : readonly CorrUnit[]
 *     Each side's interval matrix units (post enclosed-lens extraction), top→down, with their
 *     per-gap effective corr (2/1/0). Either may be empty (the lone case).
 * leftLenses, rightLenses : readonly IntervalUnit[]
 *     Enclosed lenses already extracted per side (kept as their own 8b-capped notches).
 * left, right : ColumnGeom
 * top, base : LonePinchBracket
 *     The interval brackets (per-column elevations define the slabs).
 * bandFormations : ReadonlySet<string>
 *     Formations carrying a matched-pair band in this gap (ruling 8g(b) one-body test).
 * nextId, nextFloodId : () => string
 * lensLabels : Map<string, LensLabel>
 * out : InputCurve[]
 */
export function tileCoherentStack(
  leftUnits: readonly CorrUnit[],
  rightUnits: readonly CorrUnit[],
  leftLenses: readonly IntervalUnit[],
  rightLenses: readonly IntervalUnit[],
  left: ColumnGeom,
  right: ColumnGeom,
  top: LonePinchBracket,
  base: LonePinchBracket,
  bandFormations: ReadonlySet<string>,
  nextId: () => string,
  nextFloodId: () => string,
  lensLabels: Map<string, LensLabel>,
  out: InputCurve[],
): boolean {
  sbump('entered')
  const iTopL = top.leftElev
  const iBaseL = base.leftElev
  const iTopR = top.rightElev
  const iBaseR = base.rightElev
  const thickL = iTopL - iBaseL
  const thickR = iTopR - iBaseR
  if (thickL < ELEV_EPS && thickR < ELEV_EPS) {
    sbump('bail-zero-thickness')
    return false
  }

  // A 2-corr unit reaching here is a band member that should have been excluded upstream (it is
  // carried by its band contour). Refuse defensively so a band is never double-tiled — this is
  // NOT the retired interval-level shape bail; it is a contract check that never fires on real data.
  for (const u of [...leftUnits, ...rightUnits]) {
    if (u.corr.corr === 2) {
      sbump('bail-corr2')
      return false
    }
  }

  // All-or-nothing buffer (ruling 7): emit the whole interval into a scratch buffer + label patch,
  // merge into ``out`` / ``lensLabels`` only on full success. A partial emit + the caller's seam
  // fallback would double-cover.
  const buf: InputCurve[] = []
  const labelPatch = new Map<string, LensLabel>()

  const leftConverges = thickL < CONVERGE_EPS
  const rightConverges = thickR < CONVERGE_EPS

  const leftSide: SideGeom = {
    side: 'left', col: left, facing: right, ownX: left.x, facingX: right.x,
    iTop: iTopL, iBase: iBaseL, facingTop: iTopR, facingBase: iBaseR,
    facingConverges: rightConverges, units: leftUnits, lenses: leftLenses,
  }
  const rightSide: SideGeom = {
    side: 'right', col: right, facing: left, ownX: right.x, facingX: left.x,
    iTop: iTopR, iBase: iBaseR, facingTop: iTopL, facingBase: iBaseL,
    facingConverges: leftConverges, units: rightUnits, lenses: rightLenses,
  }

  // CONVERGING FACING (ruling 8h(a) — NO BAIL): one side has ~0 thickness. That side's units
  // (if any) pinch toward THEIR convergence point; the OTHER (real-thickness) side's units pinch
  // toward THE FACING convergence point ``conv`` via the proven per-unit primitives. The
  // enclosing floods the wedge past each tip (``emitLonePinch`` / ``emitSharedContactOnlap``,
  // both hole-free for a converging facing — the same geometry ``routeLoneSidePinch`` emits).
  if (leftConverges !== rightConverges) {
    const present = leftConverges ? rightSide : leftSide
    // The converging side has zero own thickness — it contributes no slab; only the present side's
    // units terminate. Emit the present side's terminations toward the convergence point.
    if (!emitConvergingSide(present, top, base, nextId, nextFloodId, labelPatch, buf)) {
      sbump('bail-converging')
      return false
    }
    // The converging side may still carry an enclosed lens (rare) — keep it as its own notch,
    // apex toward its own facing column at the 8b-capped fraction.
    const convSide = leftConverges ? leftSide : rightSide
    for (const u of convSide.lenses) {
      emitLensClosing(u, convSide.ownX, convSide.facingX, SEAM_FRACTION, nextId, buf)
    }
    sbump('fired-converging')
    commit(buf, labelPatch, out, lensLabels)
    return true
  }

  // BOTH sides real thickness (or both lone/empty on their span): the MEET-AT-SEAM slab
  // construction. Each side's units fill their own slabs from their column to the shared 0.5
  // seam; a lone (empty) side floods its whole half from its own column's continuous matrix.
  //
  // CONSTRUCTION-SAFETY (not a shape bail): the slab decomposition is hole-free only when each
  // side's units span their own interval contiguously (top ≈ iTop, base ≈ iBase, no internal
  // gap) OR the side is empty (the facing floods it). A non-contiguous two-sided interval would
  // leave an uncovered strip between a unit's base and the next unit's top; refuse it (the
  // caller keeps the seam for it during bring-up). This is a geometry guarantee, distinct from
  // the retired ruling-8h interval-level shape classification.
  if (!spans(leftUnits, iTopL, iBaseL) || !spans(rightUnits, iTopR, iBaseR)) {
    sbump('bail-nospan')
    return false
  }
  const seamX = left.x + SEAM_FRACTION * (right.x - left.x)
  const seamElevAtT = (t: number): number => {
    const loneE = iTopL + t * (iBaseL - iTopL)
    const facingE = iTopR + t * (iBaseR - iTopR)
    return loneE + SEAM_FRACTION * (facingE - loneE)
  }
  const seamElevAtElev = (side: 'left' | 'right', e: number): number => {
    const iTop = side === 'left' ? iTopL : iTopR
    const iBase = side === 'left' ? iBaseL : iBaseR
    const span = iTop - iBase
    const t = span < ELEV_EPS ? 0 : (iTop - e) / span
    return seamElevAtT(t)
  }

  const pushClose = (id: string, points: Point[]): void => {
    buf.push({ id, kind: 'closing', points })
  }
  const pushFlood = (label: LensLabel, points: Point[]): void => {
    const id = nextFloodId()
    labelPatch.set(id, label)
    buf.push({ id, kind: 'closing', points })
  }

  // The ONE shared seam line (top → base at the seam x). It separates the two sides.
  buf.push({
    id: `close${nextId()}`,
    kind: 'closing',
    points: [{ x: seamX, y: seamElevAtT(0) }, { x: seamX, y: seamElevAtT(1) }],
  })

  for (const s of [leftSide, rightSide]) {
    if (!emitSideSlabs(s, seamX, seamElevAtElev, nextId, pushClose, pushFlood, labelPatch)) {
      sbump('bail-side')
      return false
    }
  }

  // Enclosed lenses keep their own 0.45 / 8b apex (their matrix band is the flood/seam fill).
  for (const u of leftLenses) emitLensClosing(u, left.x, right.x, SEAM_FRACTION, nextId, buf)
  for (const u of rightLenses) emitLensClosing(u, right.x, left.x, SEAM_FRACTION, nextId, buf)

  sbump('fired')
  commit(buf, labelPatch, out, lensLabels)
  return true
}

/** Merge the scratch buffer + label patch into the real accumulators (all-or-nothing, ruling 7). */
function commit(
  buf: readonly InputCurve[],
  labelPatch: ReadonlyMap<string, LensLabel>,
  out: InputCurve[],
  lensLabels: Map<string, LensLabel>,
): void {
  for (const [k, v] of labelPatch) lensLabels.set(k, v)
  out.push(...buf)
}

/**
 * Whether a side's units span [iTop..iBase] contiguously (top ≈ iTop, base ≈ iBase, no internal
 * gap). An EMPTY side (lone) spans vacuously (the facing floods it). Used ONLY as the two-sided-
 * thick meet-at-seam construction-safety guard (the converging / lone paths do not require it).
 */
function spans(units: readonly CorrUnit[], iTop: number, iBase: number): boolean {
  if (iTop - iBase < ELEV_EPS) return true
  if (units.length === 0) return true // lone side — the facing enclosing floods it.
  const sorted = [...units].sort((a, b) => b.iu.topElev - a.iu.topElev)
  if (Math.abs(sorted[0].iu.topElev - iTop) > 0.02) return false
  if (Math.abs(sorted[sorted.length - 1].iu.baseElev - iBase) > 0.02) return false
  for (let k = 0; k + 1 < sorted.length; k++) {
    if (Math.abs(sorted[k].iu.baseElev - sorted[k + 1].iu.topElev) > 0.02) return false
  }
  return true
}

/**
 * Emit the CONVERGING-FACING case for the present (real-thickness) side (ruling 8h(a) — the
 * retired session-7 bail). Each present-side unit terminates toward the facing CONVERGENCE POINT
 * by its own effective corr, the enclosing flooding the wedge past the tip:
 *
 *   - 1-corr (a shared-contact onlap, its top OR base riding a tied bracket) → ``emitSharedContactOnlap``
 *     (tip 0.5 on the tie; the enclosing on the UNTIED side floods the wedge, hole-free — the
 *     exact ``routeLoneSidePinch`` converging construction).
 *   - 0-corr (untied) → ``emitLonePinch`` ``forceLens`` (0.45 own-elevation lens; the above/below
 *     enclosing floods both wedges to ``conv``, hole-free by construction).
 *
 * A single present-side unit is the common case (the mixed-bracket minority against a converging
 * facing). A multi-unit present side is emitted unit-by-unit against its OWN adjacency enclosing
 * (from the present column's bracket lithology). Returns ``false`` only when no enclosing matrix
 * can be found for a unit (then the caller bails the interval — rare, a genuine data void).
 */
function emitConvergingSide(
  s: SideGeom,
  top: LonePinchBracket,
  base: LonePinchBracket,
  nextId: () => string,
  nextFloodId: () => string,
  labelPatch: Map<string, LensLabel>,
  buf: InputCurve[],
): boolean {
  const sorted = [...s.units].sort((a, b) => b.iu.topElev - a.iu.topElev)
  if (sorted.length === 0) {
    // No present-side units either — a fully-degenerate interval (both converge). Nothing to emit.
    return true
  }
  // MULTI-UNIT present side against a converging facing (TARGET 1, session 10 — ruling 8h phases
  // 1-2 UNCONDITIONAL per-unit lens emission). Session 8 BAILED here because N independent
  // ``emitLonePinch`` pinch wedges sharing ``conv`` overlap/gap at their shared edges (sessions 4/5
  // measured +457 holes / +666 overlaps). The fix is the SESSION-6 SLAB CONSTRUCTION generalised to
  // a converging facing (``emitConvergingStack``): each unit gets its OWN 8b-capped lens notch
  // biting its column edge, adjacent notches SEPARATED by horizontal boundary seams (loneX→apex
  // line), and the enclosing matrix floods the residue past the apex line to ``conv`` — one
  // coherent hole-free face set, NOT independent wedges (owner's CS1 walkthrough: the 0-corr
  // unit-sides in a stack facing a converging side each get their generated lens). Bails (keeps the
  // seam) only when the enclosing matrix cannot be determined — never suppressing the terminations
  // for a shape it CAN close.
  if (sorted.length > 1) {
    return emitConvergingStack(s, sorted, nextId, nextFloodId, labelPatch, buf)
  }
  for (const cu of sorted) {
    // The enclosing lithology above / below THIS unit, sampled from the FACING column at the
    // unit's own top / base elevation (the facing carries the enclosing matrix across the
    // converging bracket). ``facingMatrixLabel`` picks the facing unit whose span contains the
    // sample elevation (nearest-fallback otherwise).
    const aboveMatrix = facingMatrixLabel(s.facing, cu.iu.topElev + ELEV_EPS)
    const belowMatrix = facingMatrixLabel(s.facing, cu.iu.baseElev - ELEV_EPS)
    if (aboveMatrix === null || belowMatrix === null) return false
    const baseTied = cu.corr.baseTied && !cu.corr.topTied
    const topTied = cu.corr.topTied && !cu.corr.baseTied
    // ``emitSharedContactOnlap`` floods the wedge from the unit's own column to the facing
    // convergence — against a NON-anchor (surface) bracket that would invent a full-width band up
    // to the surface (the CS1 g8 KLEI-to-surface symptom, emitLonePinch doc). Fire the onlap ONLY
    // for an INTERIOR minority between two REAL tied brackets; else the unit lenses (below).
    const interiorOnlap = cu.corr.corr === 1 && (baseTied || topTied) && top.anchor && base.anchor
    if (interiorOnlap) {
      // 1-corr shared-contact onlap: tip 0.5 on the tied bracket; the UNTIED-side enclosing (that
      // differs from the unit) floods the wedge. ``chooseOnlapEnclosing`` picks the differing
      // bracket enclosing (never the unit's own formation — that would re-merge).
      const enclosing = chooseOnlapEnclosing(cu.iu.unit.formationId, baseTied, aboveMatrix, belowMatrix)
      // ``emitSharedContactOnlap`` uses the shared ``labelPatch`` for its flood/pinch labels; it
      // reads the bracket ``top``/``base`` elevations to build the wedge to ``conv``.
      emitSharedContactOnlap(
        cu.iu, s.side, s.ownX, s.facingX, top, base, baseTied, enclosing,
        nextId, nextFloodId, labelPatch, buf,
      )
    } else if (aboveMatrix.formationId !== belowMatrix.formationId) {
      // 0-corr MIXED-bracket lens (above ≠ below): a 0.45 own-elevation lens; the above matrix
      // floods the top wedge to ``conv``, the below the base wedge (``emitLonePinch`` mixed branch,
      // hole-free by construction). ``forceLens`` pins the apex to the unit's own mid-elevation so
      // a dipping bracket cannot collapse it full-width.
      emitLonePinch(
        [cu.iu], s.side, s.ownX, s.facingX, top, base, aboveMatrix, belowMatrix,
        nextId, nextFloodId, labelPatch, buf, undefined, undefined, true,
      )
    } else {
      // SAME-FORMATION enclosure (above === below): the unit's slot is ALREADY filled by the
      // enclosing quad that spans the gap at this elevation (a same-formation lens-in-continuous-
      // matrix). An additive lens here DOUBLE-COVERS that quad (the notch rides the column edge,
      // holes=0, so the arrangement never separates it — the ``splitAnnulus``-bypass wall,
      // measured +1.6 cm CS1 g20/g21). This class is the COLUMN-level enclosed-lens extraction's
      // job (or the per-gap-edged residual); the converging sweep must NOT emit it. Bail the whole
      // interval so it keeps the seam (the pre-existing ``absent`` residual — NOT a new overlap).
      return false
    }
  }
  return true
}

/**
 * Emit one side's meet-at-seam slab decomposition (the session-6/7 construction, ruling 8g/8h):
 * for each own-side unit, its termination toward the shared seam + the horizontal boundary seam
 * to the next unit. A lone (empty) side floods its whole half from its OWN column's continuous
 * matrix. Phase order within the slab is automatic: a 0-corr slab's boundaries are plain
 * ``close`` (the reach classifier reads a lens by geometry); a 1-corr slab carries an ``onlap``
 * edge on its tied contact (so the face reads ONLAP).
 *
 * Returns ``false`` when a lone side has no enclosing to flood the residue (the caller bails).
 */
function emitSideSlabs(
  s: SideGeom,
  seamX: number,
  seamElevAtElev: (side: 'left' | 'right', e: number) => number,
  nextId: () => string,
  pushClose: (id: string, points: Point[]) => void,
  pushFlood: (label: LensLabel, points: Point[]) => void,
  labelPatch: Map<string, LensLabel>,
): boolean {
  const { side, ownX, iTop, iBase } = s
  const sorted = [...s.units].sort((a, b) => b.iu.topElev - a.iu.topElev)

  // LONE side (empty): this side is the ENCLOSING side — its OWN column carries the continuous
  // matrix M across the interval (the units here were excluded as tied/banded). M floods this half
  // from THIS side's own column vertical to the shared seam. Sample M from this side's own column
  // at the interval mid-elevation.
  if (sorted.length === 0) {
    const mid = (iTop + iBase) / 2
    const enclosing = facingMatrixLabel(s.col, mid)
    if (enclosing === null) return false
    pushFlood(enclosing, [
      { x: ownX, y: iTop },
      { x: ownX, y: iBase },
    ])
    return true
  }

  const label = (u: CorrUnit): LensLabel => ({ formationId: u.iu.unit.formationId, bodyId: u.iu.unit.bodyId })

  // Per-unit horizontal boundary seams (own column → seam) at every INTERNAL contact so each slab
  // is closed top/base and reads its own litho (the outer brackets close the top slab's top and
  // the bottom slab's base). Each carries the slab-BELOW's label so the face keeps its own litho.
  for (let k = 0; k + 1 < sorted.length; k++) {
    const e = sorted[k].iu.baseElev // = sorted[k+1].iu.topElev (contiguity checked upstream)
    if (e > iTop - ELEV_EPS || e < iBase + ELEV_EPS) continue
    pushLabelledClose(label(sorted[k]), [{ x: ownX, y: e }, { x: seamX, y: seamElevAtElev(side, e) }], nextId, pushClose, labelPatch)
  }

  // The onlap edges (1-corr) that ride a tie carry an ``onlap`` id so the slab reads ONLAP and the
  // arrangement counts the tie. Emit a coincident onlap-id marker on the tied contact (top/base).
  for (const u of sorted) {
    if (u.corr.corr === 1) {
      const baseTied = u.corr.baseTied && !u.corr.topTied
      const e = baseTied ? u.iu.baseElev : u.iu.topElev
      if (e > iBase - ELEV_EPS && e < iTop + ELEV_EPS) {
        pushClose(`onlap${nextId()}`, [{ x: ownX, y: e }, { x: seamX, y: seamElevAtElev(side, e) }])
      }
    }
  }
  return true
}

/**
 * Push a ``close`` curve with an allocated id and record its own-litho label so the pinch face
 * keeps its lithology (not the enclosing flood).
 */
function pushLabelledClose(
  label: LensLabel,
  points: Point[],
  nextId: () => string,
  pushClose: (id: string, points: Point[]) => void,
  labelPatch: Map<string, LensLabel>,
): void {
  const id = `close${nextId()}`
  labelPatch.set(id, label)
  pushClose(id, points)
}
