/**
 * partitionFillV2.seedGate.diag.test.ts — THE MEASURED SEED GATE (SEED_FILL_MANDATE Step 1,
 * 2026-07-19). PERMANENT: this file becomes the flag-ON seed gate the paint-bucket rewrite is
 * built against, so it is committed-quality, not a throwaway.
 *
 * THE INVARIANT IT MEASURES (mandate "The one invariant"). For every bounded (non-exterior)
 * arrangement face inside the fillable model domain, BEFORE slicing to gaps:
 *
 *   1. Inspect the face's actual boundary EDGES that come from ``col<ci>:u<ui>`` column-vertical
 *      curves. A vertex TOUCH is not a seed — the face must own a NON-ZERO-LENGTH column-edge
 *      segment (measured on the traced polygon, keyed against the arrangement half-edges).
 *   2. Resolve those column edges to the picked units' ``formationId`` (bodyId is irrelevant —
 *      the invariant concerns distinct FORMATION ids only; many column segments / many body ids
 *      are allowed).
 *   3. Deduplicate formation ids.
 *
 * The only legal result is EXACTLY ONE formation id -> ``single-seed``. Zero formations ->
 * ``explicit-void`` (narrow + geometric: geometrically outside the fillable domain — above the
 * top-band or below the deepest column-TD / substrate floor) OR ``zero-seed-defect`` (a face
 * INSIDE the fillable domain with no column-edge seed -> missing/open topology). Two-or-more
 * formations -> ``multi-seed-defect`` (a missing/crossed/wrong separator line).
 *
 * IMPORTANT: ``explicit-void`` here is GEOMETRIC ONLY. It never means "the old code had no
 * label" and never means "below TD, so guess it". A sub-TD region that is supposed to be
 * geological fill MUST connect to a picked-unit column seed through valid linework; otherwise it
 * is a ``zero-seed-defect``, not a void.
 *
 * WHAT THIS RUN PRODUCES (Step 1 deliverables, mandate "Required evidence"):
 *   - per-section seed-count table (single / explicit-void / zero-seed-defect / multi-seed-defect);
 *   - the full face table -> scripts/diag_seed_gate.json (deterministic, compact);
 *   - the zero/multi identity lists (section / bounds / bounding curve ids / plan keys);
 *   - the single-seed-vs-CURRENT-flag-ON-paint mismatch list (every mismatch = a concrete
 *     old-label bug the seed model fixes — the current ``labelFaces`` painted formation vs the
 *     seed formation, threaded through the SAME faces);
 *   - the four known contexts classified (CS1-g3 holes, CS2-g17 holes, ``convergingStack (a)``,
 *     ``literalCorr`` (c)/(d)).
 *
 * MEASUREMENT ONLY. This diagnostic changes no engine behaviour and asserts no repair — it runs
 * the ACTUAL pre-slice pipeline flag-ON forced and records what the seed model sees, so Step 2's
 * red tests + Step 3's seed labelling can be written against proven face evidence.
 *
 * Run (desktop/):
 *   SHAPE_AUDIT=1 npx vitest run src/renderer/src/utils/partitionFillV2.seedGate.diag.test.ts --disableConsoleIntercept
 *
 * Pure test — no engine mutation leaks (flag restored in try/finally per invocation).
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  type CorrelationEdge,
  type PartitionColumn,
} from './sectionPartition'
import { buildArrangement } from './partitionFillV2/arrangement'
import { emitCurves, resolveJumpTies } from './partitionFillV2/emitCurves'
import { labelFaces } from './partitionFillV2/labelFaces'
import { buildSectionInput, type ColumnGeom } from './partitionFillV2/sectionGeom'
import { buildTerminationPlans, type TerminationPlan } from './partitionFillV2/terminationPlan'
import { detectCrossingConflicts, edgeKey } from './partitionFillV2/crossingConflicts'
import { resolveZeroSeedClass, type ZeroSeedResolution } from './partitionFillV2/seedClassifier'
import { twoSidedTerminationsEnabled, setTwoSidedTerminations } from './partitionFillV2/tileFlags'
import { SNAP_GRID_M, type Arrangement, type Face } from './partitionFillV2/types'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const INPUT = resolve(REPO_ROOT, 'scripts/diag_allsections_input.json')
const NAMES = resolve(REPO_ROOT, 'scripts/diag_shape_audit_names.json')
const DUMP = resolve(REPO_ROOT, 'scripts/diag_seed_gate.json')

// A face-boundary column-edge must be at least this long (metres) to count as a SEED. Below the
// 1 mm snap grid a "segment" is a vertex touch, not an owned edge — the mandate's "a vertex touch
// is not a seed". One snap unit is the smallest meaningful length; require strictly more than that.
const MIN_SEED_EDGE_M = SNAP_GRID_M + 1e-9

// ---------------------------------------------------------------------------
// Input shapes (mirror the extractor output).
// ---------------------------------------------------------------------------
interface RawUnit {
  layerId: string
  topDepthM: number
  baseDepthM: number
  formationId: string
  bodyId: string | null
}
interface RawCol {
  investigationId: string
  surfaceElevM: number | null
  units: RawUnit[]
}
interface RawSection {
  sectionId: string
  name: string
  columns: RawCol[]
  edges: { a: string; b: string; aSide?: string; bSide?: string }[]
  alongM: number[]
}

const COL_RE = /^col(\d+):u(\d+)$/
// ``col<ci>:lens<j>`` — the ruling-8r / Step 4.1 enclosed-lens id split (emitCurves). The lens
// interval of a merged host's column vertical carries this so the interbed's OWN face reads its
// RAW litho (``enclosedLenses[j].lens.formationId``) instead of the enclosing matrix.
const COL_LENS_RE = /^col(\d+):lens(\d+)$/

/** Classification of a face under the seed invariant. */
type SeedClass = 'single-seed' | 'explicit-void' | 'zero-seed-defect' | 'multi-seed-defect'

