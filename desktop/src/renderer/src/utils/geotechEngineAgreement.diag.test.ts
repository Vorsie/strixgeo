/**
 * GEOTECH-AXIS AGREEMENT GATE — what the section DRAWS vs what the build is FED.
 *
 * On the geotech axis the two surfaces are produced by different computations
 * from different inputs, and until this file nothing measured the difference.
 *
 *   RENDER arm (``PartitionFillOverlay``, geotech axis):
 *       partition = computeSectionFillActive(LITHO columns, LITHO edges, apexOverrides, alongM)
 *       refined   = refineLithoPartition(partition, geotech sub-bands, nadMeta, lithoSoil)
 *     The litho partition is the base and its boundaries are invariant; the NAD
 *     packing classes subdivide each litho region in thickness-fraction space.
 *
 *   BUILD arm (``makeVoxelRequestBuilder`` -> ``buildVoxelRequest``, geotech stage):
 *       regions   = computeSectionFillActive(GEOTECH columns, GEOTECH edges, apexOverrides, alongM)
 *     A direct geotech partition. Its regions are the payload POSTed to the voxel
 *     builder, so they are the geometry the 3-D model is labelled from.
 *
 * ``docs/design/section-fill.md`` asserts that the 2-D partition is the single
 * source of truth and the 3-D build merely labels space from it. This gate
 * measures how far that invariant is from holding on the owner's real sections.
 *
 * HOW THE TWO ARMS ARE MADE COMPARABLE. They do not share a column set — the
 * render arm runs on all 58 litho columns (CPTs and boreholes), the build arm on
 * the 44 CPT-only geotech columns — so gap index i means a different physical
 * band in each arm, and pairing regions by gap index, ordinal or position would
 * repeat the rank-pairing error that has already produced two false results in
 * this codebase. Both arms are therefore mapped into the one coordinate system
 * that is independently real for both: ALONG-SECTION METRES by ELEVATION. Every
 * polygon's gap-local fraction is converted with that arm's own column positions,
 * and the comparison then asks a single question at each physical point of the
 * section plane: which NAD packing class does each arm put here? Comparison is by
 * CLASS and by AREA, never by identity of a region.
 *
 * The geotech columns are a strict subset of the litho columns at identical
 * along positions (asserted below), so both arms genuinely live on one along
 * axis and the mapping introduces no registration error of its own.
 *
 * WHAT IS MEASURED, per section:
 *   agree        both arms assign the SAME packing class at that point;
 *   disagree     both assign a class and they DIFFER;
 *   render-only  the section draws material where the build has nothing;
 *   build-only   the build has material where the section draws nothing.
 * Disagreement percentage is (union - agree) / union, so it is symmetric and
 * reads as "the share of the section plane where the two do not say the same
 * thing". Areas are real square metres in the section plane; the per-gap tables
 * additionally carry the fraction-by-metre units the engine works in.
 *
 * Vertically the measurement is EXACT (polygon slices resolved at every
 * breakpoint). Horizontally it samples the along axis at a fixed step, so a
 * feature narrower than the step can be missed; the step is printed per section.
 *
 * Each arm is also checked on its own terms for holes and overlaps, reusing the
 * existing machinery rather than a third implementation: ``findNonLensOverlaps``
 * for the build arm's ``SectionRegion[]``, and ``detectorPolysFromRefinement`` +
 * ``detectRefinementOverlaps`` for the render arm's refined polygons.
 *
 * Not a pure reporter any more: it prints everything, and FAILS when the run is
 * worse than the committed baseline (see ``geotechAgreementFreeze.diag.ts``).
 * Dormant unless ``GEOTECH_AGREE=1``.
 *
 * WHERE THE NUMBERS COME FROM, AND WHO CAN REPRODUCE THEM. Be explicit, because
 * "it is frozen" would otherwise read as "anyone can check this":
 *
 *   INPUT     ``scripts/throwaway_geotech_axis_inputs.json`` — an UNTRACKED,
 *             read-only dump of the OWNER'S dev DB (it carries a real project,
 *             which is why it is not committed and why CI cannot run this gate).
 *             Regenerate with, from the repo root:
 *                 uv run python scripts/dump_geotech_axis_inputs.py
 *             The script guards its own DB target and prints it before reading.
 *             Missing input FAILS the run with this recipe — never skips.
 *   BASELINE  ``__fixtures__/geotech_agreement_baseline.json`` — committed, and
 *             the only reproducible half. It records the model ids and the
 *             engine it was frozen on; a run on other ids, or on the other
 *             engine, reports NOT COMPARABLE and enforces nothing.
 *   ENGINE    read at RUN TIME from env / device localStorage
 *             (``isPartitionEngineV2Active``), so what is measured depends on
 *             device state. It is printed on the first line; a v1 device
 *             silently drops all enforcement through the engine-mismatch branch,
 *             so read that line before reading a green run as a pass.
 *
 * Run:
 *   cd desktop
 *   GEOTECH_AGREE=1 npx vitest run src/renderer/src/utils/geotechEngineAgreement.diag.test.ts --disableConsoleIntercept
 * Re-freeze (deliberate — only when the rise/fall is understood):
 *   GEOTECH_AGREE=1 GEOTECH_AGREE_FREEZE=1 npx vitest run src/renderer/src/utils/geotechEngineAgreement.diag.test.ts --disableConsoleIntercept
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { computeUnderColumnSubstrateForRender } from '../components/sections/underColumnSubstrate'
import type { BodyBoundaryResponse } from '../api/clients/geology.types'
// The REAL builder's own override derivation, not a copy of it: a hand-copy can
// drift from the thing this gate claims to measure without anything noticing.
import { deriveSectionApexOverrides } from './buildVoxelRequest'
import {
  computeUnderColumnSubstrate,
  type CorrelationEdge,
  type LensApexOverride,
  type PartitionColumn,
  type SectionRegion,
  type UnderColumnFill,
} from './partitionFill'
import { computeSectionFillActive, isPartitionEngineV2Active } from './partitionEngineSelect'
import { findNonLensOverlaps, formatOverlapReports } from './partitionOverlapCheck'
import {
  refineLithoPartition,
  refineSubstrateQuads,
  type GeotechColumn,
  type NadFormationMeta,
  type RefinedPolygon,
} from './refineLithoPartition'
import {
  detectRefinementOverlaps,
  detectorPolysFromRefinement,
} from './refineLithoPartition.overlap'
import {
  compareToBaseline,
  readBaseline,
  writeBaseline,
  type AgreementBaseline,
  type MeasuredSection,
} from './geotechAgreementFreeze.diag'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const INPUT = resolve(REPO_ROOT, 'scripts/throwaway_geotech_axis_inputs.json')
const DETAIL_OUT = resolve(REPO_ROOT, 'scripts/throwaway_geotech_agreement_detail.json')
/** The committed baseline this run is judged against (see the freeze module). */
const BASELINE = resolve(HERE, './__fixtures__/geotech_agreement_baseline.json')

/**
 * Along-axis sample step in metres; the vertical direction stays exact.
 * Overridable with ``GEOTECH_AGREE_STEP`` so the headline can be re-measured at
 * a finer step to prove it is not a sampling artifact.
 */
