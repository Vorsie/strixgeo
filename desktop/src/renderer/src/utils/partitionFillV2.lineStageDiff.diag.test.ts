/**
 * partitionFillV2.lineStageDiff.diag.test.ts — THE DETERMINISTIC RAW-UNIT LINE-STAGE DIFF
 * (INSTRUMENT ONLY — no engine changes; NEW FILE; v1 + app + engine READ-ONLY).
 *
 * The diagnostic the owner's Codex review mandated before any spot fix on the v2 partition
 * line stage: measure the pipeline
 *
 *   raw expected 0/1/2  ->  raw expected curve endpoints  ->  emitted curves  ->  discrepancy
 *
 * across all 14 real sections (``scripts/diag_allsections_input.json``). MEASUREMENT ONLY —
 * this file draws no conclusions the numbers do not support and mutates no engine state beyond
 * a try/finally cut-over-flag flip.
 *
 * WHY "RAW" IS THE GROUND TRUTH (Codex constraint). ``buildSectionInput`` MERGES a section via
 * ``extractEnclosedLenses`` (sectionGeom.ts) before the engine ever classifies it, so a plan
 * built on the NORMALISED section agreeing with itself proves NOTHING about ruling 8r (lines
 * before merge) — the plan at ``emitCurves`` sees a section whose enclosed minorities were
 * already spliced out of their host column. This diff therefore computes LAYER 1/2 (expected
 * corr + expected endpoints) on the RAW, UN-MERGED units — a ``SectionInput`` built directly from
 * the raw column stacks with elevations, no ``extractEnclosedLenses`` — and only THEN compares it
 * to the NORMALISED plan + the EMITTED curves. A raw unit absent from the normalised section is a
 * MERGED-AWAY row (the 8r debt, quantified).
 *
 * THE THREE LAYERS (one deterministic run per section):
 *
 *   1. RAW EXPECTED 0/1/2 per (gap, side, raw-unit): the LITERAL corr (ruling 8l) from
 *      ``effectiveCorrForSide`` on the raw section (ties resolved against RAW unit indices via
 *      ``emitCurves`` on the raw section — its ``resolveTies`` / bridge anchoring index the raw
 *      stack). Every tied contact records its classifying tie (the ``TieRef``).
 *   2. RAW EXPECTED ENDPOINTS: corr-0 -> two flanks rooted EXACTLY at the unit's contacts, apex
 *      0.45*gapWidth lateral at mid-elevation (flag where a collision COULD legitimately shorten —
 *      not modelled); corr-1 -> ONE flank from the free contact to a 0.5 apex interpolated ON the
 *      resolved tie, SUPPRESSED iff the matched facing litho is identical (ruling 8m — recorded
 *      separately); corr-2 -> none (band = given line art).
 *   3. EMITTED: flag-ON ``emitCurves`` on the CANONICAL (normalised) input. The termination curves
 *      are the id-prefixed families (``term`` / ``oflank`` / ``subtdlens`` / ``subtdo`` / ``lens``);
 *      the full id vocabulary is inventoried.
 *
 * MATCH + CLASSIFY per raw identity (colX + own-contact elevation): OK / MISSING / MISROOTED /
 * COLLAPSED / DANGLING / PHANTOM / DUPLICATE / MERGED-AWAY / WRONG-SIDE / INVISIBLE-SUPPORT /
 * NOT-MISSING-TIED (the owner's 8a rule question — expected-none via an 8a-shared-contact/bridge
 * tie, listed with its classifying tie, NOT a defect).
 *
 * Gate: SHAPE_AUDIT=1 (the allowed audit env var). Pure reporter — never fails. Deterministic
 * (no Date.now / Math.random; fixed iteration order). Dump: scripts/diag_line_stage_diff.json.
 * Run (desktop/):
 *   SHAPE_AUDIT=1 npx vitest run src/renderer/src/utils/partitionFillV2.lineStageDiff.diag.test.ts
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  INTERIOR_PINCH_FRACTION,
  LENS_PINCH_FRACTION,
  type CorrelationEdge,
  type PartitionColumn,
} from './sectionPartition'
import { emitCurves, type ResolvedTie } from './partitionFillV2/emitCurves'
import { effectiveCorrForSide, type TieRef } from './partitionFillV2/effectiveCorr'
import { buildTerminationPlans, type TerminationPlan } from './partitionFillV2/terminationPlan'
import { setTwoSidedTerminations } from './partitionFillV2/tileFlags'
import {
  buildSectionInput,
  type ColumnGeom,
  type SectionInput,
} from './partitionFillV2/sectionGeom'
import { type InputCurve, type Point } from './partitionFillV2/types'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const INPUT = resolve(REPO_ROOT, 'scripts/diag_allsections_input.json')
const NAMES = resolve(REPO_ROOT, 'scripts/diag_shape_audit_names.json')
const DUMP = resolve(REPO_ROOT, 'scripts/diag_line_stage_diff.json')
const UTILS_DIR = resolve(HERE)

// ---------------------------------------------------------------------------
// Input shapes (mirror the extractor output — same as the conformance diag).
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
  alongM: number[]
  edges: { a: string; b: string; aSide?: string; bSide?: string }[]
}

const round = (x: number): number => Math.round(x * 1000) / 1000
/** 1 mm — the arrangement snap grid; a root within this of an expected contact is "on it". */
const ROOT_TOL_M = 0.001
/** COLLAPSED threshold: an emitted flank whose lateral reach is < 10 % of expected. */
const COLLAPSE_FRAC = 0.1

// The termination id prefixes emitted by the flag-ON sweep + the enclosed-lens / sub-TD carriers.
// These are the DRAWABLE termination curves (the LAYER-3 population). Non-termination curves
// (column verticals / surface band / ties / bridges / flood wedges / band contours / substrate
// floor & curtain) are NOT terminations and are excluded from the match population — but their
// prefixes are still tallied into the id vocabulary so the full inventory is visible.
//
// NOTE on the CONCATENATED prefixes: an onlap flank id is built ``oflank${nextId()}`` where the
// sweep's ``nextId`` already returns ``term{seq}`` (drawTermination.emitOnlap) or the sub-TD carrier
// returns ``subtdo{seq}`` — so the emitted ids are ``oflankterm{seq}`` / ``oflanksubtdo{seq}``, NOT a
// bare ``oflank``. ``idPrefix`` captures the whole leading letter-run, so the match set MUST list the
// concatenated forms. ``term`` = interior/lens-closing curves; ``lens`` = enclosed-lens closings;
// ``subtdlens`` = sub-TD hugging lens closings.
const TERMINATION_PREFIXES = [
  'term',
  'oflankterm',
  'oflanksubtdo',
  'subtdlens',
  'lens',
] as const