/** One face's full seed record (a row in the JSON dump). */
interface SeedFaceRecord {
  section: string
  faceIndex: number
  /** Stable diagnostic id: section + rounded bounds (deterministic, human-locatable). */
  diagId: string
  xLo: number
  xHi: number
  elLo: number
  elHi: number
  boundaryCurveIds: string[]
  /** The NON-ZERO-LENGTH ``col<ci>:u<ui>`` seed refs on this face's boundary. */
  seedRefs: string[]
  /** Distinct seed FORMATION ids (bodyId irrelevant). */
  seedFormations: string[]
  classification: SeedClass
  /** For a zero-seed face: which label path owns it today (substrate/flood/band-contour/empty). */
  zeroSeedFamily: string | null
  /** For a zero-seed face: its RESOLUTION CLASS (session 50 — SEED_FILL_MANDATE Step-4 recording).
   *  ``carry-seed`` (8n substrate) / ``unterminated-litho`` (8o single-litho flood) / ``band-contour``
   *  / ``owner-ambiguous`` (8o ask-clause: 0 or >1 unterminated litho, or an empty hole). Only
   *  ``owner-ambiguous`` counts as an UNRESOLVED zero-seed defect; the rest are doctrine-owned. */
  zeroSeedResolution: ZeroSeedResolution | null
  /** Termination-plan keys ``gap|side|unit`` when a plan's unit-side seeds this face. */
  planKeys: string[]
  /** The CURRENT flag-ON ``labelFaces`` painted formation for this face (or null if dropped). */
  currentPaintFormation: string | null
  /** True when single-seed AND the current paint differs from the seed formation. */
  paintMismatch: boolean
  /** Ruling-8r merged-minority keep (see SectionCounts.mergedMinority). */
  mergedMinority: boolean
}

interface SectionCounts {
  section: string
  faces: number
  single: number
  explicitVoid: number
  zeroDefect: number
  multiDefect: number
  /** Ruling-8r merged-minority keeps: a genuine enclosed lens whose single "seed" is a
   *  merge artifact — the lens litho is kept; its own ratchet class, → 0 at Step 4. */
  mergedMinority: number
  /** UNRESOLVED zero-seed faces (session 50): zero-seed faces whose resolution class is
   *  ``owner-ambiguous`` (ruling 8o ask-clause) — the only ones NOT owned by a fill doctrine. The
   *  carry-seed (8n) / unterminated-litho (8o single) / band-contour classes are RESOLVED and drop
   *  out of this tally, so ``unresolvedZeroDefect`` is what the Step-4 ratchet drives to 0. */
  unresolvedZeroDefect: number
}

// ---------------------------------------------------------------------------
// Geometry helpers.
// ---------------------------------------------------------------------------

/** Snapped-integer key for a metres x elevation point (matches the arrangement snap grid). */
function ptKey(x: number, y: number): string {
  return `${Math.round(x / SNAP_GRID_M)},${Math.round(y / SNAP_GRID_M)}`
}

/** Undirected segment key from two point keys. */
function segKey(ka: string, kb: string): string {
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
}

/**
 * Build an undirected-segment -> curveIds map from the arrangement half-edges. Every traced face
 * polygon edge is one snapped segment; this lets us recover WHICH input curve contributed a face
 * boundary edge (the ``Face.boundingCurveIds`` aggregate cannot — it has no per-edge provenance
 * and cannot tell a non-zero-length column edge from a mere vertex touch).
 */
