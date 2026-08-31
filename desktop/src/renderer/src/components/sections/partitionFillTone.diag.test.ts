/**
 * THROWAWAY DIAG — does the composited fill tone change at a column card edge?
 *
 * Owner, on a fresh screenshot (2026-08-15): "fill tone still seems a bit off?".
 * ``STACK_CARD_VEIL_OPACITY`` is already 0 and ``columnFillTone`` already equals
 * ``gapFillTone`` as arithmetic, so the remaining suspect is the RENDER: the
 * overlay emits several independent SVG elements, and two translucent elements
 * covering the same pixel composite TWICE (0.62 over 0.62 ≈ 0.855) where one
 * dissolved element would composite once.
 *
 * This harness replays the geotech axis's real emitted paint list on the real
 * project dump and samples the coat stack a few px either side of every column
 * card edge. Dormant unless TONE_DIAG=1.
 *
 * ⚠ STALE ARM (2026-08-15). The geotech partition below is still built on the
 * GEOTECH column set with the clip gated on the two column sets matching —
 * the construction the render used BEFORE the frame-aligned assembly
 * (``utils/frameAlignedPartition``). That is harmless for the question this
 * harness asks (how many translucent coats stack at a card edge, which the
 * partition's column axis does not change) but it is NOT the render's
 * coverage: use ``geotechLithoConsistency.diag.test.ts`` for anything about
 * WHERE the fill reaches.
 *
 * Env: GEOTECH_AXIS_INPUT (input override). Reads
 * scripts/throwaway_geotech_axis_inputs.json.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'vitest'

import type { BodyBoundaryResponse } from '../../api/clients/geology.types'
import { deriveSectionApexOverrides } from '../../utils/buildVoxelRequest'
import { frameAlignedColumns } from '../../utils/frameAlignedPartition'
import { computeHierarchicalGeotechFill } from '../../utils/geotechHierarchicalFill'
import { buildPackingClassOf } from '../../utils/geotechHierarchicalFill/packingClassOf'
import { computeSectionFillActive } from '../../utils/partitionEngineSelect'
import type { CorrelationEdge, PartitionColumn, SectionRegion } from '../../utils/partitionFill'
import { buildColumnStripFills } from './columnStripFills'
import { computeUnderColumnSubstrateForRender } from './underColumnSubstrate'
import { buildFillGroups, type FillGroupElement } from './sectionFillGroups'
import { computeSectionSeamStrokes } from './sectionSeamStrokeElements'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../../..')
const INPUT = process.env.GEOTECH_AXIS_INPUT
  ? resolve(REPO_ROOT, process.env.GEOTECH_AXIS_INPUT)
  : resolve(REPO_ROOT, 'scripts/throwaway_geotech_axis_inputs.json')

const FILL_OPACITY = 0.62
const LENS_OPACITY = 0.85
const HALF_CARD_PX = 26
/** Card-centre spacing (px) the tightest column pair is scaled to, so no two
 *  cards can overlap in the synthetic projection (a harness artifact, not a
 *  render one) and every gap is a real gap. */
const MIN_SPACING_PX = 140
/** How far either side of a card edge the probe samples (px). */
const PROBE_PX = Number(process.env.TONE_PROBE_PX ?? '2')
const V_PX_PER_M = 12

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
interface RawSection extends RawArm {
  sectionId: string
  name: string
  geotech: RawArm
}
interface RawFile {
  refinementBundle: {
    nadMeta: Record<string, { nadClass: number | null; soilCode: string | null }>
    lithoSoilByFormationId: Record<string, string | null>
  }
  sections: RawSection[]
}

const toEdges = (raw: readonly RawEdge[]): CorrelationEdge[] =>
  raw.map((e) => ({
    a: e.a,
    b: e.b,
    aSide: (e.aSide ?? 'top') as 'top' | 'base',
    bSide: (e.bSide ?? 'top') as 'top' | 'base',
  }))

