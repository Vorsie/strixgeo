/**
 * partitionFillV2/seedClassifier.ts — the ONE shared seed classifier (SEED_FILL_MANDATE
 * "The one invariant"). Extracted from the Step-1 measured seed gate so the gate AND the
 * flag-ON engine paint path resolve seeds through the SAME implementation — no drift.
 *
 * THE INVARIANT (mandate). For every bounded (non-exterior) arrangement face inside the
 * fillable model domain, BEFORE slicing to gaps:
 *
 *   1. Inspect the face's actual boundary EDGES that come from ``col<ci>:u<ui>``
 *      column-vertical curves. A vertex TOUCH is not a seed — the face must own a
 *      NON-ZERO-LENGTH column-edge segment (measured on the traced polygon against the
 *      arrangement half-edges).
 *   2. Resolve those column edges to the picked units' ``formationId`` (bodyId is
 *      irrelevant — the invariant concerns distinct FORMATION ids only; many column
 *      segments / many body ids are allowed).
 *   3. Deduplicate formation ids.
 *
 * The only legal result is EXACTLY ONE formation id -> ``single-seed``. Zero formations ->
 * ``explicit-void`` (narrow + geometric: geometrically outside the fillable domain) OR
 * ``zero-seed-defect`` (a face INSIDE the fillable domain with no column-edge seed ->
 * missing/open topology). Two-or-more formations -> ``multi-seed-defect`` (a missing /
 * crossed / wrong separator line).
 *
 * IMPORTANT: ``explicit-void`` is GEOMETRIC ONLY. It never means "the old code had no
 * label" and never means "below TD, so guess it". A sub-TD face that overlaps a real
 * column's drilled elevation is fillable domain and, if seedless, a defect.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { columnDeepestBase } from './columnMetrics'
import { type ColumnGeom } from './sectionGeom'
import { SNAP_GRID_M, type Arrangement, type Face } from './types'

/** ``col<ci>:u<ui>`` column-vertical curve id pattern — the primary seed vocabulary. */
export const COL_SEED_RE = /^col(\d+):u(\d+)$/

/**
 * ``col<ci>:lens<j>`` enclosed-lens sub-segment curve id pattern (ruling 8r / Step 4.1 — the
 * COLUMN-VERTICAL ID SPLIT). Emitted flag-ON by ``emitColumnVerticals`` for the lens interval of
 * a merged host's column vertical, so an enclosed interbed's OWN face carries its RAW litho as a
 * genuine single seed instead of the enclosing matrix (the ``merged-minority`` artifact). Resolves
 * to ``columns[ci].enclosedLenses[j].lens.formationId`` (``formationOfRef``).
 */
export const COL_LENS_SEED_RE = /^col(\d+):lens(\d+)$/

/** Whether a curve id is ANY column-vertical seed (a real ``col:u`` face or a ``col:lens`` sub-segment). */
export function isColumnSeedId(id: string): boolean {
  return COL_SEED_RE.test(id) || COL_LENS_SEED_RE.test(id)
}

/**
 * A face-boundary column-edge must be at least this long (metres) to count as a SEED. Below
 * the 1 mm snap grid a "segment" is a vertex touch, not an owned edge — the mandate's "a
 * vertex touch is not a seed". One snap unit is the smallest meaningful length; require
 * strictly more than that.
 */
export const MIN_SEED_EDGE_M = SNAP_GRID_M + 1e-9

/** Classification of a face under the seed invariant. */
export type SeedClass = 'single-seed' | 'explicit-void' | 'zero-seed-defect' | 'multi-seed-defect'

/** The x/elevation bounding box of a face. */
export interface FaceBounds {
  xLo: number
  xHi: number
  elLo: number
  elHi: number
}

/** The full seed record of one face — the classifier's output. */
export interface SeedResult {
  classification: SeedClass
  /** The NON-ZERO-LENGTH ``col<ci>:u<ui>`` seed refs on this face's boundary (sorted). */
  seedRefs: string[]
  /** Distinct seed FORMATION ids (bodyId irrelevant), sorted. */
  seedFormations: string[]
  bounds: FaceBounds
}

