const fs = require('fs')
const d = JSON.parse(fs.readFileSync('scripts/throwaway_section_dump.json','utf8'))
const inv = JSON.parse(fs.readFileSync('scripts/throwaway_geotech_axis_inputs.json','utf8'))
const cs1 = inv.sections.find(s=>s.name==='Cross-section 1')
const nad = d.nadMeta
const nm = (id)=> nad[id] ? (nad[id].soilCode+'-'+nad[id].nadClass) : (d.lithoSoil[id] ? 'L:'+d.lithoSoil[id] : id.slice(0,8))
const G = cs1.geotech, L = cs1
const gaps = process.argv.slice(2).map(Number)
const out = []
const stack = (arm, ci, tag) => {
  const c = arm.columns[ci]
  out.push(`  ${tag} col${ci} surf=${c.surfaceElevM}:`)
  for (const u of [...c.units].sort((a,b)=>a.topDepthM-b.topDepthM))
    out.push(`    ${nm(u.formationId)} ${(c.surfaceElevM-u.topDepthM).toFixed(2)}..${(c.surfaceElevM-u.baseDepthM).toFixed(2)} [${u.layerId.slice(-6)}]`)
}
const ties = (arm, lo, hi, tag) => {
  const colOf = new Map()
  arm.columns.forEach((c,i)=>c.units.forEach(u=>colOf.set(u.layerId,i)))
  const elevOf = (lid, side) => {
    for (const c of arm.columns) for (const u of c.units) if (u.layerId===lid)
      return (c.surfaceElevM - (side==='top'?u.topDepthM:u.baseDepthM)).toFixed(2)
    return '?'
  }
  out.push(`  ${tag} ties:`)
  for (const e of arm.edges) {
    const ca = colOf.get(e.a), cb = colOf.get(e.b)
    if (ca===undefined||cb===undefined) continue
    const g0 = Math.min(ca,cb), g1 = Math.max(ca,cb)
    if (g1-g0<1 || g0>hi || g1<=lo) continue
    if (g0>=lo && g0<=hi)
      out.push(`    col${ca}[${e.a.slice(-6)}](${e.aSide??'top'}@${elevOf(e.a,e.aSide??'top')}) <-> col${cb}[${e.b.slice(-6)}](${e.bSide??'top'}@${elevOf(e.b,e.bSide??'top')})${g1-g0>1?' JUMP':''}`)
  }
}
for (const gap of gaps) {
  out.push(`=========== GAP ${gap} ===========`)
  stack(G, gap, 'GEO'); stack(G, gap+1, 'GEO')
  stack(L, gap, 'LITHO'); stack(L, gap+1, 'LITHO')
  ties(G, gap, gap, 'GEO'); ties(L, gap, gap, 'LITHO')
  out.push('  HIER regions:')
  for (const r of d.clipped.filter(r=>r.gap===gap))
    out.push(`    ${nm(r.formationId)} ${r.kind} ${r.pts.map(([f,e])=>'('+f.toFixed(2)+','+e.toFixed(2)+')').join('')}`)
  out.push('  HIER fallback:')
  for (const r of d.clippedFallback.filter(r=>r.gap===gap))
    out.push(`    ${nm(r.formationId)} ${r.pts.map(([f,e])=>'('+f.toFixed(2)+','+e.toFixed(2)+')').join('')}`)
  out.push('  LITHO regions:')
  for (const r of d.litho.filter(r=>r.gap===gap))
    out.push(`    ${nm(r.formationId)} ${r.kind} ${r.pts.map(([f,e])=>'('+f.toFixed(2)+','+e.toFixed(2)+')').join('')}`)
}
fs.writeFileSync(process.env.OUT ?? 'scripts/throwaway_scene_probe.txt', out.join('\n'))
console.log('wrote', out.length, 'lines')
