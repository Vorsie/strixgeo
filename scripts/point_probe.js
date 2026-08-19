// THROWAWAY: which regions cover a point?  node scripts/point_probe.js <gap> <f> <elev>
const fs = require('fs')
const d = JSON.parse(fs.readFileSync('scripts/throwaway_section_dump.json', 'utf8'))
const nad = d.nadMeta
const nm = (id) => (nad[id] ? nad[id].soilCode + '-' + nad[id].nadClass : d.lithoSoil[id] ? 'L:' + d.lithoSoil[id] : id.slice(0, 8))
function inPoly(px, py, poly) {
  let wn = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length]
    const [ax, ay] = a, [bx, by] = b
    if (ay <= py) { if (by > py && (bx - ax) * (py - ay) - (px - ax) * (by - ay) > 0) wn++ }
    else if (by <= py && (bx - ax) * (py - ay) - (px - ax) * (by - ay) < 0) wn--
  }
  return wn !== 0
}
const [gap, f, e] = process.argv.slice(2).map(Number)
for (const [tag, arr] of [['LITHO', d.litho], ['HIER', d.clipped], ['FALLBACK', d.clippedFallback]]) {
  for (const r of arr) {
    if (r.gap !== gap) continue
    if (inPoly(f, e, r.pts)) console.log(tag, nm(r.formationId), r.pts.map(([a, b]) => `(${a.toFixed(2)},${b.toFixed(2)})`).join(''))
  }
}
