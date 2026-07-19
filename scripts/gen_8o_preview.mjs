/**
 * gen_8o_preview.mjs — THROWAWAY (2026-07-19). Whole-section PREVIEW of the proposed
 * 8o/8g label rule ("the hole fills with the litho that CONTINUES ACROSS it on both
 * open ends"): renders the CURRENT flag-ON fill for all of CS1, then at EVERY corr-0 /
 * corr-1 termination wedge evaluates the rule from the dump's corr tables and marks:
 *   green check  — the rule agrees with what the engine paints today;
 *   red badge    — the rule CHANGES the label (now → proposed, with (a)/(b) cause);
 *   amber "?"    — the rule finds zero/multiple continuers (the ask-first fallback).
 * Nothing here touches the engine — pure preview from the committed dump.
 *
 * Rule as evaluated (orchestrator's 8g-grounded resolution, PENDING OWNER APPROVAL):
 *   (a) ENCLOSURE CONTINUATION (8g detour, priority): the unit's own-column neighbours
 *       above+below share one litho AND both continue past this wedge (their side corr
 *       >= 1, so their reach 0.5/full exceeds the 0.45 lens apex) -> that litho wraps.
 *   (b) LATERAL BAND FLOW: else the facing column's corr-2 band-member(s) overlapping
 *       the wedge elevations flow in; exactly one distinct litho -> it.
 *
 * Run: node scripts/gen_8o_preview.mjs  → scripts/owner_8o_preview.html
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const d = JSON.parse(readFileSync(resolve(HERE, 'diag_cs1_flip_walkthrough.json'), 'utf8'))

const LITHO_COLOR = { ZAND: '#eab308', SILT: '#a3e635', KLEI: '#94a3b8', VEEN: '#78350f', LEEM: '#d97706', GRIND: '#f97316' }
const color = (l) => LITHO_COLOR[l] ?? '#c084fc'
const cols = d.columns

// ---- x-warp (same as the walkthrough) ----
const MIN_GAP_PX = 150
const PX_PER_M_X = 2.2
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
const MARGIN_L = 90, MARGIN_T = 60, PLOT_H = 860
let eMin = Infinity, eMax = -Infinity
for (const r of d.regions ?? []) for (const p of r.poly) { eMin = Math.min(eMin, p[1]); eMax = Math.max(eMax, p[1]) }
eMin -= 1; eMax += 1
const sx = (xm) => MARGIN_L + warp(xm)
const sy = (e) => MARGIN_T + ((eMax - e) / (eMax - eMin)) * PLOT_H
const SVG_W = MARGIN_L + warpCum[warpCum.length - 1] + 60
const SVG_H = MARGIN_T + PLOT_H + 30
const fmt = (n) => (Math.round(n * 100) / 100).toString()

// ---- point-in-polygon on a dump region poly ([x, elev] pairs, real alongM) ----
function pip(poly, x, e) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > e !== yj > e && x < ((xj - xi) * (e - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
function currentLithoAt(gi, x, e) {
  for (const r of d.regions ?? []) {
    if (r.gapIndex !== gi) continue
    if (pip(r.poly, x, e)) return r.litho
  }
  return null
}

// ---- the rule evaluation per termination wedge ----
const badges = []
const gapKeys = Object.keys(d.gaps).map(Number).filter((k) => k >= 0).sort((a, b) => a - b)
for (const gi of gapKeys) {
  const g = d.gaps[gi]
  const L = cols.find((c) => c.index === gi)
  const R = cols.find((c) => c.index === gi + 1)
  if (!L || !R) continue
  for (const side of ['left', 'right']) {
    const own = side === 'left' ? L : R
    const facing = side === 'left' ? R : L
    const corrTab = side === 'left' ? g.leftCorr : g.rightCorr
    const facingTab = side === 'left' ? g.rightCorr : g.leftCorr
    if (!corrTab) continue
    for (const row of corrTab) {
      if (row.corr !== 0 && row.corr !== 1) continue
      const u = own.units[row.ui]
      if (!u) continue
      // The wedge sample point: just past the apex (0.45 lens / 0.5 onlap), at unit mid-elev.
      const reach = row.corr === 0 ? 0.45 : 0.5
      const fSample = Math.min(reach + 0.06, 0.93)
      const frac = side === 'left' ? fSample : 1 - fSample
      const x = L.x + frac * (R.x - L.x)
      const eMid = (u.topElev + u.baseElev) / 2
      const now = currentLithoAt(gi, x, eMid)
      // (a) enclosure continuation: own-column neighbours above+below, same litho, both continue.
      const ab = own.units[row.ui - 1]
      const be = own.units[row.ui + 1]
      let proposed = null
      let cause = null
      if (ab && be && ab.litho === be.litho) {
        const abRow = corrTab.find((r2) => r2.ui === row.ui - 1)
        const beRow = corrTab.find((r2) => r2.ui === row.ui + 1)
        const cont = (r2) => r2 && r2.corr >= 1 // onlap 0.5 or band full — continues past 0.45
        if (cont(abRow) && cont(beRow)) { proposed = ab.litho; cause = '(a) detour' }
      }
      // (b) lateral flow: facing units whose termination does NOT close them before the
      // wedge sample — corr-2 bands (full width) and corr-1 onlaps (reach 0.5, which
      // covers a sample sitting ≤0.49 from the facing side). A facing corr-0 lens (0.45)
      // stops short and does not flow.
      if (!proposed && facingTab) {
        const flowLithos = new Set()
        for (const fr of facingTab) {
          if (fr.corr !== 2 && fr.corr !== 1) continue
          const fu = facing.units[fr.ui]
          if (!fu) continue
          // The unit that flows AT the wedge = the one containing the sample elevation
          // (whole-span overlap over-collects and manufactures false ambiguity).
          if (fu.topElev >= eMid && fu.baseElev <= eMid) flowLithos.add(fu.litho)
        }
        if (flowLithos.size === 1) { proposed = [...flowLithos][0]; cause = '(b) lateral flow' }
        else if (flowLithos.size > 1) { proposed = '?'; cause = `ambiguous: ${[...flowLithos].join('/')}` }
      }
      if (!proposed) { proposed = '?'; cause = 'no continuer' }
      badges.push({ gi, side, ui: row.ui, litho: row.litho, corr: row.corr, x, e: eMid, now, proposed, cause })
    }
  }
}

// ---- render ----
const parts = []
parts.push(`<rect x="0" y="0" width="${SVG_W}" height="${SVG_H}" fill="#0b1220"/>`)
for (let e = Math.ceil(eMin / 2) * 2; e <= eMax; e += 2) {
  parts.push(`<line x1="${MARGIN_L - 30}" y1="${fmt(sy(e))}" x2="${SVG_W - 20}" y2="${fmt(sy(e))}" stroke="#16213a" stroke-width="1"/>`)
  parts.push(`<text x="10" y="${fmt(sy(e) + 3)}" fill="#475569" font-size="9">${e}</text>`)
}
// Current fill (verbatim engine output).
for (const r of d.regions ?? []) {
  if (!r.poly || r.poly.length < 3) continue
  const dstr = r.poly.map((p, i) => `${i === 0 ? 'M' : 'L'}${fmt(sx(p[0]))},${fmt(sy(p[1]))}`).join(' ') + ' Z'
  const c = color(r.litho)
  parts.push(`<path d="${dstr}" fill="${c}" fill-opacity="${r.kind === 'lens' ? 0.8 : 0.55}" stroke="${c}" stroke-width="0.6"/>`)
}
// Columns on top.
for (const c of cols) {
  const cx = sx(c.x)
  parts.push(`<text x="${fmt(cx)}" y="16" fill="#cbd5e1" font-size="9" text-anchor="middle" transform="rotate(-35 ${fmt(cx)} 16)">${c.shortId}</text>`)
  for (const u of c.units) {
    const yT = sy(u.topElev), yB = sy(u.baseElev)
    parts.push(`<rect x="${fmt(cx - 10)}" y="${fmt(yT)}" width="20" height="${fmt(Math.max(1, yB - yT))}" fill="${color(u.litho)}" stroke="#0f172a" stroke-width="0.6" opacity="0.95"/>`)
  }
}
// Badges.
for (const b of badges) {
  const bx = sx(b.x), by = sy(b.e)
  if (b.proposed === '?') {
    parts.push(`<circle cx="${fmt(bx)}" cy="${fmt(by)}" r="7" fill="#f59e0b" opacity="0.9"/><text x="${fmt(bx)}" y="${fmt(by + 3.5)}" fill="#0f172a" font-size="10" font-weight="bold" text-anchor="middle">?</text>`)
  } else if (b.now && b.proposed === b.now) {
    parts.push(`<circle cx="${fmt(bx)}" cy="${fmt(by)}" r="5.5" fill="#22c55e" opacity="0.85"/><text x="${fmt(bx)}" y="${fmt(by + 3)}" fill="#0f172a" font-size="8" font-weight="bold" text-anchor="middle">✓</text>`)
  } else {
    parts.push(`<circle cx="${fmt(bx)}" cy="${fmt(by)}" r="8" fill="none" stroke="#ef4444" stroke-width="2.4"/>`)
    parts.push(`<text x="${fmt(bx)}" y="${fmt(by - 11)}" fill="#ef4444" font-size="9.5" font-weight="bold" text-anchor="middle">${b.now ?? '∅'}→${b.proposed}</text>`)
  }
}
const svg = `<svg width="${SVG_W}" height="${SVG_H}" viewBox="0 0 ${SVG_W} ${SVG_H}" xmlns="http://www.w3.org/2000/svg" font-family="ui-sans-serif,system-ui">${parts.join('\n')}</svg>`

const rows = badges.map((b) => {
  const changed = b.proposed !== '?' && b.now !== b.proposed
  const cls = b.proposed === '?' ? 'amber' : changed ? 'red' : 'ok'
  return `<tr class="${cls}"><td>g${b.gi} ${b.side}</td><td>u${b.ui} ${b.litho} (corr ${b.corr})</td><td>${b.now ?? '—'}</td><td>${b.proposed}</td><td>${b.cause}</td></tr>`
}).join('\n')

const nChanged = badges.filter((b) => b.proposed !== '?' && b.now !== b.proposed).length
const nAmber = badges.filter((b) => b.proposed === '?').length
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<title>8o/8g rule preview — whole CS1</title>
<style>
 body{margin:0;background:#0f172a;color:#e2e8f0;font-family:ui-sans-serif,system-ui;padding:20px}
 h1{font-size:18px;margin:0 0 4px} .sub{color:#94a3b8;font-size:13px;max-width:1100px;line-height:1.5}
 .wrap{overflow-x:auto;border:1px solid #334155;border-radius:8px;margin-top:12px}
 table{border-collapse:collapse;font-size:12px;margin-top:14px}
 td,th{padding:3px 12px;border-bottom:1px solid #1e293b;text-align:left}
 tr.red td{color:#f87171} tr.amber td{color:#fbbf24} tr.ok td{color:#64748b}
 .leg{margin-top:8px;font-size:12px;color:#94a3b8}
</style></head><body>
<h1>Proposed 8o/8g label rule — evaluated on ALL of Cross-section 1 (current engine fill underneath)</h1>
<div class="sub">Every corr-0 / corr-1 termination wedge, sampled just past its apex. The rule (pending your
approval): the hole fills with the litho that CONTINUES ACROSS it — (a) the own-column enclosure whose faces
extend past the wedge (your 8g detour) takes priority; else (b) the facing corr-2 band flowing laterally.
<b style="color:#22c55e">✓ green</b> = the rule agrees with today's paint · <b style="color:#ef4444">red ring</b>
= the rule CHANGES the label (now→proposed) · <b style="color:#fbbf24">amber ?</b> = zero/multiple continuers
(would be logged for you, not guessed). Totals: ${nChanged} changed · ${nAmber} ask-first · ${badges.length - nChanged - nAmber} agree.</div>
<div class="wrap">${svg}</div>
<table><tr><th>where</th><th>terminating unit</th><th>painted today</th><th>rule says</th><th>via</th></tr>
${rows}</table>
</body></html>`
writeFileSync(resolve(HERE, 'owner_8o_preview.html'), html)
console.log(`wrote owner_8o_preview.html — ${badges.length} wedges: ${nChanged} changed, ${nAmber} ask-first, ${badges.length - nChanged - nAmber} agree`)
