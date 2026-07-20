/**
 * diff_owner_paint.mjs — THROWAWAY (2026-07-20). The owner hand-painted CS1 in the paint tool
 * (owner_paint.png, exported canvas). This diffs HIS fill against the ENGINE's fill
 * (diag_cs1_flip_walkthrough.json regions) region by region: the ultimate acceptance test —
 * the owner IS the reference fill engine.
 *
 * Run: node scripts/diff_owner_paint.mjs
 */
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

// ---------- minimal PNG decoder (8-bit RGBA/RGB, non-interlaced) ----------
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG')
  let pos = 8
  let w = 0, h = 0, bitDepth = 0, colorType = 0
  const idat = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4)
      bitDepth = data[8]; colorType = data[9]
      if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) throw new Error(`unsupported PNG (depth ${bitDepth} color ${colorType})`)
      if (data[12] !== 0) throw new Error('interlaced PNG unsupported')
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    pos += 12 + len
  }
  const bpp = colorType === 6 ? 4 : 3
  const raw = inflateSync(Buffer.concat(idat))
  const stride = w * bpp
  const out = Buffer.alloc(w * h * 4)
  let prev = Buffer.alloc(stride)
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const cur = Buffer.alloc(stride)
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0
      const b = prev[i]
      const c = i >= bpp ? prev[i - bpp] : 0
      let v = line[i]
      if (f === 1) v = (v + a) & 255
      else if (f === 2) v = (v + b) & 255
      else if (f === 3) v = (v + ((a + b) >> 1)) & 255
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255
      }
      cur[i] = v
    }
    for (let x = 0; x < w; x++) {
      out[(y * w + x) * 4] = cur[x * bpp]
      out[(y * w + x) * 4 + 1] = cur[x * bpp + 1]
      out[(y * w + x) * 4 + 2] = cur[x * bpp + 2]
      out[(y * w + x) * 4 + 3] = colorType === 6 ? cur[x * bpp + 3] : 255
    }
    prev = cur
  }
  return { w, h, px: out }
}

// ---------- the paint tool's EXACT canvas transform (mirror of gen_paint_tool.mjs) ----------
const d = JSON.parse(readFileSync(resolve(HERE, 'diag_cs1_flip_walkthrough.json'), 'utf8'))
const cols = d.columns
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
const COLW = 13

// ---------- color classification ----------
const PALETTE = {
  ZAND: [234, 179, 8], SILT: [163, 230, 53], KLEI: [148, 163, 184], VEEN: [120, 53, 15], LEEM: [217, 119, 6],
}
const WHITE = [255, 255, 255]
const LINES = [[17, 24, 39], [30, 58, 138], [139, 26, 26], [91, 33, 182]]
function classify(r, g, b) {
  const near = (c, tol) => Math.abs(r - c[0]) <= tol && Math.abs(g - c[1]) <= tol && Math.abs(b - c[2]) <= tol
  // LINES FIRST: the dark-red engine-tie color (139,26,26) is within 30/channel of VEEN
  // (120,53,15) — checking the palette first misread tie pixels as peat (owner caught it:
  // "i didn't brush that, those are misreads on your part").
  for (const c of LINES) if (near(c, 18)) return 'LINE'
  for (const [name, c] of Object.entries(PALETTE)) if (near(c, 22)) return name
  if (near(WHITE, 12)) return 'WHITE'
  return 'OTHER'
}

// ---------- geometry ----------
function pointInPoly(x, y, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
function polyArea(poly) {
  let a = 0
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1])
  return Math.abs(a / 2)
}
function centroid(poly) {
  let x = 0, y = 0
  for (const p of poly) { x += p[0]; y += p[1] }
  return [x / poly.length, y / poly.length]
}

// ---------- main ----------
const png = decodePng(readFileSync(resolve(HERE, 'owner_paint.png')))
console.log(`PNG ${png.w}x${png.h}; expected canvas ${Math.ceil(M_L + warpCum[warpCum.length - 1] + 40)}x${Math.ceil(M_T + PLOT_H + 30)}`)

const pxAt = (cx, cy) => {
  const x = Math.round(cx), y = Math.round(cy)
  if (x < 0 || y < 0 || x >= png.w || y >= png.h) return null
  const i = (y * png.w + x) * 4
  return [png.px[i], png.px[i + 1], png.px[i + 2]]
}

