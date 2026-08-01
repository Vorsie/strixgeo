/**
 * ADVERSARIAL RE-DERIVATION of the geotech-axis render-vs-build disagreement.
 *
 * A separate reporter (``geotechEngineAgreement.diag.test.ts``) measured the two
 * geotech-axis geometries by sampling the along axis at a fixed step and taking
 * the midpoint class of every elevation run. This file exists to attack that
 * result rather than to repeat it, so nothing here is shared with it beyond the
 * production engine calls themselves, which ARE the thing under measurement and
 * cannot be replaced without measuring something else.
 *
 * WHAT IS DIFFERENT HERE.
 *
 * 1. AREA INTEGRATION IS EXACT, NOT SAMPLED. Every x at which the painted
 *    structure can change is enumerated first: every polygon vertex of both
 *    arms, plus every proper crossing between every pair of polygon edges. On a
 *    strip between two consecutive such x values no boundary crosses another, so
 *    each painted run's top and base are linear in x, every bucket's thickness is
 *    linear in x, and a bucket that vanishes does so exactly at a strip end. The
 *    trapezoid rule over the strip is therefore EXACT, not an approximation, and
 *    the result is independent of any step size. If the sampled headline is a
 *    sampling artifact this integration will not reproduce it.
 *
 * 2. CLASS KEYING IS INDEPENDENT AND TWO-DIMENSIONAL. Rather than one composite
 *    string, soil code and NAD packing class are carried as separate axes, and
 *    the render arm's "no packing data" case is read from the engine's own
 *    ``tag === 'fallback'`` flag rather than inferred from which lookup table the
 *    formation id happens to appear in. That splits the answer into the three
 *    questions the owner actually has: do the arms put the same SOIL here, do
 *    they grade the same soil the same way, and does one arm simply have nothing
 *    to say.
 *
 * 3. THE SLIVER QUESTION IS ANSWERED AT THE BUILD'S OWN GRID. The 3-D model is
 *    labelled on a voxel grid whose stored parameters on this project are
 *    ``horizontal_spacing_m = 2`` and ``vertical_spacing_m = 0.25`` (read from
 *    ``litho_build_generation``; the newest generation also records
 *    ``grid_origin_z = -16.47``). Disagreement thinner than one cell cannot
 *    survive labelling, so the whole comparison is re-run a second time with both
 *    arms quantised onto that grid — cell centres, aligned to the real origin.
 *    Re-sampling the along axis FINER, as the first reporter did, cannot answer
 *    this question; it can only confirm convergence of the fine-scale integral.
 *
 * 4. THE DENOMINATOR IS REPORTED THREE WAYS. Union-based (the first reporter's
 *    headline), overlap-only (of the plane both arms paint, how much do they
 *    grade differently), and one-sided coverage in each direction. A single
 *    percentage that mixes "we disagree about the class here" with "one of us
 *    has nothing here" is not wrong, but it is not separable either.
 *
 * RANK-PAIRING. The two arms do not share a column set, so gap index i is a
 * different physical band in each and no polygon, region, interval or ordinal of
 * one arm is ever matched to a counterpart in the other. Both are mapped into
 * along-section metres by elevation using their OWN column positions, and the
 * only question asked is what each paints at a given physical point. The
 * precondition for that mapping — that the geotech columns are litho columns at
 * identical along positions — is asserted per section and printed.
 *
 * Pure reporter; it never fails the suite. Dormant unless ``GEOTECH_REFUTE=1``.
 *
 * Run:
 *   cd desktop
 *   GEOTECH_REFUTE=1 npx vitest run src/renderer/src/utils/geotechAgreementRefute.diag.test.ts \
 *     --disableConsoleIntercept --testTimeout=1800000
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  buildApexOverridesForGaps,
  detectPersistedLensBodies,
  type GapExtent,
} from '../components/sections/apexOverrideWiring'
import type { BodyBoundaryResponse } from '../api/clients/geology.types'
import type {
  CorrelationEdge,
  LensApexOverride,
  PartitionColumn,
  SectionRegion,
} from './partitionFill'
import { computeSectionFillActive, isPartitionEngineV2Active } from './partitionEngineSelect'
import {
  refineLithoPartition,
  type GeotechColumn,
  type NadFormationMeta,
  type RefinedPolygon,
} from './refineLithoPartition'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const INPUT = resolve(REPO_ROOT, 'scripts/throwaway_geotech_axis_inputs.json')
const PRIOR = resolve(REPO_ROOT, 'scripts/throwaway_geotech_agreement_detail.json')
const OUT = resolve(REPO_ROOT, 'scripts/throwaway_geotech_refute_detail.json')

/** Build grid parameters, read from ``litho_build_generation`` on this project. */
const VOXEL_DZ_M = Number(process.env.GEOTECH_REFUTE_DZ ?? '0.25')
const VOXEL_DX_M = Number(process.env.GEOTECH_REFUTE_DX ?? '2')
const VOXEL_ORIGIN_Z = Number(process.env.GEOTECH_REFUTE_Z0 ?? '-16.47')

/** Elevation tolerance below which two breakpoints are the same point. */
const EPS = 1e-9
/**
 * Fractional inset from each strip end at which the strip's two exact endpoint
 * profiles are evaluated. Small enough that the trapezoid stays exact to well
 * under a square millimetre, large enough to stay clear of the endpoint itself.
 */
const STRIP_INSET = 1e-7
/** Strips narrower than this carry no meaningful area and are skipped. */
const MIN_STRIP_W = 1e-9
/** Column-probe offset as a fraction of the adjoining gap; reported for audit. */
const SIDE_FRAC_ENV = process.env.GEOTECH_REFUTE_SIDEFRAC ?? '1e-4'

// ---------------------------------------------------------------------------
// Extract shapes
// ---------------------------------------------------------------------------

interface RawUnit {
  layerId: string
  topDepthM: number
  baseDepthM: number
  formationId: string
  bodyId: string | null
}

interface RawColumn {
  investigationId: string
  surfaceElevM: number | null
  units: RawUnit[]
}

interface RawEdge {
  a: string
  b: string
  aSide?: string
  bSide?: string
}

interface RawGeotechLayer {
  id: string
  investigationId: string
  depth_top_m: number
  depth_base_m: number
  formation_id: string
  body_id: string | null
}

interface RawSection {
  sectionId: string
  name: string
  kind: string
  columns: RawColumn[]
  edges: RawEdge[]
  alongM: number[]
  geotech: { columns: RawColumn[]; edges: RawEdge[]; alongM: number[] }
  refinement: { geotechLayers: RawGeotechLayer[] }
  anchor: string
}

interface RawInvestigation {
  id: string
  name: string
  kind: string
}

interface RawFile {
  meta: Record<string, unknown>
  investigations: RawInvestigation[]
  refinementBundle: {
    nadMeta: Record<string, { nadClass: number | null; soilCode: string | null }>
    lithoSoilByFormationId: Record<string, string | null>
  }
  bodyBoundaries: {
    litho: Record<string, BodyBoundaryResponse>
    geotech: Record<string, BodyBoundaryResponse>
  }
  sections: RawSection[]
}

// ---------------------------------------------------------------------------
// Arm assembly — written against the production call sites, not copied
// ---------------------------------------------------------------------------