/** The id-prefix of a curve (leading run of lowercase letters). */
function idPrefix(id: string): string {
  const m = /^[a-z]+/.exec(id)
  return m ? m[0] : id
}

// ---------------------------------------------------------------------------
// Section preparation (identical to the conformance diag ``prepare``).
// ---------------------------------------------------------------------------
function prepare(
  sec: RawSection,
  nameOf: (id: string) => string,
): { columns: PartitionColumn[]; alongM: number[]; edges: CorrelationEdge[]; colNames: string[] } {
  const keep = sec.columns
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.surfaceElevM != null && c.units.length > 0)
  const columns: PartitionColumn[] = keep.map(({ c }) => ({
    investigationId: c.investigationId,
    surfaceElevM: c.surfaceElevM as number,
    units: c.units,
  }))
  const alongM = keep.map(({ i }) => sec.alongM[i])
  const colNames = keep.map(({ c }) => nameOf(c.investigationId))
  const edges: CorrelationEdge[] = sec.edges.map((e) => ({
    a: e.a,
    b: e.b,
    aSide: (e.aSide ?? 'top') as 'top' | 'base',
    bSide: (e.bSide ?? 'top') as 'top' | 'base',
  }))
  return { columns, alongM, edges, colNames }
}

/**
 * Build the RAW (un-merged) ``SectionInput`` directly from the kept columns — the ground truth
 * BEFORE ``buildSectionInput``'s ``extractEnclosedLenses`` merge (Codex constraint). Elevations are
 * ``surfaceElevM - depth``; NO gap-close / same-formation-collapse / enclosed-lens extraction is
 * applied, so every RAW unit survives with its own top/base contact and column index. Real alongM x.
 */
function buildRawSection(
  columns: readonly PartitionColumn[],
  edges: readonly CorrelationEdge[],
  alongM: readonly number[],
): SectionInput {
  const geom: ColumnGeom[] = columns.map((c, ci) => ({
    investigationId: c.investigationId,
    x: alongM[ci],
    surfaceElevM: c.surfaceElevM,
    units: c.units.map((u) => ({
      layerId: u.layerId,
      formationId: u.formationId,
      bodyId: u.bodyId,
      topElev: c.surfaceElevM - u.topDepthM,
      baseElev: c.surfaceElevM - u.baseDepthM,
    })),
    enclosedLenses: [],
  }))
  return { columns: geom, edges }
}

// ---------------------------------------------------------------------------
// Layer-2 expected-endpoint geometry (mirrors drawTermination's own construction,
// re-derived here from raw so the diff is INDEPENDENT of the emitter — a match means
// the emitter reproduced the rule's geometry, not that it agreed with itself).
// ---------------------------------------------------------------------------

/** A single expected flank: its two endpoints in metres*elevation + which raw contact roots it. */
interface ExpectedFlank {
  rootContact: 'top' | 'base'
  root: Point
  apex: Point
}

/** The classifying tie of a tied contact, flattened for the dump. */
function tieRefLabel(ref: TieRef | null): string {
  if (!ref) return 'none'
  if (ref.kind === 'top-band') return 'top-band'
  return `resolved(${ref.tie.id}@${ref.ownContact})`
}

/**
 * The FAR (facing) endpoint elevation of a resolved tie for the look ``side`` — mirrors
 * ``drawTermination.tieRefFarElev``: the near endpoint is on OUR column, so the far one is the
 * other. A top-band / null ref falls back to the facing unit spanning the tied elevation.
 */
function facingTiedElevFor(
  ref: TieRef | null,
  side: 'left' | 'right',
  tiedElev: number,
  facing: ColumnGeom,
): number {
  if (ref?.kind === 'resolved') return side === 'left' ? ref.tie.right.y : ref.tie.left.y
  // Fallback: nearest facing unit contact spanning the tied elevation (facingElevAt clone).
  const ELEV_EPS = 1e-6
  let best = tiedElev
  let bestDist = Infinity
  for (const fu of facing.units) {
    if (fu.topElev >= tiedElev - ELEV_EPS && tiedElev >= fu.baseElev - ELEV_EPS) return tiedElev
    const dist = tiedElev > fu.topElev ? tiedElev - fu.topElev : fu.baseElev - tiedElev
    if (dist < bestDist) {
      bestDist = dist
      best = tiedElev > fu.topElev ? fu.topElev : fu.baseElev
    }
  }
  return best
}

/** The facing unit's formation at an elevation (nearest fallback) — for the 8m matched-litho check. */
function facingFormationAt(facing: ColumnGeom, elev: number): string | null {
  const ELEV_EPS = 1e-6
  let best: string | null = null
  let bestDist = Infinity
  for (const fu of facing.units) {
    if (fu.topElev >= elev - ELEV_EPS && elev >= fu.baseElev - ELEV_EPS) return fu.formationId
    const dist = elev > fu.topElev ? elev - fu.topElev : fu.baseElev - elev
    if (dist < bestDist) {
      bestDist = dist
      best = fu.formationId
    }
  }
  return best
}

// ---------------------------------------------------------------------------
// Dump row.
// ---------------------------------------------------------------------------
type MatchClass =
  | 'OK'
  | 'MISSING'
  | 'MISROOTED'
  | 'COLLAPSED'
  | 'DANGLING'
  | 'WRONG-SIDE'
  | 'INVISIBLE-SUPPORT'
  | 'NOT-MISSING-TIED'
  | 'MERGED-AWAY'
  | 'SUPPRESSED-8M'

interface DiffRow {
  section: string
  gap: number
  side: 'left' | 'right'
  col: string
  facing: string
  rawUnitIndex: number
  layerId: string
  formation: string
  topElev: number
  baseElev: number
  corr: 0 | 1 | 2
  topTie: string
  baseTie: string
  expectedKind: 'lens' | 'onlap' | 'band-member'
  expectedFlanks: number
  matchedFlanks: number
  matchClass: MatchClass
  note: string
  collisionCouldShorten?: boolean
  mergedAway?: boolean
}

/** An emitted termination flank, reduced to its two endpoints + id (for matching). */
interface EmittedFlank {
  id: string
  prefix: string
  a: Point
  b: Point
  matched: boolean
}

function segEndpoints(c: InputCurve): { a: Point; b: Point } {
  const pts = c.points
  return { a: pts[0], b: pts[pts.length - 1] }
}

/** Whether point ``p`` is within ROOT_TOL_M of ``q`` on both axes. */
function near(p: Point, q: Point): boolean {
  return Math.abs(p.x - q.x) <= ROOT_TOL_M && Math.abs(p.y - q.y) <= ROOT_TOL_M
}