const ALONG_STEP_M = Number(process.env.GEOTECH_AGREE_STEP ?? '0.25')
/** Sample-count clamp so a 900 m section stays fast and a 1 m tie stays resolved. */
const MIN_SAMPLES = 200
const MAX_SAMPLES = Number(process.env.GEOTECH_AGREE_MAXSAMPLES ?? '3000')
/** Elevation tolerance (metres) below which two breakpoints are the same point. */
const EPS = 1e-9
/**
 * Pixels the detector's calibrated thresholds assume across a section. The
 * refinement overlap detector documents its x axis as "any linear map of
 * along-position" but its 0.8-unit bbox floor was tuned at app render scale, so
 * along metres are scaled to a plausible plot width before it runs.
 */
const DETECTOR_PLOT_W = 1200

/**
 * The boundary map the RENDER arm runs with: empty, always.
 *
 * ⚠ SUSPECTED PRODUCT DEFECT, described here rather than corrected. This is a
 * faithful description of TODAY'S CODE, not of a decision anybody took: the
 * geotech axis has no hand-drawn body boundaries because ``SectionsCanvas``
 * clears ``lensBoundaries`` to an empty Map on any non-lithostratigraphic axis,
 * so the geotech render derives zero apex/contact overrides. But the LITHO
 * render and BOTH voxel builds DO apply the stored boundaries — so a lens the
 * engineer reshaped by hand on the litho axis is drawn reshaped on litho, built
 * reshaped in 3-D, and drawn UN-reshaped on the geotech axis, which the
 * governing plan ("geotech behaves like litho, constrained by the two levels
 * above") does not allow.
 *
 * The gate keeps measuring what is actually on screen — that is its job, and
 * feeding this arm the litho boundaries measured a partition nobody sees
 * (``geotechRenderArmRefute.diag.test.ts`` refuted that earlier version). It
 * reports the suspicion as a TRACKED SUSPECT line instead of hiding it in a
 * baseline, and the owner question is in ``docs/design/geotech-stage.md`` §7.
 * On this model the measured impact is nil: 1 stored litho boundary, 0 geotech.
 */
const RENDER_ARM_BOUNDARIES: ReadonlyMap<string, BodyBoundaryResponse> = new Map()

// ---------------------------------------------------------------------------
// Extract shapes (mirrors scripts/dump_geotech_axis_inputs.py)
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

interface RawArm {
  columns: RawColumn[]
  edges: RawEdge[]
  alongM: number[]
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
  geotech: RawArm
  refinement: { geotechLayers: RawGeotechLayer[] }
  anchor: string
}

interface RawFile {
  meta: Record<string, unknown>
  formationNames: Record<string, string>
  refinementBundle: {
    nadMeta: Record<string, { nadClass: number | null; soilCode: string | null }>
    lithoSoilByFormationId: Record<string, string | null>
    lithoFormationColorById: Record<string, string>
    geotechFormationColorById: Record<string, string>
  }
  bodyBoundaries: {
    litho: Record<string, BodyBoundaryResponse>
    geotech: Record<string, BodyBoundaryResponse>
  }
  sections: RawSection[]
}

// ---------------------------------------------------------------------------
// Geometry helpers — scanline in (along metres, elevation)
// ---------------------------------------------------------------------------

/** A polygon mapped out of gap-local fraction into along metres. */
interface AlongPoly {
  cls: string
  x0: number
  x1: number
  pts: { x: number; e: number }[]
}

/** One painted elevation run at a single along sample. */
interface Seg {
  top: number
  base: number
  cls: string
}

/**
 * Elevation intervals where the vertical line at ``x`` crosses a closed ring.
 *
 * Uses the same half-open crossing rule as the existing holes reporter, so a
 * vertex exactly on the sample line is counted once rather than twice.
 *
 * @param pts Closed ring in (along metres, elevation) order.
 * @param x Along position of the sample line, in metres.
 * @returns ``[base, top]`` pairs, ascending.
 */
function sliceRing(pts: readonly { x: number; e: number }[], x: number): [number, number][] {
  const ys: number[] = []
  const n = pts.length
  for (let i = 0; i < n; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % n]
    if ((a.x <= x && b.x > x) || (b.x <= x && a.x > x)) {
      const t = (x - a.x) / (b.x - a.x)
      ys.push(a.e + t * (b.e - a.e))
    }
  }
  ys.sort((p, q) => p - q)
  const out: [number, number][] = []
  for (let i = 0; i + 1 < ys.length; i += 2) out.push([ys[i], ys[i + 1]])
  return out
}

/**
 * Stamp one run over an existing painted stack, later paint winning.
 *
 * This reproduces how both surfaces actually resolve on screen and in the
 * labeller: a lens overlay is drawn after its matrix and takes the space.
 *
 * @param existing Runs already painted, in no particular order.
 * @param s The run being painted on top.
 * @returns The new stack with ``s`` occupying its full extent.
 */
function stamp(existing: readonly Seg[], s: Seg): Seg[] {
  const out: Seg[] = []
  for (const e of existing) {
    if (e.base >= s.top - EPS || e.top <= s.base + EPS) {
      out.push(e)
      continue
    }
    if (e.top > s.top + EPS) out.push({ top: e.top, base: s.top, cls: e.cls })
    if (e.base < s.base - EPS) out.push({ top: s.base, base: e.base, cls: e.cls })
  }
  out.push(s)
  return out
}

/**
 * Resolve one arm's painted class stack at a single along sample.
 *
 * @param polys The arm's polygons in PAINT order (earliest first).
 * @param x Along position of the sample line, in metres.
 * @returns The disjoint painted runs at that line.
 */
function paintAt(polys: readonly AlongPoly[], x: number): Seg[] {
  let segs: Seg[] = []
  for (const p of polys) {
    if (x < p.x0 || x > p.x1) continue
    for (const [lo, hi] of sliceRing(p.pts, x)) {
      if (hi - lo <= EPS) continue
      segs = stamp(segs, { top: hi, base: lo, cls: p.cls })
    }
  }
  return segs
}

/**
 * Class assigned at one elevation, or ``null`` where the arm has nothing.
 *
 * @param segs Disjoint painted runs from ``paintAt``.
 * @param e Elevation in metres.
 */
function classAt(segs: readonly Seg[], e: number): string | null {
  for (const s of segs) if (e <= s.top && e >= s.base) return s.cls
  return null
}

/**
 * Interior vertical voids of one arm at a single along sample.
 *
 * A void is unpainted elevation strictly between the arm's shallowest and
 * deepest paint at that line — the arm's own holes, on its own terms.
 *
 * @param segs Disjoint painted runs from ``paintAt``.
 * @returns Total void thickness in metres and the largest single void.
 */
function interiorVoids(segs: readonly Seg[]): { total: number; worst: number } {
  if (segs.length < 2) return { total: 0, worst: 0 }
  const sorted = [...segs].sort((a, b) => b.top - a.top)
  let total = 0
  let worst = 0
  let cursor = sorted[0].base
  for (let i = 1; i < sorted.length; i++) {
    const s = sorted[i]
    if (s.top < cursor - EPS) {
      const v = cursor - s.top
      total += v
      if (v > worst) worst = v
    }
    if (s.base < cursor) cursor = s.base
  }
  return { total, worst }
}