/**
 * Order and filter one arm's columns the way ``assembleSectionPartitionInput``
 * and the overlay's ``valid`` filter both do: a column needs a surface elevation
 * and at least one unit, and the engine consumes them in along order.
 *
 * @param cols Raw columns from the extract.
 * @param alongM Along position per raw column, 1:1 with ``cols``.
 * @returns The engine's columns and their along positions, in lockstep.
 */
function assembleColumns(
  cols: readonly RawColumn[],
  alongM: readonly number[],
): { columns: PartitionColumn[]; alongM: number[] } {
  const paired = cols
    .map((c, i) => ({ c, a: alongM[i] }))
    .filter(({ c }) => c.surfaceElevM != null && c.units.length > 0)
    .sort((p, q) => p.a - q.a)
  return {
    columns: paired.map(({ c }) => ({
      investigationId: c.investigationId,
      surfaceElevM: c.surfaceElevM as number,
      units: [...c.units].sort((a, b) => a.topDepthM - b.topDepthM),
    })),
    alongM: paired.map(({ a }) => a),
  }
}

/** Reshape stored edges into the engine's shape; sides drive band vs bottom-tie. */
function toEdges(raw: readonly RawEdge[]): CorrelationEdge[] {
  return raw.map((e) => ({
    a: e.a,
    b: e.b,
    aSide: (e.aSide ?? 'top') as 'top' | 'base',
    bSide: (e.bSide ?? 'top') as 'top' | 'base',
  }))
}

/**
 * Derive hand-drawn apex overrides in the screen-free form ``buildVoxelRequest``
 * uses: along metres as the horizontal coordinate, identity transform, both drag
 * states null.
 *
 * @param columns The engine's ordered columns.
 * @param edges The section's approved correlation edges.
 * @param alongM Along position per column, 1:1 with ``columns``.
 * @param boundaries Stored hand-drawn boundary shapes by body id.
 * @param engineV2 Whether the active engine consumes contact overrides.
 * @returns The apex override map the engine is called with.
 */
function deriveOverrides(
  columns: readonly PartitionColumn[],
  edges: readonly CorrelationEdge[],
  alongM: readonly number[],
  boundaries: ReadonlyMap<string, BodyBoundaryResponse>,
  engineV2: boolean,
): Map<string, LensApexOverride> {
  const gapXs: GapExtent[] = columns
    .slice(0, -1)
    .map((_, i) => ({ leftX: alongM[i], rightX: alongM[i + 1] }))
  const identity = (along: number): number => along
  const persistedLensBodies =
    boundaries.size > 0
      ? detectPersistedLensBodies(
          computeSectionFillActive(columns, edges, undefined, alongM),
          columns,
          boundaries,
          identity,
          gapXs,
        )
      : undefined
  const { apexOverrides } = buildApexOverridesForGaps({
    orderedColumns: columns,
    gapXs,
    boundariesByBodyId: boundaries,
    alongToScreenX: identity,
    screenToLevel: undefined,
    lensDrag: null,
    boundaryDrag: null,
    partitionEngineV2: engineV2,
    persistedLensBodies,
  })
  return apexOverrides
}

// ---------------------------------------------------------------------------
// Geometry — polygons mapped into (along metres, elevation)
// ---------------------------------------------------------------------------

/** A class token pair carried on every mapped polygon. */
interface ClassTag {
  /** Soil code, or ``'?'`` when the formation resolves to none. */
  soil: string
  /** NAD packing class token, or ``'none'`` when the arm has no packing here. */
  nad: string
  /** True when this is the render arm's no-packing-data fallback polygon. */
  fallback: boolean
}

/** A polygon of one arm, in along metres by elevation. */
interface MappedPoly {
  tag: ClassTag
  xmin: number
  xmax: number
  xs: number[]
  es: number[]
}

/** One painted elevation run at a single along position. */
interface Run {
  top: number
  base: number
  tag: ClassTag
}

/**
 * Map a polygon out of gap-local fraction into along metres using the arm's own
 * column positions.
 *
 * @param pts Ring in (fraction, elevation) order.
 * @param left Along position of the gap's left column, in metres.
 * @param right Along position of the gap's right column, in metres.
 * @param tag The class this polygon paints.
 * @returns The mapped polygon, or ``null`` for a degenerate gap.
 */
function mapPoly(
  pts: readonly { fraction: number; elevation: number }[],
  left: number,
  right: number,
  tag: ClassTag,
): MappedPoly | null {
  if (!Number.isFinite(left) || !Number.isFinite(right) || right - left <= 0) return null
  if (pts.length < 3) return null
  const xs = pts.map((p) => left + p.fraction * (right - left))
  const es = pts.map((p) => p.elevation)
  return { tag, xmin: Math.min(...xs), xmax: Math.max(...xs), xs, es }
}

/**
 * Elevation intervals where the vertical line at ``x`` crosses a closed ring.
 *
 * The crossing rule is half-open in x so a vertex sitting exactly on the sample
 * line is counted once rather than twice, which is what keeps the even-odd
 * pairing below from inverting inside and outside.
 *
 * @param p The mapped polygon.
 * @param x Along position of the line, in metres.
 * @returns Ascending ``[base, top]`` pairs.
 */
function sliceAt(p: MappedPoly, x: number): [number, number][] {
  const ys: number[] = []
  const n = p.xs.length
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const ax = p.xs[i]
    const bx = p.xs[j]
    if ((ax <= x && bx > x) || (bx <= x && ax > x)) {
      const t = (x - ax) / (bx - ax)
      ys.push(p.es[i] + t * (p.es[j] - p.es[i]))
    }
  }
  if (ys.length < 2) return []
  ys.sort((a, b) => a - b)
  const out: [number, number][] = []
  for (let i = 0; i + 1 < ys.length; i += 2) out.push([ys[i], ys[i + 1]])
  return out
}

/**
 * Paint one run over an existing stack, later paint winning.
 *
 * Both surfaces resolve this way: a lens overlay is drawn after the matrix it
 * sits in and takes the space, and the voxel labeller honours the same order.
 *
 * @param stack Runs already painted.
 * @param s The run being painted on top.
 * @returns The new stack, disjoint by construction.
 */
function stamp(stack: readonly Run[], s: Run): Run[] {
  const out: Run[] = []
  for (const e of stack) {
    if (e.base >= s.top - EPS || e.top <= s.base + EPS) {
      out.push(e)
      continue
    }
    if (e.top > s.top + EPS) out.push({ top: e.top, base: s.top, tag: e.tag })
    if (e.base < s.base - EPS) out.push({ top: s.base, base: e.base, tag: e.tag })
  }
  out.push(s)
  return out
}

/**
 * Resolve one arm's painted stack at a single along position.
 *
 * @param polys The arm's polygons in paint order (earliest first).
 * @param x Along position, in metres.
 * @returns The disjoint painted runs at that line.
 */
function paintAt(polys: readonly MappedPoly[], x: number): Run[] {
  let stack: Run[] = []
  for (const p of polys) {
    if (x < p.xmin || x > p.xmax) continue
    for (const [lo, hi] of sliceAt(p, x)) {
      if (hi - lo <= EPS) continue
      stack = stamp(stack, { top: hi, base: lo, tag: p.tag })
    }
  }
  return stack
}

/**
 * The class painted at one elevation, or ``null`` where the arm has nothing.
 *
 * @param runs Disjoint painted runs.
 * @param e Elevation in metres.
 */
function tagAt(runs: readonly Run[], e: number): ClassTag | null {
  for (const r of runs) if (e <= r.top && e >= r.base) return r.tag
  return null
}