/** Does an emitted flank have an endpoint rooted at ``root`` (metres*elevation)? */
function flankRootsAt(f: EmittedFlank, root: Point): boolean {
  return near(f.a, root) || near(f.b, root)
}

interface SectionResult {
  section: string
  cols: number
  rawUnits: number
  survivingUnits: number
  mergedAway: number
  byClass: Record<MatchClass, number>
  emittedTerminations: number
  matchedTerminations: number
  phantomTerminations: number
  duplicateRoots: number
  rows: DiffRow[]
  // TIE-CONFORMANCE (SEED_FILL_MANDATE Step 4.2 "ALSO"): raw approved edges vs emitted
  // tie/bridge curves. DROPPED = a raw edge with no emitted tie/bridge; MOVED = matched but an
  // endpoint shifted > 2 cm; INVENTED = an emitted tie/bridge matching no raw edge.
  tieRaw: number
  tieDropped: TieConf[]
  tieMoved: TieConf[]
  tieInvented: number
}

/** One tie-conformance discrepancy (a dropped or moved approved edge). */
interface TieConf {
  aName: string
  bName: string
  aSide: 'top' | 'base'
  bSide: 'top' | 'base'
  detail: string
}

/** Curve-id prefixes that carry CORRELATION line art (a drawn/derived/bridge tie). */
const TIE_PREFIXES = ['tie', 'bridge', 'jump'] as const

/** Tolerances for matching a raw approved edge to an emitted tie/bridge curve. */
const TIE_X_TOL_M = 0.05 // 5 cm laterally
const TIE_ELEV_TOL_M = 0.02 // 2 cm in elevation

/** Whether an emitted tie/bridge curve's endpoints match a raw edge's endpoints (either order). */
function tieEndpointsMatch(
  ca: Point,
  cb: Point,
  ra: Point,
  rb: Point,
  xTol: number,
  eTol: number,
): boolean {
  const hit = (p: Point, q: Point): boolean => Math.abs(p.x - q.x) <= xTol && Math.abs(p.y - q.y) <= eTol
  return (hit(ca, ra) && hit(cb, rb)) || (hit(ca, rb) && hit(cb, ra))
}

const EMPTY_CLASS_COUNTS = (): Record<MatchClass, number> => ({
  OK: 0,
  MISSING: 0,
  MISROOTED: 0,
  COLLAPSED: 0,
  DANGLING: 0,
  'WRONG-SIDE': 0,
  'INVISIBLE-SUPPORT': 0,
  'NOT-MISSING-TIED': 0,
  'MERGED-AWAY': 0,
  'SUPPRESSED-8M': 0,
})

/**
 * Local clone of ``emitCurves.resolveJumpTies`` for the plan build — the engine builds jump ties
 * inside ``emitCurves`` but does not expose them, and ``buildTerminationPlans`` needs them for the
 * F5 sub-TD TieRef resolution. This mirrors the exported logic (non-adjacent edges -> two anchored
 * ``ResolvedTie`` records). Kept in the diag so the plan matches the engine's own build.
 */
function resolveJumpTiesLocal(section: SectionInput): ResolvedTie[] {
  const { columns } = section
  const out: ResolvedTie[] = []
  const layerLoc = new Map<string, { ci: number; ui: number }>()
  for (let ci = 0; ci < columns.length; ci++) {
    for (let ui = 0; ui < columns[ci].units.length; ui++) {
      layerLoc.set(columns[ci].units[ui].layerId, { ci, ui })
    }
  }
  let seq = 0
  for (const e of section.edges) {
    const la = layerLoc.get(e.a)
    const lb = layerLoc.get(e.b)
    if (!la || !lb) continue
    if (Math.abs(la.ci - lb.ci) < 2) continue
    const loLoc = la.ci < lb.ci ? la : lb
    const hiLoc = la.ci < lb.ci ? lb : la
    const loSide = (la.ci < lb.ci ? e.aSide : e.bSide) ?? 'top'
    const hiSide = (la.ci < lb.ci ? e.bSide : e.aSide) ?? 'top'
    const loU = columns[loLoc.ci].units[loLoc.ui]
    const hiU = columns[hiLoc.ci].units[hiLoc.ui]
    const loX = columns[loLoc.ci].x
    const hiX = columns[hiLoc.ci].x
    const loElev = loSide === 'top' ? loU.topElev : loU.baseElev
    const hiElev = hiSide === 'top' ? hiU.topElev : hiU.baseElev
    if (Math.abs(hiX - loX) < 1e-9) continue
    const elevAt = (x: number): number => loElev + ((x - loX) / (hiX - loX)) * (hiElev - loElev)
    const loFacingX = columns[loLoc.ci + 1]?.x ?? hiX
    out.push({
      gapIndex: loLoc.ci,
      left: { x: loX, y: loElev },
      right: { x: loFacingX, y: elevAt(loFacingX) },
      leftSide: loSide,
      rightSide: 'top',
      leftUnitIndex: loLoc.ui,
      rightUnitIndex: -1,
      id: `jump${seq}lo:${loLoc.ci}-${hiLoc.ci}`,
    })
    const hiFacingX = columns[hiLoc.ci - 1]?.x ?? loX
    out.push({
      gapIndex: hiLoc.ci - 1,
      left: { x: hiFacingX, y: elevAt(hiFacingX) },
      right: { x: hiX, y: hiElev },
      leftSide: 'top',
      rightSide: hiSide,
      leftUnitIndex: -1,
      rightUnitIndex: hiLoc.ui,
      id: `jump${seq}hi:${loLoc.ci}-${hiLoc.ci}`,
    })
    seq++
  }
  return out
}

/**
 * Run the whole three-layer diff for ONE section at the CURRENT (flag-ON) engine state. Returns the
 * per-section result + the raw rows. Deterministic: fixed column-first / gap iteration.
 */