/** Snapped-integer key for a metres x elevation point (matches the arrangement snap grid). */
function ptKey(x: number, y: number): string {
  return `${Math.round(x / SNAP_GRID_M)},${Math.round(y / SNAP_GRID_M)}`
}

/** Undirected segment key from two point keys. */
function segKey(ka: string, kb: string): string {
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
}

/**
 * Build an undirected-segment -> curveIds map from the arrangement half-edges. Every traced
 * face polygon edge is one snapped segment; this recovers WHICH input curve contributed a
 * face-boundary edge (the ``Face.boundingCurveIds`` aggregate cannot — it has no per-edge
 * provenance and cannot tell a non-zero-length column edge from a mere vertex touch).
 *
 * Parameters
 * ----------
 * arr : Arrangement
 *     The built arrangement (its half-edges carry the per-segment curve ids).
 *
 * Returns
 * -------
 * Map<string, string[]>
 *     Undirected snapped-segment key -> the input curve ids that contributed it.
 */
export function buildSegCurveMap(arr: Arrangement): Map<string, string[]> {
  const m = new Map<string, string[]>()
  for (const he of arr.halfEdges) {
    const a = arr.vertices[he.origin]
    const b = arr.vertices[he.target]
    const ka = ptKey(a.x, a.y)
    const kb = ptKey(b.x, b.y)
    if (ka === kb) continue
    m.set(segKey(ka, kb), he.curveIds)
  }
  return m
}

/** Metres length of a face polygon edge. */
function edgeLen(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay)
}

/** The x/elevation bounding box of a traced face's outer ring. */
export function faceBounds(face: Face): FaceBounds {
  let xLo = Infinity
  let xHi = -Infinity
  let elLo = Infinity
  let elHi = -Infinity
  for (const p of face.polygon) {
    if (p.x < xLo) xLo = p.x
    if (p.x > xHi) xHi = p.x
    if (p.y < elLo) elLo = p.y
    if (p.y > elHi) elHi = p.y
  }
  return { xLo, xHi, elLo, elHi }
}

/**
 * The NON-ZERO-LENGTH column-edge seed refs on a face's boundary, per the invariant (step 1).
 * Walks every consecutive polygon-edge (outer ring), maps it to its input curve via the
 * segment->curve map, and keeps a ``col<ci>:u<ui>`` ref only when THAT edge's own length
 * exceeds the snap floor. A vertex touch (a column curve id present in ``boundingCurveIds``
 * but with no non-zero owned edge) is NOT a seed and is excluded — the point of the invariant.
 *
 * Parameters
 * ----------
 * face : Face
 *     A traced arrangement face.
 * segCurve : Map<string, string[]>
 *     The segment->curve map from ``buildSegCurveMap``.
 *
 * Returns
 * -------
 * string[]
 *     Sorted distinct ``col<ci>:u<ui>`` refs owning a non-zero edge on the face boundary.
 */
export function seedRefsOfFace(face: Face, segCurve: Map<string, string[]>): string[] {
  const refs = new Set<string>()
  const ring = face.polygon
  const n = ring.length
  for (let i = 0; i < n; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % n]
    if (edgeLen(a.x, a.y, b.x, b.y) <= MIN_SEED_EDGE_M) continue
    const ids = segCurve.get(segKey(ptKey(a.x, a.y), ptKey(b.x, b.y)))
    if (!ids) continue
    for (const id of ids) if (isColumnSeedId(id)) refs.add(id)
  }
  return resolveNotchLensRefs([...refs]).sort()
}

