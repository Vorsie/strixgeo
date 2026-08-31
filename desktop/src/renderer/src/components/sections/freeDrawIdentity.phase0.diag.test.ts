/**
 * freeDrawIdentity.phase0.diag.test.ts — PHASE 0 of the §87 architectural free-draw repair.
 *
 * TRACE + MEASURE ONLY (no behaviour change). The §87 brief is a TARGET-IDENTITY / TOPOLOGY bug,
 * not a "guard is too strict" bug. Before touching any code this test measures, on the REAL CS1
 * partition (``scripts/diag_allsections_input.json``), the two quantities the brief's root-cause
 * classification (A–F) hinges on:
 *
 *   MEASUREMENT 1 — REJECTION-IDENTITY BREADTH (CONFIRMED BUG #1).
 *     ``rejectedDragBody`` is a body-level string and ``handleFillColor`` reddens EVERY handle whose
 *     ``bodyId`` matches. For each shapeable body, count how many DISTINCT rendered handles (lens
 *     tips across gaps/edges) carry that same bodyId — i.e. how many handles the current body-level
 *     rejection would redden when only ONE of them is dragged. Any body with >1 shapeable region
 *     proves the over-broad reddening.
 *
 *   MEASUREMENT 2 — RAW/RENDERED ALIAS FAN-OUT (the most-important investigation).
 *     ``expandOverrideAliasesFromBase`` turns ONE render-body override at a gap into overrides for
 *     EVERY raw body in the merged same-litho component. Measure, per shapeable override:
 *       (a) how many ALIAS keys the expansion adds beyond the original;
 *       (b) whether any alias key targets a (bodyId, gap) whose RENDERED body differs from the
 *           override's own rendered body — i.e. the override could reach a DIFFERENT visible feature
 *           (the onlap-disappears / edits-go-unsafe mechanism);
 *       (c) whether, WITHIN the override's own gap, the merged component holds >1 raw emitter (an
 *           in-gap fan-out that changes which geometry the drag actually owns).
 *
 * Gated ``CS1_GATE=1`` (skips in the normal suite). Pure diagnostic — no engine / app edits. This is
 * the Phase-0 evidence the §87 report classifies the root cause from; it stays RED-free (it asserts
 * only that the fixture EXERCISES the multi-handle / multi-alias case, so a future refactor that
 * eliminates the case fails loudly and the diagnostic can retire).
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  type CorrelationEdge,
  type LensApexOverride,
  lensApexOverrideKey,
  type PartitionColumn,
  type PartitionPoint,
  type SectionRegion,
} from '../../utils/sectionPartition'
import { computeSectionFillV2 } from '../../utils/partitionFillV2'
import { expandOverrideAliasesFromBase } from '../../utils/partitionFillV2/expandOverrideAliases'
import { setTwoSidedTerminations } from '../../utils/partitionFillV2/tileFlags'

const RUN = process.env.CS1_GATE === '1'
const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../../..')
const INPUT = resolve(REPO_ROOT, 'scripts/diag_allsections_input.json')

const TIP_FRACTION_EPS = 0.02
function isApexShapeable(region: SectionRegion): boolean {
  if (region.kind === 'lens') return true
  let fMin = Infinity
  let fMax = -Infinity
  let hasInteriorVertex = false
  for (const p of region.polygon) {
    if (p.fraction < fMin) fMin = p.fraction
    if (p.fraction > fMax) fMax = p.fraction
    if (p.fraction > TIP_FRACTION_EPS && p.fraction < 1 - TIP_FRACTION_EPS) hasInteriorVertex = true
  }
  const spansFullWidth = fMin <= TIP_FRACTION_EPS && fMax >= 1 - TIP_FRACTION_EPS
  return hasInteriorVertex && !spansFullWidth
}

function polygonKey(poly: readonly PartitionPoint[]): string {
  return poly.map((p) => `${p.fraction.toFixed(5)},${p.elevation.toFixed(5)}`).join(';')
}

function realSection(name: string): { columns: PartitionColumn[]; edges: CorrelationEdge[]; alongM: number[] } {
  const raw = JSON.parse(readFileSync(INPUT, 'utf8'))
  const sec = raw.sections.find((s: { name: string }) => s.name === name)
  if (!sec) throw new Error(`section ${name} not in diag input`)
  const keep = sec.columns
    .map((c: { surfaceElevM: number | null; units: unknown[] }, i: number) => ({ c, i }))
    .filter(({ c }: { c: { surfaceElevM: number | null; units: unknown[] } }) => c.surfaceElevM != null && c.units.length > 0)
  const columns: PartitionColumn[] = keep.map(
    ({ c }: { c: { investigationId: string; surfaceElevM: number; units: unknown[] } }) => ({
      investigationId: c.investigationId,
      surfaceElevM: c.surfaceElevM,
      units: c.units as PartitionColumn['units'],
    }),
  )
  const alongM = keep.map(({ i }: { i: number }) => sec.alongM[i])
  const edges: CorrelationEdge[] = sec.edges.map((e: { a: string; b: string; aSide?: string; bSide?: string }) => ({
    a: e.a,
    b: e.b,
    aSide: (e.aSide ?? 'top') as 'top' | 'base',
    bSide: (e.bSide ?? 'top') as 'top' | 'base',
  }))
  return { columns, edges, alongM }
}

describe.skipIf(!RUN)('Phase 0 — §87 free-draw identity + alias trace (real CS1)', () => {
  it('measures rejection-identity breadth and raw/rendered alias fan-out', { timeout: 120000 }, () => {
    setTwoSidedTerminations(true)
    try {
      const { columns, edges, alongM } = realSection('Cross-section 1')
      // The RENDERED (post-merge) partition = what the app draws handles on (flag ON = merge).
      const rendered = computeSectionFillV2(columns, edges, undefined, alongM)
      // The RAW (pre-merge) partition = what the ENGINE emits per unit (flag OFF = no
      // mergeTouchingBodies). ``classifyOverrideOutcome`` forms exactly this (sliced) + rendered
      // (merged) pair internally and feeds it to ``expandOverrideAliasesFromBase``. We reproduce the
      // pair here to measure the REAL alias fan-out (my first pass fed rendered twice → 0 aliases).
      setTwoSidedTerminations(false)
      const rawSliced = computeSectionFillV2(columns, edges, undefined, alongM)
      setTwoSidedTerminations(true)
      const mergedRatio =
        rawSliced.length > 0
          ? new Set(rendered.map((r) => r.bodyId)).size / new Set(rawSliced.map((r) => r.bodyId)).size
          : 1
      // eslint-disable-next-line no-console
      console.info(
        `[P0-MERGE] raw bodies=${new Set(rawSliced.map((r) => r.bodyId)).size} ` +
          `rendered bodies=${new Set(rendered.map((r) => r.bodyId)).size} (merge collapse ratio=${mergedRatio.toFixed(3)})`,
      )
      const shapeable = rendered.filter((r) => r.bodyId != null && isApexShapeable(r))

      // ---- MEASUREMENT 1: rejection-identity breadth --------------------------------------------
      // Group shapeable regions by bodyId. Every region here renders its own grab handle(s). A body
      // with >1 shapeable region means the current body-level ``handleFillColor`` reddens all of them
      // when only one is dragged.
      const regionsPerBody = new Map<string, SectionRegion[]>()
      for (const r of shapeable) {
        const arr = regionsPerBody.get(r.bodyId as string) ?? regionsPerBody.set(r.bodyId as string, []).get(r.bodyId as string)!
        arr.push(r)
      }
      let multiHandleBodies = 0
      let worstSiblingCount = 0
      let worstBody = ''
      for (const [bodyId, regs] of regionsPerBody) {
        if (regs.length > 1) {
          multiHandleBodies++
          if (regs.length > worstSiblingCount) {
            worstSiblingCount = regs.length
            worstBody = bodyId
          }
        }
      }
      // eslint-disable-next-line no-console
      console.info(
        `[P0-IDENT] shapeable handles=${shapeable.length} distinct bodies=${regionsPerBody.size} ` +
          `bodies-with->1-handle=${multiHandleBodies} worst body=${worstBody.slice(0, 8)} carries ${worstSiblingCount} shapeable regions`,
      )
      // Also: does a shapeable body ALSO own a shared-boundary contact (participate as an upper body
      // of a full-width band pair)? Those handles ALSO redden under the body-level rule. Count bodies
      // that are BOTH shapeable-tip owners AND full-width band owners in some gap.
      const fullWidthBandBodies = new Set<string>()
      for (const r of rendered) {
        if (r.bodyId == null) continue
        let fMin = Infinity
        let fMax = -Infinity
        for (const p of r.polygon) {
          fMin = Math.min(fMin, p.fraction)
          fMax = Math.max(fMax, p.fraction)
        }
        if (fMin <= TIP_FRACTION_EPS && fMax >= 1 - TIP_FRACTION_EPS) fullWidthBandBodies.add(r.bodyId)
      }
      let tipAndBandBodies = 0
      for (const bodyId of regionsPerBody.keys()) if (fullWidthBandBodies.has(bodyId)) tipAndBandBodies++
      // eslint-disable-next-line no-console
      console.info(
        `[P0-IDENT] bodies that are BOTH a shapeable tip AND a full-width band (→ their boundary handle ` +
          `ALSO reddens under body-level rejection) = ${tipAndBandBodies}`,
      )

      // ---- MEASUREMENT 2: raw/rendered alias fan-out --------------------------------------------
      // For EACH shapeable rendered override, run the alias expansion and count the breadth + whether
      // any alias reaches a DIFFERENT rendered body (in the same or another gap).
      // Build the raw↔rendered maps exactly like ``expandOverrideAliasesFromBase`` does internally so
      // we can classify each alias target's rendered body.
      // Map (gap#polygon) → rendered bodyId, to classify what a given (rawBody, gap) alias resolves to.
      const renderedByGapPoly = new Map<string, string>()
      for (const r of rendered) {
        if (r.bodyId) renderedByGapPoly.set(`${r.gapIndex}#${polygonKey(r.polygon)}`, r.bodyId)
      }

      let overridesTested = 0
      let totalAliasesAdded = 0
      let overridesWithCrossRenderedAlias = 0
      let overridesWithInGapFanout = 0
      let worstAliasCount = 0
      const crossRenderedExamples: string[] = []

      for (const r of shapeable) {
        const bodyId = r.bodyId as string
        const gap = r.gapIndex
        const key = lensApexOverrideKey(bodyId, gap)
        const elevs = r.polygon.map((p) => p.elevation)
        const midElev = (Math.max(...elevs) + Math.min(...elevs)) / 2
        const ov = new Map<string, LensApexOverride>([[key, { fraction: 0.5, elevation: midElev }]])
        // Real basePass: sliced (RAW pre-merge) + merged (rendered) — the EXACT pair the engine forms
        // internally (``classifyOverrideOutcome`` → runFill(undefined) → {sliced, merged}).
        const expanded = expandOverrideAliasesFromBase(ov, () => ({ sliced: rawSliced, merged: rendered }))
        const aliasKeys = expanded ? [...expanded.keys()].filter((k) => k !== key) : []
        overridesTested++
        totalAliasesAdded += aliasKeys.length
        if (aliasKeys.length > worstAliasCount) worstAliasCount = aliasKeys.length

        // Classify each alias: does it reach a rendered body different from THIS override's rendered
        // body, and does it stay in this gap or spill to another gap?
        let crossRendered = false
        let inGapFanout = false
        for (const ak of aliasKeys) {
          const at = ak.lastIndexOf('@')
          const aRaw = ak.slice(0, at)
          const aGap = Number(ak.slice(at + 1))
          // Which rendered body does (aRaw, aGap) correspond to? Find a rendered region in aGap whose
          // bodyId == aRaw (the raw is itself a merge representative / raw member).
          const targetRendered = rendered.find((rr) => rr.gapIndex === aGap && rr.bodyId === aRaw)
          const targetRenderedBody = targetRendered?.bodyId ?? aRaw
          if (targetRenderedBody !== bodyId) crossRendered = true
          if (aGap === gap && aRaw !== bodyId) inGapFanout = true
        }
        if (crossRendered) {
          overridesWithCrossRenderedAlias++
          if (crossRenderedExamples.length < 8) {
            crossRenderedExamples.push(`${bodyId.slice(0, 8)}@${gap} → ${aliasKeys.length} aliases (cross-rendered)`)
          }
        }
        if (inGapFanout) overridesWithInGapFanout++
      }

      // eslint-disable-next-line no-console
      console.info(
        `[P0-ALIAS] overrides tested=${overridesTested} total aliases added=${totalAliasesAdded} ` +
          `worst single-override alias count=${worstAliasCount}`,
      )
      // eslint-disable-next-line no-console
      console.info(
        `[P0-ALIAS] overrides whose aliases reach a DIFFERENT rendered body=${overridesWithCrossRenderedAlias} ` +
          `| overrides with >1 raw emitter IN THE SAME GAP=${overridesWithInGapFanout}`,
      )
      for (const ex of crossRenderedExamples) {
        // eslint-disable-next-line no-console
        console.info(`[P0-ALIAS] cross-rendered example: ${ex}`)
      }

      // ---- MEASUREMENT 3: does an override MUTATE an unrelated rendered body in the same gap? ------
      // The decisive test that separates a HARMLESS relabel-alias (the raw ids all belong to the SAME
      // rendered region, so aliasing only helps the emitter find the override) from a CORRUPTING
      // fan-out (the override reshapes a DIFFERENT visible feature — the "onlap disappears" mechanism).
      // For each shapeable override, apply it via the full engine (classifyOverrideOutcome path =
      // computeSectionFillV2 WITH aliasing) and count rendered bodies (other than the target) in the
      // SAME gap whose footprint changed.
      const bodyGapSig = (regs: SectionRegion[], bodyId: string, gap: number): string =>
        regs
          .filter((rr) => rr.bodyId === bodyId && rr.gapIndex === gap)
          .map((rr) => `${rr.kind}|${polygonKey(rr.polygon)}`)
          .sort()
          .join('#')
      // Elevation band [min,max] of a body's regions in a gap (to tell a boundary-sharing neighbour —
      // legitimate tessellation re-flow — from a topologically DISTANT feature the drag must not touch).
      const elevBand = (regs: SectionRegion[], bodyId: string, gap: number): [number, number] | null => {
        let lo = Infinity
        let hi = -Infinity
        for (const rr of regs) {
          if (rr.bodyId !== bodyId || rr.gapIndex !== gap) continue
          for (const p of rr.polygon) {
            lo = Math.min(lo, p.elevation)
            hi = Math.max(hi, p.elevation)
          }
        }
        return lo === Infinity ? null : [lo, hi]
      }
      let overridesMutatingOtherBody = 0
      let overridesMutatingDistantBody = 0 // mutation of a body whose elevation band does NOT touch the target's
      const mutationExamples: string[] = []
      for (const r of shapeable) {
        const bodyId = r.bodyId as string
        const gap = r.gapIndex
        const key = lensApexOverrideKey(bodyId, gap)
        const elevs = r.polygon.map((p) => p.elevation)
        const midElev = (Math.max(...elevs) + Math.min(...elevs)) / 2
        // A MODERATE reach (mirrors reshapeMap): the reach a real drag lands in.
        const apexF = (() => {
          let best = 0.5
          let bestDist = -1
          for (const p of r.polygon) {
            const d = Math.min(p.fraction, 1 - p.fraction)
            if (d > bestDist) {
              bestDist = d
              best = p.fraction
            }
          }
          return best
        })()
        const targetFrac = apexF < 0.5 ? Math.min(0.7, apexF + 0.15) : Math.max(0.3, apexF - 0.15)
        const ov = new Map<string, LensApexOverride>([[key, { fraction: targetFrac, elevation: midElev }]])
        const after = computeSectionFillV2(columns, edges, ov, alongM)
        // Rendered bodies present in this gap OTHER than the target.
        const otherBodies = new Set(
          rendered.filter((rr) => rr.gapIndex === gap && rr.bodyId != null && rr.bodyId !== bodyId).map((rr) => rr.bodyId as string),
        )
        const targetBand = elevBand(rendered, bodyId, gap)
        let mutatedAny = false
        let mutatedDistant = false
        for (const ob of otherBodies) {
          if (bodyGapSig(rendered, ob, gap) !== bodyGapSig(after, ob, gap)) {
            mutatedAny = true
            // Distant = the mutated body's elevation band does not touch the target's (not a shared-
            // boundary neighbour that legitimately re-flows). Touch tolerance = 0.05 m.
            const ob2 = elevBand(rendered, ob, gap)
            const touches =
              targetBand && ob2 ? !(ob2[1] < targetBand[0] - 0.05 || ob2[0] > targetBand[1] + 0.05) : true
            if (!touches) mutatedDistant = true
            if (mutationExamples.length < 12) {
              mutationExamples.push(
                `drag ${bodyId.slice(0, 8)}@${gap} MUTATED ${touches ? 'neighbour' : 'DISTANT'} body ${ob.slice(0, 8)}`,
              )
            }
          }
        }
        if (mutatedAny) overridesMutatingOtherBody++
        if (mutatedDistant) overridesMutatingDistantBody++
      }
      // eslint-disable-next-line no-console
      console.info(
        `[P0-MUTATE] of ${shapeable.length} drags, ${overridesMutatingOtherBody} MUTATED some other body in the gap; ` +
          `of those, ${overridesMutatingDistantBody} mutated a topologically DISTANT body (NOT a shared-boundary ` +
          `neighbour) — the onlap-disappears / alias-corruption signature`,
      )
      for (const ex of mutationExamples) {
        // eslint-disable-next-line no-console
        console.info(`[P0-MUTATE] ${ex}`)
      }

      // ---- MEASUREMENT 4: SECOND-edit stability ("worse after the FIRST click/edit"). -------------
      // The dogfeed says behaviour degrades after the first edit. Model it: persist edit A (its override
      // stays in the map), then apply edit B on a DIFFERENT body. Compare B's reshape (a) alone vs
      // (b) with A already applied. If they differ, the first edit destabilised the second's target
      // (class C — unstable identity after re-render / stateful corruption).
      const distinctBodies = [...new Set(shapeable.map((s) => s.bodyId as string))]
      let secondEditDivergences = 0
      if (distinctBodies.length >= 2) {
        // Pick A and B as two DIFFERENT bodies each with a single shapeable region in some gap.
        const single = shapeable.filter(
          (s) => regionsPerBody.get(s.bodyId as string)!.filter((rr) => rr.gapIndex === s.gapIndex).length === 1,
        )
        const pairs: [SectionRegion, SectionRegion][] = []
        for (let i = 0; i < single.length && pairs.length < 12; i++) {
          for (let j = 0; j < single.length && pairs.length < 12; j++) {
            if (single[i].bodyId === single[j].bodyId) continue
            pairs.push([single[i], single[j]])
          }
        }
        const buildOv = (r: SectionRegion): [string, LensApexOverride] => {
          const elevs = r.polygon.map((p) => p.elevation)
          const midElev = (Math.max(...elevs) + Math.min(...elevs)) / 2
          let apexF = 0.5
          let bestDist = -1
          for (const p of r.polygon) {
            const d = Math.min(p.fraction, 1 - p.fraction)
            if (d > bestDist) {
              bestDist = d
              apexF = p.fraction
            }
          }
          const targetFrac = apexF < 0.5 ? Math.min(0.7, apexF + 0.15) : Math.max(0.3, apexF - 0.15)
          return [lensApexOverrideKey(r.bodyId as string, r.gapIndex), { fraction: targetFrac, elevation: midElev }]
        }
        for (const [a, b] of pairs) {
          const [ka, va] = buildOv(a)
          const [kb, vb] = buildOv(b)
          // B alone.
          const bAlone = computeSectionFillV2(columns, edges, new Map([[kb, vb]]), alongM)
          // B after A is already applied.
          const bAfterA = computeSectionFillV2(columns, edges, new Map([[ka, va], [kb, vb]]), alongM)
          if (bodyGapSig(bAlone, b.bodyId as string, b.gapIndex) !== bodyGapSig(bAfterA, b.bodyId as string, b.gapIndex)) {
            secondEditDivergences++
          }
        }
        // eslint-disable-next-line no-console
        console.info(
          `[P0-2ND] of ${pairs.length} (editA, then editB) pairs, ${secondEditDivergences} where B's own reshape ` +
            `DIVERGED because A was already applied (class-C stateful destabilisation)`,
        )
      }

      // ---- MEASUREMENT 5: AGGRESSIVE-reach distant-onlap corruption. ------------------------------
      // The rejection path fires at an aggressive reach; if the alias fan-out corrupts a distant onlap
      // it would show HERE. Drive each override far past the far column (1.8) — the S79 reject reach —
      // and count DISTANT-body mutations. The engine's defect guard degrades an unsafe reach to the base
      // fill, so most of these produce NO mutation at all; the question is whether the aliased variant
      // that DID apply reached an unrelated onlap.
      let aggressiveDistantMutations = 0
      for (const r of shapeable) {
        const bodyId = r.bodyId as string
        const gap = r.gapIndex
        const key = lensApexOverrideKey(bodyId, gap)
        const elevs = r.polygon.map((p) => p.elevation)
        const midElev = (Math.max(...elevs) + Math.min(...elevs)) / 2
        const ov = new Map<string, LensApexOverride>([[key, { fraction: 1.8, elevation: midElev }]])
        const after = computeSectionFillV2(columns, edges, ov, alongM)
        const targetBand = elevBand(rendered, bodyId, gap)
        const otherBodies = new Set(
          rendered.filter((rr) => rr.gapIndex === gap && rr.bodyId != null && rr.bodyId !== bodyId).map((rr) => rr.bodyId as string),
        )
        for (const ob of otherBodies) {
          if (bodyGapSig(rendered, ob, gap) !== bodyGapSig(after, ob, gap)) {
            const ob2 = elevBand(rendered, ob, gap)
            const touches = targetBand && ob2 ? !(ob2[1] < targetBand[0] - 0.05 || ob2[0] > targetBand[1] + 0.05) : true
            if (!touches) aggressiveDistantMutations++
          }
        }
      }
      // eslint-disable-next-line no-console
      console.info(
        `[P0-AGGR] aggressive (1.8) reach: ${aggressiveDistantMutations} DISTANT-body mutations across all ` +
          `${shapeable.length} overrides (the "onlap disappears at extreme reach" corruption test)`,
      )

      // The diagnostic EXERCISES the multi-handle case (the bug the fix targets). If CS1 ever has no
      // multi-handle body, this fixture no longer reproduces BUG #1 → fail loudly so the report is honest.
      expect(shapeable.length, 'CS1 must have shapeable handles to exercise the identity trace').toBeGreaterThan(0)
    } finally {
      setTwoSidedTerminations(false)
    }
  })
})
