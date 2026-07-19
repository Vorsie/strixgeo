/**
 * gen_owner_questions.mjs — THROWAWAY (2026-07-19). Renders the two open owner
 * rulings (F3 mixed enclosure at B3; F4 sub-TD clay at B2) from the REAL model:
 * full column stacks + every drawn tie, straight out of
 * scripts/diag_allsections_input.json (fresh extraction). No invented geometry —
 * only the option annotations (seam / labels) are overlaid.
 *
 * Run: node scripts/gen_owner_questions.mjs  → scripts/owner_questions_real.html
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const input = JSON.parse(readFileSync(resolve(HERE, 'diag_allsections_input.json'), 'utf8'))
const names = JSON.parse(readFileSync(resolve(HERE, 'diag_shape_audit_names.json'), 'utf8'))

const cs1 = input.sections.find((s) => s.name === 'Cross-section 1')
const fname = (id) => input.formationNames?.[id] ?? id.slice(0, 8)
const LITHOS = ['ZAND', 'SAND', 'SILT', 'KLEI', 'CLAY', 'VEEN', 'LEEM', 'GRIND']
const baseLitho = (id) => {
  const up = fname(id).toUpperCase()
  for (const l of LITHOS) if (up.includes(l)) return l === 'SAND' ? 'ZAND' : l === 'CLAY' ? 'KLEI' : l
  return up.slice(0, 4)
}
const COLOR = { ZAND: '#eab308', SILT: '#a3e635', KLEI: '#94a3b8', VEEN: '#78350f', LEEM: '#d97706', GRIND: '#f97316' }
const color = (id) => COLOR[baseLitho(id)] ?? '#c084fc'
const colName = (i) => names[cs1.columns[i].investigationId] ?? cs1.columns[i].investigationId.slice(0, 8)

// Per-column unit list with true elevations.
function unitsOf(i) {
  const c = cs1.columns[i]
  return c.units.map((u) => ({
    layerId: u.layerId,
    fid: u.formationId,
    top: c.surfaceElevM - u.topDepthM,
    base: c.surfaceElevM - u.baseDepthM,
  }))
}
// layerId -> { col, top, base } for tie endpoint lookup.
const layerLoc = new Map()
cs1.columns.forEach((c, i) => {
  for (const u of unitsOf(i)) layerLoc.set(u.layerId, { col: i, top: u.top, base: u.base })
})

function panel(colIdxs, opts) {
  const W = 980
  const COLW = 34
  const xs = colIdxs.map((i) => cs1.alongM[i])
  // Warp: proportional but min 180px per gap so the 2.9 m gap stays readable.
  const px = [60]
  for (let k = 1; k < xs.length; k++) px.push(px[k - 1] + Math.max(180, (xs[k] - xs[k - 1]) * 6))
  const plotW = px[px.length - 1] + 120
  const allUnits = colIdxs.map((i) => unitsOf(i))
  let eMax = -Infinity
  let eMin = Infinity
  for (const us of allUnits) for (const u of us) { eMax = Math.max(eMax, u.top); eMin = Math.min(eMin, u.base) }
  if (opts.clipTop !== undefined) eMax = Math.min(eMax, opts.clipTop)
  if (opts.clipBase !== undefined) eMin = Math.max(eMin, opts.clipBase)
  eMax += 0.6; eMin -= 0.6
  const H = 560
  const sy = (e) => 30 + ((eMax - e) / (eMax - eMin)) * (H - 70)
  const sx = (k) => px[k] // panel-local column index -> px
  const parts = []
  parts.push(`<rect x="0" y="0" width="${Math.max(plotW, W)}" height="${H}" fill="#0b1220"/>`)
  // Elevation grid every 2 m.
  for (let e = Math.ceil(eMin / 2) * 2; e <= eMax; e += 2) {
    parts.push(`<line x1="40" y1="${sy(e)}" x2="${plotW - 20}" y2="${sy(e)}" stroke="#1e293b" stroke-width="1"/>`)
    parts.push(`<text x="8" y="${sy(e) + 3}" fill="#475569" font-size="9">${e}</text>`)
  }
  // Columns: full real stacks.
  colIdxs.forEach((ci, k) => {
    const cx = sx(k)
    parts.push(`<text x="${cx}" y="14" fill="#e2e8f0" font-size="11" text-anchor="middle">${colName(ci)}</text>`)
    parts.push(`<text x="${cx}" y="25" fill="#64748b" font-size="9" text-anchor="middle">x=${cs1.alongM[ci].toFixed(1)} m</text>`)
    for (const u of allUnits[k]) {
      if (u.top < eMin || u.base > eMax) continue
      const yT = sy(Math.min(u.top, eMax))
      const yB = sy(Math.max(u.base, eMin))
      parts.push(`<rect x="${cx - COLW / 2}" y="${yT.toFixed(1)}" width="${COLW}" height="${(yB - yT).toFixed(1)}" fill="${color(u.fid)}" stroke="#0f172a" stroke-width="0.8"/>`)
      if (yB - yT > 11) {
        const lit = baseLitho(u.fid)
        const tc = ['ZAND', 'SILT', 'LEEM'].includes(lit) ? '#1e293b' : '#f1f5f9'
        parts.push(`<text x="${cx}" y="${((yT + yB) / 2 + 3).toFixed(1)}" fill="${tc}" font-size="8" text-anchor="middle">${lit}</text>`)
      }
    }
    // TD marker.
    const tdE = Math.min(...allUnits[k].map((u) => u.base))
    if (tdE >= eMin) parts.push(`<text x="${cx}" y="${sy(tdE) + 12}" fill="#94a3b8" font-size="8" text-anchor="middle">TD ${tdE.toFixed(2)}</text>`)
  })
  // Ties: every drawn edge whose BOTH endpoints are on rendered columns.
  const idxOf = new Map(colIdxs.map((ci, k) => [ci, k]))
  for (const e of cs1.edges) {
    const la = layerLoc.get(e.a)
    const lb = layerLoc.get(e.b)
    if (!la || !lb || !idxOf.has(la.col) || !idxOf.has(lb.col) || la.col === lb.col) continue
    const ea = (e.aSide ?? 'top') === 'base' ? la.base : la.top
    const eb = (e.bSide ?? 'top') === 'base' ? lb.base : lb.top
    if (Math.min(ea, eb) > eMax || Math.max(ea, eb) < eMin) continue
    const [k1, k2] = [idxOf.get(la.col), idxOf.get(lb.col)]
    const jump = Math.abs(la.col - lb.col) > 1
    const x1 = sx(k1) + (k2 > k1 ? COLW / 2 : -COLW / 2)
    const x2 = sx(k2) + (k2 > k1 ? -COLW / 2 : COLW / 2)
    parts.push(`<line x1="${x1}" y1="${sy(ea).toFixed(1)}" x2="${x2}" y2="${sy(eb).toFixed(1)}" stroke="#ef4444" stroke-width="1.8" opacity="0.9"${jump ? ' stroke-dasharray="8,3"' : ''}/>`)
    parts.push(`<circle cx="${x1}" cy="${sy(ea).toFixed(1)}" r="2.6" fill="#ef4444"/><circle cx="${x2}" cy="${sy(eb).toFixed(1)}" r="2.6" fill="#ef4444"/>`)
  }
  // Overlays supplied by the caller (already in data space; convert here).
  for (const ov of opts.overlays ?? []) parts.push(ov({ sx, sy, COLW, idxOf }))
  return `<svg width="${Math.max(plotW, W)}" height="${H}" viewBox="0 0 ${Math.max(plotW, W)} ${H}">${parts.join('\n')}</svg>`
}

// ---------- Q1: B3 (col12) with S9 left (col11) and S9 right (col13) ----------
// The F3 silt on B3: el [8.48 .. 5.98] (2nd SILT from top). Flanks to the RIGHT
// gap (col12→col13). 0.45 apex per ruling 8b-rev; the old capped apex marked.
const q1 = panel([11, 12, 13], {
  clipBase: -6,
  overlays: [
    ({ sx, sy, COLW }) => {
      const xL = sx(1) + COLW / 2
      const xR = sx(2) - COLW / 2
      const apexX = xL + 0.45 * (xR - xL)
      const oldX = xL + ((507.875 - 502.875) / (537.68 - 502.875)) * (xR - xL) * ((537.68 - 502.875) / (537.68 - 502.875))
      const capX = xL + ((507.875 - 502.875) / (537.68 - 502.875)) * (xR - xL)
      const yT = sy(8.48)
      const yB = sy(5.98)
      const yA = sy(7.23)
      return [
        `<line x1="${xL}" y1="${yT}" x2="${apexX}" y2="${yA}" stroke="#22c55e" stroke-width="2.2"/>`,
        `<line x1="${xL}" y1="${yB}" x2="${apexX}" y2="${yA}" stroke="#22c55e" stroke-width="2.2"/>`,
        `<circle cx="${apexX}" cy="${yA}" r="4" fill="#22c55e"/>`,
        `<text x="${apexX}" y="${yA - 8}" fill="#22c55e" font-size="9" text-anchor="middle">0.45 apex (8b-rev)</text>`,
        `<line x1="${capX}" y1="${yA - 14}" x2="${capX}" y2="${yA + 14}" stroke="#64748b" stroke-width="1" stroke-dasharray="3,3"/>`,
        `<text x="${capX}" y="${yA + 26}" fill="#64748b" font-size="8" text-anchor="middle">old capped apex</text>`,
        `<text x="${(xL + xR) / 2}" y="${sy(5.98) + 40}" fill="#fbbf24" font-size="11" text-anchor="middle">? what fills right of the apex — CLAY is above the silt, SAND below ?</text>`,
      ].join('\n')
    },
  ],
})

// ---------- Q1b: MY INTERPRETATION of the owner's 8o ruling, on the real geometry ----------
// Real ties (from the extraction): silt tops tied 5.47(c11)<->8.48(c12) — same litho -> merge;
// sand base tie 3.42<->3.98 (left) and 3.98<->4.84 (right) -> onlaps both ways; clay top tie
// 11.39<->11.98 + base tie (the silt-top tie) -> banded left, bare right -> lens right.
const q1b = panel([11, 12, 13], {
  clipBase: -6,
  overlays: [
    ({ sx, sy, COLW }) => {
      const xR11 = sx(1) - COLW / 2 // B3 left edge
      const xL11 = sx(0) + COLW / 2 // col11 right edge
      const xL12 = sx(1) + COLW / 2 // B3 right edge
      const xR12 = sx(2) - COLW / 2 // col13 left edge
      const midG11 = (xL11 + xR11) / 2
      const half12 = xL12 + 0.5 * (xR12 - xL12)
      const a45 = xL12 + 0.45 * (xR12 - xL12)
      const p = []
      // SAND onlap ties (blue, 8i(d) one line, apex 0.5 riding the base tie).
      p.push(`<line x1="${xR11}" y1="${sy(5.98)}" x2="${midG11}" y2="${sy(3.7)}" stroke="#3b82f6" stroke-width="2.4"/>`)
      p.push(`<circle cx="${midG11}" cy="${sy(3.7)}" r="3.6" fill="#3b82f6"/>`)
      p.push(`<line x1="${xL12}" y1="${sy(5.98)}" x2="${half12}" y2="${sy(4.41)}" stroke="#3b82f6" stroke-width="2.4"/>`)
      p.push(`<circle cx="${half12}" cy="${sy(4.41)}" r="3.6" fill="#3b82f6"/>`)
      p.push(`<text x="${half12}" y="${sy(4.41) + 14}" fill="#3b82f6" font-size="9" text-anchor="middle">SAND onlaps (0.5, riding its tie)</text>`)
      // CLAY lens ties right (green, 0.45).
      p.push(`<line x1="${xL12}" y1="${sy(11.98)}" x2="${a45}" y2="${sy(10.23)}" stroke="#22c55e" stroke-width="2.4"/>`)
      p.push(`<line x1="${xL12}" y1="${sy(8.48)}" x2="${a45}" y2="${sy(10.23)}" stroke="#22c55e" stroke-width="2.4"/>`)
      p.push(`<circle cx="${a45}" cy="${sy(10.23)}" r="3.6" fill="#22c55e"/>`)
      p.push(`<text x="${a45}" y="${sy(10.23) - 8}" fill="#22c55e" font-size="9" text-anchor="middle">CLAY lens right (banded left)</text>`)
      // SILT lens ties right (green, 0.45).
      p.push(`<line x1="${xL12}" y1="${sy(8.48)}" x2="${a45}" y2="${sy(7.23)}" stroke="#22c55e" stroke-width="2.4"/>`)
      p.push(`<line x1="${xL12}" y1="${sy(5.98)}" x2="${a45}" y2="${sy(7.23)}" stroke="#22c55e" stroke-width="2.4"/>`)
      p.push(`<circle cx="${a45}" cy="${sy(7.23)}" r="3.6" fill="#22c55e"/>`)
      // No flank on B3-silt's LEFT: 8m — its top tie faces col11's SILT (same litho) -> merge.
      p.push(`<text x="${(xL11 + xR11) / 2}" y="${sy(6.6)}" fill="#a3e635" font-size="9" text-anchor="middle">no flank (8m: same litho</text>`)
      p.push(`<text x="${(xL11 + xR11) / 2}" y="${sy(6.1)}" fill="#a3e635" font-size="9" text-anchor="middle">across the tie) → silt flows</text>`)
      // The ONE SILT BODY outline (white dashed): col11 silt u1 -> gap11 band between the two
      // ties -> B3 silt u2 -> the gap12 hole (silt = the only unterminated litho: col13's top
      // SILT is corr-2 [top+base tied] and BANDS into the gap) -> col13 silt u0.
      const d = [
        `M ${sx(0) - COLW / 2} ${sy(5.47)}`,
        `L ${xL11} ${sy(5.47)}`, `L ${xR11} ${sy(8.48)}`, // silt-top tie (5.47->8.48)
        `L ${xL12} ${sy(8.48)}`,
        `L ${a45} ${sy(10.23)}`, // around the clay lens apex
        `L ${xR12} ${sy(11.73)}`, // col13 silt top
        `L ${sx(2) + COLW / 2} ${sy(11.73)}`,
        `L ${sx(2) + COLW / 2} ${sy(4.84)}`,
        `L ${xR12} ${sy(4.84)}`,
        `L ${half12} ${sy(4.41)}`, // over the sand's right onlap apex
        `L ${xL12} ${sy(5.98)}`,
        `L ${xR11} ${sy(5.98)}`, // B3 silt base (sand's untied top)
        `L ${midG11} ${sy(3.7)}`, // around the sand's left onlap wedge
        `L ${xL11} ${sy(3.42)}`,
        `L ${sx(0) - COLW / 2} ${sy(3.42)}`,
        `Z`,
      ].join(' ')
      p.push(`<path d="${d}" fill="none" stroke="#f8fafc" stroke-width="2" stroke-dasharray="7,5" opacity="0.9"/>`)
      p.push(`<text x="${(xL12 + xR12) / 2}" y="${sy(9.0)}" fill="#f8fafc" font-size="11" font-weight="bold" text-anchor="middle">ONE SILT BODY (fill + merge)</text>`)
      p.push(`<text x="${(xL12 + xR12) / 2}" y="${sy(8.5)}" fill="#94a3b8" font-size="9" text-anchor="middle">gap hole fills SILT — the only unterminated litho (col13's top silt is corr-2: it BANDS in)</text>`)
      return p.join('\n')
    },
  ],
})

// ---------- Q2: B2 (col16) with S8/S10 left (14,15), S7A/S7/S6 right (17,18,19) ----------
const q2 = panel([14, 15, 16, 17, 18, 19], {
  overlays: [
    ({ sx, sy, COLW }) => {
      // B2 = panel col 2. TD from its deepest base.
      const b2 = unitsOf(16)
      const tdE = Math.min(...b2.map((u) => u.base))
      const x1 = sx(2) - COLW / 2
      const x2 = sx(2) + COLW / 2
      const y = sy(tdE)
      return [
        `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="#f8fafc" stroke-width="2.6"/>`,
        `<text x="${x2 + 6}" y="${y + 4}" fill="#f8fafc" font-size="9">B2 TD ${tdE.toFixed(2)}</text>`,
      ].join('\n')
    },
  ],
})

// ---------- Q2b: MY INTERPRETATION of "sand below B2, because of the geometry" ----------
// Real ties: the deep CLAY-TOP tie c14@-7.64 <-> c19@-5.87 (a jump passing under cols
// 15-18) bounds the deep clay band from above; ABOVE that line BOTH deep neighbours carry
// SAND (S8's zand, S6's zand [-5.87..7.03]). The sand-top line: S8 3.20 -> S10 4.09 ->
// B2 4.25 -> (jump under S7A) S7's TD 4.23 -> rising to S6's sand top 7.03. Everything
// between those two boundaries is the sand's space; the hole under B2's TD fills SAND
// (ruling 8o: the only unterminated litho) and merges with B2's own sand -> ONE BODY.
const q2b = panel([14, 15, 16, 17, 18, 19], {
  overlays: [
    ({ sx, sy, COLW }) => {
      const W2 = COLW / 2
      const p = []
      const b2 = unitsOf(16)
      const tdE = Math.min(...b2.map((u) => u.base))
      // B2 TD marker (the body continues BELOW it).
      p.push(`<line x1="${sx(2) - W2}" y1="${sy(tdE)}" x2="${sx(2) + W2}" y2="${sy(tdE)}" stroke="#f8fafc" stroke-width="2.6"/>`)
      p.push(`<text x="${sx(2) + W2 + 5}" y="${sy(tdE) + 4}" fill="#f8fafc" font-size="9">B2 TD — sand continues BELOW</text>`)
      // THE ONE SAND BODY outline (white dashed), riding the real ties:
      const d = [
        `M ${sx(0) + W2} ${sy(3.20)}`, // S8 sand top (right edge)
        `L ${sx(1) - W2} ${sy(4.09)}`, `L ${sx(1) + W2} ${sy(4.09)}`, // tie 3.20<->4.09, over S10
        `L ${sx(2) - W2} ${sy(4.25)}`, `L ${sx(2) + W2} ${sy(4.25)}`, // tie 4.09<->4.25, over B2
        `L ${sx(4) - W2} ${sy(4.23)}`, `L ${sx(4) + W2} ${sy(4.23)}`, // jump tie 4.25<->4.23 under S7A
        `L ${sx(5) - W2} ${sy(7.03)}`, `L ${sx(5) + W2} ${sy(7.03)}`, // tie 4.23<->7.03 rising to S6 sand top
        `L ${sx(5) + W2} ${sy(-5.87)}`, // down S6's right edge to its sand base
        `L ${sx(5) - W2} ${sy(-5.87)}`,
        `L ${sx(0) + W2} ${sy(-7.64)}`, // back along the deep CLAY-TOP jump tie under everything
        `Z`,
      ].join(' ')
      p.push(`<path d="${d}" fill="#eab308" opacity="0.18"/>`)
      p.push(`<path d="${d}" fill="none" stroke="#f8fafc" stroke-width="2.2" stroke-dasharray="8,5" opacity="0.95"/>`)
      p.push(`<text x="${(sx(2) + sx(4)) / 2}" y="${sy(-1)}" fill="#f8fafc" font-size="12" font-weight="bold" text-anchor="middle">ONE SAND BODY</text>`)
      p.push(`<text x="${(sx(2) + sx(4)) / 2}" y="${sy(-2.2)}" fill="#94a3b8" font-size="9.5" text-anchor="middle">the hole under B2's TD is bounded below by the deep clay-top tie —</text>`)
      p.push(`<text x="${(sx(2) + sx(4)) / 2}" y="${sy(-3.2)}" fill="#94a3b8" font-size="9.5" text-anchor="middle">SAND is the only unterminated litho above it (8o) → fill sand, merge with B2's sand</text>`)
      // The deep clay band label (between its top tie and the tied clay bottoms).
      p.push(`<text x="${(sx(1) + sx(3)) / 2}" y="${sy(-8.6)}" fill="#94a3b8" font-size="10" text-anchor="middle">deep CLAY band (top tie −7.64 → −5.87, bottoms tied −10.20 ↔ −9.96)</text>`)
      // S8's deep SILT interbed [-6.32..-4.45]: corr-0 -> lenses right at 0.45 INSIDE the sand.
      const xg = sx(0) + W2
      const apex = xg + 0.45 * ((sx(1) - W2) - xg)
      p.push(`<line x1="${xg}" y1="${sy(-4.45)}" x2="${apex}" y2="${sy(-5.385)}" stroke="#22c55e" stroke-width="2.2"/>`)
      p.push(`<line x1="${xg}" y1="${sy(-6.32)}" x2="${apex}" y2="${sy(-5.385)}" stroke="#22c55e" stroke-width="2.2"/>`)
      p.push(`<circle cx="${apex}" cy="${sy(-5.385)}" r="3.4" fill="#22c55e"/>`)
      p.push(`<text x="${apex + 6}" y="${sy(-5.385) + 3}" fill="#22c55e" font-size="8.5">S8's silt lenses inside the sand (0.45)</text>`)
      return p.join('\n')
    },
  ],
})

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<title>Owner rulings — REAL geometry from the model</title>
<style>
 body{margin:0;background:#0f172a;color:#e2e8f0;font-family:ui-sans-serif,system-ui,sans-serif;padding:22px}
 h1{font-size:19px;margin:0 0 4px} h2{font-size:15px;margin:26px 0 6px;color:#93c5fd}
 .sub{color:#94a3b8;font-size:13px;max-width:1000px;line-height:1.5;margin-bottom:8px}
 .q{color:#fbbf24;font-size:13.5px;margin-top:10px;max-width:1000px;line-height:1.55}
 .wrap{overflow-x:auto;border:1px solid #334155;border-radius:8px}
 .leg{margin:8px 0;font-size:12px;color:#94a3b8}
 .leg span{display:inline-block;width:12px;height:12px;vertical-align:middle;margin:0 4px 0 12px;border:1px solid #0f172a}
 .leg .ln{display:inline-block;width:26px;height:0;border-top:2.5px solid;vertical-align:middle;margin:0 4px 0 12px}
</style></head><body>
<h1>The two rulings — rendered from your saved model (no invented geometry)</h1>
<div class="leg"><span style="background:#eab308"></span>SAND <span style="background:#a3e635"></span>SILT
 <span style="background:#94a3b8"></span>CLAY <span style="background:#78350f"></span>PEAT
 <span class="ln" style="border-color:#ef4444"></span>your drawn ties (dashed = jump)
 <span class="ln" style="border-color:#22c55e"></span>lens flanks (0.45 per your new rule)</div>

<h2>Q1 — mixed enclosure: B3's 2nd silt [8.48 .. 5.98], right gap toward GEO-23/125-S9</h2>
<div class="sub">Full real stacks, every tie you drew in these two gaps. The silt's own contacts carry no
ties → corr 0 → it lenses right to the 0.45 apex. CLAY sits directly above it, SAND directly below —
no single matrix. What fills right of the apex?</div>
<div class="wrap">${q1}</div>

<h2>Q1 — MY INTERPRETATION of your ruling (8o), drawn on the real geometry</h2>
<div class="sub">Your rule as I read it, using the actual ties: the silt tops are TIED (5.47↔8.48) and the
litho matches across that tie → 8m: no flank, the silt flows left and merges. The SAND's base tie exists on
both sides → it ONLAPS left and right (blue, apex 0.5 riding its tie). The top CLAY is banded left
(top tie 11.39↔11.98 + the silt-top tie on its base) and bare right → LENS right (green, 0.45).
B3's silt is bare right → LENS right. Col13's top silt is tied top AND base → corr 2 → it BANDS into the
gap unterminated. The hole right of B3 then fills SILT — the only unterminated litho — and the merge welds
<b>one silt body</b> (white dashed outline) from GEO-10/170-S9's silt through B3 to GEO-23/125-S9's top silt,
with the clay lens and sand onlap wedges poking into it as closed shapes.</div>
<div class="wrap">${q1b}</div>
<div class="q">Is this your rule, letter for letter? Anything in the dashed outline or the ties that reads wrong?</div>

<h2>Q2 — the B2 clay: 23/126-B2 between GEO-10/170-S10 and GEO-23/125-S7A</h2>
<div class="sub">Full real stacks + every tie (dashed red = jump correlations spanning past a column).
B2 bottoms in its sand; below its TD the deeper tests carry the sand/clay ties passing underneath.</div>
<div class="wrap">${q2}</div>

<h2>Q2 — MY INTERPRETATION of "sand below B2, because of the geometry", drawn with all bands</h2>
<div class="sub">Your rule as I read it (same 8o mechanism as Q1): the deep CLAY-TOP tie (S8's −7.64 → S6's −5.87,
a jump passing under everything) closes the deep clay band from above. Above that line both deep tests carry
SAND, and the sand-top line runs S8 3.20 → S10 4.09 → B2 4.25 → (jump under S7A) S7's base 4.23 → rising to
S6's sand top 7.03. The hole under B2's TD sits between those two boundaries — SAND is the only unterminated
lithology there, so it fills sand and merges with B2's own sand: <b>one sand body</b> (white dashed outline,
tinted), produced entirely by the tie geometry — nothing "extended down". S8's deep silt lenses inside it at 0.45.</div>
<div class="wrap">${q2b}</div>
<div class="q">Is this your rule for B2, letter for letter?</div>
</body></html>`

writeFileSync(resolve(HERE, 'owner_questions_real.html'), html)
console.log('wrote owner_questions_real.html')