/**
 * RULING 8r / STEP 4.1 — the NOTCH-vs-HOLE seed resolution. The enclosed-lens id split
 * (``emitColumnVerticals``) gives the lens interval its own ``col<ci>:lens<j>`` column edge so an
 * INTERIOR-HOLE lens's OWN face (bounded ONLY by that edge + its flanks) seeds its RAW interbed
 * litho — the clean win (54 merged-minority artifacts → genuine single-seed interbed faces).
 *
 * A NOTCH lens (the merged matrix pinches before reaching the facing) rides its own column edge as a
 * concave bite; the arrangement CANNOT separate the lens's own triangle from the enclosing matrix's
 * host piece, so ONE face carries BOTH the ``col:lens`` edge AND a host ``col:u`` edge. On that face
 * the ``col:lens`` edge is a shared notch boundary, NOT a seed: the matrix host owns the notch region
 * (the pre-existing behaviour — the interbed was already absorbed into the matrix flood there, the
 * §49 notch/annulus wall). So the rule is purely structural + geometric, no interior-hole/notch guess
 * at emission: if a face carries ANY host ``col:u`` edge, its ``col:lens`` edges are dropped (matrix
 * wins); a face carrying ONLY ``col:lens`` edges is the interior-hole lens's own face (interbed wins).
 * This keeps interior holes single-seeded as their interbed AND notch faces single-seeded as their
 * matrix — no multi-seed inflation, no merged-minority residual.
 */
export function resolveNotchLensRefs(refs: readonly string[]): string[] {
  const hasHost = refs.some((r) => COL_SEED_RE.test(r))
  if (!hasHost) return [...refs]
  return refs.filter((r) => !COL_LENS_SEED_RE.test(r))
}

/**
 * Resolve a column-vertical seed ref to its unit's formationId (or null when out of range). Two
 * forms: ``col<ci>:u<ui>`` -> ``columns[ci].units[ui].formationId``; ``col<ci>:lens<j>`` (the
 * ruling-8r id split) -> ``columns[ci].enclosedLenses[j].lens.formationId`` (the RAW interbed litho).
 */
export function formationOfRef(ref: string, columns: readonly ColumnGeom[]): string | null {
  const mu = COL_SEED_RE.exec(ref)
  if (mu) {
    const u = columns[Number(mu[1])]?.units[Number(mu[2])]
    return u ? u.formationId : null
  }
  const ml = COL_LENS_SEED_RE.exec(ref)
  if (ml) {
    const el = columns[Number(ml[1])]?.enclosedLenses[Number(ml[2])]
    return el ? el.lens.formationId : null
  }
  return null
}

/**
 * The ruling-8r merge-artifact test (SEED_FILL_MANDATE Steps 2+3): whether a single-seed enclosed-
 * lens face's seed was manufactured BY the same-column enclosed-lens merge and is therefore
 * ILLEGITIMATE linework — not a valid seed. It is a merge-artifact ONLY when some seed edge belongs
 * to a column that HOSTS an enclosed lens whose ``formationId`` == the face's recorded minority AND
 * whose recorded ``matrixFormationId`` == the seed formation. That triple (same host column +
 * minority match + matrix match) is the merge's exact fingerprint: ``extractEnclosedLenses`` deleted
 * the minority unit from that column and merged the enclosing matrix above+below into one band, so
 * the lens face's only surviving column edge is that merged matrix.
 *
 * This deliberately EXCLUDES a foreign lens biting a matrix notch (the seed column hosts NO such
 * lens -> its column edge is a REAL seed, e.g. CS1#11's SILT), and a lens whose seed already equals
 * its minority (handled as ordinary agreement upstream).
 *
 * Parameters
 * ----------
 * seedRefs : readonly string[]
 *     The face's ``col<ci>:u<ui>`` seed refs.
 * seedFormation : string
 *     The single resolved seed formation (the candidate merged matrix).
 * minorityFormation : string
 *     The face's recorded enclosed-lens minority litho (the ``lensLabel`` formation).
 * columns : readonly ColumnGeom[]
 *     Section columns (their ``enclosedLenses`` carry the merge provenance).
 *
 * Returns
 * -------
 * boolean
 *     True when the seed is a merge artifact (-> ``merged-minority`` defect, keep the minority paint).
 */