// ---------------------------------------------------------------------------
// Arm assembly
// ---------------------------------------------------------------------------

/**
 * Reproduce ``assembleSectionPartitionInput``: drop columns with no surface
 * elevation or no units, keep along order, sort each column's units downwards.
 *
 * @param cols Raw columns from the extract, already in along order.
 * @param alongM Along position per raw column, 1:1 with ``cols``.
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

/** Reproduce the overlay's edge reshape; sides are load-bearing for banding. */
function toEdges(raw: readonly RawEdge[]): CorrelationEdge[] {
  return raw.map((e) => ({
    a: e.a,
    b: e.b,
    aSide: (e.aSide ?? 'top') as 'top' | 'base',
    bSide: (e.bSide ?? 'top') as 'top' | 'base',
  }))
}


// ---------------------------------------------------------------------------
// Reporting shapes
// ---------------------------------------------------------------------------

interface Buckets {
  agree: number
  disagree: number
  renderOnly: number
  buildOnly: number
}

/**
 * The disagreement split by WHAT disagrees, because the three kinds have very
 * different meanings and lumping them hides the story.
 *
 * ``noPackingData`` is area where the render arm found no NAD sub-band of the
 * litho region's own soil code anywhere in the section and fell back to plain
 * lithology colour, while the build assigned a real class there. That is not
 * two engines disagreeing about packing; it is one arm having no packing to
 * show. ``soilDiffers`` is the serious kind — the two arms put different
 * LITHOLOGIES at the same point. ``classDiffers`` is the same lithology graded
 * into a different NAD packing class.
 */
interface Kinds {
  noPackingData: number
  soilDiffers: number
  classDiffers: number
}

/** Soil code of a class key, or null for the unknown-formation case. */
function soilOf(cls: string): string | null {
  const i = cls.indexOf('/')
  if (i < 0) return null
  const head = cls.slice(0, i)
  if (head === 'LITHO-FALLBACK') return cls.slice(i + 1)
  if (head === 'UNKNOWN') return null
  return head
}

/** True when a class key is the render arm's no-packing-data fallback. */
const isFallback = (cls: string): boolean => cls.startsWith('LITHO-FALLBACK/')

interface SectionResult {
  name: string
  kind: string
  anchor: string
  computed: boolean
  reason?: string
  buckets: Buckets
  kinds: Kinds
  disagreementPct: number
  note: string
  stepM: number
  lithoCols: number
  geoCols: number
  /** Approved correlation edges each arm ran on — part of the freeze fingerprint. */
  lithoEdges: number
  geoEdges: number
  renderPolys: number
  buildRegions: number
  renderOverlaps: number
  renderEngineOverlaps: number
  renderCarveOverlaps: number
  buildOverlaps: number
  renderVoidM2: number
  buildVoidM2: number
  lithoVoidM2: number
  lithoCoverM2: number
  renderCoverM2: number
  buildCoverM2: number
  substrateQuads: number
  substrateNoDonor: number
  overridesRender: number
  overridesBuild: number
  topPairs: { pair: string; m2: number }[]
  topRenderOnly: { cls: string; m2: number }[]
  topBuildOnly: { cls: string; m2: number }[]
  perGap: {
    gapIndex: number
    leftAlongM: number
    rightAlongM: number
    classes: { cls: string; renderFracM: number; buildFracM: number; renderM2: number; buildM2: number }[]
  }[]
}

const fmt = (v: number, d = 1): string => v.toFixed(d)