// ---------------------------------------------------------------------------
// Exact strip decomposition
// ---------------------------------------------------------------------------

/** One polygon edge, oriented for the sweep. */
interface SweepEdge {
  x0: number
  e0: number
  x1: number
  e1: number
  xmin: number
  xmax: number
}

/** Every edge of every polygon of both arms, for crossing enumeration. */
function edgesOf(polys: readonly MappedPoly[]): SweepEdge[] {
  const out: SweepEdge[] = []
  for (const p of polys) {
    const n = p.xs.length
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      const x0 = p.xs[i]
      const x1 = p.xs[j]
      out.push({
        x0,
        e0: p.es[i],
        x1,
        e1: p.es[j],
        xmin: Math.min(x0, x1),
        xmax: Math.max(x0, x1),
      })
    }
  }
  return out
}

/**
 * The along position of a proper crossing between two edges, if there is one.
 *
 * Only crossings strictly interior to both edges matter; a shared endpoint is
 * already a breakpoint because it is a vertex.
 *
 * @param a First edge.
 * @param b Second edge.
 * @returns The crossing x in metres, or ``null``.
 */
function crossingX(a: SweepEdge, b: SweepEdge): number | null {
  const lo = Math.max(a.xmin, b.xmin)
  const hi = Math.min(a.xmax, b.xmax)
  if (hi - lo <= 0) return null
  const adx = a.x1 - a.x0
  const bdx = b.x1 - b.x0
  if (adx === 0 || bdx === 0) return null
  const as = (a.e1 - a.e0) / adx
  const bs = (b.e1 - b.e0) / bdx
  const den = as - bs
  if (den === 0) return null
  const ai = a.e0 - as * a.x0
  const bi = b.e0 - bs * b.x0
  const x = (bi - ai) / den
  if (!Number.isFinite(x) || x <= lo || x >= hi) return null
  return x
}

/**
 * Every along position at which the painted structure of either arm can change.
 *
 * Between two consecutive returned values no boundary crosses another, so every
 * painted run's top and base are linear in x there. That is what makes the
 * trapezoid integration below exact rather than approximate.
 *
 * @param polys All polygons of both arms.
 * @returns Sorted, de-duplicated breakpoints in metres.
 */
function breakpoints(polys: readonly MappedPoly[]): number[] {
  const xs: number[] = []
  for (const p of polys) for (const x of p.xs) xs.push(x)
  const edges = edgesOf(polys).sort((a, b) => a.xmin - b.xmin)
  const active: SweepEdge[] = []
  for (const e of edges) {
    for (let i = active.length - 1; i >= 0; i--) {
      if (active[i].xmax < e.xmin) {
        active[i] = active[active.length - 1]
        active.pop()
      }
    }
    for (const f of active) {
      const x = crossingX(e, f)
      if (x !== null) xs.push(x)
    }
    active.push(e)
  }
  xs.sort((a, b) => a - b)
  const out: number[] = []
  for (const x of xs) {
    if (out.length === 0 || x - out[out.length - 1] > MIN_STRIP_W) out.push(x)
  }
  return out
}

// ---------------------------------------------------------------------------
// Buckets
// ---------------------------------------------------------------------------

/** Area totals of one comparison, in square metres of the section plane. */
interface Buckets {
  /** Both arms paint and the soil AND packing class match. */
  agree: number
  /** Both paint, same soil, but one has packing and the other does not. */
  noPackingData: number
  /** Both paint and the SOIL differs — a different material at that point. */
  soilDiffers: number
  /** Both paint, same soil, both have packing, and the class differs. */
  classDiffers: number
  /** The section draws material where the build has none. */
  renderOnly: number
  /** The build has material where the section draws none. */
  buildOnly: number
}

const zeroBuckets = (): Buckets => ({
  agree: 0,
  noPackingData: 0,
  soilDiffers: 0,
  classDiffers: 0,
  renderOnly: 0,
  buildOnly: 0,
})

const addBuckets = (into: Buckets, from: Buckets): void => {
  into.agree += from.agree
  into.noPackingData += from.noPackingData
  into.soilDiffers += from.soilDiffers
  into.classDiffers += from.classDiffers
  into.renderOnly += from.renderOnly
  into.buildOnly += from.buildOnly
}

/** Total area either arm paints. */
const unionOf = (b: Buckets): number =>
  b.agree + b.noPackingData + b.soilDiffers + b.classDiffers + b.renderOnly + b.buildOnly
/** Total area BOTH arms paint. */
const overlapOf = (b: Buckets): number =>
  b.agree + b.noPackingData + b.soilDiffers + b.classDiffers
/** Total disagreement of any kind, on the shared plane. */
const disagreeOf = (b: Buckets): number => b.noPackingData + b.soilDiffers + b.classDiffers

/**
 * Classify one point where both arms paint and add its area to the right bucket.
 *
 * @param b The buckets being accumulated into.
 * @param ra Render arm's class at the point.
 * @param rb Build arm's class at the point.
 * @param area Area in square metres attributed to the point.
 */
function scorePair(b: Buckets, ra: ClassTag, rb: ClassTag, area: number): void {
  if (ra.soil !== rb.soil) {
    b.soilDiffers += area
    return
  }
  if (ra.fallback !== rb.fallback || ra.nad === 'none' || rb.nad === 'none') {
    if (ra.nad === rb.nad && ra.fallback === rb.fallback) b.agree += area
    else b.noPackingData += area
    return
  }
  if (ra.nad === rb.nad) b.agree += area
  else b.classDiffers += area
}

/** Per-section result of both the exact pass and the voxel-grid pass. */
interface SectionOut {
  name: string
  buildComputable: boolean
  reason: string
  lithoCols: number
  geoCols: number
  offAxis: number
  renderPolys: number
  buildPolys: number
  strips: number
  exact: Buckets
  voxel: Buckets
  voxelCells: number
  /** Disagreement area whose painted run is thinner than one voxel cell. */
  thinDisagree: number
  /** Disagreement area in runs at least one voxel cell thick. */
  thickDisagree: number
  /** Disagreement in litho gaps that touch a borehole column. */
  disagreeBoreholeGap: number
  /** Disagreement in litho gaps bounded by two CPTs, which both arms can see. */
  disagreeCptGap: number
  /**
   * Area the prior reporter's precedence books as "one arm has no packing to
   * show" although the two arms name a different SOIL there.
   */
  soilDiffMaskedAsNoPacking: number
  /**
   * Column-fidelity against the logged geotech stack: how much of it each arm
   * reproduces, and how much it even COVERS, at the investigations themselves.
   * ``lithoCovM`` is the raw litho partition the render arm refines, so the gap
   * between it and ``renderCovM`` is geometry the NAD refinement lost.
   */
  fidelity: {
    refM: number
    renderOkM: number
    buildOkM: number
    renderCovM: number
    buildCovM: number
    lithoCovM: number
    columns: number
  }
  renderCoverCheck: number
  buildCoverCheck: number
  /** Exact area the raw litho partition paints. */
  lithoCoverM2: number
  /** Exact area the litho partition paints and the refined output does not. */
  refinementLostM2: number
  residual: number
}

const pct = (num: number, den: number): number => (den > 0 ? (num / den) * 100 : 0)
const f1 = (v: number): string => v.toFixed(1)