export function isMergeArtifactSeed(
  seedRefs: readonly string[],
  seedFormation: string,
  minorityFormation: string,
  columns: readonly ColumnGeom[],
): boolean {
  for (const ref of seedRefs) {
    const m = COL_SEED_RE.exec(ref)
    if (!m) continue
    const col = columns[Number(m[1])]
    if (!col) continue
    for (const el of col.enclosedLenses) {
      if (el.lens.formationId === minorityFormation && el.matrixFormationId === seedFormation) return true
    }
  }
  return false
}

/** Piecewise-linear interpolation of a per-column value across the section x axis. */
function interpAcross(x: number, xs: readonly number[], vals: readonly number[]): number {
  if (xs.length === 0) return 0
  if (x <= xs[0]) return vals[0]
  if (x >= xs[xs.length - 1]) return vals[vals.length - 1]
  for (let i = 0; i + 1 < xs.length; i++) {
    if (x >= xs[i] && x <= xs[i + 1]) {
      const t = (x - xs[i]) / (xs[i + 1] - xs[i] || 1)
      return vals[i] + t * (vals[i + 1] - vals[i])
    }
  }
  return vals[vals.length - 1]
}

/**
 * Per-section fillable envelope: the top-band line and the deepest floor, sampled per column, so
 * the per-face void test interpolates precomputed arrays instead of rebuilding them on every face.
 */
export interface VoidEnvelope {
  /** Column x positions, left to right (the interpolation abscissa). */
  xs: number[]
  /** Per-column top-band elevation (first-litho top, else surface) at each column x. */
  topBandVals: number[]
  /** Per-column deepest base elevation (the substrate floor) at each column x. */
  floorVals: number[]
}

/**
 * Build the per-section fillable envelope ONCE — the top-band line + the deepest floor per column.
 * Hoisted out of ``isExplicitVoidGeometric`` so the per-face void test reads these precomputed
 * arrays instead of rebuilding ``columns.map(...)`` on every face lookup. The values are
 * byte-identical to the former inline expressions (top band ``units[0]?.topElev ?? surfaceElevM``;
 * floor ``columnDeepestBase``), so the seed classification is unchanged.
 *
 * Parameters
 * ----------
 * columns : readonly ColumnGeom[]
 *     The normalised section columns (their x + unit stacks define the envelope).
 *
 * Returns
 * -------
 * VoidEnvelope
 *     The precomputed abscissa + top-band + floor arrays, index-aligned to ``columns``.
 */
export function buildVoidEnvelope(columns: readonly ColumnGeom[]): VoidEnvelope {
  return {
    xs: columns.map((c) => c.x),
    topBandVals: columns.map((c) => c.units[0]?.topElev ?? c.surfaceElevM),
    floorVals: columns.map((c) => columnDeepestBase(c)),
  }
}

/**
 * Whether a zero-seed face lies GEOMETRICALLY OUTSIDE the fillable model domain (-> explicit
 * void). Narrow + geometric, per the mandate: a void is a face whose whole extent sits ABOVE
 * the local top-band (the strip between ground and first-litho, deliberately empty) OR BELOW
 * the deepest bracketing column TD / substrate floor. It is NEVER "no old label" and NEVER
 * "below TD, so guess it" — a sub-TD face that overlaps a real column's drilled elevation is
 * fillable domain and, if seedless, a defect.
 *
 * The fillable envelope at along-x is [deepestBaseElev, topBandElev] interpolated between the
 * two bracketing columns. A face entirely above topBand is the empty top strip; a face
 * entirely below the deepest TD floor is below the model. Anything overlapping the envelope
 * interior is fillable.
 *
 * Parameters
 * ----------
 * bounds : FaceBounds
 *     The face's x/elevation bounding box.
 * env : VoidEnvelope
 *     The per-section envelope from ``buildVoidEnvelope`` (built once per section).
 *
 * Returns
 * -------
 * boolean
 *     True when the face is geometrically outside the fillable envelope (explicit void).
 */
