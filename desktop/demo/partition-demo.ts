/**
 * Partition-fill visual demo (planning artifact, not shipped).
 *
 * Renders each fixture twice: LEFT = live ``computePartitionFill`` output (the
 * current behaviour, incl. the droop), RIGHT = the hand-authored TARGET shape
 * (band / onlap / lens / matrix). Served on localhost via ``vite.demo.config.ts``
 * so the owner can eyeball the difference and sign off on the target geometry
 * before the algorithm is implemented.
 */

import {
  computePartitionFill,
  type PartitionColumn,
  type PartitionPoint,
  type PartitionRegion,
} from '../src/renderer/src/utils/partitionFill'

// ---------------------------------------------------------------------------
// Fixture + region builders
// ---------------------------------------------------------------------------

interface U {
  top: number
  base: number
  f: string
  b: string | null
}

const col = (id: string, surf: number, units: U[]): PartitionColumn => ({
  investigationId: id,
  surfaceElevM: surf,
  units: units.map((u) => ({ topDepthM: u.top, baseDepthM: u.base, formationId: u.f, bodyId: u.b })),
})

const poly = (...pts: [number, number][]): PartitionPoint[] =>
  pts.map(([fraction, elevation]) => ({ fraction, elevation }))

const reg = (formationId: string, kind: PartitionRegion['kind'], pts: [number, number][]): PartitionRegion => ({
  formationId,
  bodyId: null,
  kind,
  polygon: poly(...pts),
})

// ---------------------------------------------------------------------------
// Colour by lithology (matches the section's lithology families loosely)
// ---------------------------------------------------------------------------

function colorFor(f: string): string {
  const s = f.toLowerCase()
  if (s.includes('zand') || s.includes('sand')) return '#E4C76B' // sand — yellow
  if (s.includes('klei') || s.includes('clay')) return '#9C7A4D' // clay — brown
  if (s.includes('silt') || s.includes('leem') || s === 'fsi') return '#9AA3AE' // silt — grey
  if (s.includes('veen') || s.includes('peat') || s === 'fv') return '#5B4636' // peat — dark brown
  let h = 0
  for (const c of f) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return `hsl(${h % 360} 45% 55%)`
}

// ---------------------------------------------------------------------------
// SVG render
// ---------------------------------------------------------------------------

const W = 320
const H = 260
const PAD = 26