function diffSection(
  sec: RawSection,
  fname: (id: string) => string,
  nameOf: (id: string) => string,
  idVocab: Map<string, number>,
): SectionResult {
  const { columns, alongM, edges, colNames } = prepare(sec, nameOf)
  const byClass = EMPTY_CLASS_COUNTS()
  const rows: DiffRow[] = []
  if (columns.length < 2) {
    return {
      section: sec.name,
      cols: columns.length,
      rawUnits: 0,
      survivingUnits: 0,
      mergedAway: 0,
      byClass,
      emittedTerminations: 0,
      matchedTerminations: 0,
      phantomTerminations: 0,
      duplicateRoots: 0,
      rows,
      tieRaw: 0,
      tieDropped: [],
      tieMoved: [],
      tieInvented: 0,
    }
  }

  // LAYER 1/2 SOURCE — the RAW (un-merged) section. Its ties/bridge anchoring index the RAW stack.
  const rawSection = buildRawSection(columns, edges, alongM)
  const { activeTies: rawTies, bridgeGapAnchored: rawBridge } = emitCurves(rawSection)

  // NORMALISED (canonical) section — what the engine actually classifies + emits. MERGED-AWAY is
  // measured against the layerIds that survive here.
  const normSection = buildSectionInput(columns, edges, undefined, alongM)
  const emitted = emitCurves(normSection)
  const plans = buildTerminationPlans(
    normSection,
    emitted.activeTies,
    resolveJumpTiesLocal(normSection),
    emitted.bridgeGapAnchored,
  )
  const planAt = new Map<string, TerminationPlan>()
  for (const p of plans) planAt.set(`${p.gapIndex}|${p.side}|${p.unitIndex}`, p)

  // LAYER 3 — the emitted TERMINATION flanks (id-prefixed families). Tally the FULL id vocabulary
  // for the inventory; keep only the termination population for matching.
  const emittedFlanks: EmittedFlank[] = []
  for (const c of emitted.curves) {
    const prefix = idPrefix(c.id)
    idVocab.set(prefix, (idVocab.get(prefix) ?? 0) + 1)
    if ((TERMINATION_PREFIXES as readonly string[]).includes(prefix)) {
      const { a, b } = segEndpoints(c)
      emittedFlanks.push({ id: c.id, prefix, a, b, matched: false })
    }
  }

  // The set of layerIds that SURVIVE into the normalised section (for MERGED-AWAY detection).
  const survivingLayerIds = new Set<string>()
  for (const col of normSection.columns) for (const u of col.units) survivingLayerIds.add(u.layerId)

  let rawUnits = 0
  let survivingUnits = 0
  let mergedAway = 0

  // COLUMN-first iteration (ruling 8k) over the RAW geometry — every unit looks into its two gaps.
  const rawCols = rawSection.columns
  for (let ci = 0; ci < rawCols.length; ci++) {
    const col = rawCols[ci]
    for (const [gi, side] of [
      [ci, 'left'],
      [ci - 1, 'right'],
    ] as const) {
      if (gi < 0 || gi + 1 >= rawCols.length) continue
      const facing = side === 'left' ? rawCols[gi + 1] : rawCols[gi]
      const left = rawCols[gi]
      const right = rawCols[gi + 1]
      // LAYER 1 — the literal 2/1/0 corr per raw unit on this side (bridge-fed, flag-ON semantics).
      const corr = effectiveCorrForSide(gi, side, col, facing, left, right, rawTies, rawBridge)
      const colX = col.x
      const facingX = facing.x
      const gapWidth = facingX - colX

      for (let ui = 0; ui < col.units.length; ui++) {
        const u = col.units[ui]
        // Count each raw unit ONCE (on its 'left' look) for the raw-unit totals.
        if (side === 'left') {
          rawUnits++
          if (survivingLayerIds.has(u.layerId)) survivingUnits++
          else mergedAway++
        }
        const eff = corr[ui] ?? {
          topTied: false,
          baseTied: false,
          corr: 0 as const,
          topTie: null,
          baseTie: null,
        }
        const c = eff.corr
        const expectedKind: DiffRow['expectedKind'] =
          c === 2 ? 'band-member' : c === 1 ? 'onlap' : 'lens'

        // MERGED-AWAY: this raw unit is not in the normalised section (extractEnclosedLenses spliced
        // it out). It CANNOT have an emitted termination of its own identity — quantify the 8r debt.
        const isMergedAway = !survivingLayerIds.has(u.layerId)

        // ---- LAYER 2: expected flanks from the raw corr + geometry ----
        const expectedFlanks: ExpectedFlank[] = []
        let collisionCouldShorten = false
        let suppressed8m = false
        if (c === 0) {
          // corr-0 LENS: two flanks rooted at top + base contacts, apex 0.45*gap at mid-elevation.
          const mid = (u.topElev + u.baseElev) / 2
          const apexX = colX + LENS_PINCH_FRACTION * gapWidth
          const apex: Point = { x: apexX, y: mid }
          expectedFlanks.push({ rootContact: 'top', root: { x: colX, y: u.topElev }, apex })
          expectedFlanks.push({ rootContact: 'base', root: { x: colX, y: u.baseElev }, apex })
          // Flag where a collision COULD legitimately shorten: a facing unit at mid-elev of a THIRD
          // litho (neither the unit's nor its enclosing matrix's) would bracket the diamond (8b-rev).
          const facingFid = facingFormationAt(facing, mid)
          collisionCouldShorten = facingFid != null && facingFid !== u.formationId
        } else if (c === 1) {
          // corr-1 ONLAP: ONE flank from the FREE contact to a 0.5 apex ON the resolved tie.
          const eb = eff.baseTied && !eff.topTied
          const et = eff.topTied && !eff.baseTied
          const tieSide: 'top' | 'base' = eb ? 'base' : et ? 'top' : 'base'
          const baseIsTied = tieSide === 'base'
          const tiedElev = baseIsTied ? u.baseElev : u.topElev
          const tiedRef = baseIsTied ? eff.baseTie : eff.topTie
          const facingTiedElev = facingTiedElevFor(tiedRef, side, tiedElev, facing)
          // RULING 8m: follow the tie to the matched facing contact (below-for-top / above-for-base)
          // and compare litho — SAME -> the onlap flank is SUPPRESSED (recorded separately).
          const MATCH_OFFSET = 1e-3
          const sampleElev = baseIsTied ? facingTiedElev + MATCH_OFFSET : facingTiedElev - MATCH_OFFSET
          const matchedFid = facingFormationAt(facing, sampleElev)
          suppressed8m = matchedFid != null && matchedFid === u.formationId
          if (!suppressed8m) {
            const apexX = colX + INTERIOR_PINCH_FRACTION * gapWidth
            const apexElev = tiedElev + INTERIOR_PINCH_FRACTION * (facingTiedElev - tiedElev)
            const apex: Point = { x: apexX, y: apexElev }
            // The free contact roots the single flank.
            const freeContact: 'top' | 'base' = baseIsTied ? 'top' : 'base'
            const freeElev = baseIsTied ? u.topElev : u.baseElev
            expectedFlanks.push({ rootContact: freeContact, root: { x: colX, y: freeElev }, apex })
          }
        }
        // corr-2: no flank (band = given line art).

        // ---- LAYER 3 MATCH: find emitted termination flanks rooted at each expected root ----
        let matchedFlanks = 0
        let anyMisrooted = false
        let anyCollapsed = false
        let anyDangling = false
        let danglingDetail = ''
        for (const ef of expectedFlanks) {
          // Candidate emitted flanks rooted at this contact (colX + contact elevation).
          const rootedHere = emittedFlanks.filter((f) => !f.matched && flankRootsAt(f, ef.root))
          // PREFIX-AWARE MATCHING (S48): the greedy ``cands[0]`` was prefix-agnostic, so when a
          // corr-0 LENS flank of an ADJACENT unit happened to root at the SAME shared contact as
          // this corr-1 ONLAP's free contact, ``cands[0]`` consumed the lens flank and reported a
          // huge apexYerr (the lens apex is nowhere near the onlap's tie) — a MATCHER ARTIFACT, not
          // a real onlap defect (§46/§52 gap19 class). Match the expected flank against its OWN
          // family FIRST: a corr-1 onlap expects an ``oflank*`` flank; a corr-0 lens expects a
          // ``lens`` / ``term`` / ``subtdlens`` closing. Only if no same-family flank is rooted here
          // do we fall back to any rooted flank (which then surfaces the real geometry honestly).
          const isOnlapPrefix = (p: string): boolean => p.startsWith('oflank')
          const familyMatch = (p: string): boolean => (c === 1 ? isOnlapPrefix(p) : !isOnlapPrefix(p))
          const preferred = rootedHere.filter((f) => familyMatch(f.prefix))
          const cands = preferred.length > 0 ? preferred : rootedHere
          if (cands.length === 0) {
            // No flank rooted here: is there an emitted flank NEAR the root elevation but off-x
            // (MISROOTED) or is the root simply MISSING?
            const off = emittedFlanks.find(
              (f) =>
                !f.matched &&
                (Math.abs(f.a.y - ef.root.y) <= ROOT_TOL_M || Math.abs(f.b.y - ef.root.y) <= ROOT_TOL_M) &&
                (Math.abs(f.a.x - colX) <= ROOT_TOL_M || Math.abs(f.b.x - colX) <= ROOT_TOL_M),
            )
            if (off) anyMisrooted = true
            continue
          }
          // Take the first candidate; measure its lateral reach vs expected.
          const f = cands[0]
          f.matched = true
          matchedFlanks++
          // apex point = the endpoint that is NOT the root.
          const apexPt = near(f.a, ef.root) ? f.b : f.a
          const expectedReach = Math.abs(ef.apex.x - ef.root.x)
          const actualReach = Math.abs(apexPt.x - ef.root.x)
          if (expectedReach > ROOT_TOL_M && actualReach < COLLAPSE_FRAC * expectedReach) anyCollapsed = true
          // DANGLING: for a corr-1 onlap the apex should sit ON the tie within snap; measure the
          // apex-elevation error against the expected apex elevation.
          if (c === 1 && Math.abs(apexPt.y - ef.apex.y) > ROOT_TOL_M) {
            anyDangling = true
            danglingDetail = `matched ${f.prefix} apexYerr=${(Math.abs(apexPt.y - ef.apex.y) * 100).toFixed(1)}cm`
          }
        }

        // Merged-away interbeds: count carrier presence WITHOUT consuming (``matched`` is not read),
        // so a lens carrier rooted at a contact confirms the interbed's line on EVERY look — a lens
        // is emitted into BOTH adjacent gaps, and the greedy per-look ``f.matched`` consumption would
        // otherwise leave one look partial (a matcher artifact, not a missing line). A carrier at a
        // contact = that flank is drawn (``lens`` prefix); reach/apex geometry is the enclosed-lens
        // carrier's own (0.45 cap), not the raw expected apex, so it is NOT reach-checked here.
        let carrierRootedFlanks = 0
        if (isMergedAway) {
          for (const ef of expectedFlanks) {
            if (emittedFlanks.some((f) => f.prefix === 'lens' && flankRootsAt(f, ef.root))) carrierRootedFlanks++
          }
        }

        // ---- classify the raw identity ----
        let matchClass: MatchClass
        let note = ''
        if (c === 2) {
          // corr-2 expects NO termination flank — a band member. Not a defect (line art).
          matchClass = 'OK'
          note = 'corr-2 band member — no termination flank expected (given line art)'
        } else if (expectedFlanks.length === 0) {
          // corr-1 with the 8m same-litho suppression, OR corr-0 that produced no flank (degenerate).
          if (suppressed8m) {
            matchClass = 'SUPPRESSED-8M'
            note = 'corr-1 onlap flank suppressed (matched facing same litho, ruling 8m)'
          } else {
            // A tied corr-1/corr-0 that yields no expected flank via an 8a-shared / bridge tie: the
            // owner's 8a rule question — expected-none, NOT a defect. Recorded with its tie.
            matchClass = 'NOT-MISSING-TIED'
            note = `corr=${c} but no free flank expected (8a-shared / bridge tie): top=${tieRefLabel(
              eff.topTie,
            )} base=${tieRefLabel(eff.baseTie)}`
          }
        } else if (isMergedAway) {
          // RULING 8r / STEP 4.1 GROUND-TRUTH REFINEMENT. A merged-away interbed is spliced out of
          // the NORMALISED section, so it carries no termination of its own ``col:u`` identity — BUT
          // its lens line art IS drawn: ``emitEnclosedLensCurves`` emits the interbed's ``lens<n>``
          // closing flanks at its OWN original top/base contacts (the enclosed-lens carriers), and
          // the id split (``emitColumnVerticals``) now gives its interval its own ``col:lens`` column
          // edge. Those carriers ARE the interbed's lens lines. When they match ALL its expected
          // flanks (rooted at its contacts, ``lens`` is a TERMINATION_PREFIX) the interbed's linework
          // is PRESENT and CORRECT — it is OK, not the 8r "no line for the merged unit" debt. The
          // COLLAPSED/DANGLING reach checks are NOT applied here: the enclosed-lens carrier has its
          // OWN authoritative apex geometry (the 0.45 ``enclosedLensReach`` cap), which legitimately
          // differs from the raw corr-0/corr-1 expected apex — comparing them is a false positive.
          // Only a merged-away interbed whose flanks are NOT all drawn stays MERGED-AWAY (a genuine
          // notch/annulus residual — the §49 wall, e.g. the sub-snap CS1 gap21 lens whose degenerate
          // flanks were not emitted).
          if (carrierRootedFlanks >= expectedFlanks.length) {
            matchClass = 'OK'
            note = 'merged-away interbed — its lens carrier flanks are drawn (ruling 8r lines-before-the-merge)'
          } else {
            matchClass = 'MERGED-AWAY'
            note = `merged-away interbed: ${carrierRootedFlanks}/${expectedFlanks.length} lens-carrier flanks drawn (notch/annulus residual, §49)`
          }
        } else if (matchedFlanks === 0) {
          // Nothing rooted here at all.
          if (anyMisrooted) {
            matchClass = 'MISROOTED'
            note = 'an emitted flank sits near this contact but off its exact root (>1mm)'
          } else {
            // A corr-1 whose apex rides a bridge/jump tie that is never drawn as a curve = the S11
            // INVISIBLE-SUPPORT class. Detect it: the tied ref is resolved to a jump/bridge tie
            // (id starts 'jump' or the contact is bridge-anchored) yet no adjacent tie curve exists.
            const bridgeSupported =
              (eff.topTie?.kind === 'resolved' && /^jump/.test(eff.topTie.tie.id)) ||
              (eff.baseTie?.kind === 'resolved' && /^jump/.test(eff.baseTie.tie.id))
            if (c === 1 && bridgeSupported) {
              matchClass = 'INVISIBLE-SUPPORT'
              note = 'corr-1 onlap whose apex rides a jump/bridge tie that may not be drawn (S11 class)'
            } else {
              matchClass = 'MISSING'
              note = `expected ${expectedFlanks.length} flank(s), 0 emitted rooted at this unit's contacts`
            }
          }
        } else if (matchedFlanks < expectedFlanks.length) {
          matchClass = anyMisrooted ? 'MISROOTED' : 'MISSING'
          note = `expected ${expectedFlanks.length} flank(s), matched ${matchedFlanks}`
        } else if (anyCollapsed) {
          matchClass = 'COLLAPSED'
          note = 'emitted flank lateral reach < 10% of expected'
        } else if (anyDangling) {
          matchClass = 'DANGLING'
          note = `onlap apex not on its tie within snap (${danglingDetail})`
        } else {
          matchClass = 'OK'
          note = ''
        }

        byClass[matchClass]++

        rows.push({
          section: sec.name,
          gap: gi,
          side,
          col: colNames[ci],
          facing: side === 'left' ? colNames[gi + 1] : colNames[gi],
          rawUnitIndex: ui,
          layerId: u.layerId,
          formation: fname(u.formationId),
          topElev: round(u.topElev),
          baseElev: round(u.baseElev),
          corr: c,
          topTie: tieRefLabel(eff.topTie),
          baseTie: tieRefLabel(eff.baseTie),
          expectedKind,
          expectedFlanks: expectedFlanks.length,
          matchedFlanks,
          matchClass,
          note,
          collisionCouldShorten: collisionCouldShorten || undefined,
          mergedAway: isMergedAway || undefined,
        })
      }
    }
  }

  // PHANTOM + DUPLICATE: emitted termination flanks that never matched any raw expectation.
  const phantoms = emittedFlanks.filter((f) => !f.matched)
  // DUPLICATE detection: two emitted flanks that root at the SAME point (a duplicate termination).
  let duplicateRoots = 0
  for (let i = 0; i < emittedFlanks.length; i++) {
    for (let j = i + 1; j < emittedFlanks.length; j++) {
      if (near(emittedFlanks[i].a, emittedFlanks[j].a) && near(emittedFlanks[i].b, emittedFlanks[j].b)) {
        duplicateRoots++
      }
    }
  }
  void planAt // plan indexed for future per-plan cross-checks; the raw diff is the authority here.

  // ---- TIE-CONFORMANCE (SEED_FILL_MANDATE Step 4.2 "ALSO") ----
  // Raw approved edges (endpoints = the picked unit's OWN contact elevations, on the RAW/un-merged
  // stack — ruling 8r "lines before the merge") vs the emitted tie/bridge curves. A DROPPED edge is
  // one whose two contact endpoints have NO emitted tie/bridge curve within tolerance (the S46b S5
  // case: the edged interbed spliced into a same-formation band loses its layerId, so resolveTies
  // drops it). MOVED = matched but an endpoint shifted > 2 cm. INVENTED = an emitted tie/bridge
  // curve matching no raw approved edge. This measures the LINE ART only (no fill claim).
  const rawLoc = new Map<string, { x: number; topElev: number; baseElev: number; colName: string }>()
  for (let ci = 0; ci < rawSection.columns.length; ci++) {
    const col = rawSection.columns[ci]
    for (const u of col.units)
      rawLoc.set(u.layerId, { x: col.x, topElev: u.topElev, baseElev: u.baseElev, colName: colNames[ci] ?? `col${ci}` })
  }
  const endpointOf = (layerId: string, sideRaw: 'top' | 'base'): Point | null => {
    const loc = rawLoc.get(layerId)
    if (!loc) return null
    return { x: loc.x, y: sideRaw === 'top' ? loc.topElev : loc.baseElev }
  }
  const emittedTieCurves = emitted.curves
    .filter((c) => (TIE_PREFIXES as readonly string[]).includes(idPrefix(c.id)))
    .map((c) => ({ id: c.id, ...segEndpoints(c), matched: false }))
  const tieDropped: TieConf[] = []
  const tieMoved: TieConf[] = []
  let tieRaw = 0
  for (const e of edges) {
    const aSideRaw = (e.aSide ?? 'top') as 'top' | 'base'
    const bSideRaw = (e.bSide ?? 'top') as 'top' | 'base'
    const pa = endpointOf(e.a, aSideRaw)
    const pb = endpointOf(e.b, bSideRaw)
    if (!pa || !pb) continue // an endpoint not on the RAW stack (shouldn't happen — raw is un-merged)
    tieRaw++
    const conf: TieConf = {
      aName: rawLoc.get(e.a)?.colName ?? nameOf(e.a),
      bName: rawLoc.get(e.b)?.colName ?? nameOf(e.b),
      aSide: aSideRaw,
      bSide: bSideRaw,
      detail: '',
    }
    // Exact-tolerance match first (DROPPED vs present).
    const exact = emittedTieCurves.find(
      (c) => !c.matched && tieEndpointsMatch(c.a, c.b, pa, pb, TIE_X_TOL_M, TIE_ELEV_TOL_M),
    )
    if (exact) {
      exact.matched = true
      continue
    }
    // A looser elevation match → the tie EXISTS but MOVED (an endpoint shifted > 2 cm).
    const moved = emittedTieCurves.find(
      (c) => !c.matched && tieEndpointsMatch(c.a, c.b, pa, pb, TIE_X_TOL_M, 5),
    )
    if (moved) {
      moved.matched = true
      const dA = Math.min(
        Math.hypot(moved.a.x - pa.x, moved.a.y - pa.y),
        Math.hypot(moved.b.x - pa.x, moved.b.y - pa.y),
      )
      conf.detail = `moved ~${(dA * 100).toFixed(0)}cm (${moved.id})`
      tieMoved.push(conf)
      continue
    }
    // No emitted tie/bridge at these contacts at all → DROPPED.
    conf.detail = `raw a=(${pa.x.toFixed(1)},${pa.y.toFixed(2)}) b=(${pb.x.toFixed(1)},${pb.y.toFixed(2)}) — no emitted tie/bridge`
    tieDropped.push(conf)
  }
  const tieInvented = emittedTieCurves.filter((c) => !c.matched).length

  return {
    section: sec.name,
    cols: columns.length,
    rawUnits,
    survivingUnits,
    mergedAway,
    byClass,
    emittedTerminations: emittedFlanks.length,
    matchedTerminations: emittedFlanks.filter((f) => f.matched).length,
    phantomTerminations: phantoms.length,
    duplicateRoots,
    rows,
    tieRaw,
    tieDropped,
    tieMoved,
    tieInvented,
  }
}