export function isExplicitVoidGeometric(bounds: FaceBounds, env: VoidEnvelope): boolean {
  const topBandAt = (x: number): number => interpAcross(x, env.xs, env.topBandVals)
  const floorAt = (x: number): number => interpAcross(x, env.xs, env.floorVals)
  // A void must be outside at BOTH x-extent endpoints (conservative).
  const aboveTopBand =
    bounds.elLo >= topBandAt(bounds.xLo) - 1e-6 && bounds.elLo >= topBandAt(bounds.xHi) - 1e-6
  const belowFloor =
    bounds.elHi <= floorAt(bounds.xLo) + 1e-6 && bounds.elHi <= floorAt(bounds.xHi) + 1e-6
  return aboveTopBand || belowFloor
}

/**
 * Classify ONE face under the seed invariant (the shared entry point).
 *
 * Parameters
 * ----------
 * face : Face
 *     A traced arrangement face.
 * segCurve : Map<string, string[]>
 *     The segment->curve map from ``buildSegCurveMap`` (built once per arrangement).
 * columns : readonly ColumnGeom[]
 *     The normalised section columns (so a ``col<ci>:u<ui>`` id resolves to a unit).
 * env : VoidEnvelope, optional
 *     The per-section fillable envelope from ``buildVoidEnvelope``. Pass it once per section (the
 *     face loop builds it before iterating) so the void test does not rebuild it per face; omitted,
 *     it is built from ``columns`` on the call (correct, just not hoisted).
 *
 * Returns
 * -------
 * SeedResult
 *     The face's classification + seed refs + distinct seed formations + bounds.
 */
export function classifyFaceSeed(
  face: Face,
  segCurve: Map<string, string[]>,
  columns: readonly ColumnGeom[],
  env: VoidEnvelope = buildVoidEnvelope(columns),
): SeedResult {
  const seedRefs = seedRefsOfFace(face, segCurve)
  const seedFormations = [
    ...new Set(seedRefs.map((r) => formationOfRef(r, columns)).filter((f): f is string => f != null)),
  ].sort()
  const bounds = faceBounds(face)
  let classification: SeedClass
  if (seedFormations.length === 1) classification = 'single-seed'
  else if (seedFormations.length >= 2) classification = 'multi-seed-defect'
  else classification = isExplicitVoidGeometric(bounds, env) ? 'explicit-void' : 'zero-seed-defect'
  return { classification, seedRefs, seedFormations, bounds }
}

/**
 * The RESOLUTION CLASS of a ``zero-seed-defect`` face (SEED_FILL_MANDATE Step-4, session 50). A
 * zero-seed face carries NO column-edge seed, so the ``single formation`` invariant cannot resolve
 * it from a picked column — but it is NOT a render defect: it is a doctrine-scaffold face already
 * correctly painted (``paintMismatch === 0`` on all 94 real ones) by ONE of the fill doctrines. This
 * RECORDS which doctrine legitimately owns it, so the seed gate's "unresolved zero-seed" tally drops
 * to the genuinely-undecided (owner-ambiguous) faces only. RECORDING ONLY — it changes no geometry,
 * no ``SeedClass``, no paint: ``labelFaces`` still keeps the interim doctrine paint (this classifies
 * the SAME face after the fact). The four classes:
 *
 *   - ``carry-seed`` (ruling 8n) — a SUBSTRATE face (``btfloor``/``btcurtain``): the deep-to-deep
 *     band∩column intersect carried straight down IS the seed. UNREACHABLE since 2026-10-04: the
 *     flat-floor substrate that emitted those curves is retired (owner, "no tie, no band"); the
 *     class is kept so the recorded seed-gate tallies keep their vocabulary.
 *   - ``unterminated-litho`` (ruling 8o) — a FLOOD face (``floodsw``/``flood``) whose boundary
 *     carries EXACTLY ONE unterminated lithology (the enclosing fill the hole fills with). The flood
 *     curves on the boundary resolve to a single formation → that IS the 8o answer, unambiguous.
 *   - ``band-contour`` — a matched-pair-band / top-band contour face (``bandc``/``surface`` only, no
 *     column edge): the band's own contour owns it; traced + classified as the band litho.
 *   - ``owner-ambiguous`` (ruling 8o's OWN ask-clause) — a flood face whose boundary carries ZERO or
 *     MORE THAN ONE unterminated lithology, or a genuinely unlabelled (``empty``) hole. Ruling 8o:
 *     "if a hole's boundary carries ZERO or MORE THAN ONE unterminated lithology, ASK the owner,
 *     never pick." Listed by identity for the owner — never guessed.
 */