describe('geotech axis — adversarial re-derivation', () => {
  if (process.env.GEOTECH_REFUTE !== '1') {
    it.skip('dormant (set GEOTECH_REFUTE=1)', () => {})
    return
  }

  it('re-derives the disagreement exactly and at the build grid', () => {
    expect(existsSync(INPUT)).toBe(true)
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as RawFile
    const engineV2 = isPartitionEngineV2Active()

    const nadMeta = new Map<string, NadFormationMeta>(
      Object.entries(raw.refinementBundle.nadMeta).map(([k, v]) => [
        k,
        { nadClass: v.nadClass, soilCode: v.soilCode },
      ]),
    )
    const lithoSoil = new Map<string, string | null>(
      Object.entries(raw.refinementBundle.lithoSoilByFormationId),
    )
    const lithoBoundaries = new Map<string, BodyBoundaryResponse>(
      Object.entries(raw.bodyBoundaries.litho),
    )
    const geotechBoundaries = new Map<string, BodyBoundaryResponse>(
      Object.entries(raw.bodyBoundaries.geotech),
    )
    const kindByInv = new Map<string, string>(raw.investigations.map((i) => [i.id, i.kind]))
    const invNameById = new Map<string, string>(raw.investigations.map((i) => [i.id, i.name]))

    /**
     * Resolve a formation id to its two independent class axes.
     *
     * A geotech formation carries both a soil code and a NAD packing class. A
     * litho formation carries only a soil code, so its packing axis is ``none``
     * — that is a real statement about the data, not a missing value to be
     * guessed at.
     *
     * @param formationId The formation the polygon carries.
     * @param fallback Whether the engine tagged the polygon as no-packing-data.
     */
    const tagOf = (formationId: string, fallback: boolean): ClassTag => {
      const m = nadMeta.get(formationId)
      if (m && !fallback) {
        return {
          soil: m.soilCode ?? '?',
          nad: m.nadClass == null ? 'none' : `n${m.nadClass}`,
          fallback: false,
        }
      }
      const s = lithoSoil.get(formationId)
      return { soil: s ?? m?.soilCode ?? '?', nad: 'none', fallback: true }
    }

    console.log('')
    console.log('='.repeat(100))
    console.log('ADVERSARIAL RE-DERIVATION — geotech axis, render vs build')
    console.log('='.repeat(100))
    console.log(`  input          ${INPUT}`)
    console.log(`  active engine  ${engineV2 ? 'v2' : 'v1'}`)
    console.log(
      `  build grid     dx=${VOXEL_DX_M} m  dz=${VOXEL_DZ_M} m  originZ=${VOXEL_ORIGIN_Z} m ` +
        `(from litho_build_generation)`,
    )
    console.log(
      `  build anchor   persisted geotech generations = ` +
        `${String(raw.meta.persistedGeotechBuildGenerations)} — the build arm has no witness`,
    )
    console.log('')

    const outs: SectionOut[] = []
    const totalExact = zeroBuckets()
    const totalVoxel = zeroBuckets()
    const buildableExact = zeroBuckets()
    let worstResidual = 0
    let totalOffAxis = 0
    const globalSoilPairs = new Map<string, number>()
    const globalNadPairs = new Map<string, number>()

    for (const sec of raw.sections) {
      // ---- RENDER arm -------------------------------------------------
      const L = assembleColumns(sec.columns, sec.alongM)
      const lithoEdges = toEdges(sec.edges)
      const renderOverrides = deriveOverrides(
        L.columns,
        lithoEdges,
        L.alongM,
        lithoBoundaries,
        engineV2,
      )
      const lithoRegions: SectionRegion[] =
        L.columns.length >= 2
          ? computeSectionFillActive(L.columns, lithoEdges, renderOverrides, L.alongM)
          : []

      const geoByInv = new Map<string, GeotechColumn['units'][number][]>()
      for (const l of sec.refinement.geotechLayers) {
        const arr = geoByInv.get(l.investigationId) ?? []
        arr.push({
          layerId: l.id,
          topDepthM: l.depth_top_m,
          baseDepthM: l.depth_base_m,
          formationId: l.formation_id,
          bodyId: l.body_id ?? null,
        })
        geoByInv.set(l.investigationId, arr)
      }
      const columnOrder = L.columns.map((c) => c.investigationId)
      const geoColByInv = new Map<string, GeotechColumn>()
      for (const c of L.columns) {
        geoColByInv.set(c.investigationId, {
          investigationId: c.investigationId,
          surfaceElevM: c.surfaceElevM,
          units: geoByInv.get(c.investigationId) ?? [],
        })
      }
      const refined: RefinedPolygon[] =
        lithoRegions.length > 0
          ? refineLithoPartition(lithoRegions, columnOrder, geoColByInv, nadMeta, lithoSoil)
          : []

      // ---- BUILD arm --------------------------------------------------
      const G = assembleColumns(sec.geotech.columns, sec.geotech.alongM)
      const geoEdges = toEdges(sec.geotech.edges)
      const buildComputable = G.columns.length >= 2
      const buildOverrides = buildComputable
        ? deriveOverrides(G.columns, geoEdges, G.alongM, geotechBoundaries, engineV2)
        : new Map<string, LensApexOverride>()
      const buildRegions: SectionRegion[] = buildComputable
        ? computeSectionFillActive(G.columns, geoEdges, buildOverrides, G.alongM)
        : []

      // The precondition for comparing in along space at all.
      const lithoAlongByInv = new Map(L.columns.map((c, i) => [c.investigationId, L.alongM[i]]))
      const offAxis = G.columns.filter((c, i) => {
        const a = lithoAlongByInv.get(c.investigationId)
        return a === undefined || Math.abs(a - G.alongM[i]) > 1e-6
      }).length
      totalOffAxis += offAxis

      // ---- Map both arms into along metres ----------------------------
      const renderPolys: MappedPoly[] = []
      for (const p of refined) {
        const m = mapPoly(
          p.points,
          L.alongM[p.gapIndex],
          L.alongM[p.gapIndex + 1],
          tagOf(p.formationId, p.tag === 'fallback'),
        )
        if (m) renderPolys.push(m)
      }
      const buildOrdered = [...buildRegions].sort(
        (a, b) => (a.kind === 'lens' ? 1 : 0) - (b.kind === 'lens' ? 1 : 0),
      )
      const buildPolys: MappedPoly[] = []
      for (const r of buildOrdered) {
        const m = mapPoly(
          r.polygon,
          G.alongM[r.gapIndex],
          G.alongM[r.gapIndex + 1],
          tagOf(r.formationId, false),
        )
        if (m) buildPolys.push(m)
      }

      // The RAW litho partition in the same space. It is what the render arm
      // refines, and ``refineLithoPartition`` documents litho boundaries as
      // INVARIANT, so anything the litho partition covers and the refined output
      // does not is geometry the NAD carve lost — a render-arm defect that has
      // nothing to do with the build engine. Tagged as fallback throughout
      // because a litho formation carries no packing class of its own.
      const lithoPolys: MappedPoly[] = []
      for (const r of [...lithoRegions].sort(
        (a, b) => (a.kind === 'lens' ? 1 : 0) - (b.kind === 'lens' ? 1 : 0),
      )) {
        const m = mapPoly(
          r.polygon,
          L.alongM[r.gapIndex],
          L.alongM[r.gapIndex + 1],
          tagOf(r.formationId, true),
        )
        if (m) lithoPolys.push(m)
      }

      if (process.env.GEOTECH_REFUTE_DUMP === sec.name) {
        const perGap = new Map<number, number>()
        for (const r of lithoRegions) perGap.set(r.gapIndex, (perGap.get(r.gapIndex) ?? 0) + 1)
        console.log(
          `    GAPS ${[...perGap.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([g, n]) => `${g}:${n}`)
            .join(' ')}   (litho columns ${L.columns.length}, so gaps 0..${L.columns.length - 2})`,
        )
        const g4 = lithoRegions.filter((r) => r.gapIndex === 4)
        console.log(
          `    GAP4 left=${L.alongM[4]} right=${L.alongM[5]} fracRanges=` +
            g4
              .map(
                (r) =>
                  `[${Math.min(...r.polygon.map((p) => p.fraction)).toExponential(2)},` +
                  `${Math.max(...r.polygon.map((p) => p.fraction)).toFixed(4)}]`,
              )
              .join(' '),
        )
      }

      // ---- EXACT pass: vertical strips, trapezoid per strip ------------
      const xs = breakpoints([...renderPolys, ...buildPolys, ...lithoPolys])
      const exact = zeroBuckets()
      let lithoCoverM2 = 0
      let refinementLostM2 = 0
      let renderCoverCheck = 0
      let buildCoverCheck = 0
      let thinDisagree = 0
      let thickDisagree = 0
      let disagreeBoreholeGap = 0
      let disagreeCptGap = 0
      let soilDiffMaskedAsNoPacking = 0
      const soilPairs = new Map<string, number>()
      const nadPairs = new Map<string, number>()

      /**
       * True when the litho gap containing ``x`` is bounded by a borehole.
       *
       * The build arm never sees a borehole column, so a gap with one on either
       * side is a place where the two arms are interpolating between DIFFERENT
       * pairs of investigations. Separating those from CPT-to-CPT gaps says
       * whether the disagreement is caused by the missing columns or survives
       * where both arms have the same neighbours.
       */
      const gapTouchesBorehole = (x: number): boolean => {
        for (let i = 0; i + 1 < L.alongM.length; i++) {
          if (x >= L.alongM[i] - 1e-9 && x <= L.alongM[i + 1] + 1e-9) {
            return (
              kindByInv.get(columnOrder[i]) === 'borehole' ||
              kindByInv.get(columnOrder[i + 1]) === 'borehole'
            )
          }
        }
        return false
      }

      /**
       * Accumulate the exact contribution of one strip.
       *
       * Within a strip the painted structure is combinatorially constant, so
       * every bucket's thickness is linear in x and the trapezoid of the two
       * endpoint profiles is the exact integral over the strip.
       */
      const doStrip = (xa: number, xb: number): void => {
        const w = xb - xa
        if (w <= MIN_STRIP_W) return
        const inset = w * STRIP_INSET
        const ends = [xa + inset, xb - inset]
        for (const x of ends) {
          const rRuns = paintAt(renderPolys, x)
          const bRuns = paintAt(buildPolys, x)
          const lRuns = paintAt(lithoPolys, x)
          const half = w / 2
          for (const r of rRuns) renderCoverCheck += (r.top - r.base) * half
          for (const r of bRuns) buildCoverCheck += (r.top - r.base) * half
          for (const r of lRuns) lithoCoverM2 += (r.top - r.base) * half

          // Area the litho partition paints and the refined render output does
          // not, resolved exactly. ``refineLithoPartition`` states litho
          // boundaries are invariant, so every square metre here is the NAD
          // carve losing geometry the section is supposed to keep showing.
          const lbps: number[] = []
          for (const r of lRuns) lbps.push(r.top, r.base)
          for (const r of rRuns) lbps.push(r.top, r.base)
          if (lbps.length > 0) {
            lbps.sort((p, q) => p - q)
            for (let i = 0; i + 1 < lbps.length; i++) {
              const h = lbps[i + 1] - lbps[i]
              if (h <= EPS) continue
              const mid = (lbps[i] + lbps[i + 1]) / 2
              if (tagAt(lRuns, mid) !== null && tagAt(rRuns, mid) === null) {
                refinementLostM2 += h * half
              }
            }
          }

          const bps: number[] = []
          for (const r of rRuns) bps.push(r.top, r.base)
          for (const r of bRuns) bps.push(r.top, r.base)
          if (bps.length === 0) continue
          bps.sort((p, q) => p - q)
          for (let i = 0; i + 1 < bps.length; i++) {
            const lo = bps[i]
            const hi = bps[i + 1]
            const h = hi - lo
            if (h <= EPS) continue
            const mid = (lo + hi) / 2
            const ra = tagAt(rRuns, mid)
            const rb = tagAt(bRuns, mid)
            const area = h * half
            if (ra !== null && rb !== null) {
              const before = disagreeOf(exact)
              scorePair(exact, ra, rb, area)
              const added = disagreeOf(exact) - before
              if (added > 0) {
                if (h < VOXEL_DZ_M) thinDisagree += added
                else thickDisagree += added
                if (gapTouchesBorehole(x)) disagreeBoreholeGap += added
                else disagreeCptGap += added
                if (ra.soil !== rb.soil) {
                  const sk = `${ra.soil} -> ${rb.soil}`
                  soilPairs.set(sk, (soilPairs.get(sk) ?? 0) + added)
                  // The prior reporter tested for the fallback tag BEFORE
                  // comparing soils, so every square metre that is both a soil
                  // conflict and a no-packing case was booked as the benign
                  // kind. This is exactly that area.
                  if (ra.fallback || rb.fallback) soilDiffMaskedAsNoPacking += added
                } else {
                  const nk = `${ra.soil}:${ra.nad} -> ${rb.soil}:${rb.nad}`
                  nadPairs.set(nk, (nadPairs.get(nk) ?? 0) + added)
                }
              }
            } else if (ra !== null) {
              exact.renderOnly += area
            } else if (rb !== null) {
              exact.buildOnly += area
            }
          }
        }
      }

      for (let i = 0; i + 1 < xs.length; i++) doStrip(xs[i], xs[i + 1])

      // INSTRUMENT ANCHOR — each arm's coverage integrated off its own painted
      // stack must equal the sum of the buckets that mention it. A non-zero
      // residual means the decomposition is creating or destroying area.
      const rSum =
        exact.agree +
        exact.noPackingData +
        exact.soilDiffers +
        exact.classDiffers +
        exact.renderOnly
      const bSum =
        exact.agree + exact.noPackingData + exact.soilDiffers + exact.classDiffers + exact.buildOnly
      const residual = Math.max(
        Math.abs(renderCoverCheck - rSum),
        Math.abs(buildCoverCheck - bSum),
      )
      worstResidual = Math.max(worstResidual, residual)

      // ---- VOXEL pass: quantise both arms onto the build's own grid ----
      // A disagreement the labeller cannot resolve is not a disagreement in the
      // delivered model, so the whole comparison is repeated with both arms read
      // only at cell centres of the grid the 3-D build actually uses.
      const voxel = zeroBuckets()
      let voxelCells = 0
      const allX: number[] = []
      for (const p of [...renderPolys, ...buildPolys]) allX.push(p.xmin, p.xmax)
      if (allX.length > 0) {
        const xLo = Math.min(...allX)
        const xHi = Math.max(...allX)
        const cellArea = VOXEL_DX_M * VOXEL_DZ_M
        const k0 = Math.floor(xLo / VOXEL_DX_M)
        const k1 = Math.ceil(xHi / VOXEL_DX_M)
        for (let k = k0; k <= k1; k++) {
          const xc = (k + 0.5) * VOXEL_DX_M
          if (xc < xLo || xc > xHi) continue
          const rRuns = paintAt(renderPolys, xc)
          const bRuns = paintAt(buildPolys, xc)
          if (rRuns.length === 0 && bRuns.length === 0) continue
          let eTop = -Infinity
          let eBot = Infinity
          for (const r of [...rRuns, ...bRuns]) {
            if (r.top > eTop) eTop = r.top
            if (r.base < eBot) eBot = r.base
          }
          const j0 = Math.floor((eBot - VOXEL_ORIGIN_Z) / VOXEL_DZ_M)
          const j1 = Math.ceil((eTop - VOXEL_ORIGIN_Z) / VOXEL_DZ_M)
          for (let j = j0; j <= j1; j++) {
            const ec = VOXEL_ORIGIN_Z + (j + 0.5) * VOXEL_DZ_M
            if (ec < eBot || ec > eTop) continue
            const ra = tagAt(rRuns, ec)
            const rb = tagAt(bRuns, ec)
            if (ra === null && rb === null) continue
            voxelCells++
            if (ra !== null && rb !== null) scorePair(voxel, ra, rb, cellArea)
            else if (ra !== null) voxel.renderOnly += cellArea
            else voxel.buildOnly += cellArea
          }
        }
      }

      // ---- COLUMN FIDELITY: both arms against the LOGGED stack -----------
      // Neither arm is a witness for the other, and the geotech build has never
      // been persisted, so the only independently real thing at hand is the
      // geotech layer stack actually recorded at each investigation. At a column
      // both arms are pinned to that stack by construction, so agreement there
      // is a property of the DATA and any shortfall is an arm distorting its own
      // input rather than the two engines interpolating differently. Read a hair
      // to each side of the column so both adjoining gaps are covered.
      const fidelity = {
        refM: 0,
        renderOkM: 0,
        buildOkM: 0,
        renderCovM: 0,
        buildCovM: 0,
        lithoCovM: 0,
        columns: 0,
      }
      // The probe steps off the column by a FRACTION of the adjoining gap, not by
      // a fixed distance. The v2 engine insets its region rings by fraction 2e-6
      // from each bounding column, so a fixed 0.1 mm step lands inside that empty
      // sliver on a 98 m gap and reads as "no arm covers this column" — an
      // artifact of the probe, not a property of either arm. A gap-relative step
      // is above the inset at every gap width on this model.
      const SIDE_FRAC = Number(SIDE_FRAC_ENV)
      for (const gc of G.columns) {
        const ci = L.columns.findIndex((c) => c.investigationId === gc.investigationId)
        if (ci < 0 || gc.units.length === 0) continue
        const xc = L.alongM[ci]
        const refRuns: Run[] = gc.units.map((u) => ({
          top: gc.surfaceElevM - u.topDepthM,
          base: gc.surfaceElevM - u.baseDepthM,
          tag: tagOf(u.formationId, false),
        }))
        const sides: number[] = []
        if (ci > 0) sides.push(xc - SIDE_FRAC * (xc - L.alongM[ci - 1]))
        if (ci + 1 < L.alongM.length) sides.push(xc + SIDE_FRAC * (L.alongM[ci + 1] - xc))
        if (sides.length === 0) continue
        fidelity.columns++
        for (const x of sides) {
          const rRuns = paintAt(renderPolys, x)
          const bRuns = paintAt(buildPolys, x)
          const lRuns = paintAt(lithoPolys, x)
          let cRef = 0
          let cL = 0
          let cR = 0
          let cB = 0
          for (const ref of refRuns) {
            const steps = Math.max(1, Math.round((ref.top - ref.base) / 0.01))
            const dz = (ref.top - ref.base) / steps
            for (let s = 0; s < steps; s++) {
              const e = ref.base + (s + 0.5) * dz
              cRef += dz
              if (tagAt(lRuns, e)) cL += dz
              if (tagAt(rRuns, e)) cR += dz
              if (tagAt(bRuns, e)) cB += dz
              fidelity.refM += dz
              const ra = tagAt(rRuns, e)
              const rb = tagAt(bRuns, e)
              if (ra) fidelity.renderCovM += dz
              if (rb) fidelity.buildCovM += dz
              if (tagAt(lRuns, e)) fidelity.lithoCovM += dz
              if (ra && ra.soil === ref.tag.soil && ra.nad === ref.tag.nad) fidelity.renderOkM += dz
              if (rb && rb.soil === ref.tag.soil && rb.nad === ref.tag.nad) fidelity.buildOkM += dz
            }
          }
          if (process.env.GEOTECH_REFUTE_DUMP === sec.name) {
            const nm = invNameById.get(gc.investigationId) ?? gc.investigationId.slice(0, 8)
            const nL = lithoPolys.filter((p) => x >= p.xmin && x <= p.xmax).length
            const nR = renderPolys.filter((p) => x >= p.xmin && x <= p.xmax).length
            const nB = buildPolys.filter((p) => x >= p.xmin && x <= p.xmax).length
            const gi = L.alongM.findIndex((a, i) => i + 1 < L.alongM.length && x >= a && x <= L.alongM[i + 1])
            console.log(
              `    COL ${nm.padEnd(20)} x=${x.toFixed(5).padStart(11)}  logged=${cRef
                .toFixed(1)
                .padStart(6)} m  covered: litho ${f1(pct(cL, cRef)).padStart(5)} %  ` +
                `render ${f1(pct(cR, cRef)).padStart(5)} %  build ${f1(pct(cB, cRef)).padStart(5)} %` +
                `  | polysAtX l/r/b=${nL}/${nR}/${nB}  lithoGap=${gi}`,
            )
          }
        }
      }

      addBuckets(totalExact, exact)
      addBuckets(totalVoxel, voxel)
      if (buildComputable) addBuckets(buildableExact, exact)
      for (const [k, v] of soilPairs) globalSoilPairs.set(k, (globalSoilPairs.get(k) ?? 0) + v)
      for (const [k, v] of nadPairs) globalNadPairs.set(k, (globalNadPairs.get(k) ?? 0) + v)

      outs.push({
        name: sec.name,
        buildComputable,
        reason: buildComputable ? '' : `geotech columns = ${G.columns.length} (< 2)`,
        lithoCols: L.columns.length,
        geoCols: G.columns.length,
        offAxis,
        renderPolys: renderPolys.length,
        buildPolys: buildPolys.length,
        strips: Math.max(0, xs.length - 1),
        exact,
        voxel,
        voxelCells,
        thinDisagree,
        thickDisagree,
        disagreeBoreholeGap,
        disagreeCptGap,
        soilDiffMaskedAsNoPacking,
        fidelity,
        renderCoverCheck,
        buildCoverCheck,
        lithoCoverM2,
        refinementLostM2,
        residual,
      })

      console.log(
        `  ${sec.name.padEnd(17)} strips=${String(outs[outs.length - 1].strips).padStart(6)}  ` +
          `polys r/b=${String(renderPolys.length).padStart(4)}/${String(buildPolys.length).padStart(4)}  ` +
          `offAxis=${offAxis}  residual=${residual.toExponential(2)}`,
      )
    }

    // ---- Report ---------------------------------------------------------
    console.log('')
    console.log(
      `  INSTRUMENT ANCHOR  worst area residual across all sections: ` +
        `${worstResidual.toExponential(3)} m2` +
        `${worstResidual > 1e-6 ? '   <-- FAILURE, do not report these numbers' : '   (ok)'}`,
    )
    console.log(
      `  AXIS ANCHOR        geotech columns not co-located with a litho column: ${totalOffAxis}` +
        `${totalOffAxis === 0 ? '   (ok — one shared along axis)' : '   <-- comparison space is not shared'}`,
    )
    console.log('')

    const head =
      '  section            union m2   agree%  disagr%  |  soil%  class%  nopack%  |  rOnly%  bOnly%'
    console.log('  EXACT INTEGRATION (no sampling — every structural breakpoint resolved)')
    console.log(head)
    console.log('  ' + '-'.repeat(96))
    for (const o of outs) {
      const u = unionOf(o.exact)
      console.log(
        `  ${o.name.padEnd(17)} ${f1(u).padStart(9)}  ${f1(pct(o.exact.agree, u)).padStart(6)}  ` +
          `${f1(pct(u - o.exact.agree, u)).padStart(7)}  |  ` +
          `${f1(pct(o.exact.soilDiffers, u)).padStart(5)}  ${f1(pct(o.exact.classDiffers, u)).padStart(6)}  ` +
          `${f1(pct(o.exact.noPackingData, u)).padStart(7)}  |  ` +
          `${f1(pct(o.exact.renderOnly, u)).padStart(6)}  ${f1(pct(o.exact.buildOnly, u)).padStart(6)}` +
          `${o.buildComputable ? '' : '   [build drops this section: ' + o.reason + ']'}`,
      )
    }
    const uT = unionOf(totalExact)
    console.log('  ' + '-'.repeat(96))
    console.log(
      `  ${'TOTAL'.padEnd(17)} ${f1(uT).padStart(9)}  ${f1(pct(totalExact.agree, uT)).padStart(6)}  ` +
        `${f1(pct(uT - totalExact.agree, uT)).padStart(7)}  |  ` +
        `${f1(pct(totalExact.soilDiffers, uT)).padStart(5)}  ${f1(pct(totalExact.classDiffers, uT)).padStart(6)}  ` +
        `${f1(pct(totalExact.noPackingData, uT)).padStart(7)}  |  ` +
        `${f1(pct(totalExact.renderOnly, uT)).padStart(6)}  ${f1(pct(totalExact.buildOnly, uT)).padStart(6)}`,
    )
    const uB = unionOf(buildableExact)
    console.log(
      `  ${'TOTAL (buildable)'.padEnd(17)} ${f1(uB).padStart(9)}  ${f1(pct(buildableExact.agree, uB)).padStart(6)}  ` +
        `${f1(pct(uB - buildableExact.agree, uB)).padStart(7)}`,
    )

    console.log('')
    console.log('  AREAS (m2)')
    const rows: [string, Buckets][] = [
      ['exact', totalExact],
      ['voxel grid', totalVoxel],
    ]
    console.log(
      '  pass          agree    soilDiff   classDiff   noPacking   renderOnly   buildOnly       union',
    )
    for (const [label, b] of rows) {
      console.log(
        `  ${label.padEnd(12)}${f1(b.agree).padStart(9)}${f1(b.soilDiffers).padStart(11)}` +
          `${f1(b.classDiffers).padStart(12)}${f1(b.noPackingData).padStart(12)}` +
          `${f1(b.renderOnly).padStart(13)}${f1(b.buildOnly).padStart(12)}${f1(unionOf(b)).padStart(12)}`,
      )
    }

    console.log('')
    console.log('  DENOMINATORS — the same disagreement read four ways')
    console.log(
      `    union-based           (union - agree) / union            ` +
        `${f1(pct(uT - totalExact.agree, uT))} %   <- the reported headline shape`,
    )
    console.log(
      `    overlap-only          disagree / (both arms paint)       ` +
        `${f1(pct(disagreeOf(totalExact), overlapOf(totalExact)))} %`,
    )
    console.log(
      `    render's own plane    (disagree + renderOnly) / render    ` +
        `${f1(
          pct(
            disagreeOf(totalExact) + totalExact.renderOnly,
            overlapOf(totalExact) + totalExact.renderOnly,
          ),
        )} %`,
    )
    console.log(
      `    build's own plane     (disagree + buildOnly) / build      ` +
        `${f1(
          pct(
            disagreeOf(totalExact) + totalExact.buildOnly,
            overlapOf(totalExact) + totalExact.buildOnly,
          ),
        )} %`,
    )

    console.log('')
    console.log(
      `  SLIVER TEST — the 3-D build labels on a ${VOXEL_DX_M} m x ${VOXEL_DZ_M} m grid, so a ` +
        `disagreement thinner than one cell cannot reach the model.`,
    )
    const dThin = outs.reduce((s, o) => s + o.thinDisagree, 0)
    const dThick = outs.reduce((s, o) => s + o.thickDisagree, 0)
    console.log(
      `    disagreement in runs thinner than ${VOXEL_DZ_M} m : ${f1(dThin)} m2 ` +
        `(${f1(pct(dThin, dThin + dThick))} % of all disagreement)`,
    )
    console.log(
      `    disagreement in runs at least  ${VOXEL_DZ_M} m : ${f1(dThick)} m2 ` +
        `(${f1(pct(dThick, dThin + dThick))} %)`,
    )
    const uV = unionOf(totalVoxel)
    console.log(
      `    re-run entirely at the build grid  : union ${f1(uV)} m2, ` +
        `disagreement ${f1(pct(uV - totalVoxel.agree, uV))} % ` +
        `(exact pass says ${f1(pct(uT - totalExact.agree, uT))} %)`,
    )
    console.log(
      `    voxel-pass split                   : soil ${f1(pct(totalVoxel.soilDiffers, uV))} %, ` +
        `class ${f1(pct(totalVoxel.classDiffers, uV))} %, ` +
        `noPacking ${f1(pct(totalVoxel.noPackingData, uV))} %, ` +
        `renderOnly ${f1(pct(totalVoxel.renderOnly, uV))} %, ` +
        `buildOnly ${f1(pct(totalVoxel.buildOnly, uV))} %`,
    )

    console.log('')
    console.log('  IS IT CLASS OR IS IT GEOMETRY?  [PROBE-SENSITIVE — see the caveat below]')
    console.log(
      `    Both arms read their packing classes from the SAME per-column geotech layers, so at a`,
    )
    console.log(
      `    column neither can invent a class. Agreement AGAINST THE LOGGED STACK at the shared`,
    )
    console.log(`    columns therefore separates classification from lateral interpolation.`)
    const fRef = outs.reduce((s, o) => s + o.fidelity.refM, 0)
    const fR = outs.reduce((s, o) => s + o.fidelity.renderOkM, 0)
    const fB = outs.reduce((s, o) => s + o.fidelity.buildOkM, 0)
    const fCols = outs.reduce((s, o) => s + o.fidelity.columns, 0)
    console.log(
      `    logged geotech column length compared : ${f1(fRef)} m over ${fCols} column sides`,
    )
    console.log(
      `    render arm reproduces the logged class : ${f1(pct(fR, fRef))} %  (${f1(fRef - fR)} m wrong)`,
    )
    console.log(
      `    build  arm reproduces the logged class : ${f1(pct(fB, fRef))} %  (${f1(fRef - fB)} m wrong)`,
    )
    const fLcov = outs.reduce((s, o) => s + o.fidelity.lithoCovM, 0)
    const fRcov = outs.reduce((s, o) => s + o.fidelity.renderCovM, 0)
    const fBcov = outs.reduce((s, o) => s + o.fidelity.buildCovM, 0)
    console.log(
      `    ...but first, does each arm even COVER the logged column at the column?`,
    )
    console.log(`      raw litho partition (what the render refines) : ${f1(pct(fLcov, fRef))} %`)
    console.log(`      render arm after the NAD refinement           : ${f1(pct(fRcov, fRef))} %`)
    console.log(`      build arm                                    : ${f1(pct(fBcov, fRef))} %`)
    console.log(
      `      => the NAD refinement drops ${f1(fLcov - fRcov)} m of column that the litho ` +
        `partition it refines does cover (${f1(pct(fLcov - fRcov, fLcov))} % of it).`,
    )
    console.log(
      `      Of the ${f1(fRef - fR)} m the render arm gets wrong, ${f1(fRef - fRcov)} m is ` +
        `simply not drawn at all; only ${f1(fRcov - fR)} m is drawn with the wrong class.`,
    )
    console.log(
      `      Build: of ${f1(fRef - fB)} m wrong, ${f1(fRef - fBcov)} m not drawn, ` +
        `${f1(fBcov - fB)} m drawn with the wrong class.`,
    )
    console.log(
      `    CAVEAT — these column-line figures move with the probe offset ` +
        `(GEOTECH_REFUTE_SIDEFRAC, now ${SIDE_FRAC_ENV}). Measured on this model the render`,
    )
    console.log(
      `    figure runs 55.8 % .. 70.4 % and the build figure 86.3 % .. 91.2 % as the probe steps`,
    )
    console.log(
      `    from 1e-4 to 5e-2 of the gap width, because both arms thin out within a few percent of`,
    )
    console.log(
      `    the gap beside a column. They are therefore NOT quotable as numbers. What IS stable is`,
    )
    console.log(
      `    that the raw litho partition covers the logged column 100.0 % once the probe clears the`,
    )
    console.log(
      `    engine's 2e-6 ring inset, and the AREA figures below, which do not depend on a probe.`,
    )
    console.log('')
    console.log('  IS THE COLUMN-LINE SHORTFALL A SLIVER OR IS IT BULK?')
    console.log(
      `    The fidelity figures above are LENGTHS on the column line, so a defect confined to a`,
    )
    console.log(
      `    hairline beside the column would read as a total miss there and cost almost no area.`,
    )
    console.log(`    The same loss integrated exactly as AREA over the whole section plane:`)
    const lCov = outs.reduce((s, o) => s + o.lithoCoverM2, 0)
    const lLost = outs.reduce((s, o) => s + o.refinementLostM2, 0)
    console.log(`      raw litho partition area                  : ${f1(lCov)} m2`)
    console.log(
      `      of which the NAD refinement does not draw : ${f1(lLost)} m2 ` +
        `(${f1(pct(lLost, lCov))} %)`,
    )
    console.log('')
    console.log('  WHERE THE DISAGREEMENT LIVES')
    const dBh = outs.reduce((s, o) => s + o.disagreeBoreholeGap, 0)
    const dCpt = outs.reduce((s, o) => s + o.disagreeCptGap, 0)
    console.log(
      `    in litho gaps touching a BOREHOLE (invisible to the build) : ${f1(dBh)} m2 ` +
        `(${f1(pct(dBh, dBh + dCpt))} % of all disagreement)`,
    )
    console.log(
      `    in gaps bounded by two CPTs (both arms see both columns)   : ${f1(dCpt)} m2 ` +
        `(${f1(pct(dCpt, dBh + dCpt))} %)`,
    )
    console.log('')
    console.log('  ATTRIBUTION DEFECT IN THE PRIOR REPORT')
    const masked = outs.reduce((s, o) => s + o.soilDiffMaskedAsNoPacking, 0)
    console.log(
      `    The prior reporter tested the no-packing tag BEFORE comparing soils, so area that is`,
    )
    console.log(
      `    BOTH a soil conflict AND a no-packing case was booked as the benign kind: ${f1(masked)} m2.`,
    )
    console.log(
      `    different-LITHOLOGY area  reported ${f1(totalExact.soilDiffers - masked)} m2  ->  actually ${f1(totalExact.soilDiffers)} m2`,
    )
    console.log(
      `    no-packing-data    area  reported ${f1(totalExact.noPackingData + masked)} m2  ->  actually ${f1(totalExact.noPackingData)} m2`,
    )
    console.log('')
    console.log('  TOP SOIL-vs-SOIL DISAGREEMENTS (a different material at the same point)')
    for (const [k, v] of [...globalSoilPairs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
      console.log(`    ${f1(v).padStart(9)} m2   ${k}`)
    }
    console.log('')
    console.log('  TOP CLASS-vs-CLASS DISAGREEMENTS (soil:class -> soil:class)')
    for (const [k, v] of [...globalNadPairs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
      console.log(`    ${f1(v).padStart(9)} m2   ${k}`)
    }

    // ---- Cross-check against the prior reporter --------------------------
    if (existsSync(PRIOR)) {
      const prior = JSON.parse(readFileSync(PRIOR, 'utf8')) as {
        totals?: { agree?: number; disagree?: number; renderOnly?: number; buildOnly?: number }
      }
      const p = prior.totals ?? {}
      const pu = (p.agree ?? 0) + (p.disagree ?? 0) + (p.renderOnly ?? 0) + (p.buildOnly ?? 0)
      console.log('')
      console.log('  CROSS-CHECK vs the prior sampled reporter')
      console.log(
        `    prior   agree ${f1(p.agree ?? 0)}  disagree ${f1(p.disagree ?? 0)}  ` +
          `renderOnly ${f1(p.renderOnly ?? 0)}  buildOnly ${f1(p.buildOnly ?? 0)}  ` +
          `-> ${f1(pct(pu - (p.agree ?? 0), pu))} %`,
      )
      console.log(
        `    exact   agree ${f1(totalExact.agree)}  disagree ${f1(disagreeOf(totalExact))}  ` +
          `renderOnly ${f1(totalExact.renderOnly)}  buildOnly ${f1(totalExact.buildOnly)}  ` +
          `-> ${f1(pct(uT - totalExact.agree, uT))} %`,
      )
      console.log(
        `    delta   agree ${f1(totalExact.agree - (p.agree ?? 0))}  ` +
          `disagree ${f1(disagreeOf(totalExact) - (p.disagree ?? 0))}  ` +
          `renderOnly ${f1(totalExact.renderOnly - (p.renderOnly ?? 0))}  ` +
          `buildOnly ${f1(totalExact.buildOnly - (p.buildOnly ?? 0))}`,
      )
    }

    writeFileSync(
      OUT,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          method: 'exact vertical-strip trapezoid + build-grid voxel pass',
          buildGrid: { dxM: VOXEL_DX_M, dzM: VOXEL_DZ_M, originZ: VOXEL_ORIGIN_Z },
          worstResidualM2: worstResidual,
          offAxisColumns: totalOffAxis,
          totals: { exact: totalExact, voxel: totalVoxel, buildableExact },
          soilPairs: Object.fromEntries(globalSoilPairs),
          classPairs: Object.fromEntries(globalNadPairs),
          sections: outs,
        },
        null,
        2,
      ),
      'utf8',
    )
    console.log('')
    console.log(`  wrote ${OUT}`)
    expect(outs.length).toBe(raw.sections.length)
  })
})