// transform validation on known column-unit rect centers (pre-painted litho colors)
let valOk = 0, valBad = 0
for (const c of sorted) {
  for (const u of c.units) {
    const cy = (sy(u.topElev) + sy(u.baseElev)) / 2
    if (sy(u.baseElev) - sy(u.topElev) < 6) continue
    const p = pxAt(sx(c.x), cy)
    if (!p) continue
    const cls = classify(...p)
    if (cls === u.litho) valOk++
    else if (cls !== 'LINE') { valBad++; if (valBad <= 5) console.log(`  VALIDATION MISS col@${c.x.toFixed(0)} ${u.litho} [${u.topElev.toFixed(1)}..${u.baseElev.toFixed(1)}] -> ${cls} rgb(${p})`) }
  }
}
console.log(`transform validation: ${valOk} unit rects OK, ${valBad} misses`)

// region sampling: candidate points = centroid + edge-midpoint pull-ins; the point must belong
// to THIS region (smallest-area containing poly wins) and avoid column rect zones.
const regions = d.regions
const inColumnZone = (cx) => sorted.some((c) => Math.abs(cx - sx(c.x)) <= COLW + 2)
function samplesFor(reg) {
  const poly = reg.poly
  const pts = []
  const c = centroid(poly)
  pts.push(c)
  for (let i = 0; i < poly.length; i++) {
    const m = [(poly[i][0] + poly[(i + 1) % poly.length][0]) / 2, (poly[i][1] + poly[(i + 1) % poly.length][1]) / 2]
    pts.push([m[0] * 0.6 + c[0] * 0.4, m[1] * 0.6 + c[1] * 0.4])
    pts.push([m[0] * 0.3 + c[0] * 0.7, m[1] * 0.3 + c[1] * 0.7])
  }
  const myArea = polyArea(poly)
  const good = []
  for (const [wx, wy] of pts) {
    if (!pointInPoly(wx, wy, poly)) continue
    // smallest containing region must be this one (handles matrix rings around lens holes)
    let smallest = myArea, owner = reg
    for (const other of regions) {
      if (other === reg) continue
      if (pointInPoly(wx, wy, other.poly)) {
        const a = polyArea(other.poly)
        if (a < smallest) { smallest = a; owner = other }
      }
    }
    if (owner !== reg) continue
    const cx = sx(wx)
    if (inColumnZone(cx)) continue
    good.push([cx, sy(wy)])
  }
  return good
}

const tally = { agree: 0, disagree: 0, unpainted: 0, unsampleable: 0 }
const disagreements = []
const unpaintedList = []
for (const reg of regions) {
  const samples = samplesFor(reg)
  const votes = {}
  for (const [cx, cy] of samples) {
    // 3x3 neighborhood majority to dodge antialiased pixels
    const local = {}
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const p = pxAt(cx + dx, cy + dy)
      if (!p) continue
      const cls = classify(...p)
      local[cls] = (local[cls] ?? 0) + 1
    }
    const best = Object.entries(local).filter(([k]) => k !== 'LINE' && k !== 'OTHER').sort((a, b) => b[1] - a[1])[0]
    if (best) votes[best[0]] = (votes[best[0]] ?? 0) + 1
  }
  const winner = Object.entries(votes).sort((a, b) => b[1] - a[1])[0]
  if (!winner) { tally.unsampleable++; continue }
  const ownerLitho = winner[0]
  const c = centroid(reg.poly)
  const id = `g${reg.gapIndex} ${reg.kind ?? ''} ${reg.litho} @(${c[0].toFixed(0)},${c[1].toFixed(1)})`
  if (ownerLitho === 'WHITE') { tally.unpainted++; unpaintedList.push(id); continue }
  if (ownerLitho === reg.litho) tally.agree++
  else { tally.disagree++; disagreements.push(`${id} -> OWNER painted ${ownerLitho}`) }
}
console.log(`\n===== OWNER PAINT vs ENGINE FILL (${regions.length} CS1 regions) =====`)
console.log(`AGREE: ${tally.agree}   DISAGREE: ${tally.disagree}   UNPAINTED: ${tally.unpainted}   unsampleable: ${tally.unsampleable}`)
if (disagreements.length) { console.log('\nDISAGREEMENTS (engine litho @ centroid vs owner):'); for (const s of disagreements) console.log('  ' + s) }
if (unpaintedList.length) { console.log('\nUNPAINTED:'); for (const s of unpaintedList.slice(0, 20)) console.log('  ' + s) }