export type ZeroSeedResolution =
  | 'carry-seed'
  | 'unterminated-litho'
  | 'band-contour'
  | 'owner-ambiguous'

/**
 * Resolve the doctrine that legitimately owns a ``zero-seed-defect`` face (see
 * ``ZeroSeedResolution``). Reads ONLY the face's boundary curve ids + a flood-label resolver — no
 * geometry, no paint mutation.
 *
 * Parameters
 * ----------
 * boundaryCurveIds : readonly string[]
 *     The face's ``Face.boundingCurveIds``.
 * floodFormationOf : (curveId: string) => string | null
 *     Resolves a ``floodsw``/``flood`` curve id to its enclosing-fill formation (the caller's
 *     ``lensLabels`` lookup). ``null`` for a non-flood or unlabelled curve.
 *
 * Returns
 * -------
 * ZeroSeedResolution
 *     The resolution class; ``owner-ambiguous`` when ruling 8o's ask-clause applies.
 */
export function resolveZeroSeedClass(
  boundaryCurveIds: readonly string[],
  floodFormationOf: (curveId: string) => string | null,
): ZeroSeedResolution {
  const has = (pfx: string): boolean => boundaryCurveIds.some((id) => id.startsWith(pfx))
  // SUBSTRATE first (ruling 8n): a sub-TD substrate wedge is seedless by construction; the carry IS
  // the seed. (A substrate face may ALSO carry a flood curve where a shallow lens holes into it, but
  // the substrate carry is the authoritative sub-TD owner, so it wins the classification.)
  if (has('btfloor') || has('btcurtain')) return 'carry-seed'
  // FLOOD (ruling 8o): the hole fills with the UNTERMINATED lithology. Read every flood curve's
  // formation; EXACTLY ONE distinct formation → unambiguous ``unterminated-litho``. Zero or more
  // than one → ruling 8o's ask-clause → ``owner-ambiguous`` (listed, never guessed).
  // ``bandseam`` (the ruling-8d mismatched midpoint seam) is grouped with the flood curves here so
  // zero-seed resolution stays byte-identical to when the seam was ``flood``-prefixed. It carries no
  // formation (``floodFormationOf`` returns null), matching the old label-less flood seam exactly —
  // the 2026-07-20 re-role is export-only and must not shift the seedGate classification.
  if (has('floodsw') || has('flood') || has('bandseam')) {
    const floodFids = new Set<string>()
    for (const id of boundaryCurveIds) {
      if (id.startsWith('floodsw') || id.startsWith('flood') || id.startsWith('bandseam')) {
        const f = floodFormationOf(id)
        if (f != null) floodFids.add(f)
      }
    }
    return floodFids.size === 1 ? 'unterminated-litho' : 'owner-ambiguous'
  }
  // BAND CONTOUR: a matched-pair band / top-band contour face — the band's own contour owns it.
  if (has('bandc') || has('surface')) return 'band-contour'
  // EMPTY: a genuinely unlabelled hole — undecided, list for the owner (ruling 8o ask-clause).
  return 'owner-ambiguous'
}