function assemble(arm: RawArm): { columns: PartitionColumn[]; alongM: number[] } {
  const paired = arm.columns
    .map((c, i) => ({ c, a: arm.alongM[i] }))
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

/** One emitted SVG element: a set of rings painted ONCE at ``opacity``. */
interface PaintedElement {
  label: string
  formationId: string
  opacity: number
  rings: { pts: { x: number; y: number }[]; tag: string }[]
}

function pointInRing(x: number, y: number, ring: readonly { x: number; y: number }[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]
    const b = ring[j]
    if (a.y > y !== b.y > y && x < a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x)) inside = !inside
  }
  return inside
}

/** Tag of the first ring of ``el`` covering (x,y), or null. */
const coverTag = (el: PaintedElement, x: number, y: number): string | null =>
  el.rings.find((r) => pointInRing(x, y, r.pts))?.tag ?? null

describe('TONE diag — composited coats either side of a card edge', () => {
  if (process.env.TONE_DIAG !== '1' || !existsSync(INPUT)) {
    it.skip('dormant (set TONE_DIAG=1)', () => {})
    return
  }
  it('samples every card edge on every section', () => {
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as RawFile
    const lithoSoil = new Map(Object.entries(raw.refinementBundle.lithoSoilByFormationId))
    const geoSoil = new Map<string, string | null>(
      Object.entries(raw.refinementBundle.nadMeta).map(([k, v]) => [k, v.soilCode]),
    )
    const empty = new Map<string, BodyBoundaryResponse>()
    const report: string[] = []

    for (const sec of raw.sections) {
      const L = assemble(sec)
      const G = assemble(sec.geotech)
      if (G.columns.length < 2 || L.columns.length < 2) continue
      const lithoEdges = toEdges(sec.edges)
      const geoEdges = toEdges(sec.geotech.edges)
      const lithoRegions = computeSectionFillActive(
        L.columns,
        lithoEdges,
        deriveSectionApexOverrides(L.columns, lithoEdges, L.alongM, empty),
        L.alongM,
      )
      const geoRegionsRaw = computeSectionFillActive(
        G.columns,
        geoEdges,
        deriveSectionApexOverrides(G.columns, geoEdges, G.alongM, empty),
        G.alongM,
      )
      const columnsMatch =
        L.alongM.length === G.alongM.length &&
        L.alongM.every((x, i) => Math.abs(x - G.alongM[i]) < 1e-6)
      let geoRegions: SectionRegion[] = geoRegionsRaw as SectionRegion[]
      let lithoFallback: SectionRegion[] = []
      if (columnsMatch) {
        // What the geotech axis draws: densities within lithos.
        const hierarchical = computeHierarchicalGeotechFill({
          lithoColumns: L.columns,
          lithoEdges,
          lithoRegions,
          geotechColumns: frameAlignedColumns(
            L.columns,
            new Map(G.columns.map((c) => [c.investigationId, c])),
          ),
          geotechEdges: geoEdges,
          alongM: L.alongM,
          packingClassOf: buildPackingClassOf(Object.entries(raw.refinementBundle.nadMeta)),
        })
        geoRegions = hierarchical.regions
        lithoFallback = hierarchical.lithoFallback
      }

      // --- screen projection (the overlay's own shape, synthetic scale). ------
      const minAlong = Math.min(...G.alongM)
      let minSpacingM = Infinity
      for (let i = 1; i < G.alongM.length; i++)
        minSpacingM = Math.min(minSpacingM, G.alongM[i] - G.alongM[i - 1])
      const pxPerM = MIN_SPACING_PX / Math.max(minSpacingM, 1e-6)
      const xOf = (a: number): number => 100 + (a - minAlong) * pxPerM
      const maxElev = Math.max(...G.columns.map((c) => c.surfaceElevM)) + 5
      const levelToScreen = (e: number): number => (maxElev - e) * V_PX_PER_M + 20
      const plotTop = 0
      const plotBottom = 100000
      const screenByInv = new Map(
        G.columns.map((c, i) => [
          c.investigationId,
          { leftX: xOf(G.alongM[i]) - HALF_CARD_PX, rightX: xOf(G.alongM[i]) + HALF_CARD_PX, along: G.alongM[i] },
        ]),
      )
      const lithoScreenByInv = new Map(
        L.columns.map((c, i) => [
          c.investigationId,
          { leftX: xOf(L.alongM[i]) - HALF_CARD_PX, rightX: xOf(L.alongM[i]) + HALF_CARD_PX, along: L.alongM[i] },
        ]),
      )
      const gapXs = G.columns.slice(0, -1).map((c, i) => ({
        leftX: screenByInv.get(c.investigationId)!.rightX,
        rightX: screenByInv.get(G.columns[i + 1].investigationId)!.leftX,
      }))
      const lithoGapXs = L.columns.slice(0, -1).map((c, i) => ({
        leftX: lithoScreenByInv.get(c.investigationId)!.rightX,
        rightX: lithoScreenByInv.get(L.columns[i + 1].investigationId)!.leftX,
      }))

      const painted: PaintedElement[] = []

      // (A) litho fallback layer — one <path> per poly, never dissolved.
      for (const r of lithoFallback) {
        const g = lithoGapXs[r.gapIndex]
        if (!g || g.rightX - g.leftX < 1) continue
        painted.push({
          label: 'litho-fallback',
          formationId: r.formationId,
          opacity: FILL_OPACITY,
          rings: [
            {
              tag: 'fallbackPoly',
              pts: r.polygon.map((p) => ({
                x: g.leftX + p.fraction * (g.rightX - g.leftX),
                y: levelToScreen(p.elevation),
              })),
            },
          ],
        })
      }

      // (B) the dissolved fill layer: strips + under-column + gap regions.
      const colByInv = new Map(G.columns.map((c) => [c.investigationId, c]))
      const lithoColByInv = new Map(L.columns.map((c) => [c.investigationId, c]))
      const strips = buildColumnStripFills(
        {
          orderedInvs: G.columns.map((c) => c.investigationId),
          colByInv,
          screenByInv,
        },
        {
          orderedInvs: L.columns.map((c) => c.investigationId),
          colByInv: lithoColByInv,
          screenByInv: lithoScreenByInv,
        },
        levelToScreen,
        plotTop,
        plotBottom,
      )
      const elements: FillGroupElement[] = []
      const ucQuads: { pts: { x: number; y: number }[]; formationId: string }[] = []
      const regionRings: { pts: { x: number; y: number }[]; formationId: string }[] = []
      const ringsByGroupKey = new Map<string, { pts: { x: number; y: number }[]; tag: string }[]>()
      const pushEl = (
        pts: { x: number; y: number }[],
        formationId: string,
        opacity: number,
        tag: string,
      ): void => {
        elements.push({ points: pts, formationId, color: formationId, opacityBucket: String(opacity), opacity })
        const key = `${formationId}::${opacity}`
        const arr = ringsByGroupKey.get(key) ?? []
        arr.push({ pts, tag })
        ringsByGroupKey.set(key, arr)
      }
      for (const s of strips) pushEl(s.pts, s.formationId, FILL_OPACITY, `strip:${s.source}`)
      const ucFills = computeUnderColumnSubstrateForRender(G.columns, geoRegions)
      for (const f of ucFills) {
        const sc = screenByInv.get(G.columns[f.columnIndex].investigationId)
        if (!sc) continue
        for (const q of f.quads) {
          const ucPts = [
            { x: sc.leftX, y: levelToScreen(q.topLeftElev) },
            { x: sc.rightX, y: levelToScreen(q.topRightElev) },
            { x: sc.rightX, y: levelToScreen(q.baseRightElev) },
            { x: sc.leftX, y: levelToScreen(q.baseLeftElev) },
          ]
          ucQuads.push({ pts: ucPts, formationId: q.formationId })
          pushEl(ucPts, q.formationId, FILL_OPACITY, 'undercol')
        }
      }
      for (const r of geoRegions) {
        const g = gapXs[r.gapIndex]
        if (!g || g.rightX <= g.leftX) continue
        const rPts = r.polygon.map((p) => ({
          x: g.leftX + p.fraction * (g.rightX - g.leftX),
          y: levelToScreen(p.elevation),
        }))
        regionRings.push({ pts: rPts, formationId: r.formationId })
        pushEl(rPts, r.formationId, r.kind === 'lens' ? LENS_OPACITY : FILL_OPACITY, `region:${r.kind}`)
      }
      const groups = buildFillGroups(elements)
      for (const g of groups) {
        const rings = ringsByGroupKey.get(g.key) ?? []
        painted.push({ label: 'fill-group', formationId: g.color, opacity: g.opacity, rings })
      }

      // --- sample either side of every card edge. ----------------------------
      const stackAt = (x: number, y: number): string[] => {
        const out: string[] = []
        for (const el of painted) {
          const tag = coverTag(el, x, y)
          if (tag) out.push(`${tag}:${el.formationId.slice(-4)}@${el.opacity}`)
        }
        return out
      }
      const fmt = (s: readonly string[]): string => s.join('+') || 'NONE'
      /** Soil + NAD class behind a formation id, from either model's meta. */
      const describe = (fid: string): string => {
        const nad = raw.refinementBundle.nadMeta[fid]
        if (nad) return `${nad.soilCode ?? '?'}/NAD${nad.nadClass ?? '?'}`
        const soil = raw.refinementBundle.lithoSoilByFormationId[fid]
        return `${soil ?? '?'}/litho`
      }
      const fullIdOf = new Map<string, string>()
      for (const el of painted) fullIdOf.set(el.formationId.slice(-4), el.formationId)
      const jumpPairs = new Map<string, number>()

      let mismatches = 0
      let doubleCoat = 0
      let formJump = 0
      let cardEmpty = 0
      let sameStack = 0
      const samples: string[] = []
      const jumpSamples: string[] = []
      for (const c of G.columns) {
        const sc = screenByInv.get(c.investigationId)!
        // Only INSIDE the column's own banded interval: there a strip is
        // guaranteed, so "the card and the gap differ" is a render answer and
        // not a sampling artifact below the deepest band.
        const shallowest = Math.min(...c.units.map((u) => u.topDepthM))
        const deepest = Math.max(...c.units.map((u) => u.baseDepthM))
        const top = levelToScreen(c.surfaceElevM - shallowest)
        const bottom = levelToScreen(c.surfaceElevM - deepest)
        for (let y = top + 2; y < bottom - 2; y += 4) {
          for (const [side, xIn, xOut] of [
            ['L', sc.leftX + PROBE_PX, sc.leftX - PROBE_PX],
            ['R', sc.rightX - PROBE_PX, sc.rightX + PROBE_PX],
          ] as const) {
            const a = stackAt(xIn, y)
            const b = stackAt(xOut, y)
            if (a.length > 1) doubleCoat += 1
            if (b.length > 1) doubleCoat += 1
            if (a.length === 0 || b.length === 0) {
              if (a.length === 0 && b.length > 0) cardEmpty += 1
              continue
            }
            // A coat's identity for tone purposes is (formation, opacity) — the
            // provenance tag before it is diagnostics only.
            const paint = (c: string): string => c.slice(c.lastIndexOf(':') + 1)
            const tone = (s: readonly string[]): string => s.map(paint).join('+')
            const sameForm = paint(a[a.length - 1]) === paint(b[b.length - 1])
            if (!sameForm) {
              formJump += 1
              const cardId = fullIdOf.get(paint(a[a.length - 1]).split('@')[0]) ?? ''
              const gapId = fullIdOf.get(paint(b[b.length - 1]).split('@')[0]) ?? ''
              const src = b[b.length - 1].split(':')[0]
              // What the RAW (pre-clip) geotech partition has at the gap point:
              // separates "the clip re-labelled a covered point" from "the
              // packing partition genuinely reaches no further than the card".
              let rawGeo = 'NONE'
              const gIdx = gapXs.findIndex((g) => xOut >= g.leftX && xOut <= g.rightX)
              if (gIdx >= 0) {
                const g = gapXs[gIdx]
                for (const r of geoRegionsRaw) {
                  if (r.gapIndex !== gIdx) continue
                  const ring = r.polygon.map((p) => ({
                    x: g.leftX + p.fraction * (g.rightX - g.leftX),
                    y: levelToScreen(p.elevation),
                  }))
                  if (pointInRing(xOut, y, ring)) rawGeo = describe(r.formationId)
                }
              }
              // When the packing partition has nothing at the card edge, walk
              // INTO the gap and report the first thing it does have: a lens
              // that never touches the column reads very differently from a
              // band that simply stops.
              let reach = ''
              if (rawGeo === 'NONE' && gIdx >= 0) {
                const g = gapXs[gIdx]
                for (let t = 0.01; t <= 0.5; t += 0.01) {
                  const px = g.leftX + t * (g.rightX - g.leftX)
                  let hit: SectionRegion | null = null
                  for (const r of geoRegionsRaw) {
                    if (r.gapIndex !== gIdx) continue
                    const ring = r.polygon.map((p) => ({
                      x: g.leftX + p.fraction * (g.rightX - g.leftX),
                      y: levelToScreen(p.elevation),
                    }))
                    if (pointInRing(px, y, ring)) hit = r
                  }
                  if (hit) {
                    reach = ` first=${hit.kind}/${describe(hit.formationId)}@frac${t.toFixed(2)}`
                    break
                  }
                }
                if (!reach) reach = ' first=NOTHING-to-midgap'
              }
              const pairKey = `${describe(cardId)} -> ${src} ${describe(gapId)} [raw ${rawGeo}${reach}]`
              jumpPairs.set(pairKey, (jumpPairs.get(pairKey) ?? 0) + 1)
              if (jumpSamples.length < 6)
                jumpSamples.push(
                  `JUMP ${c.investigationId.slice(-6)} ${side} y=${y.toFixed(0)} card=[${fmt(a)}] gap=[${fmt(b)}]`,
                )
              continue
            }
            if (tone(a) !== tone(b)) {
              mismatches += 1
              if (samples.length < 8)
                samples.push(
                  `${c.investigationId.slice(-6)} ${side} y=${y.toFixed(0)} card=[${fmt(a)}] gap=[${fmt(b)}]`,
                )
            } else {
              sameStack += 1
            }
          }
        }
      }
      // --- the seam-stroke rim: how many card-edge strokes the strips remove.
      const seamUndercol = ucQuads.map((q) => ({ points: q.pts, formationId: q.formationId }))
      const seamRegions = regionRings.map((r) => ({ points: r.pts, formationId: r.formationId }))
      const seamCards = strips.map((s) => ({ points: s.pts, formationId: s.formationId }))
      const cardEdgeXs = new Set<string>()
      for (const s of screenByInv.values()) {
        cardEdgeXs.add(s.leftX.toFixed(2))
        cardEdgeXs.add(s.rightX.toFixed(2))
      }
      const countCardEdgeStrokes = (paths: readonly string[]): number => {
        let n = 0
        for (const d of paths) {
          for (const run of d.split('M ').slice(1)) {
            const m = run.match(/^([\d.-]+),([\d.-]+) L ([\d.-]+),([\d.-]+)/)
            if (!m) continue
            if (m[1] === m[3] && cardEdgeXs.has(m[1])) n += 1
          }
        }
        return n
      }
      const before = computeSectionSeamStrokes(seamUndercol, seamRegions, [])
      const after = computeSectionSeamStrokes(seamUndercol, seamRegions, seamCards)
      const rimBefore = countCardEdgeStrokes(before.regions) + countCardEdgeStrokes(before.undercol)
      const rimAfter = countCardEdgeStrokes(after.regions) + countCardEdgeStrokes(after.undercol)

      report.push(
        `[RIM]  ${sec.name}: card-edge strokes ${rimBefore} -> ${rimAfter}`,
      )
      report.push(
        `[TONE] ${sec.name}: cols=${G.columns.length} clipped=${columnsMatch} ` +
          `fallbackPolys=${lithoFallback.length} groups=${groups.length} ` +
          `sameStack=${sameStack} edgeMismatch=${mismatches} formJump=${formJump} ` +
          `cardEmpty=${cardEmpty} doubleCoat=${doubleCoat}` +
          (samples.length ? `\n        ${samples.join('\n        ')}` : '') +
          (jumpSamples.length ? `\n        ${jumpSamples.join('\n        ')}` : '') +
          (jumpPairs.size
            ? '\n        PAIRS ' +
              [...jumpPairs.entries()]
                .sort((x, y2) => y2[1] - x[1])
                .slice(0, 6)
                .map(([k, n]) => `${k} x${n}`)
                .join('\n        PAIRS ')
            : ''),
      )
    }
    writeFileSync(resolve(REPO_ROOT, 'scripts/throwaway_tone_diag.txt'), report.join('\n'), 'utf8')
  })
})