function buildSegCurveMap(arr: Arrangement): Map<string, string[]> {
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

interface FaceBounds {
  xLo: number
  xHi: number
  elLo: number
  elHi: number
}
function faceBounds(face: Face): FaceBounds {
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
 * segment->curve map, and keeps a ``col<ci>:u<ui>`` ref only when THAT edge's own length exceeds
 * the snap floor. A vertex touch (a column curve id present in ``boundingCurveIds`` but with no
 * non-zero owned edge) is NOT a seed and is excluded — the whole point of the invariant.
 */
function seedRefsOfFace(face: Face, segCurve: Map<string, string[]>): string[] {
  const refs = new Set<string>()
  const ring = face.polygon
  const n = ring.length
  for (let i = 0; i < n; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % n]
    if (edgeLen(a.x, a.y, b.x, b.y) <= MIN_SEED_EDGE_M) continue
    const ids = segCurve.get(segKey(ptKey(a.x, a.y), ptKey(b.x, b.y)))
    if (!ids) continue
    for (const id of ids) if (COL_RE.test(id) || COL_LENS_RE.test(id)) refs.add(id)
  }
  // RULING 8r / STEP 4.1 notch-vs-hole resolution (mirrors seedClassifier.resolveNotchLensRefs):
  // a ``col:lens`` edge on a face that ALSO carries a host ``col:u`` edge is a shared NOTCH boundary,
  // not a seed — the enclosing matrix host owns the face. Only an INTERIOR-HOLE lens's own face
  // (``col:lens`` edges ONLY) seeds the interbed litho.
  const all = [...refs]
  const hasHost = all.some((r) => COL_RE.test(r))
  return (hasHost ? all.filter((r) => !COL_LENS_RE.test(r)) : all).sort()
}

/**
 * Resolve a column-vertical seed ref to its unit's formationId (or null). ``col<ci>:u<ui>`` ->
 * ``units[ui]``; ``col<ci>:lens<j>`` (the id split) -> ``enclosedLenses[j].lens`` (raw interbed litho).
 */
function formationOfRef(ref: string, columns: readonly ColumnGeom[]): string | null {
  const m = COL_RE.exec(ref)
  if (m) {
    const u = columns[Number(m[1])]?.units[Number(m[2])]
    return u ? u.formationId : null
  }
  const ml = COL_LENS_RE.exec(ref)
  if (ml) {
    const el = columns[Number(ml[1])]?.enclosedLenses[Number(ml[2])]
    return el ? el.lens.formationId : null
  }
  return null
}

/**
 * Whether a zero-seed face lies GEOMETRICALLY OUTSIDE the fillable model domain (-> explicit
 * void). Narrow + geometric, per the mandate: a void is a face whose whole extent sits ABOVE the
 * local top-band (the strip between ground and first-litho, deliberately empty) OR BELOW the
 * deepest bracketing column TD / substrate floor. It is NEVER "no old label" and NEVER "below TD,
 * so guess it" — a sub-TD face that overlaps a real column's drilled elevation is fillable domain
 * and, if seedless, a defect.
 *
 * The fillable envelope at along-x is [deepestBaseElev, topBandElev] interpolated between the two
 * bracketing columns. A face entirely above topBand (its elLo >= topBand) is the empty top strip;
 * a face entirely below the deepest TD floor (its elHi <= floor) is below the model. Anything that
 * overlaps the envelope interior is fillable.
 */
function isExplicitVoidGeometric(bounds: FaceBounds, columns: readonly ColumnGeom[]): boolean {
  const xs = columns.map((c) => c.x)
  // top-band elevation at an x = interpolate each column's FIRST unit top; floor = each column's
  // deepest base. A face above every local top-band is the empty top strip; below every local
  // floor is sub-model. Evaluate at the face's own x extent endpoints (conservative: a void must
  // be outside at BOTH ends).
  const topBandAt = (x: number): number =>
    interpAcross(x, xs, columns.map((c) => c.units[0]?.topElev ?? c.surfaceElevM))
  const floorAt = (x: number): number =>
    interpAcross(x, xs, columns.map((c) => Math.min(...c.units.map((u) => u.baseElev))))
  const aboveTopBand =
    bounds.elLo >= topBandAt(bounds.xLo) - 1e-6 && bounds.elLo >= topBandAt(bounds.xHi) - 1e-6
  const belowFloor =
    bounds.elHi <= floorAt(bounds.xLo) + 1e-6 && bounds.elHi <= floorAt(bounds.xHi) + 1e-6
  return aboveTopBand || belowFloor
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
 * The STRUCTURAL FAMILY of a zero-seed face, from the non-column curve families on its boundary.
 * This is the diagnostic teeth Step 3/4 needs: every zero-seed face today is painted (or left
 * empty) by ONE of the label paths the mandate removes as flag-ON lithology authority — this names
 * WHICH path owns it, so the repair is scoped defect-by-defect rather than "some faces are seedless".
 *
 *   - ``substrate``  — bounded by ``btfloor`` / ``btcurtain`` (the deep-to-deep sub-TD substrate
 *     wedge; painted from the bottom-tie label; seedless BY CONSTRUCTION — no column reaches sub-TD).
 *   - ``flood``      — bounded by ``floodsw`` / ``flood`` (the enclosing "fill the void with the
 *     dominant litho" flood; painted from a flood label — the mandate's forbidden authority).
 *   - ``band-contour`` — bounded by ``bandc`` / ``surface`` only (a matched-pair band or top-band
 *     contour face with no column edge — the ``resolveLabel`` / ``substrateLabel`` band quad).
 *   - ``empty``      — none of the above (a genuinely unlabelled hole; today likely dropped/absent).
 */
function zeroSeedFamily(boundaryCurveIds: readonly string[]): string {
  const has = (pfx: string): boolean => boundaryCurveIds.some((id) => id.startsWith(pfx))
  if (has('btfloor') || has('btcurtain')) return 'substrate'
  if (has('floodsw') || has('flood')) return 'flood'
  if (has('bandc') || has('surface')) return 'band-contour'
  return 'empty'
}

/**
 * The termination-plan keys whose unit-side SEEDS this face — a plan ``(gap, side, unit)`` bounds
 * the face when one of the face's ``col<ci>:u<ui>`` seed refs matches the plan's near column+unit
 * on the gap the plan looks into (left col = gapIndex, right col = gapIndex+1). This is the
 * meaningful plan<->face linkage the mandate asks for (the emitters carry no plan-key in their
 * curve ids, so the correspondence is the seed unit <-> plan unit, which the plan authority owns).
 */
function planKeysForFace(seedRefs: readonly string[], plans: readonly TerminationPlan[]): string[] {
  const keys = new Set<string>()
  const seedUnits = new Set<string>() // "ci:ui"
  for (const r of seedRefs) {
    const m = COL_RE.exec(r)
    if (m) seedUnits.add(`${m[1]}:${m[2]}`)
  }
  for (const p of plans) {
    const nearCol = p.side === 'left' ? p.gapIndex : p.gapIndex + 1
    if (seedUnits.has(`${nearCol}:${p.unitIndex}`)) {
      keys.add(`${p.gapIndex}|${p.side}|${p.unitIndex}`)
    }
  }
  return [...keys].sort()
}

// ---------------------------------------------------------------------------
// The pre-slice pipeline + seed classifier for ONE section (flag-ON forced).
// ---------------------------------------------------------------------------

interface SectionScan {
  counts: SectionCounts
  records: SeedFaceRecord[]
}

/**
 * Run the ACTUAL pre-slice pipeline (buildSectionInput -> emitCurves -> buildArrangement ->
 * traced faces -> seed classifier) with the flag FORCED ON, and record every non-exterior face.
 * The flag is restored in a finally by the caller; this helper asserts it is already on so the
 * measurement never runs against the seam path.
 */
function scanSection(
  sectionName: string,
  columns: readonly PartitionColumn[],
  edges: readonly CorrelationEdge[],
  alongM?: readonly number[],
): SectionScan {
  expect(twoSidedTerminationsEnabled(), 'seed gate must run flag-ON forced').toBe(true)
  const section = buildSectionInput(columns, edges, undefined, alongM)
  const counts: SectionCounts = {
    section: sectionName,
    faces: 0,
    single: 0,
    explicitVoid: 0,
    zeroDefect: 0,
    multiDefect: 0,
    mergedMinority: 0,
    unresolvedZeroDefect: 0,
  }
  const records: SeedFaceRecord[] = []
  if (section.columns.length < 2) return { counts, records }

  const { curves, lensLabels, bridgeGapAnchored } = emitCurves(section)
  const arr = buildArrangement(curves)
  const segCurve = buildSegCurveMap(arr)

  // Rebuild the plans from the SAME classifier + geometry the emission used (emitCurves does not
  // return the plans it built; this is the identical call the emission made — the surviving-edge
  // section, jump ties, bridge anchors). The plan KEYS depend only on the classifier + geometry +
  // bridge anchors — NOT on the adjacent tie geometry (which only resolves a corr-1 onlap's
  // TieRef, unread here), so passing [] for activeTies leaves the (gap,side,unit) keys correct.
  const { suspended } = detectCrossingConflicts(section)
  const survivingSection =
    suspended.size === 0
      ? section
      : {
          ...section,
          edges: section.edges.filter((e) => !suspended.has(edgeKey(e))),
        }
  const jumpTies = resolveJumpTies(survivingSection)
  const plans = buildTerminationPlans(survivingSection, [], jumpTies, bridgeGapAnchored)

  // Thread the SAME faces through the flag-ON labelFaces (SEED PATH — arrangement passed) so each
  // single-seed face is compared to what the SEED engine now paints (object identity:
  // labelled.face === arr face). After Step 3 the seed path paints single-seed faces from their
  // column seed, so ``paintMismatch`` ratchets to 0 — the 54 old-vote mismatches are resolved.
  const labelled = labelFaces(arr.faces, section.columns, lensLabels, arr)
  const paintByFace = new Map<Face, string>()
  // Faces the label layer classified merged-minority (ruling 8r): the single "seed" is a
  // MERGE-ARTIFACT (the pre-merge erased the lens's own column segment), so the lens litho is
  // KEPT and the paint≠seed difference is NOT a mismatch — it is its own ratchet class, driven
  // to 0 by Step 4's raw-unit emission (which restores the true seed).
  const mergedMinorityFaces = new Set<Face>()
  for (const lf of labelled) {
    paintByFace.set(lf.face, lf.formationId)
    if (lf.defect?.reason === 'merged-minority') mergedMinorityFaces.add(lf.face)
  }

  arr.faces.forEach((face, faceIndex) => {
    // Every traced face is a BOUNDED interior cell (the unbounded exterior face is never emitted
    // by ``traceFaces``), so all of these are non-exterior by construction.
    const seedRefs = seedRefsOfFace(face, segCurve)
    const seedFormations = [
      ...new Set(
        seedRefs.map((r) => formationOfRef(r, section.columns)).filter((f): f is string => f != null),
      ),
    ].sort()
    const b = faceBounds(face)
    let classification: SeedClass
    if (seedFormations.length === 1) classification = 'single-seed'
    else if (seedFormations.length >= 2) classification = 'multi-seed-defect'
    else classification = isExplicitVoidGeometric(b, section.columns) ? 'explicit-void' : 'zero-seed-defect'

    const currentPaintFormation = paintByFace.get(face) ?? null
    const mergedMinority = mergedMinorityFaces.has(face)
    const paintMismatch =
      classification === 'single-seed' &&
      !mergedMinority &&
      currentPaintFormation != null &&
      currentPaintFormation !== seedFormations[0]

    // SESSION 50 (SEED_FILL_MANDATE Step-4 recording): resolve which fill DOCTRINE owns a zero-seed
    // face — RECORDING ONLY (no geometry / paint change; ``labelFaces`` still keeps its interim
    // doctrine paint). ``owner-ambiguous`` (ruling 8o's ask-clause) is the ONLY unresolved class.
    const zeroSeedResolution: ZeroSeedResolution | null =
      classification === 'zero-seed-defect'
        ? resolveZeroSeedClass(face.boundingCurveIds, (id) => lensLabels.get(id)?.formationId ?? null)
        : null

    counts.faces++
    if (mergedMinority) counts.mergedMinority++
    else if (classification === 'single-seed') counts.single++
    else if (classification === 'explicit-void') counts.explicitVoid++
    else if (classification === 'zero-seed-defect') {
      counts.zeroDefect++
      if (zeroSeedResolution === 'owner-ambiguous') counts.unresolvedZeroDefect++
    } else counts.multiDefect++

    records.push({
      section: sectionName,
      faceIndex,
      diagId: `${sectionName}#${faceIndex}@x[${r2(b.xLo)}..${r2(b.xHi)}]el[${r2(b.elLo)}..${r2(b.elHi)}]`,
      xLo: r3(b.xLo),
      xHi: r3(b.xHi),
      elLo: r3(b.elLo),
      elHi: r3(b.elHi),
      boundaryCurveIds: [...face.boundingCurveIds].sort(),
      seedRefs,
      seedFormations,
      classification,
      zeroSeedFamily: classification === 'zero-seed-defect' ? zeroSeedFamily(face.boundingCurveIds) : null,
      zeroSeedResolution,
      planKeys: planKeysForFace(seedRefs, plans),
      currentPaintFormation,
      paintMismatch,
      mergedMinority,
    })
  })

  return { counts, records }
}

const r2 = (x: number): number => Math.round(x * 100) / 100
const r3 = (x: number): number => Math.round(x * 1000) / 1000

// ---------------------------------------------------------------------------
// Section preparation from the real input (mirrors the holes/shape-audit diags).
// ---------------------------------------------------------------------------
interface PreparedSection {
  name: string
  columns: PartitionColumn[]
  edges: CorrelationEdge[]
  alongM: number[]
}

function prepareRealSection(sec: RawSection): PreparedSection {
  const keep = sec.columns
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.surfaceElevM != null && c.units.length > 0)
  const columns: PartitionColumn[] = keep.map(({ c }) => ({
    investigationId: c.investigationId,
    surfaceElevM: c.surfaceElevM as number,
    units: c.units,
  }))
  const alongM = keep.map(({ i }) => sec.alongM[i])
  const edges: CorrelationEdge[] = sec.edges.map((e) => ({
    a: e.a,
    b: e.b,
    aSide: (e.aSide ?? 'top') as 'top' | 'base',
    bSide: (e.bSide ?? 'top') as 'top' | 'base',
  }))
  return { name: sec.name, columns, edges, alongM }
}

// ---------------------------------------------------------------------------
// The four KNOWN CONTEXTS as synthetic fixtures (mandate "Known contexts").
// The two real-section walls (CS1-g3, CS2-g17) are classified from the real scan; the two
// unit-fixture contexts (convergingStack (a), literalCorr (c)/(d)) are reproduced here.
// ---------------------------------------------------------------------------

/** convergingStack (a): a 3-unit 0-corr interbed stack facing a converging bracket. */
function convergingStackA(): PreparedSection {
  let s = 0
  const L = (): string => `L${s++}`
  const KLEI = 'klei', SILT = 'silt', VEEN = 'veen', ZAND = 'zand'
  const lS = L(), lA = L(), lB = L(), lC = L(), lZ = L(), rS = L(), rZ = L()
  const mk = (
    top: number, base: number, f: string, layerId: string, body: string,
  ): PartitionColumn['units'][number] => ({ topDepthM: top, baseDepthM: base, formationId: f, layerId, bodyId: body })
  const columns: PartitionColumn[] = [
    {
      investigationId: 'L',
      surfaceElevM: 12,
      units: [
        mk(0, 6, SILT, lS, 'bS'),
        mk(6, 6.7, KLEI, lA, 'bA'),
        mk(6.7, 7.3, VEEN, lB, 'bB'),
        mk(7.3, 8, KLEI, lC, 'bC'),
        mk(8, 14, ZAND, lZ, 'bZ'),
      ],
    },
    { investigationId: 'R', surfaceElevM: 12, units: [mk(0, 7, SILT, rS, 'bSr'), mk(7, 14, ZAND, rZ, 'bZr')] },
  ]
  const edges: CorrelationEdge[] = [
    { a: lS, b: rS, aSide: 'base', bSide: 'base' },
    { a: lZ, b: rZ, aSide: 'top', bSide: 'top' },
  ]
  return { name: 'convergingStack (a)', columns, edges, alongM: [0, 1] }
}

/** literalCorr (c)/(d): the col18 three-piece column (CLAY host split by SILT interbeds). */
function literalCorrCD(): PreparedSection {
  let s = 0
  const L = (): string => `L${s++}`
  const CLAY = 'clay', SILT = 'silt'
  const mk = (
    top: number, base: number, f: string, layerId: string, body: string,
  ): PartitionColumn['units'][number] => ({ topDepthM: top, baseDepthM: base, formationId: f, layerId, bodyId: body })
  const lClayTop = L(), lSilt = L(), lClayBot = L()
  const midTop = L(), midSilt1 = L(), midMid = L(), midSilt2 = L(), midBot = L()
  const rClayTop = L(), rSilt = L(), rClayBot = L()
  const columns: PartitionColumn[] = [
    {
      investigationId: 'L',
      surfaceElevM: 12,
      units: [mk(0, 2, CLAY, lClayTop, 'clay-L-top'), mk(2, 8, SILT, lSilt, 'silt-L'), mk(8, 12, CLAY, lClayBot, 'clay-L-bot')],
    },
    {
      investigationId: 'M',
      surfaceElevM: 12,
      units: [
        mk(0, 2, CLAY, midTop, 'clay-M-top'),
        mk(2, 4, SILT, midSilt1, 'silt-M-1'),
        mk(4, 6, CLAY, midMid, 'clay-M-mid'),
        mk(6, 8, SILT, midSilt2, 'silt-M-2'),
        mk(8, 12, CLAY, midBot, 'clay-M-bot'),
      ],
    },
    {
      investigationId: 'R',
      surfaceElevM: 12,
      units: [mk(0, 2, CLAY, rClayTop, 'clay-R-top'), mk(2, 8, SILT, rSilt, 'silt-R'), mk(8, 12, CLAY, rClayBot, 'clay-R-bot')],
    },
  ]
  const edges: CorrelationEdge[] = [
    { a: midTop, b: lClayTop, aSide: 'top', bSide: 'top' },
    { a: midBot, b: rClayBot, aSide: 'base', bSide: 'base' },
  ]
  return { name: 'literalCorr (c)/(d)', columns, edges, alongM: [0, 40, 80] }
}

// ---------------------------------------------------------------------------
// The gate.
// ---------------------------------------------------------------------------
describe('partition-v2 MEASURED SEED GATE (mandate Step 1)', () => {
  if (process.env.SHAPE_AUDIT !== '1') {
    it.skip('dormant (set SHAPE_AUDIT=1)', () => {})
    return
  }

  it('measures the seed invariant on all real sections + the four known contexts (flag-ON forced)', () => {
    expect(existsSync(INPUT)).toBe(true)
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as {
      sections: RawSection[]
      formationNames: Record<string, string>
    }
    const nameMap: Record<string, string> = existsSync(NAMES)
      ? (JSON.parse(readFileSync(NAMES, 'utf8')) as Record<string, string>)
      : {}
    const fname = (id: string): string => raw.formationNames[id] ?? nameMap[id] ?? id.slice(0, 8)

    const allCounts: SectionCounts[] = []
    const allRecords: SeedFaceRecord[] = []

    const prepared: PreparedSection[] = [
      ...raw.sections.map(prepareRealSection),
      convergingStackA(),
      literalCorrCD(),
    ]

    const prev = setTwoSidedTerminations(true)
    try {
      for (const p of prepared) {
        const { counts, records } = scanSection(p.name, p.columns, p.edges, p.alongM)
        allCounts.push(counts)
        allRecords.push(...records)
      }
    } finally {
      setTwoSidedTerminations(prev)
    }

    // ---- per-section seed-count table ----
    console.log('\n########## SEED-COUNT TABLE (flag-ON, pre-slice faces) ##########')
    console.log('  section                          faces  single  void  ZERO-DEF  MULTI-DEF  MERGED-MIN')
    let gFaces = 0, gSingle = 0, gVoid = 0, gZero = 0, gMulti = 0, gMergedMin = 0
    for (const c of allCounts) {
      gFaces += c.faces
      gSingle += c.single
      gVoid += c.explicitVoid
      gZero += c.zeroDefect
      gMulti += c.multiDefect
      gMergedMin += c.mergedMinority
      console.log(
        `  ${c.section.padEnd(32)} ${String(c.faces).padStart(5)}  ${String(c.single).padStart(6)}  ${String(c.explicitVoid).padStart(4)}  ${String(c.zeroDefect).padStart(8)}  ${String(c.multiDefect).padStart(9)}  ${String(c.mergedMinority).padStart(10)}`,
      )
    }
    console.log(
      `  ${'TOTAL'.padEnd(32)} ${String(gFaces).padStart(5)}  ${String(gSingle).padStart(6)}  ${String(gVoid).padStart(4)}  ${String(gZero).padStart(8)}  ${String(gMulti).padStart(9)}  ${String(gMergedMin).padStart(10)}`,
    )

    // ---- zero-seed-defect: family histogram + identity list ----
    const zeros = allRecords.filter((r) => r.classification === 'zero-seed-defect')
    const famHist = new Map<string, number>()
    for (const r of zeros) famHist.set(r.zeroSeedFamily ?? 'empty', (famHist.get(r.zeroSeedFamily ?? 'empty') ?? 0) + 1)
    console.log(`\n########## ZERO-SEED-DEFECT faces: ${zeros.length} (by label-path family) ##########`)
    for (const [fam, n] of [...famHist.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`   ${fam.padEnd(14)} ${n}`)
    }
    for (const r of zeros) {
      console.log(
        `  [${r.zeroSeedFamily}] ${r.diagId}\n     bounding=[${r.boundaryCurveIds.join(',')}]\n     planKeys=[${r.planKeys.join(',')}]`,
      )
    }

    // ---- SESSION 50: zero-seed RESOLUTION CLASS histogram + the owner-ambiguous (8o ask-clause) list ----
    const resHist = new Map<string, number>()
    for (const r of zeros) resHist.set(r.zeroSeedResolution ?? 'null', (resHist.get(r.zeroSeedResolution ?? 'null') ?? 0) + 1)
    const gUnresolved = allCounts.reduce((s, c) => s + c.unresolvedZeroDefect, 0)
    console.log(`\n########## ZERO-SEED RESOLUTION CLASS (session 50; UNRESOLVED = owner-ambiguous = ${gUnresolved}) ##########`)
    for (const [cls, n] of [...resHist.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`   ${cls.padEnd(20)} ${n}`)
    }
    // The ruling-8o ask-clause list: every owner-ambiguous face by identity + its candidate flood lithos,
    // for the owner to decide — NEVER guessed.
    const ambiguous = zeros.filter((r) => r.zeroSeedResolution === 'owner-ambiguous')
    console.log(`\n########## OWNER-AMBIGUOUS zero-seed faces (ruling 8o ask-clause): ${ambiguous.length} ##########`)
    for (const r of ambiguous) {
      const floodFids = r.boundaryCurveIds
        .filter((id) => id.startsWith('floodsw') || id.startsWith('flood'))
      console.log(
        `  ${r.diagId}\n     family=${r.zeroSeedFamily} currentPaint=${r.currentPaintFormation ? fname(r.currentPaintFormation) : '(none)'}\n     floodCurves=[${floodFids.join(',')}]\n     bounding=[${r.boundaryCurveIds.join(',')}]`,
      )
    }

    // ---- multi-seed-defect identity list ----
    const multis = allRecords.filter((r) => r.classification === 'multi-seed-defect')
    console.log(`\n########## MULTI-SEED-DEFECT faces: ${multis.length} ##########`)
    for (const r of multis) {
      console.log(
        `  ${r.diagId}\n     seedFormations=[${r.seedFormations.map(fname).join(',')}]\n     seedRefs=[${r.seedRefs.join(',')}]\n     bounding=[${r.boundaryCurveIds.join(',')}]\n     planKeys=[${r.planKeys.join(',')}]`,
      )
    }

    // ---- single-seed vs CURRENT flag-ON paint mismatch list ----
    const mismatches = allRecords.filter((r) => r.paintMismatch)
    console.log(`\n########## SINGLE-SEED vs CURRENT-PAINT MISMATCHES: ${mismatches.length} ##########`)
    for (const r of mismatches) {
      console.log(
        `  ${r.diagId}  now=${fname(r.currentPaintFormation as string)} -> seed=${fname(r.seedFormations[0])}`,
      )
    }

    // ---- the four KNOWN CONTEXTS ----
    console.log('\n########## KNOWN-CONTEXT CLASSIFICATION ##########')
    reportKnownContext('CS1-g3 holes', allRecords, (r) => r.section === 'Cross-section 1', fname)
    reportKnownContext('CS2-g17 holes', allRecords, (r) => r.section === 'Cross-section 2', fname)
    reportKnownContext('convergingStack (a)', allRecords, (r) => r.section === 'convergingStack (a)', fname)
    reportKnownContext('literalCorr (c)/(d)', allRecords, (r) => r.section === 'literalCorr (c)/(d)', fname)

    // ---- deterministic dump ----
    const dump = {
      generatedFor:
        'partition-v2 measured seed gate — flag-ON pre-slice faces, all 14 real sections + convergingStack(a) + literalCorr(c)/(d)',
      minSeedEdgeM: MIN_SEED_EDGE_M,
      perSection: allCounts,
      grandTotals: { faces: gFaces, single: gSingle, explicitVoid: gVoid, zeroSeedDefect: gZero, multiSeedDefect: gMulti, mergedMinority: gMergedMin, unresolvedZeroDefect: allCounts.reduce((s, c) => s + c.unresolvedZeroDefect, 0) },
      zeroSeedResolution: Object.fromEntries([...resHist.entries()]),
      zeroSeedDefects: zeros,
      multiSeedDefects: multis,
      paintMismatches: mismatches,
      faces: allRecords,
    }
    writeFileSync(DUMP, JSON.stringify(dump, null, 1))
    console.log(`\n  dumped -> ${DUMP}`)

    // MEASUREMENT ONLY — never fails (Step 1 records; Steps 2-4 add the red tests + repairs).
    expect(true).toBe(true)
  })
})

/**
 * Print a compact classification summary for one known context: how many of its faces fell into
 * each seed class, plus the defect faces' identities (for the mandate's per-context verdict).
 */
function reportKnownContext(
  label: string,
  records: readonly SeedFaceRecord[],
  belongs: (r: SeedFaceRecord) => boolean,
  fname: (id: string) => string,
): void {
  const rs = records.filter(belongs)
  const by: Record<SeedClass, number> = {
    'single-seed': 0,
    'explicit-void': 0,
    'zero-seed-defect': 0,
    'multi-seed-defect': 0,
  }
  for (const r of rs) by[r.classification]++
  const defects = rs.filter(
    (r) => r.classification === 'zero-seed-defect' || r.classification === 'multi-seed-defect',
  )
  console.log(
    `  ${label.padEnd(22)} faces=${rs.length}  single=${by['single-seed']} void=${by['explicit-void']} ZERO=${by['zero-seed-defect']} MULTI=${by['multi-seed-defect']}`,
  )
  for (const d of defects.slice(0, 8)) {
    console.log(
      `      ${d.classification.toUpperCase()}  ${d.diagId}  seeds=[${d.seedFormations.map(fname).join(',')}]`,
    )
  }
}