describe('geotech axis — render vs build engine agreement', () => {
  if (process.env.GEOTECH_AGREE !== '1') {
    it.skip('dormant (set GEOTECH_AGREE=1)', () => {})
    return
  }

  it('measures every section', () => {
    // Fail LOUDLY, with the recipe, rather than skipping: a gate that quietly
    // passes when its input is absent is worse than no gate. The extract is a
    // read-only dump of the OWNER'S dev DB and is untracked by design (it
    // carries a real project), so this is the one precondition a fresh clone
    // cannot satisfy on its own.
    if (!existsSync(INPUT)) {
      throw new Error(
        `${INPUT} not found — this gate judges the CURRENT dev model. Regenerate it with:\n` +
          `  uv run python scripts/dump_geotech_axis_inputs.py   (read-only, dev DB)\n` +
          `then re-run with GEOTECH_AGREE=1. Preconditions for the numbers to mean anything:\n` +
          `  * partition engine v2 must be the ACTIVE engine (Settings -> Litho segmenter, or\n` +
          `    STRIX_PARTITION_V2=1) — the baseline was frozen on v2 and a v1 run enforces nothing;\n` +
          `  * the baseline in __fixtures__/geotech_agreement_baseline.json must have been frozen\n` +
          `    on the same litho + geotech model ids, or every section reports NOT COMPARABLE.`,
      )
    }
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

    /**
     * The comparison key: the NAD PACKING CLASS, not the formation identity.
     * Two geotech formations with the same soil code and the same NAD class are
     * the same class and must compare equal, or the measurement would count a
     * bookkeeping difference as a geometric one.
     */
    const classOf = (formationId: string): string => {
      const m = nadMeta.get(formationId)
      if (m) return `${m.soilCode ?? '?'}/${m.nadClass == null ? 'no-class' : `n${m.nadClass}`}`
      if (lithoSoil.has(formationId)) return `LITHO-FALLBACK/${lithoSoil.get(formationId) ?? '?'}`
      return `UNKNOWN/${formationId.slice(0, 8)}`
    }

    console.log('')
    console.log('='.repeat(96))
    console.log('GEOTECH AXIS — what the section DRAWS vs what the 3-D build is FED')
    console.log('='.repeat(96))
    console.log(`  input           ${INPUT}`)
    console.log(`  active engine   ${engineV2 ? 'v2 (terminations-first)' : 'v1 (stable)'}`)
    console.log(`  project         ${String(raw.meta.projectId)}`)
    console.log(`  litho model     ${String(raw.meta.lithoModelId)}`)
    console.log(`  geotech model   ${String(raw.meta.geotechModelId)}`)
    console.log(
      `  litho arm anchor  build generation ${String(
        (raw.meta.anchor as Record<string, unknown> | null)?.generationId ?? 'none',
      )}`,
    )
    console.log(
      `  build arm anchor  NONE — persisted geotech build generations = ` +
        `${String(raw.meta.persistedGeotechBuildGenerations)}. Its numbers are what the ` +
        `build WOULD produce, not what it produced.`,
    )
    console.log(`  hand-drawn boundaries  litho ${lithoBoundaries.size}, geotech ${geotechBoundaries.size}`)
    // TRACKED SUSPECT, printed every run so it cannot settle into the baseline
    // as "correct" (see RENDER_ARM_BOUNDARIES). The render arm runs with NO
    // boundaries because that is what the geotech axis does today; the build arm
    // and the litho render both apply them. That asymmetry is a suspected
    // product defect awaiting an owner answer, not a measurement choice.
    console.log(
      `  TRACKED SUSPECT  the geotech RENDER arm runs with 0 hand-drawn boundaries because ` +
        `SectionsCanvas clears them off any non-litho axis, while the LITHO render and BOTH ` +
        `voxel builds apply all ${lithoBoundaries.size}. Impact on this model: nil ` +
        `(${lithoBoundaries.size} litho / ${geotechBoundaries.size} geotech stored). Owner ` +
        `question in docs/design/geotech-stage.md §7 — not a baseline decision.`,
    )

    const results: SectionResult[] = []
    let instrumentWorstResidual = 0
    const globalPairArea = new Map<string, number>()
    const globalClassRender = new Map<string, number>()
    const globalClassBuild = new Map<string, number>()

    for (const sec of raw.sections) {
      // ---- RENDER arm ---------------------------------------------------
      const L = assembleColumns(sec.columns, sec.alongM)
      const lithoEdges = toEdges(sec.edges)
      // NO hand-drawn overrides on this arm, deliberately. The geotech axis
      // cannot have them: ``SectionsCanvas`` clears ``lensBoundaries`` to an
      // empty Map whenever the axis is not lithostratigraphic
      // (``SectionsCanvas.tsx`` — ``if (!isLitho) { setLensBoundaries(new Map()) }``),
      // and ``SectionPanel`` forwards that empty map to ``PartitionFillOverlay``,
      // so the geotech render derives zero overrides. Feeding this arm the LITHO
      // model's stored boundaries measured a partition the engineer never sees —
      // ``geotechRenderArmRefute.diag.test.ts`` refuted the earlier version of
      // this line and its finding is applied here.
      const renderOverrides = deriveSectionApexOverrides(
        L.columns,
        lithoEdges,
        L.alongM,
        RENDER_ARM_BOUNDARIES,
        engineV2,
      )
      const lithoRegions =
        L.columns.length >= 2
          ? computeSectionFillActive(L.columns, lithoEdges, renderOverrides, L.alongM)
          : []

      // The geotech sub-band stack per investigation, sharing the litho column's
      // surface elevation — the same assembly the overlay's refinement memo does.
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
          ? refineLithoPartition(lithoRegions, columnOrder, geoColByInv, nadMeta, lithoSoil, {
              alongM: L.alongM,
            })
          : []

      // The under-column substrate pass the render also runs. It is a screen-space
      // strip the width of a column GLYPH, so it has no along-metre extent and no
      // counterpart anywhere in the build payload (which carries gap regions only).
      // It is computed and counted here, and deliberately excluded from the area
      // comparison rather than silently folded into it.
      const substrateFills: UnderColumnFill[] =
        lithoRegions.length > 0
          ? engineV2
            ? computeUnderColumnSubstrateForRender(L.columns, lithoRegions)
            : computeUnderColumnSubstrate(L.columns, lithoRegions)
          : []
      const substrateSlices =
        substrateFills.length > 0
          ? refineSubstrateQuads(substrateFills, columnOrder, geoColByInv, nadMeta, lithoSoil)
          : []

      // ---- BUILD arm ----------------------------------------------------
      const G = assembleColumns(sec.geotech.columns, sec.geotech.alongM)
      const geoEdges = toEdges(sec.geotech.edges)
      const buildOverrides =
        G.columns.length >= 2
          ? deriveSectionApexOverrides(G.columns, geoEdges, G.alongM, geotechBoundaries, engineV2)
          : new Map<string, LensApexOverride>()
      const buildComputable = G.columns.length >= 2
      const buildRegions: SectionRegion[] = buildComputable
        ? computeSectionFillActive(G.columns, geoEdges, buildOverrides, G.alongM)
        : []

      // Structural anchor: the geotech columns must be litho columns at the same
      // along positions, or the two arms are not on one axis and no comparison in
      // along space would be meaningful.
      const lithoAlongByInv = new Map(L.columns.map((c, i) => [c.investigationId, L.alongM[i]]))
      const offAxis = G.columns.filter((c, i) => {
        const a = lithoAlongByInv.get(c.investigationId)
        return a === undefined || Math.abs(a - G.alongM[i]) > 1e-6
      })

      // ---- Map both arms into (along metres, elevation) ------------------
      const renderPolys: AlongPoly[] = []
      for (const p of refined) {
        const left = L.alongM[p.gapIndex]
        const right = L.alongM[p.gapIndex + 1]
        if (left === undefined || right === undefined || right - left <= 0) continue
        const pts = p.points.map((q) => ({ x: left + q.fraction * (right - left), e: q.elevation }))
        renderPolys.push({
          cls: classOf(p.formationId),
          x0: Math.min(...pts.map((q) => q.x)),
          x1: Math.max(...pts.map((q) => q.x)),
          pts,
        })
      }
      // The RAW litho partition in the same space, so the refinement can be held to
      // its own design rule: "litho boundaries are INVARIANT", which means the
      // refined polygons must cover exactly the litho regions they subdivide. Any
      // difference is area the NAD carve lost or invented, and it belongs to the
      // render arm alone — nothing about the build arm can explain it.
      const lithoPolys: AlongPoly[] = []
      for (const r of [...lithoRegions].sort(
        (a, b) => (a.kind === 'lens' ? 1 : 0) - (b.kind === 'lens' ? 1 : 0),
      )) {
        const left = L.alongM[r.gapIndex]
        const right = L.alongM[r.gapIndex + 1]
        if (left === undefined || right === undefined || right - left <= 0) continue
        const pts = r.polygon.map((q) => ({
          x: left + q.fraction * (right - left),
          e: q.elevation,
        }))
        lithoPolys.push({
          cls: r.formationId,
          x0: Math.min(...pts.map((q) => q.x)),
          x1: Math.max(...pts.map((q) => q.x)),
          pts,
        })
      }

      // Lens regions are by-design overlays and paint last, exactly as the overlay
      // sorts them and as the voxel labeller honours them.
      const buildOrdered = [...buildRegions].sort(
        (a, b) => (a.kind === 'lens' ? 1 : 0) - (b.kind === 'lens' ? 1 : 0),
      )
      const buildPolys: AlongPoly[] = []
      for (const r of buildOrdered) {
        const left = G.alongM[r.gapIndex]
        const right = G.alongM[r.gapIndex + 1]
        if (left === undefined || right === undefined || right - left <= 0) continue
        const pts = r.polygon.map((q) => ({
          x: left + q.fraction * (right - left),
          e: q.elevation,
        }))
        buildPolys.push({
          cls: classOf(r.formationId),
          x0: Math.min(...pts.map((q) => q.x)),
          x1: Math.max(...pts.map((q) => q.x)),
          pts,
        })
      }

      // ---- Scanline comparison ------------------------------------------
      const xs: number[] = []
      for (const p of [...renderPolys, ...buildPolys]) xs.push(p.x0, p.x1)
      const domainLo = xs.length ? Math.min(...xs) : 0
      const domainHi = xs.length ? Math.max(...xs) : 0
      const span = domainHi - domainLo
      const nSamples = Math.max(
        MIN_SAMPLES,
        Math.min(MAX_SAMPLES, Math.round(span / ALONG_STEP_M) || MIN_SAMPLES),
      )
      const dx = span > 0 ? span / nSamples : 0

      const buckets: Buckets = { agree: 0, disagree: 0, renderOnly: 0, buildOnly: 0 }
      const kinds: Kinds = { noPackingData: 0, soilDiffers: 0, classDiffers: 0 }
      const pairArea = new Map<string, number>()
      const renderOnlyByClass = new Map<string, number>()
      const buildOnlyByClass = new Map<string, number>()
      const classRender = new Map<string, number>()
      const classBuild = new Map<string, number>()
      let renderVoidM2 = 0
      let buildVoidM2 = 0
      let worstRenderVoid = 0
      let worstBuildVoid = 0
      // INSTRUMENT ANCHOR. Each arm's coverage is integrated straight off its
      // painted stack, by a different code path than the breakpoint walk that
      // fills the buckets. The two must agree to roundoff: coverage(render) ==
      // agree + disagree + renderOnly, and coverage(build) == agree + disagree +
      // buildOnly. A non-zero residual means the comparison is manufacturing or
      // losing area and none of its numbers may be reported.
      let renderCoverM2 = 0
      let buildCoverM2 = 0
      let lithoCoverM2 = 0
      let lithoVoidM2 = 0

      // Per-gap accumulation uses the RENDER arm's litho gaps as the reference
      // bands. Every build gap is a union of litho gaps (the geotech columns are a
      // subset), so a litho gap is a physical along interval both arms can be asked
      // about — this is a shared coordinate band, not a paired index.
      const gapAccum = new Map<number, Map<string, { r: number; b: number }>>()
      const gapOfX = (x: number): number => {
        for (let i = 0; i + 1 < L.alongM.length; i++) {
          if (x >= L.alongM[i] - 1e-9 && x <= L.alongM[i + 1] + 1e-9) return i
        }
        return x < L.alongM[0] ? -1 : L.alongM.length - 1
      }

      if (span > 0) {
        for (let k = 0; k < nSamples; k++) {
          const x = domainLo + (k + 0.5) * dx
          const rSegs = paintAt(renderPolys, x)
          const bSegs = paintAt(buildPolys, x)
          const gi = gapOfX(x)
          let gm = gapAccum.get(gi)
          if (!gm) {
            gm = new Map()
            gapAccum.set(gi, gm)
          }

          for (const s of rSegs) renderCoverM2 += (s.top - s.base) * dx
          for (const s of bSegs) buildCoverM2 += (s.top - s.base) * dx
          const lSegs = paintAt(lithoPolys, x)
          for (const s of lSegs) lithoCoverM2 += (s.top - s.base) * dx
          lithoVoidM2 += interiorVoids(lSegs).total * dx

          const rv = interiorVoids(rSegs)
          const bv = interiorVoids(bSegs)
          renderVoidM2 += rv.total * dx
          buildVoidM2 += bv.total * dx
          if (rv.worst > worstRenderVoid) worstRenderVoid = rv.worst
          if (bv.worst > worstBuildVoid) worstBuildVoid = bv.worst

          const bps: number[] = []
          for (const s of rSegs) bps.push(s.top, s.base)
          for (const s of bSegs) bps.push(s.top, s.base)
          if (bps.length === 0) continue
          bps.sort((p, q) => p - q)
          for (let i = 0; i + 1 < bps.length; i++) {
            const lo = bps[i]
            const hi = bps[i + 1]
            const h = hi - lo
            if (h <= EPS) continue
            const mid = (lo + hi) / 2
            const ca = classAt(rSegs, mid)
            const cb = classAt(bSegs, mid)
            const a = h * dx
            if (ca !== null) {
              classRender.set(ca, (classRender.get(ca) ?? 0) + a)
              const e = gm.get(ca) ?? { r: 0, b: 0 }
              e.r += a
              gm.set(ca, e)
            }
            if (cb !== null) {
              classBuild.set(cb, (classBuild.get(cb) ?? 0) + a)
              const e = gm.get(cb) ?? { r: 0, b: 0 }
              e.b += a
              gm.set(cb, e)
            }
            if (ca !== null && cb !== null) {
              if (ca === cb) buckets.agree += a
              else {
                buckets.disagree += a
                const key = `${ca} -> ${cb}`
                pairArea.set(key, (pairArea.get(key) ?? 0) + a)
                if (isFallback(ca) || isFallback(cb)) kinds.noPackingData += a
                else if (soilOf(ca) !== soilOf(cb)) kinds.soilDiffers += a
                else kinds.classDiffers += a
              }
            } else if (ca !== null) {
              buckets.renderOnly += a
              renderOnlyByClass.set(ca, (renderOnlyByClass.get(ca) ?? 0) + a)
            } else if (cb !== null) {
              buckets.buildOnly += a
              buildOnlyByClass.set(cb, (buildOnlyByClass.get(cb) ?? 0) + a)
            }
          }
        }
      }

      const union = buckets.agree + buckets.disagree + buckets.renderOnly + buckets.buildOnly
      const disagreementPct = union > 0 ? ((union - buckets.agree) / union) * 100 : 0
      const renderResidual =
        renderCoverM2 - (buckets.agree + buckets.disagree + buckets.renderOnly)
      const buildResidual = buildCoverM2 - (buckets.agree + buckets.disagree + buckets.buildOnly)
      if (Math.abs(renderResidual) > 1e-6 || Math.abs(buildResidual) > 1e-6) {
        console.log(
          `   INSTRUMENT FAILURE on ${sec.name}: area residual render ${renderResidual}, ` +
            `build ${buildResidual} — the comparison is not conserving area, do not report it`,
        )
      }
      instrumentWorstResidual = Math.max(
        instrumentWorstResidual,
        Math.abs(renderResidual),
        Math.abs(buildResidual),
      )

      for (const [k, v] of pairArea) globalPairArea.set(k, (globalPairArea.get(k) ?? 0) + v)
      for (const [k, v] of classRender) globalClassRender.set(k, (globalClassRender.get(k) ?? 0) + v)
      for (const [k, v] of classBuild) globalClassBuild.set(k, (globalClassBuild.get(k) ?? 0) + v)

      // ---- Each arm on its own terms: overlaps ---------------------------
      const scale = span > 0 ? DETECTOR_PLOT_W / span : 1
      const renderOverlapReports = detectRefinementOverlaps(
        detectorPolysFromRefinement(lithoRegions, refined, (gapIndex) => {
          const left = L.alongM[gapIndex]
          const right = L.alongM[gapIndex + 1]
          if (left === undefined || right === undefined) return null
          const xl = (left - domainLo) * scale
          const xr = (right - domainLo) * scale
          return xr - xl < 1 ? null : { xl, xr }
        }),
        // Well above the default cap so a saturated count never reads as a ceiling.
        400,
      )
      // The detector tags a pair as ``rawOnly`` when BOTH polygons are engine litho
      // regions, so the blame is separable: rawOnly is the litho engine's own sliver
      // debt, the rest was introduced by the NAD carve.
      const renderEngineOverlaps = renderOverlapReports.filter((r) => r.rawOnly).length
      const renderCarveOverlaps = renderOverlapReports.length - renderEngineOverlaps
      // Same-fill overlaps are invisible on screen (both polygons carry the same
      // colour), so only the different-fill ones are a spill the owner can see. The
      // fills are read back out of the detector's own message, whose format is fixed
      // in refineLithoPartition.overlap.ts.
      const renderVisibleOverlaps = renderOverlapReports.filter((r) => {
        const m = r.message.match(/OVERLAP \S+\(([^)]*)\) x \S+\(([^)]*)\)/)
        return m != null && m[1] !== m[2]
      }).length
      const buildOverlapReports = findNonLensOverlaps(buildRegions)

      // ---- Character note ------------------------------------------------
      const topPairs = [...pairArea.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([pair, m2]) => ({ pair, m2 }))
      const topRenderOnly = [...renderOnlyByClass.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([cls, m2]) => ({ cls, m2 }))
      const topBuildOnly = [...buildOnlyByClass.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([cls, m2]) => ({ cls, m2 }))

      let note: string
      if (!buildComputable) {
        note =
          `the build DROPS this section entirely (only ${G.columns.length} geotech column, ` +
          `and assembleSectionsWithCanonical skips a section with fewer than 2) while the ` +
          `canvas still draws a full refined partition`
      } else {
        const parts: string[] = []
        const biggest = Math.max(buckets.disagree, buckets.renderOnly, buckets.buildOnly)
        if (biggest === buckets.renderOnly && buckets.renderOnly > 0) {
          parts.push(
            `mostly area the section draws and the build has nothing for` +
              (topRenderOnly[0] ? ` (${topRenderOnly[0].cls})` : ''),
          )
        } else if (biggest === buckets.buildOnly && buckets.buildOnly > 0) {
          parts.push(
            `mostly area the build fills and the section leaves blank` +
              (topBuildOnly[0] ? ` (${topBuildOnly[0].cls})` : ''),
          )
        } else if (buckets.disagree > 0) {
          const worstKind =
            Math.max(kinds.soilDiffers, kinds.classDiffers, kinds.noPackingData) ===
            kinds.soilDiffers
              ? 'different LITHOLOGY at the same point'
              : Math.max(kinds.classDiffers, kinds.noPackingData) === kinds.classDiffers
                ? 'same lithology, different NAD class'
                : 'render has no packing data there and shows lithology colour'
          parts.push(
            `mostly same-place class conflict — ${worstKind}` +
              (topPairs[0] ? ` (worst ${topPairs[0].pair})` : ''),
          )
        } else parts.push('the two arms agree everywhere measured')
        if (offAxis.length > 0) parts.push(`${offAxis.length} geotech column(s) OFF the litho axis`)
        note = parts.join('; ')
      }

      const perGap = [...gapAccum.entries()]
        .filter(([gi]) => gi >= 0 && gi + 1 < L.alongM.length)
        .sort((a, b) => a[0] - b[0])
        .map(([gi, m]) => {
          const left = L.alongM[gi]
          const right = L.alongM[gi + 1]
          const w = right - left
          return {
            gapIndex: gi,
            leftAlongM: left,
            rightAlongM: right,
            classes: [...m.entries()]
              .sort((a, b) => b[1].r + b[1].b - (a[1].r + a[1].b))
              .map(([cls, v]) => ({
                cls,
                renderM2: v.r,
                buildM2: v.b,
                renderFracM: w > 0 ? v.r / w : 0,
                buildFracM: w > 0 ? v.b / w : 0,
              })),
          }
        })

      results.push({
        name: sec.name,
        kind: sec.kind,
        anchor: sec.anchor,
        computed: buildComputable,
        reason: buildComputable ? undefined : `geotech columns = ${G.columns.length} (< 2)`,
        buckets,
        kinds,
        disagreementPct,
        note,
        stepM: dx,
        lithoCols: L.columns.length,
        geoCols: G.columns.length,
        lithoEdges: lithoEdges.length,
        geoEdges: geoEdges.length,
        renderPolys: refined.length,
        buildRegions: buildRegions.length,
        renderOverlaps: renderOverlapReports.length,
        renderEngineOverlaps,
        renderCarveOverlaps,
        buildOverlaps: buildOverlapReports.length,
        renderVoidM2,
        buildVoidM2,
        lithoVoidM2,
        lithoCoverM2,
        renderCoverM2,
        buildCoverM2,
        substrateQuads: substrateSlices.length,
        substrateNoDonor: substrateSlices.filter((s) => s.slices == null).length,
        overridesRender: renderOverrides.size,
        overridesBuild: buildOverrides.size,
        topPairs,
        topRenderOnly,
        topBuildOnly,
        perGap,
      })

      // Per-section detail printed as it is measured, so a long run is readable.
      console.log('')
      console.log(`-- ${sec.name} (${sec.kind}) ------------------------------------`)
      console.log(
        `   litho arm  ${L.columns.length} cols, ${lithoRegions.length} regions -> ${refined.length} refined polys, ` +
          `overrides=${renderOverrides.size}, anchor=${sec.anchor}`,
      )
      if (!buildComputable) {
        console.log(
          `   build arm  NOT COMPUTABLE — ${G.columns.length} geotech column(s); ` +
            `buildVoxelRequest skips a section with fewer than 2 (sectionFenceData.ts:126)`,
        )
      } else {
        console.log(
          `   build arm  ${G.columns.length} cols, ${buildRegions.length} regions, ` +
            `${geoEdges.length} edges, overrides=${buildOverrides.size}`,
        )
      }
      console.log(
        `   disagreement ${fmt(disagreementPct)} %   ` +
          `agree ${fmt(buckets.agree)} m2 | different-class ${fmt(buckets.disagree)} m2 | ` +
          `render-only ${fmt(buckets.renderOnly)} m2 | build-only ${fmt(buckets.buildOnly)} m2`,
      )
      console.log(
        `   of the different-class area: ${fmt(kinds.soilDiffers)} m2 different LITHOLOGY, ` +
          `${fmt(kinds.classDiffers)} m2 same lithology different NAD class, ` +
          `${fmt(kinds.noPackingData)} m2 render had no packing data`,
      )
      console.log(`   note  ${note}`)
      if (topPairs.length)
        console.log(
          `   worst class swaps  ` + topPairs.map((p) => `${p.pair} ${fmt(p.m2)} m2`).join('  |  '),
        )
      if (topRenderOnly.length)
        console.log(
          `   drawn, not built   ` +
            topRenderOnly.map((p) => `${p.cls} ${fmt(p.m2)} m2`).join('  |  '),
        )
      if (topBuildOnly.length)
        console.log(
          `   built, not drawn   ` +
            topBuildOnly.map((p) => `${p.cls} ${fmt(p.m2)} m2`).join('  |  '),
        )
      console.log(
        `   own-terms  overlaps: render ${renderOverlapReports.length} ` +
          `(${renderEngineOverlaps} litho-engine, ${renderCarveOverlaps} NAD-carve; ` +
          `${renderVisibleOverlaps} between DIFFERENT fills, the rest invisible same-colour), ` +
          `build ${buildOverlapReports.length}; detector x-scale ${fmt(scale, 2)} px/m`,
      )
      console.log(
        `   own-terms  interior voids: litho partition ${fmt(lithoVoidM2, 2)} m2, ` +
          `render (refined) ${fmt(renderVoidM2, 2)} m2 (worst ${fmt(worstRenderVoid, 3)} m), ` +
          `build ${fmt(buildVoidM2, 2)} m2 (worst ${fmt(worstBuildVoid, 3)} m)`,
      )
      console.log(
        `   refinement fidelity  litho partition covers ${fmt(lithoCoverM2)} m2, refined ` +
          `covers ${fmt(renderCoverM2)} m2 (delta ${(renderCoverM2 - lithoCoverM2 >= 0 ? '+' : '') + fmt(renderCoverM2 - lithoCoverM2)} m2, ` +
          `${lithoCoverM2 > 0 ? fmt(((renderCoverM2 - lithoCoverM2) / lithoCoverM2) * 100, 2) : '0.00'} %) ` +
          `— design rule says litho boundaries are invariant, so this should be 0`,
      )
      const colsWithPacking = L.columns.filter(
        (c) => (geoColByInv.get(c.investigationId)?.units.length ?? 0) > 0,
      ).length
      const fallbackPolys = refined.filter((p) => p.tag === 'fallback').length
      console.log(
        `   packing data  ${colsWithPacking} of ${L.columns.length} litho columns carry NAD ` +
          `sub-bands; ${fallbackPolys} of ${refined.length} refined polygons fell back to ` +
          `plain lithology colour`,
      )
      console.log(
        `   render-only substrate  ${substrateSlices.length} under-column quads ` +
          `(${substrateSlices.filter((s) => s.slices == null).length} with no NAD donor) — ` +
          `no counterpart exists in the build payload`,
      )
      if (offAxis.length > 0)
        console.log(`   WARNING  ${offAxis.length} geotech column(s) not on the litho along axis`)
      for (const line of formatOverlapReports(buildOverlapReports).slice(0, 3))
        console.log(`   build overlap: ${line}`)
      for (const r of renderOverlapReports.slice(0, 3)) console.log(`   render ${r.message}`)
      console.log(`   sampled at ${fmt(dx, 3)} m along-step over ${fmt(span)} m`)
    }

    // ---- Summary ----------------------------------------------------------
    const tot: Buckets = { agree: 0, disagree: 0, renderOnly: 0, buildOnly: 0 }
    const totKinds: Kinds = { noPackingData: 0, soilDiffers: 0, classDiffers: 0 }
    for (const r of results) {
      tot.agree += r.buckets.agree
      tot.disagree += r.buckets.disagree
      tot.renderOnly += r.buckets.renderOnly
      tot.buildOnly += r.buckets.buildOnly
      totKinds.noPackingData += r.kinds.noPackingData
      totKinds.soilDiffers += r.kinds.soilDiffers
      totKinds.classDiffers += r.kinds.classDiffers
    }
    const totUnion = tot.agree + tot.disagree + tot.renderOnly + tot.buildOnly
    const totPct = totUnion > 0 ? ((totUnion - tot.agree) / totUnion) * 100 : 0

    console.log('')
    console.log('='.repeat(96))
    console.log('PER-SECTION SUMMARY (disagreement = share of the section plane where the two')
    console.log('arms do not assign the same NAD packing class at the same physical point)')
    console.log('='.repeat(96))
    console.log(
      '  section            kind   Lcol Gcol  disagree%      agree     diff-cls  render-only   build-only',
    )
    console.log('  ' + '-'.repeat(94))
    for (const r of results) {
      console.log(
        `  ${r.name.padEnd(18)} ${r.kind.padEnd(6)} ${String(r.lithoCols).padStart(4)} ` +
          `${String(r.geoCols).padStart(4)} ${fmt(r.disagreementPct).padStart(9)} ` +
          `${fmt(r.buckets.agree).padStart(10)} ${fmt(r.buckets.disagree).padStart(12)} ` +
          `${fmt(r.buckets.renderOnly).padStart(12)} ${fmt(r.buckets.buildOnly).padStart(12)}` +
          (r.computed ? '' : '   [build arm NOT COMPUTABLE]'),
      )
    }
    console.log('  ' + '-'.repeat(94))
    console.log(
      `  TOTAL                                 ${fmt(totPct).padStart(9)} ` +
        `${fmt(tot.agree).padStart(10)} ${fmt(tot.disagree).padStart(12)} ` +
        `${fmt(tot.renderOnly).padStart(12)} ${fmt(tot.buildOnly).padStart(12)}`,
    )

    // A second total over only the sections the build can actually produce, so the
    // headline is not carried by the two sections it drops entirely. Both numbers
    // are true and they answer different questions: the first is "how much of what
    // you see reaches the model", the second is "where it does reach the model, how
    // well do the two agree".
    const computedOnly = results.filter((r) => r.computed)
    const totC: Buckets = { agree: 0, disagree: 0, renderOnly: 0, buildOnly: 0 }
    for (const r of computedOnly) {
      totC.agree += r.buckets.agree
      totC.disagree += r.buckets.disagree
      totC.renderOnly += r.buckets.renderOnly
      totC.buildOnly += r.buckets.buildOnly
    }
    const totCUnion = totC.agree + totC.disagree + totC.renderOnly + totC.buildOnly
    const totCPct = totCUnion > 0 ? ((totCUnion - totC.agree) / totCUnion) * 100 : 0
    console.log(
      `  TOTAL over the ${computedOnly.length} sections the build can produce      ` +
        `${fmt(totCPct).padStart(9)} ${fmt(totC.agree).padStart(10)} ` +
        `${fmt(totC.disagree).padStart(12)} ${fmt(totC.renderOnly).padStart(12)} ` +
        `${fmt(totC.buildOnly).padStart(12)}`,
    )

    const sum = (pick: (r: SectionResult) => number): number => results.reduce((a, r) => a + pick(r), 0)
    console.log('')
    console.log('  EACH ARM ON ITS OWN TERMS, all 14 sections:')
    console.log(
      `    litho partition (the render arm's base)  covers ${fmt(sum((r) => r.lithoCoverM2))} m2, ` +
        `interior voids ${fmt(sum((r) => r.lithoVoidM2), 2)} m2, ` +
        `${sum((r) => r.renderEngineOverlaps)} overlapping region pairs`,
    )
    console.log(
      `    render arm (litho refined by NAD)        covers ${fmt(sum((r) => r.renderCoverM2))} m2, ` +
        `interior voids ${fmt(sum((r) => r.renderVoidM2), 2)} m2, ` +
        `${sum((r) => r.renderCarveOverlaps)} overlapping polygon pairs from the carve`,
    )
    console.log(
      `    build arm (direct geotech partition)     covers ${fmt(sum((r) => r.buildCoverM2))} m2, ` +
        `interior voids ${fmt(sum((r) => r.buildVoidM2), 2)} m2, ` +
        `${sum((r) => r.buildOverlaps)} overlapping region pairs`,
    )
    const lithoTot = sum((r) => r.lithoCoverM2)
    const refinedTot = sum((r) => r.renderCoverM2)
    console.log(
      `    the NAD refinement drops ${fmt(lithoTot - refinedTot)} m2 ` +
        `(${fmt(((lithoTot - refinedTot) / lithoTot) * 100, 2)} %) of the litho partition it is ` +
        `documented to leave invariant — that loss is inside the RENDER arm, not between the arms`,
    )

    console.log('')
    console.log(
      `  instrument anchor: worst area-conservation residual across all sections = ` +
        `${instrumentWorstResidual.toExponential(2)} m2 ` +
        `(coverage integrated per arm must equal that arm's bucket sum)`,
    )
    console.log(`  along-step setting: ${ALONG_STEP_M} m, max ${MAX_SAMPLES} samples per section`)

    console.log('')
    console.log('  WHAT the different-class area actually is, model-wide:')
    console.log(
      `    ${fmt(totKinds.soilDiffers).padStart(10)} m2  different LITHOLOGY at the same point`,
    )
    console.log(
      `    ${fmt(totKinds.classDiffers).padStart(10)} m2  same lithology, different NAD packing class`,
    )
    console.log(
      `    ${fmt(totKinds.noPackingData).padStart(10)} m2  render had no packing data of that ` +
        `soil code and drew plain lithology colour while the build assigned a class`,
    )
    console.log(
      `    ${fmt(tot.renderOnly).padStart(10)} m2  drawn on the section, absent from the build`,
    )
    console.log(
      `    ${fmt(tot.buildOnly).padStart(10)} m2  present in the build, blank on the section`,
    )

    console.log('')
    console.log('  worst class swaps model-wide (drawn class -> built class, m2):')
    for (const [k, v] of [...globalPairArea.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
      console.log(`    ${fmt(v).padStart(10)}  ${k}`)
    }

    console.log('')
    console.log('  total area each arm assigns per class (m2, all 14 sections):')
    const allClasses = new Set([...globalClassRender.keys(), ...globalClassBuild.keys()])
    const rows = [...allClasses]
      .map((c) => ({
        c,
        r: globalClassRender.get(c) ?? 0,
        b: globalClassBuild.get(c) ?? 0,
      }))
      .sort((a, b) => b.r + b.b - (a.r + a.b))
    console.log('    class                       render m2      build m2      delta')
    for (const row of rows.slice(0, 20)) {
      console.log(
        `    ${row.c.padEnd(24)} ${fmt(row.r).padStart(11)} ${fmt(row.b).padStart(13)} ` +
          `${(row.b - row.r >= 0 ? '+' : '') + fmt(row.b - row.r)}`,
      )
    }

    const notComputable = results.filter((r) => !r.computed)
    if (notComputable.length > 0) {
      console.log('')
      console.log('  ARMS THAT COULD NOT BE COMPUTED (not dropped silently):')
      for (const r of notComputable) {
        console.log(`    ${r.name}: build arm — ${r.reason}. Render arm computed normally.`)
      }
    }

    writeFileSync(
      DETAIL_OUT,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          engine: engineV2 ? 'v2' : 'v1',
          input: INPUT,
          alongStepM: ALONG_STEP_M,
          note:
            'Per-gap tables use the RENDER arm (litho) gaps as shared along-metre bands. ' +
            'Areas: m2 in the section plane; fracM = m2 divided by the gap width, the ' +
            'fraction-by-metre unit the engine works in.',
          totals: { ...tot, kinds: totKinds, disagreementPct: totPct },
          totalsOverBuildableSections: { ...totC, disagreementPct: totCPct },
          sections: results,
        },
        null,
        1,
      ),
      'utf8',
    )
    // ---- The frozen half: is this run worse than the committed baseline? ---
    const measured: MeasuredSection[] = results.map((r) => ({
      name: r.name,
      lithoCols: r.lithoCols,
      geoCols: r.geoCols,
      lithoEdges: r.lithoEdges,
      geoEdges: r.geoEdges,
      disagreementPct: r.disagreementPct,
      buckets: r.buckets,
    }))
    const fresh: AgreementBaseline = {
      frozenAt: new Date().toISOString(),
      engine: engineV2 ? 'v2' : 'v1',
      lithoModelId: String(raw.meta.lithoModelId),
      geotechModelId: String(raw.meta.geotechModelId),
      totalDisagreementPct: totPct,
      buildableDisagreementPct: totCPct,
      sections: measured.map((m) => ({
        name: m.name,
        lithoCols: m.lithoCols,
        geoCols: m.geoCols,
        lithoEdges: m.lithoEdges,
        geoEdges: m.geoEdges,
        disagreementPct: m.disagreementPct,
        agreeM2: m.buckets.agree,
        disagreeM2: m.buckets.disagree,
        renderOnlyM2: m.buckets.renderOnly,
        buildOnlyM2: m.buckets.buildOnly,
      })),
      note:
        'Share of the section plane where the geotech RENDER (litho partition refined by NAD) ' +
        'and the geotech BUILD (a direct partition of the geotech layers) assign a different ' +
        'packing class. Convergence work should drive these DOWN; a rise is a regression. ' +
        'PROVENANCE: measured from scripts/throwaway_geotech_axis_inputs.json, an UNTRACKED ' +
        'read-only dump of the owner dev DB (regenerate: uv run python ' +
        'scripts/dump_geotech_axis_inputs.py); reproducible only on that machine. ' +
        'TRACKED SUSPECT baked into these numbers: the render arm runs with ZERO hand-drawn ' +
        'body boundaries because SectionsCanvas clears them off any non-litho axis, while ' +
        'the litho render and both voxel builds apply them — suspected product defect, ' +
        'owner question open in docs/design/geotech-stage.md §7. On this model 1 litho / 0 ' +
        'geotech boundaries are stored, so the override path is UNEXERCISED here and the ' +
        'frozen number does not cover it.',
    }
    const baseline = readBaseline(BASELINE)
    console.log('')
    console.log('-'.repeat(96))
    console.log('FROZEN COMPARISON — has the gap between the two arms grown?')
    console.log('-'.repeat(96))
    let regressions: string[] = []
    if (process.env.GEOTECH_AGREE_FREEZE === '1') {
      if (baseline) {
        for (const line of compareToBaseline(
          measured,
          baseline,
          fresh.lithoModelId,
          fresh.geotechModelId,
          fresh.engine,
          totPct,
          totCPct,
        ).lines) {
          console.log(line)
        }
      }
      writeBaseline(BASELINE, fresh)
      console.log(`  BASELINE REWRITTEN -> ${BASELINE}`)
    } else if (!baseline) {
      console.log(
        `  no baseline at ${BASELINE} — freeze one with GEOTECH_AGREE=1 ` +
          `GEOTECH_AGREE_FREEZE=1`,
      )
    } else {
      const verdict = compareToBaseline(
        measured,
        baseline,
        fresh.lithoModelId,
        fresh.geotechModelId,
        fresh.engine,
        totPct,
        totCPct,
      )
      for (const line of verdict.lines) console.log(line)
      // Only enforce when the run is comparable at all: a different engine or a
      // model that moved under the baseline makes the delta meaningless, and
      // failing on it would train the reader to ignore this gate.
      regressions =
        baseline.engine === fresh.engine && verdict.skipped.length < measured.length
          ? verdict.regressions
          : []
      if (verdict.skipped.length > 0) {
        console.log(
          `  ${verdict.skipped.length} section(s) not enforced (inputs moved): ` +
            verdict.skipped.join(', '),
        )
      }
    }

    console.log('')
    console.log(`  full per-gap / per-class detail written to ${DETAIL_OUT}`)
    console.log('='.repeat(96))
    console.log('')

    expect(results.length).toBe(raw.sections.length)
    // The arbiter. Convergence work must move these numbers down; nothing may
    // push them up by more than half a percentage point without saying so.
    expect(
      regressions,
      `the two geotech arms drifted FURTHER apart than the committed baseline:\n  ` +
        `${regressions.join('\n  ')}\n(re-freeze deliberately with GEOTECH_AGREE_FREEZE=1 ` +
        `only when the rise is understood and accepted)`,
    ).toEqual([])
  }, 600_000)
})