describe('v2 line-stage diff (raw expected 0/1/2 -> endpoints -> emitted; MEASUREMENT ONLY)', () => {
  if (process.env.SHAPE_AUDIT !== '1') {
    it.skip('dormant (set SHAPE_AUDIT=1)', () => {})
    return
  }

  it('raw-unit line-stage diff across all 14 real sections (flag-ON)', () => {
    expect(existsSync(INPUT)).toBe(true)
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as {
      sections: RawSection[]
      formationNames: Record<string, string>
    }
    const nameMap: Record<string, string> = existsSync(NAMES)
      ? (JSON.parse(readFileSync(NAMES, 'utf8')) as Record<string, string>)
      : {}
    const fname = (id: string): string => raw.formationNames[id] ?? id.slice(0, 8)
    const nameOf = (id: string): string => nameMap[id] ?? id.slice(0, 8)

    const idVocab = new Map<string, number>()
    const results: SectionResult[] = []

    const prev = setTwoSidedTerminations(true)
    try {
      for (const sec of raw.sections) {
        results.push(diffSection(sec, fname, nameOf, idVocab))
      }
    } finally {
      setTwoSidedTerminations(prev)
    }

    // ---- grand totals ----
    const grand = EMPTY_CLASS_COUNTS()
    let rawUnits = 0
    let survivingUnits = 0
    let mergedAway = 0
    let emittedTerm = 0
    let matchedTerm = 0
    let phantomTerm = 0
    let dupRoots = 0
    for (const r of results) {
      for (const k of Object.keys(grand) as MatchClass[]) grand[k] += r.byClass[k]
      rawUnits += r.rawUnits
      survivingUnits += r.survivingUnits
      mergedAway += r.mergedAway
      emittedTerm += r.emittedTerminations
      matchedTerm += r.matchedTerminations
      phantomTerm += r.phantomTerminations
      dupRoots += r.duplicateRoots
    }

    // ---- owner cases: pull their raw rows out by column name substring ----
    const OWNER_CASES: { key: string; colMatch: RegExp }[] = [
      { key: 'S8 (GEO-10/170-S8, one-flank boundary lens)', colMatch: /GEO-10\/170-S8$/ },
      { key: 'S11 (GEO-10/170-S11, INVISIBLE-SUPPORT)', colMatch: /GEO-10\/170-S11$/ },
      { key: 'B3 (1411-GEO-23/126-B3, corr-1 diagonal tie)', colMatch: /126-B3$/ },
      { key: 'B4 (1411-GEO-23/126-B4, lens6-9 phantom claim)', colMatch: /126-B4$/ },
      { key: 'S5A (GEO-23/125-S5A, top clay LEFT onlap)', colMatch: /125-S5A$/ },
      { key: 'S6 (GEO-23/125-S6, second clay)', colMatch: /125-S6$/ },
      { key: 'S7 top sands (GEO-10/170-S7)', colMatch: /GEO-10\/170-S7$/ },
      { key: 'S6 top sands (GEO-10/170-S6)', colMatch: /GEO-10\/170-S6$/ },
    ]
    const allRows = results.flatMap((r) => r.rows)
    const ownerCaseRows: Record<string, DiffRow[]> = {}
    for (const oc of OWNER_CASES) {
      ownerCaseRows[oc.key] = allRows.filter((row) => oc.colMatch.test(row.col))
    }

    // ---- NOT-MISSING-TIED list (the 8a evidence) ----
    const notMissingTied = allRows
      .filter((r) => r.matchClass === 'NOT-MISSING-TIED')
      .map((r) => ({
        section: r.section,
        gap: r.gap,
        side: r.side,
        col: r.col,
        formation: r.formation,
        corr: r.corr,
        topTie: r.topTie,
        baseTie: r.baseTie,
        elev: [r.topElev, r.baseElev],
      }))

    // ---- MERGED-AWAY list (deduped by section+col+layerId; a middle column's unit appears on
    // both its left and right look, so the raw rows double-list it — the ``mergedAway`` counter is
    // already left-look-only, this list mirrors that uniqueness). ----
    const mergedSeen = new Set<string>()
    const mergedAwayRows: {
      section: string
      col: string
      formation: string
      rawUnitIndex: number
      corr: 0 | 1 | 2
      elev: number[]
    }[] = []
    for (const r of allRows) {
      if (!r.mergedAway) continue
      const key = `${r.section}|${r.col}|${r.layerId}`
      if (mergedSeen.has(key)) continue
      mergedSeen.add(key)
      mergedAwayRows.push({
        section: r.section,
        col: r.col,
        formation: r.formation,
        rawUnitIndex: r.rawUnitIndex,
        corr: r.corr,
        elev: [r.topElev, r.baseElev],
      })
    }

    // ---- full utils-dir listing (record totals, do NOT chase — a concurrent agent may move them) ----
    let utilsFileCount = 0
    let utilsDiagCount = 0
    try {
      const entries = readdirSync(UTILS_DIR)
      utilsFileCount = entries.length
      utilsDiagCount = entries.filter((e) => e.endsWith('.diag.test.ts')).length
    } catch {
      // directory listing best-effort only.
    }

    const idVocabObj = Object.fromEntries([...idVocab.entries()].sort((a, b) => a[0].localeCompare(b[0])))

    const dump = {
      generatedFor:
        'RAW-unit line-stage diff: raw expected 0/1/2 -> raw expected endpoints -> emitted curves. 14 real sections, flag-ON. MEASUREMENT ONLY.',
      determinism:
        'no Date.now / Math.random; fixed column-first + gap iteration; ties/bridge from emitCurves on the RAW section; plans from buildTerminationPlans on the normalised section.',
      grandTotals: {
        rawUnits,
        survivingUnits,
        mergedAway,
        emittedTerminations: emittedTerm,
        matchedTerminations: matchedTerm,
        phantomTerminations: phantomTerm,
        duplicateRootPairs: dupRoots,
        byClass: grand,
      },
      idVocabulary: idVocabObj,
      terminationPrefixesMatched: TERMINATION_PREFIXES,
      perSection: results.map((r) => ({
        section: r.section,
        cols: r.cols,
        rawUnits: r.rawUnits,
        survivingUnits: r.survivingUnits,
        mergedAway: r.mergedAway,
        emittedTerminations: r.emittedTerminations,
        matchedTerminations: r.matchedTerminations,
        phantomTerminations: r.phantomTerminations,
        duplicateRootPairs: r.duplicateRoots,
        byClass: r.byClass,
        tieConformance: {
          rawEdges: r.tieRaw,
          dropped: r.tieDropped,
          moved: r.tieMoved,
          invented: r.tieInvented,
        },
      })),
      ownerCases: ownerCaseRows,
      notMissingTied,
      mergedAwayRows,
      utilsDir: { fileCount: utilsFileCount, diagTestCount: utilsDiagCount },
      rows: allRows,
    }
    writeFileSync(DUMP, JSON.stringify(dump, null, 1))

    // ---- console report ----
    console.log('\n########## LINE-STAGE DIFF — PER-SECTION COUNTS ##########')
    for (const r of results) {
      const bc = r.byClass
      console.log(
        `\n=== ${r.section}: cols=${r.cols} rawUnits=${r.rawUnits} surviving=${r.survivingUnits} mergedAway=${r.mergedAway}`,
      )
      console.log(
        `    OK=${bc.OK} MISSING=${bc.MISSING} MISROOTED=${bc.MISROOTED} COLLAPSED=${bc.COLLAPSED} ` +
          `DANGLING=${bc.DANGLING} WRONG-SIDE=${bc['WRONG-SIDE']} INVIS-SUPPORT=${bc['INVISIBLE-SUPPORT']} ` +
          `NOT-MISSING-TIED=${bc['NOT-MISSING-TIED']} MERGED-AWAY=${bc['MERGED-AWAY']} SUPPRESSED-8M=${bc['SUPPRESSED-8M']}`,
      )
      console.log(
        `    emitted term flanks=${r.emittedTerminations} matched=${r.matchedTerminations} ` +
          `phantom=${r.phantomTerminations} duplicateRootPairs=${r.duplicateRoots}`,
      )
    }

    console.log('\n########## GRAND TOTALS ##########')
    console.log(`  rawUnits=${rawUnits} surviving=${survivingUnits} mergedAway=${mergedAway}`)
    for (const k of Object.keys(grand) as MatchClass[]) console.log(`  ${k}: ${grand[k]}`)
    console.log(
      `  emitted term flanks=${emittedTerm} matched=${matchedTerm} phantom=${phantomTerm} duplicateRootPairs=${dupRoots}`,
    )

    // ---- TIE-CONFORMANCE grand totals (SEED_FILL_MANDATE Step 4.2 "ALSO") ----
    const tieRawTot = results.reduce((s, r) => s + r.tieRaw, 0)
    const tieDroppedTot = results.reduce((s, r) => s + r.tieDropped.length, 0)
    const tieMovedTot = results.reduce((s, r) => s + r.tieMoved.length, 0)
    const tieInventedTot = results.reduce((s, r) => s + r.tieInvented, 0)
    console.log('\n########## TIE-CONFORMANCE (raw approved edges vs emitted tie/bridge) ##########')
    console.log(
      `  GRAND: rawEdges=${tieRawTot} DROPPED=${tieDroppedTot} MOVED=${tieMovedTot} INVENTED=${tieInventedTot}`,
    )
    for (const r of results) {
      if (r.tieDropped.length === 0 && r.tieMoved.length === 0 && r.tieInvented === 0) continue
      console.log(
        `  ${r.section}: rawEdges=${r.tieRaw} DROPPED=${r.tieDropped.length} MOVED=${r.tieMoved.length} INVENTED=${r.tieInvented}`,
      )
      for (const d of r.tieDropped)
        console.log(`     DROPPED  ${d.aName}[${d.aSide}] <-> ${d.bName}[${d.bSide}] | ${d.detail}`)
      for (const d of r.tieMoved)
        console.log(`     MOVED    ${d.aName}[${d.aSide}] <-> ${d.bName}[${d.bSide}] | ${d.detail}`)
    }

    console.log('\n########## ID VOCABULARY (all emitted curve prefixes) ##########')
    for (const [k, v] of Object.entries(idVocabObj)) console.log(`  ${k}: ${v}`)

    console.log('\n########## OWNER CASES ##########')
    for (const oc of OWNER_CASES) {
      const rowsOc = ownerCaseRows[oc.key]
      console.log(`\n-- ${oc.key} (${rowsOc.length} raw rows) --`)
      for (const row of rowsOc) {
        console.log(
          `   ${row.section} gap${row.gap}[${row.side}] u${row.rawUnitIndex} ${row.formation} ` +
            `el[${row.baseElev}..${row.topElev}] corr=${row.corr} kind=${row.expectedKind} ` +
            `exp=${row.expectedFlanks} matched=${row.matchedFlanks} => ${row.matchClass}` +
            (row.mergedAway ? ' [MERGED-AWAY]' : '') +
            (row.collisionCouldShorten ? ' [collisionCouldShorten]' : '') +
            ` | topTie=${row.topTie} baseTie=${row.baseTie}${row.note ? ' | ' + row.note : ''}`,
        )
      }
    }

    console.log('\n########## NOT-MISSING-TIED (the 8a evidence) ##########')
    for (const n of notMissingTied) {
      console.log(
        `   ${n.section} gap${n.gap}[${n.side}] ${n.col} ${n.formation} corr=${n.corr} ` +
          `top=${n.topTie} base=${n.baseTie} el[${n.elev[1]}..${n.elev[0]}]`,
      )
    }

    console.log('\n########## MERGED-AWAY (ruling 8r debt) ##########')
    console.log(`  count=${mergedAway}`)
    for (const m of mergedAwayRows) {
      console.log(
        `   ${m.section} ${m.col} u${m.rawUnitIndex} ${m.formation} corr=${m.corr} el[${m.elev[1]}..${m.elev[0]}]`,
      )
    }

    console.log(`\n  utils dir: ${utilsFileCount} files, ${utilsDiagCount} diag tests (recorded, not chased)`)
    console.log(`  dumped -> ${DUMP}`)

    // Pure reporter — never fails.
    expect(true).toBe(true)
  })
})