function renderSvg(regions: PartitionRegion[], elev: { min: number; max: number }, seamFraction?: number): string {
  const span = elev.max - elev.min || 1
  const fx = (f: number): number => PAD + f * (W - 2 * PAD)
  const fy = (e: number): number => PAD + ((elev.max - e) / span) * (H - 2 * PAD)

  const parts: string[] = []

  // column edges (fraction 0 + 1) + L/R labels
  parts.push(
    `<line x1="${fx(0)}" y1="${PAD - 6}" x2="${fx(0)}" y2="${H - PAD + 6}" stroke="#334155" stroke-width="1.5"/>`,
    `<line x1="${fx(1)}" y1="${PAD - 6}" x2="${fx(1)}" y2="${H - PAD + 6}" stroke="#334155" stroke-width="1.5"/>`,
    `<text x="${fx(0)}" y="${H - 6}" fill="#64748b" font-size="10" text-anchor="middle">L</text>`,
    `<text x="${fx(1)}" y="${H - 6}" fill="#64748b" font-size="10" text-anchor="middle">R</text>`,
  )

  for (const r of regions) {
    const d = r.polygon.map((p, i) => `${i ? 'L' : 'M'}${fx(p.fraction).toFixed(1)},${fy(p.elevation).toFixed(1)}`).join(' ') + ' Z'
    const c = colorFor(r.formationId)
    const isLens = r.kind === 'lens'
    parts.push(
      `<path d="${d}" fill="${c}" fill-opacity="${isLens ? 0.85 : 0.62}" stroke="${c}" stroke-opacity="0.7" stroke-width="1"${isLens ? ' stroke-dasharray="3 2"' : ''}/>`,
    )
    // apex marker for a pinch/lens vertex strictly inside the gap
    if (r.kind !== 'quad') {
      for (const p of r.polygon) {
        if (p.fraction > 0.02 && p.fraction < 0.98) {
          parts.push(`<circle cx="${fx(p.fraction).toFixed(1)}" cy="${fy(p.elevation).toFixed(1)}" r="2.5" fill="#0b1220" stroke="${c}" stroke-width="1.5"/>`)
        }
      }
    }
  }

  // wavy facies seam (mismatched matrix target)
  if (seamFraction !== undefined) {
    const x = fx(seamFraction)
    const y0 = PAD
    const y1 = H - PAD
    const steps = 18
    let dd = `M${x.toFixed(1)},${y0.toFixed(1)}`
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      const yy = y0 + t * (y1 - y0)
      const xx = x + Math.sin(t * Math.PI * 5) * 4
      dd += ` L${xx.toFixed(1)},${yy.toFixed(1)}`
    }
    parts.push(`<path d="${dd}" fill="none" stroke="#e2e8f0" stroke-width="1.5" stroke-opacity="0.9"/>`)
  }

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('')}</svg>`
}

function elevRange(...sets: PartitionRegion[][]): { min: number; max: number } {
  let min = Infinity
  let max = -Infinity
  for (const set of sets) for (const r of set) for (const p of r.polygon) {
    if (p.elevation < min) min = p.elevation
    if (p.elevation > max) max = p.elevation
  }
  if (!isFinite(min)) return { min: 0, max: 1 }
  return { min, max }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface Fixture {
  name: string
  caption: string
  left: PartitionColumn
  right: PartitionColumn
  target: PartitionRegion[]
  seamFraction?: number
}

const fixtures: Fixture[] = [
  {
    name: 'S2 to S1 — the dogfeed droop',
    caption:
      'SAND-top + CLAY-bot are correlated (shared body_id). The middle SAND is the uncorrelated matrix; a SILT (S2) + CLAY/SILT (S1) are minorities. Target: one sand BAND, minorities pinch out floating in it.',
    left: col('S2', 0, [
      { top: 0, base: 5, f: 'SAND', b: 'sand-top' },
      { top: 5, base: 5.4, f: 'SILT', b: 's2-silt' },
      { top: 5.4, base: 12, f: 'SAND', b: 's2-sand' },
      { top: 12, base: 20, f: 'CLAY', b: 'clay-bot' },
    ]),
    right: col('S1', 0, [
      { top: 0, base: 5, f: 'SAND', b: 'sand-top' },
      { top: 5, base: 6.5, f: 'CLAY', b: 's1-clay' },
      { top: 6.5, base: 8, f: 'SAND', b: 's1-sand-a' },
      { top: 8, base: 8.6, f: 'SILT', b: 's1-silt' },
      { top: 8.6, base: 12, f: 'SAND', b: 's1-sand-b' },
      { top: 12, base: 20, f: 'CLAY', b: 'clay-bot' },
    ]),
    target: [
      reg('SAND', 'quad', [[0, 0], [1, 0], [1, -5], [0, -5]]),
      reg('SAND', 'quad', [[0, -5], [1, -5], [1, -12], [0, -12]]),
      reg('CLAY', 'quad', [[0, -12], [1, -12], [1, -20], [0, -20]]),
      reg('SILT', 'lens', [[0, -5], [0.45, -5.2], [0, -5.4]]),
      reg('CLAY', 'lens', [[1, -5], [0.55, -5.75], [1, -6.5]]),
      reg('SILT', 'lens', [[1, -8], [0.55, -8.3], [1, -8.6]]),
    ],
  },
  {
    name: 'MX2 — silt lens inside an uncorrelated sand matrix',
    caption:
      'KLEI brackets correlated; the SAND matrix is uncorrelated (zL != zL2 != zR). Target: sand BAND across, SILT a horizontal-apex LENS at its own elevation.',
    left: col('L', 10, [
      { top: 0, base: 5, f: 'KLEI', b: 'k-top' },
      { top: 5, base: 8, f: 'ZAND', b: 'zL' },
      { top: 8, base: 9, f: 'SILT', b: 's-lens' },
      { top: 9, base: 12, f: 'ZAND', b: 'zL2' },
      { top: 12, base: 18, f: 'KLEI', b: 'k-bot' },
    ]),
    right: col('R', 10, [
      { top: 0, base: 5, f: 'KLEI', b: 'k-top' },
      { top: 5, base: 12, f: 'ZAND', b: 'zR' },
      { top: 12, base: 18, f: 'KLEI', b: 'k-bot' },
    ]),
    target: [
      reg('KLEI', 'quad', [[0, 10], [1, 10], [1, 5], [0, 5]]),
      reg('ZAND', 'quad', [[0, 5], [1, 5], [1, -2], [0, -2]]),
      reg('KLEI', 'quad', [[0, -2], [1, -2], [1, -8], [0, -8]]),
      reg('SILT', 'lens', [[0, 2], [0.45, 1.5], [0, 1]]),
    ],
  },
  {
    name: 'Onlap — minority touching ONE bracket tie-line',
    caption:
      'SAND-top + CLAY-bot correlated. The SILT (left) touches the TOP tie-line only (its base floats). Target: ONLAP — flat on the top bracket, base laps up to a tip mid-gap (top correlated -> laps up).',
    left: col('L', 0, [
      { top: 0, base: 4, f: 'SAND', b: 'b-sand' },
      { top: 4, base: 7, f: 'SILT', b: 'l-silt' },
      { top: 7, base: 12, f: 'CLAY', b: 'b-clay' },
    ]),
    right: col('R', 0, [
      { top: 0, base: 4, f: 'SAND', b: 'b-sand' },
      { top: 4, base: 12, f: 'CLAY', b: 'b-clay' },
    ]),
    target: [
      reg('SAND', 'quad', [[0, 0], [1, 0], [1, -4], [0, -4]]),
      reg('SILT', 'pinch', [[0, -4], [0.5, -4], [0, -7]]),
      reg('CLAY', 'quad', [[0, -7], [0.5, -4], [1, -4], [1, -12], [0, -12]]),
    ],
  },
  {
    name: 'Mismatched matrix — no shared lithology',
    caption:
      'Interval background is SAND on the left, CLAY on the right (no shared matrix). Target: vertical MIDPOINT seam (50/50 — transition position unknown), drawn wriggly to read as a lateral facies change.',
    left: col('L', 0, [
      { top: 0, base: 2, f: 'SAND', b: 'top' },
      { top: 2, base: 10, f: 'SAND', b: 'l-sand' },
      { top: 10, base: 12, f: 'CLAY', b: 'bot' },
    ]),
    right: col('R', 0, [
      { top: 0, base: 2, f: 'SAND', b: 'top' },
      { top: 2, base: 10, f: 'CLAY', b: 'r-clay' },
      { top: 10, base: 12, f: 'CLAY', b: 'bot' },
    ]),
    target: [
      reg('SAND', 'quad', [[0, 0], [1, 0], [1, -2], [0, -2]]),
      reg('SAND', 'quad', [[0, -2], [0.5, -2], [0.5, -10], [0, -10]]),
      reg('CLAY', 'quad', [[0.5, -2], [1, -2], [1, -10], [0.5, -10]]),
      reg('CLAY', 'quad', [[0, -10], [1, -10], [1, -12], [0, -12]]),
    ],
    seamFraction: 0.5,
  },
]

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

function mount(): void {
  const app = document.getElementById('app')
  if (!app) return
  const blocks: string[] = [
    '<h1>Partition fill — current vs target</h1>',
    '<p class="sub">LEFT = today’s computePartitionFill output. RIGHT = the proposed target (band / onlap / lens / matrix). Dashed = lens overlay; dot = pinch/onlap apex.</p>',
  ]
  for (const fx of fixtures) {
    const now = computePartitionFill(fx.left, fx.right)
    const range = elevRange(now, fx.target)
    blocks.push(
      `<div class="fixture">`,
      `<h2>${fx.name}</h2>`,
      `<p class="cap">${fx.caption}</p>`,
      `<div class="panels">`,
      `<div class="panel now"><div class="label">current</div>${renderSvg(now, range)}</div>`,
      `<div class="panel target"><div class="label">target</div>${renderSvg(fx.target, range, fx.seamFraction)}</div>`,
      `</div></div>`,
    )
  }
  // createContextualFragment parses trusted, fully-static markup (no user/network
  // input) without the innerHTML sink.
  const frag = document.createRange().createContextualFragment(blocks.join(''))
  app.replaceChildren(frag)
}

mount()
