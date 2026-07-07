/**
 * PRODUCTION render harness for the geotech fraction-space refinement.
 *
 * Runs the PRODUCTION ``refineLithoPartition`` + ``refineSubstrateQuads`` +
 * ``clipPolygonToElevBand`` on the frozen CS1 fixture (or a live-extracted
 * input via ``GEOTECH_RENDER_INPUT``) and writes a standalone SVG/HTML preview
 * to the repo root — the owner's eyeball-acceptance surface, and the surface a
 * screenshot-diff verifies against the reference ``carvePanel`` panel 3.
 *
 * Env-gated (``GEOTECH_RENDER=1``) so it never runs in the normal suite.
 * Run:
 *   GEOTECH_RENDER=1 npx vitest run src/renderer/src/utils/refineLithoPartition.render.test.ts
 * Output: <repo>/geotech_refine_preview.html
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, it } from 'vitest'

import {
  computeSectionFill,
  computeUnderColumnSubstrate,
  type CorrelationEdge,
  type PartitionColumn,
} from './partitionFill'
import { detectRefinementOverlaps, detectorPolysFromRefinement } from './refineLithoPartition.overlap'
import {
  clipPolygonToElevBand,
  refineLithoPartition,
  refineSubstrateQuads,
  type GeotechColumn,
  type NadFormationMeta,
} from './refineLithoPartition'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const INPUT = process.env.GEOTECH_RENDER_INPUT ?? resolve(HERE, './__fixtures__/cs1_geotech_frozen.json')
const OUT = resolve(REPO_ROOT, 'geotech_refine_preview.html')

// Soil-code shade ramps (light = loose/soft, dark = dense/stiff) — same as the
// reference so a screenshot diff is meaningful.
const RAMP: Record<string, string[]> = {
  ZAND: ['#fef9c3', '#fde68a', '#fbbf24', '#f59e0b', '#b45309'],
  KLEI: ['#eceef2', '#c3c9d4', '#9aa3b2', '#78818f', '#5a6272'],
  SILT: ['#f1fbd8', '#d3f095', '#a3d94a', '#6da823', '#4d7c0f'],
  VEEN: ['#e0cbb4', '#c3a07e', '#a56d3f', '#8a4d1e', '#6b3410'],
}
const LITHO_COLOR: Record<string, string> = {
  ZAND: '#fbbf24',
  KLEI: '#6b7280',
  SILT: '#84cc16',
  VEEN: '#92400e',
}

interface Frozen {
  alongM: Record<string, number>
  columns: Array<{ investigationId: string; surfaceElevM: number | null; units: PartitionColumn['units'] }>
  edges: CorrelationEdge[]
  geotechColumns: GeotechColumn[]
  nadFormations: Record<string, NadFormationMeta>
  lithoSoil: Record<string, string>
}

describe('geotech refinement production render', () => {
  if (process.env.GEOTECH_RENDER !== '1') {
    it.skip('dormant (set GEOTECH_RENDER=1)', () => {})
    return
  }

  it('renders the production refinement to HTML', () => {
    const frozen: Frozen = JSON.parse(readFileSync(INPUT, 'utf8'))
    const columns: PartitionColumn[] = frozen.columns
      .filter((c) => c.surfaceElevM != null)
      .map((c) => ({ investigationId: c.investigationId, surfaceElevM: c.surfaceElevM as number, units: c.units }))
    const order = columns.map((c) => c.investigationId)
    const geo = new Map(frozen.geotechColumns.map((c) => [c.investigationId, c]))
    const nad = new Map<string, NadFormationMeta>(Object.entries(frozen.nadFormations))
    const soil = new Map<string, string | null>(Object.entries(frozen.lithoSoil))

    // Class colour: soil ramp indexed by class rank within its soil code.
    const classesByCode = new Map<string, number[]>()
    for (const m of nad.values()) {
      if (m.soilCode == null || m.nadClass == null) continue
      const list = classesByCode.get(m.soilCode) ?? []
      if (!list.includes(m.nadClass)) list.push(m.nadClass)
      classesByCode.set(m.soilCode, list)
    }
    for (const list of classesByCode.values()) list.sort((a, b) => a - b)
    const nadColor = (formationId: string): string => {
      const m = nad.get(formationId)
      if (!m || m.soilCode == null || m.nadClass == null) return LITHO_COLOR[soil.get(formationId) ?? ''] ?? '#d4d4d8'
      const ramp = RAMP[m.soilCode] ?? RAMP.KLEI
      const list = classesByCode.get(m.soilCode) ?? [m.nadClass]
      const rank = list.indexOf(m.nadClass)
      const ix = list.length === 1 ? 2 : Math.round((rank / (list.length - 1)) * (ramp.length - 1))
      return ramp[Math.min(ramp.length - 1, Math.max(0, ix))]
    }
    const nadLabel = (formationId: string): string => {
      const c = nad.get(formationId)?.nadClass
      return c != null ? `n${c}` : '?'
    }

    // ---- layout ----
    const W = 1500
    const H = 460
    const ML = 60
    const MR = 20
    const MT = 30
    const MB = 26
    const PW = W - ML - MR
    const PH = H - MT - MB
    const COLW = 14
    const alongs = order.map((id) => frozen.alongM[id])
    const aMin = Math.min(...alongs)
    const aMax = Math.max(...alongs)
    const elevs: number[] = []
    for (const c of columns) for (const u of c.units) elevs.push(c.surfaceElevM - u.topDepthM, c.surfaceElevM - u.baseDepthM)
    const emin = Math.min(...elevs) - 1
    const emax = Math.max(...elevs) + 1
    const X = (a: number): number => ML + ((a - aMin) / (aMax - aMin)) * PW
    const Y = (e: number): number => MT + ((emax - e) / (emax - emin)) * PH
    const cx = (i: number): number => X(alongs[i])
    const gapScreenX = (g: number): { xl: number; xr: number } | null => {
      const xl = cx(g) + COLW / 2
      const xr = cx(g + 1) - COLW / 2
      return xr - xl < 1 ? null : { xl, xr }
    }

    // ---- run production refinement ----
    const regions = computeSectionFill(columns, frozen.edges)
    const refined = refineLithoPartition(regions, order, geo, nad, soil)
    const substrateFills = computeUnderColumnSubstrate(columns, regions)
    const substrateSlices = refineSubstrateQuads(substrateFills, order, geo, nad, soil)
    const slicesByCol = new Map<string, typeof substrateSlices>()
    for (const s of substrateSlices) {
      const k = `${s.columnIndex}`
      const l = slicesByCol.get(k) ?? []
      l.push(s)
      slicesByCol.set(k, l)
    }

    const svg: string[] = []
    // grid + labels
    for (let e = Math.ceil(emax); e >= Math.floor(emin); e -= 5) {
      const y = Y(e)
      svg.push(`<line x1="${ML}" y1="${y.toFixed(1)}" x2="${ML + PW}" y2="${y.toFixed(1)}" stroke="#2c3444"/>`)
      svg.push(`<text x="${ML - 6}" y="${(y + 3).toFixed(1)}" font-size="9" text-anchor="end" fill="#8b93a7">${e}</text>`)
    }

    const RAW = process.env.GEOTECH_RENDER_RAW === '1'
    // RAW mode: render only the engine litho regions solid — any dark triangle
    // that shows through between them is an ENGINE gap (#228), not a carve void.
    if (RAW) {
      const rc: Record<string, string> = { ZAND: '#fbbf24', KLEI: '#6b7280', SILT: '#84cc16', VEEN: '#92400e' }
      for (const r of regions) {
        const g = gapScreenX(r.gapIndex)
        if (!g) continue
        const pts = r.polygon.map((p) => `${(g.xl + p.fraction * (g.xr - g.xl)).toFixed(1)},${Y(p.elevation).toFixed(1)}`).join(' ')
        svg.push(`<polygon points="${pts}" fill="${rc[soil.get(r.formationId) ?? ''] ?? '#ccc'}" stroke="#0d1117" stroke-width="0.4"/>`)
      }
    }

    // refined region fills
    for (const p of RAW ? [] : refined) {
      const g = gapScreenX(p.gapIndex)
      if (!g) continue
      const fill = p.tag === 'fallback' ? LITHO_COLOR[soil.get(p.formationId) ?? ''] ?? '#ccc' : nadColor(p.formationId)
      const pts = p.points.map((q) => `${(g.xl + q.fraction * (g.xr - g.xl)).toFixed(1)},${Y(q.elevation).toFixed(1)}`).join(' ')
      svg.push(`<polygon points="${pts}" fill="${fill}" stroke="${fill}" stroke-width="0.4"/>`)
    }

    // substrate quads, class-subdivided (production slices + clip)
    for (const f of (process.env.GEOTECH_RENDER_RAW==="1"?[]:substrateFills)) {
      const i = f.columnIndex
      const x0raw = cx(i) - COLW / 2
      const x1raw = cx(i) + COLW / 2
      const x0 = Math.max(x0raw, i > 0 ? (cx(i - 1) + cx(i)) / 2 : -Infinity)
      const x1 = Math.min(x1raw, i < order.length - 1 ? (cx(i) + cx(i + 1)) / 2 : Infinity)
      if (x1 - x0 < 0.5) continue
      const colSlices = substrateSlices.filter((s) => s.columnIndex === i)
      for (let qi = 0; qi < f.quads.length; qi++) {
        const q = f.quads[qi]
        const fx = (xa: number): number => (xa - x0raw) / (x1raw - x0raw)
        const topAt = (xa: number): number => q.topLeftElev + (q.topRightElev - q.topLeftElev) * fx(xa)
        const baseAt = (xa: number): number => q.baseLeftElev + (q.baseRightElev - q.baseLeftElev) * fx(xa)
        const quadPts = [
          { x: x0, e: topAt(x0) },
          { x: x1, e: topAt(x1) },
          { x: x1, e: baseAt(x1) },
          { x: x0, e: baseAt(x0) },
        ]
        const rq = colSlices.find((s) => s.quadIndex === qi)
        if (!rq || rq.slices == null) {
          const fill = LITHO_COLOR[soil.get(q.formationId) ?? ''] ?? '#ccc'
          svg.push(`<polygon points="${quadPts.map((p) => `${p.x.toFixed(1)},${Y(p.e).toFixed(1)}`).join(' ')}" fill="${fill}" stroke="#1a1f2b" stroke-width="0.3"/>`)
          continue
        }
        for (const sl of rq.slices) {
          const clipped = clipPolygonToElevBand(quadPts, sl.topElev, sl.baseElev)
          if (clipped.length < 3) continue
          svg.push(`<polygon points="${clipped.map((p) => `${p.x.toFixed(1)},${Y(p.e).toFixed(1)}`).join(' ')}" fill="${nadColor(sl.formationId)}" stroke="#1a1f2b" stroke-width="0.3"/>`)
        }
      }
    }

    // litho outlines on top
    for (const r of regions) {
      const g = gapScreenX(r.gapIndex)
      if (!g) continue
      const pts = r.polygon.map((p) => `${(g.xl + p.fraction * (g.xr - g.xl)).toFixed(1)},${Y(p.elevation).toFixed(1)}`).join(' ')
      svg.push(`<polygon points="${pts}" fill="none" stroke="#0d1117" stroke-width="0.8"/>`)
    }

    // column strips (NAD bands + labels)
    for (const c of columns) {
      const g = geo.get(c.investigationId)
      if (!g) continue
      const x0 = X(frozen.alongM[c.investigationId]) - COLW / 2
      for (const u of g.units) {
        const yt = Y(g.surfaceElevM - u.topDepthM)
        const yb = Y(g.surfaceElevM - u.baseDepthM)
        svg.push(`<rect x="${x0.toFixed(1)}" y="${yt.toFixed(1)}" width="${COLW}" height="${Math.max(0.5, yb - yt).toFixed(1)}" fill="${nadColor(u.formationId)}" stroke="#111" stroke-width="0.5"/>`)
        if (yb - yt > 9)
          svg.push(`<text x="${(x0 + COLW / 2).toFixed(1)}" y="${((yt + yb) / 2 + 2.5).toFixed(1)}" font-size="6.5" text-anchor="middle" fill="#111">${nadLabel(u.formationId)}</text>`)
      }
      const nm = c.investigationId
      svg.push(`<text x="${X(frozen.alongM[c.investigationId]).toFixed(1)}" y="${MT - 6}" font-size="7" text-anchor="middle" fill="#aab3c5" transform="rotate(-28 ${X(frozen.alongM[c.investigationId]).toFixed(1)} ${MT - 6})">${nm}</text>`)
    }

    // overlap report inline
    const polys = detectorPolysFromRefinement(regions, refined, gapScreenX)
    const reports = detectRefinementOverlaps(polys, 200).filter((r) => !r.rawOnly)

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Geotech refinement — production render</title>
<style>body{background:#151a26;color:#dbe2f0;font-family:system-ui,sans-serif;margin:24px}
.panel{background:#1c2333;border:1px solid #333d55;border-radius:8px;padding:6px}
code{background:#2a3247;padding:1px 5px;border-radius:3px}</style></head><body>
<h1>Geotech refinement — PRODUCTION <code>refineLithoPartition</code> on ${INPUT.includes('frozen') ? 'frozen CS1' : 'live input'}</h1>
<p>${reports.length} carve overlaps (non-engine). Litho outlines dark; NAD sub-bands coloured by density ramp.</p>
<div class="panel"><svg viewBox="0 0 ${W} ${H}" width="100%">${svg.join('\n')}</svg></div>
</body></html>`
    writeFileSync(OUT, html, 'utf8')
    // eslint-disable-next-line no-console
    console.info(`[GEOTECH-RENDER] wrote ${OUT} (${reports.length} non-engine overlaps)`)
  })
})
