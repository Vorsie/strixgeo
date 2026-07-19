/**
 * gen_paint_tool.mjs — THROWAWAY (2026-07-19). Interactive PAINT-BUCKET dogfeed tool:
 * renders CS1's COMPLETE OWNER LINE NETWORK (picked columns pre-painted, drawn ties,
 * jump bridges, lens flanks, onlap flanks, surface curves, domain frame — NO synthetic
 * phase-3 scaffolds/floods/substrate curves) on a canvas, with a real flood-fill tool
 * + lithology palette so the owner IS the fill engine. A paint leak = a missing line.
 *
 * Run: node scripts/gen_paint_tool.mjs  → scripts/owner_paint_tool.html
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const d = JSON.parse(readFileSync(resolve(HERE, 'diag_cs1_flip_walkthrough.json'), 'utf8'))
// The RAW picked stacks (un-merged, every unit exactly as the owner picked it) — the
// walkthrough dump's columns are NORMALIZED (enclosed interbeds merged into hosts).
const input = JSON.parse(readFileSync(resolve(HERE, 'diag_allsections_input.json'), 'utf8'))
const names = JSON.parse(readFileSync(resolve(HERE, 'diag_shape_audit_names.json'), 'utf8'))
const rawCs1 = input.sections.find((s) => s.name === 'Cross-section 1')
const fname = (id) => input.formationNames?.[id] ?? ''
const LITHOS_KEYS = ['ZAND', 'SAND', 'SILT', 'KLEI', 'CLAY', 'VEEN', 'LEEM', 'GRIND']
const baseLitho = (id) => {
  const up = fname(id).toUpperCase()
  for (const k of LITHOS_KEYS) if (up.includes(k)) return k === 'SAND' ? 'ZAND' : k === 'CLAY' ? 'KLEI' : k
  return up.slice(0, 4)
}

const LITHO_COLOR = { ZAND: '#eab308', SILT: '#a3e635', KLEI: '#94a3b8', VEEN: '#78350f', LEEM: '#d97706', GRIND: '#f97316' }
const cols = d.columns

// x-warp (walkthrough convention).
const MIN_GAP_PX = 150, PX_PER_M_X = 2.2
const sorted = [...cols].sort((a, b) => a.x - b.x)
const warpCum = [0]
for (let i = 1; i < sorted.length; i++) warpCum.push(warpCum[i - 1] + Math.max(MIN_GAP_PX, (sorted[i].x - sorted[i - 1].x) * PX_PER_M_X))
function warp(xm) {
  if (xm <= sorted[0].x) return warpCum[0]
  for (let i = 1; i < sorted.length; i++) {
    if (xm <= sorted[i].x) {
      const t = (xm - sorted[i - 1].x) / (sorted[i].x - sorted[i - 1].x || 1e-9)
      return warpCum[i - 1] + t * (warpCum[i] - warpCum[i - 1])
    }
  }
  return warpCum[warpCum.length - 1]
}
const M_L = 40, M_T = 40, PLOT_H = 900
let eMin = Infinity, eMax = -Infinity
for (const c of cols) { eMax = Math.max(eMax, c.surfaceElevM); for (const u of c.units) eMin = Math.min(eMin, u.baseElev) }
for (const s of d.synthesized ?? []) for (const p of s.points) { eMin = Math.min(eMin, p.y); eMax = Math.max(eMax, p.y) }
eMin -= 1; eMax += 1
const sx = (xm) => M_L + warp(xm)
const sy = (e) => M_T + ((eMax - e) / (eMax - eMin)) * PLOT_H
const W = Math.ceil(M_L + warpCum[warpCum.length - 1] + 40)
const H = Math.ceil(M_T + PLOT_H + 30)
const COLW = 13

// ---- collect geometry in CANVAS coordinates ----
// Columns from the RAW input: every unit exactly as picked, un-merged (the walkthrough's
// normalized columns collapse enclosed interbeds into their hosts — owner caught it).
const rects = []
const labels = []
rawCs1.columns.forEach((c, i) => {
  if (!c.units || c.units.length === 0 || c.surfaceElevM == null) return
  const cx = sx(rawCs1.alongM[i])
  const nm = names[c.investigationId] ?? c.investigationId.slice(0, 8)
  labels.push({ x: cx, y: M_T - 12, text: nm })
  for (const u of c.units) {
    const top = c.surfaceElevM - u.topDepthM
    const base = c.surfaceElevM - u.baseDepthM
    const lit = baseLitho(u.formationId)
    rects.push({ x: cx - COLW, y: sy(top), w: COLW * 2, h: Math.max(1, sy(base) - sy(top)), color: LITHO_COLOR[lit] ?? '#c084fc' })
  }
})
const lines = [] // each: {pts: [[x,y]...], kind}
// Drawn ties + jump bridges (owner line art).
for (const e of d.edges ?? []) {
  if (e.aCol == null || e.bCol == null) continue
  const cA = cols.find((c) => c.index === e.aCol)
  const cB = cols.find((c) => c.index === e.bCol)
  if (!cA || !cB) continue
  lines.push({ pts: [[sx(cA.x), sy(e.aElev)], [sx(cB.x), sy(e.bElev)]], kind: e.kind === 'jump-bridge' ? 'bridge' : 'tie' })
}
// Lens flanks (phase 1) + onlap flanks (phase 2) + BAND CONTOURS and SURFACE curves
// (phase-tagged 0 in the dump — the owner's tied/band line art + domain top; my first
// filter dropped all 158 of them, which the owner caught as leaks). Still NO phase-3
// scaffolds (flood/substrate/btfloor) — those are the synthetic authorities 8q retires.
for (const s of d.synthesized ?? []) {
  const isTermination = s.phase === 1 || s.phase === 2
  const isBandOrSurface = s.id.startsWith('bandc') || s.id.startsWith('surface')
  if (!isTermination && !isBandOrSurface) continue
  if (s.id.startsWith('bridge')) continue
  lines.push({ pts: s.points.map((p) => [sx(p.x), sy(p.y)]), kind: isTermination ? (s.phase === 1 ? 'lens' : 'onlap') : 'band' })
}
// Surface curves (domain top).
for (const g of d.given ?? []) {
  if (!g.id.startsWith('surface:')) continue
  lines.push({ pts: g.points.map((p) => [sx(p.x), sy(p.y)]), kind: 'surface' })
}

const payload = JSON.stringify({ W, H, rects, lines, labels })

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<title>CS1 paint bucket — you are the fill engine</title>
<style>
 body{margin:0;background:#0f172a;color:#e2e8f0;font-family:ui-sans-serif,system-ui}
 header{padding:12px 20px;border-bottom:1px solid #334155}
 h1{font-size:16px;margin:0 0 4px}.sub{color:#94a3b8;font-size:12.5px}
 .bar{padding:8px 20px;display:flex;gap:8px;align-items:center;border-bottom:1px solid #334155;flex-wrap:wrap}
 .sw{width:34px;height:26px;border:2px solid #334155;border-radius:5px;cursor:pointer}
 .sw.sel{border-color:#f8fafc;box-shadow:0 0 0 2px #38bdf8}
 button{background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:5px;padding:4px 12px;cursor:pointer;font-size:12px}
 .wrap{overflow:auto;max-height:calc(100vh - 130px)}
 canvas{display:block;cursor:crosshair;background:#fff}
 .lbl{font-size:12px;color:#94a3b8;margin-right:4px}
</style></head><body>
<header><h1>Cross-section 1 — the complete line network. You are the paint bucket.</h1>
<div class="sub">Pre-painted: your picked columns. Lines: your ties (solid), jump bridges (same), generated lens
lines + onlap lines, surface, and the section frame. NO synthetic scaffolds — only the doctrine's lines.
Pick a lithology, click a region. If paint leaks somewhere it shouldn't, a line is missing there — that's a
topology defect found by hand. Right-click floods white (un-paint).</div></header>
<div class="bar"><span class="lbl">Paint:</span></div>
<div class="wrap"><canvas id="cv"></canvas></div>
<script>
const DATA = ${payload}
const LITHOS = { ZAND:'#eab308', SILT:'#a3e635', KLEI:'#94a3b8', VEEN:'#78350f', LEEM:'#d97706' }
const cv = document.getElementById('cv')
cv.width = DATA.W; cv.height = DATA.H
const ctx = cv.getContext('2d', { willReadFrequently: true })
let current = LITHOS.ZAND

function draw() {
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, DATA.W, DATA.H)
  // frame (domain boundary)
  ctx.strokeStyle = '#111827'; ctx.lineWidth = 3
  ctx.strokeRect(1.5, 1.5, DATA.W - 3, DATA.H - 3)
  // picked columns FIRST (fills), so the line art lands ON TOP and every tie/flank
  // endpoint is VISIBLY at its true contact on the column line ("a tie is drawn from
  // boundary to boundary" — the owner caught the hidden center-to-center misalignment).
  for (const r of DATA.rects) {
    ctx.fillStyle = r.color
    ctx.fillRect(r.x, r.y, r.w, r.h)
    ctx.strokeStyle = '#111827'; ctx.lineWidth = 1.2
    ctx.strokeRect(r.x, r.y, r.w, r.h)
  }
  // owner line art — all barriers, near-black, TRUE coordinates, drawn on top.
  for (const L of DATA.lines) {
    ctx.beginPath()
    ctx.lineWidth = 2.5
    ctx.strokeStyle = '#111827'
    const p = L.pts
    ctx.moveTo(p[0][0], p[0][1])
    for (let i = 1; i < p.length; i++) ctx.lineTo(p[i][0], p[i][1])
    ctx.stroke()
  }
  ctx.fillStyle = '#334155'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center'
  for (const t of DATA.labels) ctx.fillText(t.text, t.x, t.y)
}

function hexToRgb(h) { return [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)] }
function flood(x0, y0, hex) {
  const img = ctx.getImageData(0, 0, DATA.W, DATA.H)
  const px = img.data
  const idx = (x, y) => (y * DATA.W + x) * 4
  const i0 = idx(x0, y0)
  const sr = px[i0], sg = px[i0+1], sb = px[i0+2]
  const [fr, fg, fb] = hexToRgb(hex)
  if (sr === fr && sg === fg && sb === fb) return
  // barrier = near-black line pixels; fill spreads over pixels matching the START color (tol for AA)
  const TOL = 60
  const match = (i) => Math.abs(px[i]-sr)<=TOL && Math.abs(px[i+1]-sg)<=TOL && Math.abs(px[i+2]-sb)<=TOL
  const dark = (i) => px[i] < 70 && px[i+1] < 70 && px[i+2] < 80
  if (dark(i0)) return
  const stack = [[x0, y0]]
  while (stack.length) {
    const [x, y] = stack.pop()
    let xl = x
    while (xl >= 0 && match(idx(xl, y)) && !dark(idx(xl, y))) xl--
    let xr = x
    while (xr < DATA.W && match(idx(xr, y)) && !dark(idx(xr, y))) xr++
    for (let xi = xl + 1; xi < xr; xi++) {
      const i = idx(xi, y)
      px[i] = fr; px[i+1] = fg; px[i+2] = fb; px[i+3] = 255
      for (const yn of [y - 1, y + 1]) {
        if (yn < 0 || yn >= DATA.H) continue
        const j = idx(xi, yn)
        if (match(j) && !dark(j)) stack.push([xi, yn])
      }
    }
  }
  ctx.putImageData(img, 0, 0)
}

cv.addEventListener('click', (ev) => {
  const r = cv.getBoundingClientRect()
  flood(Math.round(ev.clientX - r.left), Math.round(ev.clientY - r.top), current)
})
cv.addEventListener('contextmenu', (ev) => {
  ev.preventDefault()
  const r = cv.getBoundingClientRect()
  flood(Math.round(ev.clientX - r.left), Math.round(ev.clientY - r.top), '#ffffff')
})

const bar = document.querySelector('.bar')
for (const [name, hex] of Object.entries(LITHOS)) {
  const b = document.createElement('div')
  b.className = 'sw'
  b.style.background = hex
  b.title = name
  b.addEventListener('click', () => {
    current = hex
    for (const s of bar.querySelectorAll('.sw')) s.classList.remove('sel')
    b.classList.add('sel')
  })
  bar.appendChild(b)
  if (name === 'ZAND') b.classList.add('sel')
}
const reset = document.createElement('button')
reset.textContent = 'Reset'
reset.addEventListener('click', draw)
bar.appendChild(reset)
draw()
</script></body></html>`

writeFileSync(resolve(HERE, 'owner_paint_tool.html'), html)
console.log(`wrote owner_paint_tool.html (${W}x${H}, ${lines.length} line elements, ${rects.length} unit rects)`)
