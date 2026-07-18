/**
 * gen_cs1_flip_html.mjs — THROWAWAY (2026-07-16, session-8 8h sweep revision).
 *
 * Reads scripts/diag_cs1_flip_walkthrough.json (produced by the CS1_FLIP diag test) and
 * writes scripts/cs1_flip_walkthrough.html: a fully STATIC, self-contained SVG walkthrough
 * of what the flipped partition engine v2 does on Cross-section 1, per ruling 8h.
 *
 * OWNER FIXES (2026-07-16) baked in:
 *   1. Three visually distinct TIE families — drawn-adjacent (solid red, filled dots);
 *      jump-bridge (solid red, HOLLOW dots + a double line so it reads "drawn, spans
 *      columns"); engine-DERIVED (dashed amber, ACTUALLY rendered from d.derivedTies).
 *   2. X-axis WARP with a minimum pixel width per gap (~140px) so cramped gaps stretch;
 *      wide gaps stay proportional. Each caption prints the TRUE gap width in metres.
 *   3. Captions live in a fixed side panel (one entry per gap), hover-linked to the gap
 *      region via CSS :target/:hover + an anchor. Phase layers get checkbox toggles that
 *      default to ① ON, ②③ OFF. Only circled numbers at apexes — no per-segment labels.
 *   4. Session-8 branch counters + the fixed-this-session gap notes surface in the panel.
 *
 * The HTML has NO innerHTML anywhere (a security hook blocks it): all markup is generated
 * HERE as a string and written to disk. The only dynamic behaviour is CSS-driven (checkbox
 * :checked siblings toggle layer visibility) — no runtime DOM building at all.
 *
 * Run (from repo root, Node 22):  node scripts/gen_cs1_flip_html.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
// Optional argv overrides so per-section renders coexist (owner asked for CS2, 2026-07-17):
//   node gen_cs1_flip_html.mjs [input.json] [output.html]
const IN = resolve(HERE, process.argv[2] ?? 'diag_cs1_flip_walkthrough.json')
const OUT = resolve(HERE, process.argv[3] ?? 'cs1_flip_walkthrough.html')

const d = JSON.parse(readFileSync(IN, 'utf8'))

// ---- Formation colours (owner spec) + fallback palette. ----
const LITHO_COLOR = {
  ZAND: '#eab308', SILT: '#a3e635', KLEI: '#94a3b8',
  VEEN: '#78350f', LEEM: '#d97706', GRIND: '#f97316',
}
const FALLBACK = ['#f472b6', '#22d3ee', '#c084fc', '#fb923c', '#4ade80']
const lithoColor = (litho) => LITHO_COLOR[litho] ?? FALLBACK[Math.abs(hash(litho)) % FALLBACK.length]
function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h }

// Phase colours.
const PHASE_COLOR = { 1: '#22c55e', 2: '#3b82f6', 3: '#a855f7' }
const PHASE_NAME = {
  1: '① 0-corr lens closings (drawn FIRST)',
  2: '② onlap contours riding ties (drawn SECOND)',
  3: '③ seams / floods / fill boundaries (drawn LAST)',
}

const cols = d.columns

// A derived tie whose physical contact ALREADY carries a drawn/bridge tie is redundant
// bookkeeping (ruling 8a: the drawn tie on a unit's top IS the tie on the neighbour's base —
// same surface). Rendering it as a second amber line duplicates the red line and misleads
// (owner caught this on col0's top ZAND). Keep amber ONLY for contacts no drawn edge touches:
// the ruling-8d top-band implicit ties and genuinely invisible derived contacts.
const EPS_ELEV = 0.005
const gapColX = {}
for (const g of Object.keys(d.gaps)) {
  const gi = Number(g)
  if (gi >= 0 && cols[gi] && cols[gi + 1]) gapColX[gi] = [cols[gi].x, cols[gi + 1].x]
}
function contactHasDrawnEdge(t) {
  const span = gapColX[t.gapIndex]
  if (!span) return false
  const srcX = t.side === 'left' ? span[0] : span[1]
  const srcElev = t.points?.[0]?.y
  if (srcElev === undefined) return false
  for (const e of d.edges) {
    const ends = [
      { col: e.aCol, elev: e.aElev },
      { col: e.bCol, elev: e.bElev },
    ]
    for (const end of ends) {
      const c = cols[end.col]
      if (!c) continue
      if (Math.abs(c.x - srcX) < 1e-6 && Math.abs(end.elev - srcElev) < EPS_ELEV) return true
    }
  }
  return false
}
const allDerived = d.derivedTies ?? []
const derivedTies = allDerived.filter((t) => !contactHasDrawnEdge(t))
const nDerivedSuppressed = allDerived.length - derivedTies.length

// ---- X-AXIS WARP (fix #2): a MINIMUM pixel width per gap. ----
// The real alongM span has many sub-2 m gaps (cols crowd at 96/100/101, 497/499/502, ...)
// that render as invisible slivers. Warp: each gap gets max(realMetres * PX_PER_M, MIN_GAP_PX).
// Narrow gaps STRETCH to the floor; wide gaps stay proportional. The warp is PRESENTATION ONLY —
// the true alongM stays in the dump, and every caption prints the true metre width so the warp
// misleads nobody. We build a monotone real-metres -> warped-px map and interpolate any x.
const MIN_GAP_PX = 140 // owner spec (~140px minimum per gap)
const PX_PER_M_X = 2.2 // proportional scale for wide gaps
const sortedCols = [...cols].sort((a, b) => a.x - b.x)
// warpX[colIndex-in-sorted] = cumulative warped px from the first column.
const warpCum = [0]
for (let i = 1; i < sortedCols.length; i++) {
  const realGap = sortedCols[i].x - sortedCols[i - 1].x
  const px = Math.max(MIN_GAP_PX, realGap * PX_PER_M_X)
  warpCum.push(warpCum[i - 1] + px)
}
// Map any real-metre x to warped px by locating the bracketing columns and lerping inside them.
function warpMetre(xm) {
  if (xm <= sortedCols[0].x) return warpCum[0]
  const last = sortedCols.length - 1
  if (xm >= sortedCols[last].x) return warpCum[last]
  for (let i = 1; i < sortedCols.length; i++) {
    if (xm <= sortedCols[i].x) {
      const x0 = sortedCols[i - 1].x, x1 = sortedCols[i].x
      const t = x1 - x0 < 1e-9 ? 0 : (xm - x0) / (x1 - x0)
      return warpCum[i - 1] + t * (warpCum[i] - warpCum[i - 1])
    }
  }
  return warpCum[last]
}
const WARP_TOTAL = warpCum[warpCum.length - 1]

// ---- Elevation transform. ----
const allElev = []
for (const c of cols) {
  allElev.push(c.surfaceElevM)
  for (const u of c.units) { allElev.push(u.topElev, u.baseElev) }
}
for (const s of d.synthesized) for (const p of s.points) allElev.push(p.y)
for (const g of d.given) for (const p of g.points) allElev.push(p.y)
for (const r of d.regions ?? []) for (const p of r.poly) allElev.push(p[1])
const elevMin = Math.floor(Math.min(...allElev)) - 1
const elevMax = Math.ceil(Math.max(...allElev)) + 1

// Layout.
const MARGIN_L = 90
const MARGIN_R = 40
const MARGIN_T = 78
const PLOT_H = 900
const PX_PER_M_ELEV = PLOT_H / (elevMax - elevMin)
const PLOT_W = WARP_TOTAL
const COL_W = 12 // px half-width of a column glyph rect

const sx = (xm) => MARGIN_L + warpMetre(xm)
const sy = (elev) => MARGIN_T + (elevMax - elev) * PX_PER_M_ELEV
const SVG_W = MARGIN_L + PLOT_W + MARGIN_R
const SVG_H = MARGIN_T + PLOT_H + 40 // gap-tick strip only (captions live in the side panel)

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const fmt = (n) => (Math.round(n * 100) / 100).toString()

// ---- SVG builders. ----
const parts = []

// Defs: arrowhead markers per phase.
parts.push('<defs>')
for (const ph of [1, 2, 3]) {
  parts.push(`<marker id="arw${ph}" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto" markerUnits="userSpaceOnUse">` +
    `<path d="M0,0 L7,3 L0,6 Z" fill="${PHASE_COLOR[ph]}"/></marker>`)
}
parts.push('</defs>')

// Elevation gridlines + labels every 2 m.
const grid = []
for (let e = Math.ceil(elevMin / 2) * 2; e <= elevMax; e += 2) {
  const y = sy(e)
  grid.push(`<line x1="${MARGIN_L}" y1="${fmt(y)}" x2="${MARGIN_L + PLOT_W}" y2="${fmt(y)}" stroke="#334155" stroke-width="1" stroke-dasharray="2,4"/>`)
  grid.push(`<text x="${MARGIN_L - 10}" y="${fmt(y + 4)}" fill="#64748b" font-size="11" text-anchor="end">${e} m</text>`)
}
parts.push(`<g class="grid">${grid.join('')}</g>`)

// Per-gap hover-highlight bands (fill appears only when the matching side-panel entry is hovered
// or targeted — driven by CSS below). Drawn FIRST so everything else sits on top.
const hoverG = []
for (let gi = 0; gi + 1 < cols.length; gi++) {
  const cL = cols.find((c) => c.index === gi)
  const cR = cols.find((c) => c.index === gi + 1)
  if (!cL || !cR) continue
  const x1 = sx(cL.x), x2 = sx(cR.x)
  hoverG.push(`<rect id="gapband${gi}" class="gapband" x="${fmt(x1)}" y="${MARGIN_T}" width="${fmt(x2 - x1)}" height="${PLOT_H}" fill="#38bdf8" fill-opacity="0"/>`)
}
parts.push(`<g class="gapbands">${hoverG.join('')}</g>`)

// ---- REGION FILL — the ACTUAL partition output (owner ask 2026-07-18: paint the polygons,
// not just the line art). Drawn UNDER the column glyphs + ties so the line structure stays
// readable on top. Each region is stroked with its OWN fill colour (the app's anti-hairline
// fix) so adjacent fills don't show antialiasing seams. Toggle: "fill" (default ON).
const fillG = []
for (const r of d.regions ?? []) {
  if (!r.poly || r.poly.length < 3) continue
  const dstr = r.poly.map((p, i) => `${i === 0 ? 'M' : 'L'}${fmt(sx(p[0]))},${fmt(sy(p[1]))}`).join(' ') + ' Z'
  const col = lithoColor(r.litho)
  fillG.push(`<path d="${dstr}" fill="${col}" fill-opacity="0.55" stroke="${col}" stroke-width="0.8"><title>${esc(r.litho)} (${esc(r.kind)}) g${r.gapIndex}</title></path>`)
}
parts.push(`<g class="layer-fill">${fillG.join('')}</g>`)

// Litho column glyphs (stacked rects at true elevation) + names above.
const colG = []
for (const c of cols) {
  const cx = sx(c.x)
  colG.push(`<text x="${fmt(cx)}" y="${MARGIN_T - 50}" fill="#e2e8f0" font-size="10" text-anchor="middle" transform="rotate(-30 ${fmt(cx)} ${MARGIN_T - 50})">${esc(c.shortId)}</text>`)
  colG.push(`<text x="${fmt(cx)}" y="${MARGIN_T - 14}" fill="#475569" font-size="9" text-anchor="middle">x=${fmt(c.x)}</text>`)
  for (const u of c.units) {
    const yTop = sy(u.topElev)
    const yBase = sy(u.baseElev)
    const h = Math.max(1, yBase - yTop)
    const col = lithoColor(u.litho)
    colG.push(`<rect x="${fmt(cx - COL_W)}" y="${fmt(yTop)}" width="${COL_W * 2}" height="${fmt(h)}" fill="${col}" stroke="#0f172a" stroke-width="0.5" opacity="0.92"/>`)
    if (h > 12) {
      const tc = ['ZAND', 'SILT', 'LEEM', 'GRIND'].includes(u.litho) ? '#1e293b' : '#f1f5f9'
      colG.push(`<text x="${fmt(cx)}" y="${fmt(yTop + h / 2 + 3)}" fill="${tc}" font-size="8" text-anchor="middle">${esc(u.litho)}</text>`)
    }
  }
  // Enclosed-lens interbeds (thin units INSIDE a matrix unit — a separate field on the
  // column, not part of the stacked units, so v1/v2 of this render silently omitted them;
  // the owner's column-1 lens cluster anchored to invisible geometry). Drawn as inset
  // rects with a dashed outline so they read as "inside the matrix".
  for (const l of c.enclosedLenses ?? []) {
    const yTop = sy(l.topElev)
    const h = Math.max(1.5, sy(l.baseElev) - yTop)
    colG.push(`<rect x="${fmt(cx - COL_W)}" y="${fmt(yTop)}" width="${COL_W * 2}" height="${fmt(h)}" fill="${lithoColor(l.litho)}" stroke="#0f172a" stroke-width="0.8" stroke-dasharray="3 2" opacity="0.95"/>`)
    if (h > 10) {
      const tc = ['ZAND', 'SILT', 'LEEM', 'GRIND'].includes(l.litho) ? '#1e293b' : '#f1f5f9'
      colG.push(`<text x="${fmt(cx)}" y="${fmt(yTop + h / 2 + 3)}" fill="${tc}" font-size="7" text-anchor="middle">${esc(l.litho)}</text>`)
    }
  }
}
parts.push(`<g class="cols">${colG.join('')}</g>`)

// ---- TIE FAMILY (a): DRAWN ADJACENT ties — solid red, FILLED endpoint dots. ----
const tieG = []
for (const e of d.edges) {
  if (e.kind !== 'drawn-tie' || e.aCol == null || e.bCol == null) continue
  const cA = cols.find((c) => c.index === e.aCol)
  const cB = cols.find((c) => c.index === e.bCol)
  if (!cA || !cB) continue
  const x1 = sx(cA.x), y1 = sy(e.aElev)
  const x2 = sx(cB.x), y2 = sy(e.bElev)
  tieG.push(`<line x1="${fmt(x1)}" y1="${fmt(y1)}" x2="${fmt(x2)}" y2="${fmt(y2)}" stroke="#ef4444" stroke-width="1.6" opacity="0.92"/>`)
  tieG.push(`<circle cx="${fmt(x1)}" cy="${fmt(y1)}" r="2.6" fill="#ef4444"/><circle cx="${fmt(x2)}" cy="${fmt(y2)}" r="2.6" fill="#ef4444"/>`)
}
parts.push(`<g class="layer-ties">${tieG.join('')}</g>`)

// ---- TIE FAMILY (b): JUMP BRIDGES — solid red DOUBLE line, HOLLOW endpoint dots. ----
// A drawn edge between NON-adjacent columns: it spans OVER intermediate column(s). The double
// offset line + hollow dots make it read "drawn by you, but jumps over columns".
const jumpG = []
for (const e of d.edges) {
  if (e.kind !== 'jump-bridge' || e.aCol == null || e.bCol == null) continue
  const cA = cols.find((c) => c.index === e.aCol)
  const cB = cols.find((c) => c.index === e.bCol)
  if (!cA || !cB) continue
  const x1 = sx(cA.x), y1 = sy(e.aElev)
  const x2 = sx(cB.x), y2 = sy(e.bElev)
  // Double line: the main stroke + a thin parallel offset (2px normal) so it reads as "spanning".
  const dx = x2 - x1, dy = y2 - y1
  const len = Math.hypot(dx, dy) || 1
  const nx = (-dy / len) * 2, ny = (dx / len) * 2
  jumpG.push(`<line x1="${fmt(x1)}" y1="${fmt(y1)}" x2="${fmt(x2)}" y2="${fmt(y2)}" stroke="#ef4444" stroke-width="1.6" opacity="0.92"/>`)
  jumpG.push(`<line x1="${fmt(x1 + nx)}" y1="${fmt(y1 + ny)}" x2="${fmt(x2 + nx)}" y2="${fmt(y2 + ny)}" stroke="#ef4444" stroke-width="0.9" opacity="0.7"/>`)
  jumpG.push(`<circle cx="${fmt(x1)}" cy="${fmt(y1)}" r="3.2" fill="#1e293b" stroke="#ef4444" stroke-width="1.4"/>` +
    `<circle cx="${fmt(x2)}" cy="${fmt(y2)}" r="3.2" fill="#1e293b" stroke="#ef4444" stroke-width="1.4"/>`)
}
parts.push(`<g class="layer-bridges">${jumpG.join('')}</g>`)

// ---- TIE FAMILY (c): ENGINE-DERIVED ties — dashed AMBER, ACTUALLY rendered this time. ----
// Sourced from d.derivedTies (ruling-8a shared-contact + §4-inc-2 derived base + ruling-8d top
// band), each a dashed-amber line at the tied contact. Small hollow amber diamonds mark the ends.
const derG = []
for (const t of derivedTies) {
  const pts = t.points
  if (!pts || pts.length < 2) continue
  const x1 = sx(pts[0].x), y1 = sy(pts[0].y)
  const x2 = sx(pts[1].x), y2 = sy(pts[1].y)
  derG.push(`<line x1="${fmt(x1)}" y1="${fmt(y1)}" x2="${fmt(x2)}" y2="${fmt(y2)}" stroke="#f59e0b" stroke-width="1.3" stroke-dasharray="6,4" opacity="0.85"/>`)
}
parts.push(`<g class="layer-derived">${derG.join('')}</g>`)

// Top-band surface curves (the given "line art" top band) = dashed amber, thinner.
const surfG = []
for (const g of d.given) {
  if (!g.id.startsWith('surface:')) continue
  surfG.push(polyline(g.points, '#f59e0b', 0.9, '3,4'))
}
parts.push(`<g class="layer-surface">${surfG.join('')}</g>`)

// SYNTHESIZED curves per phase. Phases ① and ② render AS GENERATED TIES (owner directive
// 2026-07-16: "draw them as ties on the render" — the lens closures and onlap contours ARE
// the imaginary correlation ties of rulings 8g/8h, so they get tie visual language: solid
// tie-weight lines with endpoint dots, no arrowheads). Phase ③ (fill scaffold) keeps the
// thin arrowed style — it is the flood boundary, not a tie.
for (const ph of [1, 2, 3]) {
  const g = []
  const phaseCurves = d.synthesized.filter((s) => s.phase === ph && !s.id.startsWith('bridge'))
  for (const s of phaseCurves) {
    if (ph === 3) {
      g.push(polyline(s.points, PHASE_COLOR[ph], 1.1, null, `url(#arw${ph})`))
      continue
    }
    // Generated tie: tie-weight solid line + endpoint dots at BOTH real endpoints.
    g.push(polyline(s.points, PHASE_COLOR[ph], 2.4, null, null))
    const p0 = s.points[0], pn = s.points[s.points.length - 1]
    for (const p of [p0, pn]) {
      g.push(`<circle cx="${fmt(sx(p.x))}" cy="${fmt(sy(p.y))}" r="3.2" fill="${PHASE_COLOR[ph]}"/>`)
    }
  }
  // Circled phase marker at each generated tie's apex (the far-reach point) for ① and ② only.
  if (ph !== 3) {
    for (const s of phaseCurves) {
      const apex = apexPoint(s.points)
      g.push(`<circle cx="${fmt(sx(apex.x))}" cy="${fmt(sy(apex.y))}" r="7" fill="${PHASE_COLOR[ph]}" opacity="0.95"/>` +
        `<text x="${fmt(sx(apex.x))}" y="${fmt(sy(apex.y) + 3.5)}" fill="#0f172a" font-size="10" font-weight="bold" text-anchor="middle">${ph}</text>`)
    }
  }
  parts.push(`<g class="layer-phase${ph}">${g.join('')}</g>`)
}

// Gap ticks + g-labels along the bottom (the ONLY on-plot gap annotation; captions moved out).
const tickG = []
for (let gi = 0; gi + 1 < cols.length; gi++) {
  const cL = cols.find((c) => c.index === gi)
  const cR = cols.find((c) => c.index === gi + 1)
  if (!cL || !cR) continue
  const midX = (sx(cL.x) + sx(cR.x)) / 2
  const warn = d.knownResidualGaps[gi]
  const fixed = d.fixedThisSession && d.fixedThisSession[gi]
  const color = warn ? '#f87171' : fixed ? '#34d399' : '#94a3b8'
  tickG.push(`<line x1="${fmt(midX)}" y1="${MARGIN_T + PLOT_H}" x2="${fmt(midX)}" y2="${MARGIN_T + PLOT_H + 8}" stroke="#64748b" stroke-width="1"/>`)
  tickG.push(`<text x="${fmt(midX)}" y="${MARGIN_T + PLOT_H + 20}" fill="${color}" font-size="9" text-anchor="middle">g${gi}${warn ? ' ⚠' : fixed ? ' ✓' : ''}</text>`)
}
parts.push(`<g class="ticks">${tickG.join('')}</g>`)

function polyline(pts, color, w, dash, marker) {
  const dstr = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${fmt(sx(p.x))},${fmt(sy(p.y))}`).join(' ')
  const da = dash ? ` stroke-dasharray="${dash}"` : ''
  const mk = marker ? ` marker-end="${marker}"` : ''
  return `<path d="${dstr}" fill="none" stroke="${color}" stroke-width="${w}" opacity="0.9"${da}${mk}/>`
}
function apexPoint(pts) {
  let best = pts[pts.length - 1], bd = -1
  for (const p of pts) { const dd = Math.abs(p.x - pts[0].x); if (dd > bd) { bd = dd; best = p } }
  return best
}

const svg = `<svg id="plot" width="${SVG_W}" height="${SVG_H}" viewBox="0 0 ${SVG_W} ${SVG_H}" xmlns="http://www.w3.org/2000/svg" font-family="ui-sans-serif,system-ui,sans-serif">
<rect x="0" y="0" width="${SVG_W}" height="${SVG_H}" fill="#1e293b"/>
${parts.join('\n')}
</svg>`

// ---- Side panel: one caption entry per gap (fix #3). Hover-links to the gap band via CSS. ----
const gapKeys = Object.keys(d.gaps).map(Number).filter((k) => k >= 0).sort((a, b) => a - b)
const derivedByGap = {}
for (const t of derivedTies) derivedByGap[t.gapIndex] = (derivedByGap[t.gapIndex] ?? 0) + 1
const panelRows = []
for (const gi of gapKeys) {
  const g = d.gaps[gi]
  const cL = cols.find((c) => c.index === gi)
  const cR = cols.find((c) => c.index === gi + 1)
  if (!cL || !cR) continue
  const warn = d.knownResidualGaps[gi]
  const fixed = d.fixedThisSession && d.fixedThisSession[gi]
  const nDer = derivedByGap[gi] ?? 0
  const cls = warn ? 'gaprow warn' : fixed ? 'gaprow fixed' : 'gaprow'
  const wtxt = g.trueWidthM != null ? `${fmt(g.trueWidthM)} m` : '—'
  const flag = warn ? ` <span class="wflag">⚠ ${esc(warn)}</span>` : fixed ? ` <span class="fflag">✓ ${esc(fixed)}</span>` : ''
  const derTxt = nDer > 0 ? ` · ${nDer} derived-tie${nDer > 1 ? 's' : ''}` : ''
  // Anchor link → :target lights the gap band across the plot subtree (CSS-only, no JS/DOM build).
  panelRows.push(
    `<a class="${cls}" href="#gapband${gi}" data-gap="${gi}">` +
    `<span class="gaphead"><span class="gnum">g${gi}</span> <span class="gcols">${esc(cL.shortId)}↔${esc(cR.shortId)}</span> ` +
    `<span class="gwidth">true width ${wtxt}</span></span>` +
    `<span class="gcase">${esc(g.caption)}${derTxt}</span>${flag}</a>`,
  )
}

// ---- Legend + ruling text. ----
const legendRows = [
  ['<span style="color:#ef4444">━●</span> Drawn tie', 'adjacent correlation edge you drew (solid red, FILLED dots)'],
  ['<span style="color:#ef4444">═◦</span> Jump bridge', 'drawn by you — SPANS over intermediate column(s) (double line, HOLLOW dots)'],
  ['<span style="color:#f59e0b">╌◇</span> Derived tie', 'engine-DERIVED (ruling-8a shared contact + top-band implicit) — dashed amber'],
  [`<span style="color:${PHASE_COLOR[1]}">●━①━●</span> Generated tie ①`, 'lens closure for a 0-corr unit-side (an imaginary correlation tie the engine generates — closes the loop)'],
  [`<span style="color:${PHASE_COLOR[2]}">●━②━●</span> Generated tie ②`, 'onlap contour for a 1-corr unit-side, riding its drawn tie (also a generated correlation tie — closes the loop)'],
  [`<span style="color:${PHASE_COLOR[3]}">━▶③</span> Phase 3`, PHASE_NAME[3]],
  ['<span style="color:#f87171">⚠</span> / <span style="color:#34d399">✓</span>', 'known residual violation / newly fixed by the 8h sweep this session'],
]
const lithoLegend = Object.entries(LITHO_COLOR)
  .map(([k, v]) => `<span style="display:inline-block;margin-right:12px"><span style="display:inline-block;width:14px;height:14px;background:${v};vertical-align:middle;border:1px solid #0f172a"></span> ${k}</span>`)
  .join('')

const ruling = `“Phase 1: 0-corr on the left → lens left. Phase 2: 0-corr on the right → lens right. Phases 3–4: the same for 1-corr onlaps (left then right). Phases 5–6: the outer columns close every body's loop at the frame. Then fill little-to-big — never overwrite a small fill with an encompassing body's.” — owner ruling 8h (six-phase bidirectional sweep, session 8)`

const branch = d.branchSummary?.coherent ?? {}
const branchStr = Object.entries(branch).map(([k, v]) => `${k}: ${v}`).join(' · ')
const tilegap = d.branchSummary?.tilegap ?? {}
const tilegapStr = Object.entries(tilegap).map(([k, v]) => `${k}: ${v}`).join(' · ')

const nDrawn = d.edges.filter((e) => e.kind === 'drawn-tie').length
const nBridge = d.edges.filter((e) => e.kind === 'jump-bridge').length

// Per-gap highlight CSS (fixed count — no runtime DOM building). Clicking a panel row anchors
// to #gapbandN → :target lights that band across the plot subtree (CSS :target works anywhere,
// unlike ~/+ which cannot cross from the panel into the plot). Hover tints the panel row itself.
const gapHoverCss = gapKeys.map((gi) =>
  `#gapband${gi}:target{fill-opacity:.16}`,
).join('\n')

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>CS1 — Partition engine v2 FLIP walkthrough (ruling 8h, session 8)</title>
<style>
  body { margin:0; background:#0f172a; color:#e2e8f0; font-family:ui-sans-serif,system-ui,sans-serif; }
  header { padding:16px 24px; border-bottom:1px solid #334155; }
  h1 { margin:0 0 4px; font-size:18px; }
  .sub { color:#94a3b8; font-size:13px; }
  .layout { display:flex; align-items:flex-start; }
  .panel { flex:0 0 340px; max-width:340px; position:sticky; top:0; align-self:flex-start;
           max-height:100vh; overflow-y:auto; padding:12px 14px; border-right:1px solid #334155;
           background:#111c30; }
  .panel h2 { font-size:13px; margin:4px 0 10px; color:#cbd5e1; }
  .gaprow { display:block; text-decoration:none; padding:7px 9px; margin-bottom:6px;
            border-radius:6px; background:#1e293b; border-left:3px solid #475569;
            cursor:pointer; font-size:11.5px; line-height:1.45; color:inherit; }
  .gaprow:hover { background:#243044; border-left-color:#38bdf8; }
  .gaprow.warn { border-left-color:#f87171; }
  .gaprow.fixed { border-left-color:#34d399; }
  .gaphead { display:block; margin-bottom:2px; }
  .gnum { font-weight:bold; color:#e2e8f0; }
  .gcols { color:#93c5fd; }
  .gwidth { color:#64748b; float:right; font-size:10.5px; }
  .gcase { color:#cbd5e1; }
  .wflag { display:block; margin-top:3px; color:#f87171; font-size:10.5px; }
  .fflag { display:block; margin-top:3px; color:#34d399; font-size:10.5px; }
  .plotwrap { flex:1 1 auto; overflow-x:auto; padding:12px 0; min-width:0; }
  .toggle { position:absolute; opacity:0; width:0; height:0; pointer-events:none; }
  .chk { padding:8px 24px; font-size:12px; color:#94a3b8; border-bottom:1px solid #334155; }
  .chk label { margin-right:12px; cursor:pointer; user-select:none; padding:2px 8px;
               border:1px solid #334155; border-radius:5px; display:inline-block; }
  /* Highlight a label whose checkbox is checked (checkbox precedes .chk in the sibling order). */
  #t1:checked ~ .chk label[for="t1"], #t2:checked ~ .chk label[for="t2"],
  #t3:checked ~ .chk label[for="t3"], #tt:checked ~ .chk label[for="tt"],
  #tb:checked ~ .chk label[for="tb"], #td:checked ~ .chk label[for="td"],
  #tf:checked ~ .chk label[for="tf"] {
    background:#1e3a5f; border-color:#38bdf8; color:#e2e8f0;
  }
  .legend { padding:14px 24px; border-top:1px solid #334155; font-size:12px; line-height:1.9; }
  .legend b { color:#cbd5e1; }
  .ruling { padding:14px 24px; color:#cbd5e1; font-size:12.5px; font-style:italic; border-top:1px solid #334155; max-width:1100px; }
  table.leg { border-collapse:collapse; }
  table.leg td { padding:2px 12px 2px 0; vertical-align:top; }
  code { color:#7dd3fc; }
  /* Phase-layer toggles: pure CSS checkbox-sibling. Checkboxes live BEFORE the .layout so the
     general-sibling combinator can reach the SVG layer groups. Default: ① on, ②③ off. */
  #t1:not(:checked) ~ .layout .layer-phase1 { display:none; }
  #t2:not(:checked) ~ .layout .layer-phase2 { display:none; }
  #t3:not(:checked) ~ .layout .layer-phase3 { display:none; }
  #tt:not(:checked) ~ .layout .layer-ties { display:none; }
  #tb:not(:checked) ~ .layout .layer-bridges { display:none; }
  #td:not(:checked) ~ .layout .layer-derived { display:none; }
  #tf:not(:checked) ~ .layout .layer-fill { display:none; }
  .gapband { transition: fill-opacity .1s; }
${gapHoverCss}
</style>
</head>
<body>
<header>
  <h1>Cross-section 1 — partition engine v2 FLIP (session-8 ruling-8h six-phase sweep)</h1>
  <div class="sub">${esc(d.nColumns)} columns · real alongM ${esc(d.alongMRange[0])}–${esc(d.alongMRange[1])} m · x-axis WARPED (min ${MIN_GAP_PX}px/gap, true widths in the side panel) · flip: <code>setTwoSidedTerminations(true)</code></div>
  <div class="sub">ties: ${nDrawn} drawn-adjacent · ${nBridge} jump-bridge · ${derivedTies.length} engine-derived shown (${nDerivedSuppressed} suppressed — same contact as a drawn tie, ruling 8a) · coherent-stack branch: ${esc(branchStr)}</div>
</header>
<!-- Phase-toggle checkboxes: bare inputs that are DIRECT siblings of .layout, so the CSS ~
     combinator reaches the SVG layer groups. The visible labels below use for= to drive them.
     Default: ① on, ②③ off; all three tie families on. -->
<input type="checkbox" id="t1" class="toggle" checked>
<input type="checkbox" id="t2" class="toggle">
<input type="checkbox" id="t3" class="toggle">
<input type="checkbox" id="tt" class="toggle" checked>
<input type="checkbox" id="tb" class="toggle" checked>
<input type="checkbox" id="td" class="toggle" checked>
<input type="checkbox" id="tf" class="toggle" checked>
<div class="chk">
  Toggle layers:
  <label for="tf">FILL (region polygons)</label>
  <label for="t1">① lenses</label>
  <label for="t2">② onlaps</label>
  <label for="t3">③ fill</label>
  <label for="tt">drawn ties</label>
  <label for="tb">jump bridges</label>
  <label for="td">derived ties</label>
</div>
<div class="layout">
  <aside class="panel">
    <h2>Per-gap cases (click a row to highlight its gap band)</h2>
    ${panelRows.join('\n    ')}
  </aside>
  <div class="plotwrap">
${svg}
  </div>
</div>
<div class="ruling">${esc(ruling)}</div>
<div class="legend">
  <b>Lithology:</b><br>${lithoLegend}<br><br>
  <table class="leg">
    ${legendRows.map(([a, b]) => `<tr><td><b>${a}</b></td><td>${b}</td></tr>`).join('')}
  </table>
  <p style="color:#64748b;margin-top:12px">Arrowheads show each synthesized boundary's walk direction. Circled ①/② markers sit at the pinch apex. Phase 3 (③) is the closed-shape fill scaffold, drawn LAST. Default view shows phase ① only — tick ②/③ to layer them on. Branch tilegap counters: ${esc(tilegapStr)}.</p>
</div>
</body>
</html>`

writeFileSync(OUT, html)
console.log(`wrote ${OUT} (${(html.length / 1024).toFixed(1)} KB)`)
console.log(`  warp: ${MIN_GAP_PX}px min/gap, ${PX_PER_M_X}px/m proportional → plot ${Math.round(PLOT_W)}px wide`)
console.log(`  ties rendered: ${nDrawn} drawn · ${nBridge} bridge · ${derivedTies.length} derived (amber)`)
