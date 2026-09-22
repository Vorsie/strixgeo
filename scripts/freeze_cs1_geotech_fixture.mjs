// Freezes the CS1 geotech-refinement fixture (2026-07-06).
// (The geotech-brainstorm extractor it names below was an untracked one-off;
// re-derive that input from the dev DB if the fixture ever needs refreshing.)
//
// Combines scripts/throwaway_cs1_input.json (litho columns + edges + section
// order) + scripts/throwaway_geotech_brainstorm.json (geotech NAD sub-band
// columns + NAD formation metadata) + tests/fixtures/voxel/
// teststrix_partitions.json sections[12] (along_m) into ONE anonymised,
// committable fixture:
//   desktop/src/renderer/src/utils/__fixtures__/cs1_geotech_frozen.json
//
// Anonymisation (single shared pass so litho + geotech cross-reference):
//   investigationId → col-00.. (section along order preserved)
//   litho layerId   → lay-000..   geotech layerId → glay-000..
//   litho bodyId    → body-00..   geotech bodyId  → gbody-00.. (null stays null)
//   litho formationId → formation-sand / -clay / -silt / -peat
//   geotech formationId → nad-<soil>-<class> (readable, class preserved)
//   surfaceElevM + along_m offset so their minima are 0; depths unchanged.
//   Real test names + geo contacts + Lambert-72 coordinates are DROPPED.
//
// Run: node scripts/freeze_cs1_geotech_fixture.mjs   (from repo root)
import { readFileSync, writeFileSync } from 'node:fs'

const litho = JSON.parse(readFileSync('scripts/throwaway_cs1_input.json', 'utf8'))
const bs = JSON.parse(readFileSync('scripts/throwaway_geotech_brainstorm.json', 'utf8'))
const voxel = JSON.parse(readFileSync('tests/fixtures/voxel/teststrix_partitions.json', 'utf8'))

const LITHO_SOIL = {
  '019e940a-4b41-7e01-a763-ab030a38d1bc': 'ZAND',
  '019e940a-4b50-7f69-af85-2354e519bb43': 'KLEI',
  '019e940a-4b4e-7806-aa41-5831b60f2e06': 'SILT',
  '019e940a-4b52-7560-bc4d-93ca84512af4': 'VEEN',
}
const SOIL_NAME = { ZAND: 'sand', KLEI: 'clay', SILT: 'silt', VEEN: 'peat' }

const alongRaw = new Map()
for (const c of voxel.sections[12].columns) alongRaw.set(c.investigation_id, c.along_m)

// Section order: the litho input's `order` array (along-sorted investigation ids).
const order = litho.order.filter((id) => alongRaw.has(id))
const invMap = new Map(order.map((id, i) => [id, `col-${String(i).padStart(2, '0')}`]))

const counter = (prefix, pad) => {
  const m = new Map()
  return (id) => {
    if (id == null) return null
    if (!m.has(id)) m.set(id, `${prefix}${String(m.size).padStart(pad, '0')}`)
    return m.get(id)
  }
}
const lithoLayer = counter('lay-', 3)
const lithoBody = counter('body-', 2)
const geoLayer = counter('glay-', 3)
const geoBody = counter('gbody-', 2)

const lithoFormation = (fid) => {
  const soil = LITHO_SOIL[fid]
  if (!soil) throw new Error(`unknown litho formation ${fid}`)
  return `formation-${SOIL_NAME[soil]}`
}
const geoFormation = (fid) => {
  const m = bs.nadFormations[fid]
  if (!m) throw new Error(`unknown geotech formation ${fid}`)
  const soil = (m.soilCode ?? 'none').toLowerCase()
  return `nad-${soil}-${m.nadClass ?? 'none'}`
}

// Shared elevation offset across litho + geotech columns (same investigations).
const surfaces = [...litho.columns, ...bs.geotechColumns]
  .filter((c) => c.surfaceElevM != null && invMap.has(c.investigationId))
  .map((c) => c.surfaceElevM)
const elevOff = Math.min(...surfaces)
const alongOff = Math.min(...order.map((id) => alongRaw.get(id)))
const r3 = (v) => Math.round(v * 1000) / 1000

const byOrder = (cols) =>
  order
    .map((id) => cols.find((c) => c.investigationId === id))
    .filter((c) => c && c.surfaceElevM != null)

const columns = byOrder(litho.columns).map((c) => ({
  investigationId: invMap.get(c.investigationId),
  surfaceElevM: r3(c.surfaceElevM - elevOff),
  units: c.units.map((u) => ({
    topDepthM: u.topDepthM,
    baseDepthM: u.baseDepthM,
    formationId: lithoFormation(u.formationId),
    bodyId: lithoBody(u.bodyId),
    layerId: lithoLayer(u.layerId),
  })),
}))
const edges = litho.edges.map((e) => ({
  a: lithoLayer(e.a),
  b: lithoLayer(e.b),
  ...(e.aSide ? { aSide: e.aSide } : {}),
  ...(e.bSide ? { bSide: e.bSide } : {}),
}))
const geotechColumns = byOrder(bs.geotechColumns).map((c) => ({
  investigationId: invMap.get(c.investigationId),
  surfaceElevM: r3(c.surfaceElevM - elevOff),
  units: c.units.map((u) => ({
    layerId: geoLayer(u.layerId),
    topDepthM: u.topDepthM,
    baseDepthM: u.baseDepthM,
    formationId: geoFormation(u.formationId),
    bodyId: geoBody(u.bodyId),
  })),
}))
const nadFormations = {}
for (const [fid, m] of Object.entries(bs.nadFormations)) {
  nadFormations[geoFormation(fid)] = { nadClass: m.nadClass, soilCode: m.soilCode }
}
const lithoSoil = {}
for (const fid of Object.keys(LITHO_SOIL)) lithoSoil[lithoFormation(fid)] = LITHO_SOIL[fid]
const alongM = {}
for (const id of order) alongM[invMap.get(id)] = r3(alongRaw.get(id) - alongOff)

const out = {
  provenance:
    'CS1 of test.strix (litho model + geotech model), extracted 2026-07-06, anonymised. ' +
    'Regenerate: scripts/extract_cs1_partition_input.py + scripts/throwaway_geotech_brainstorm_extract.py ' +
    'against the dev DB, then node scripts/freeze_cs1_geotech_fixture.mjs.',
  alongM,
  columns,
  edges,
  geotechColumns,
  nadFormations,
  lithoSoil,
}
writeFileSync(
  'desktop/src/renderer/src/utils/__fixtures__/cs1_geotech_frozen.json',
  JSON.stringify(out, null, 1),
  'utf8',
)
console.log(
  `frozen: ${columns.length} litho cols / ${columns.reduce((s, c) => s + c.units.length, 0)} units / ` +
    `${edges.length} edges; ${geotechColumns.length} geotech cols / ` +
    `${geotechColumns.reduce((s, c) => s + c.units.length, 0)} sub-bands; ` +
    `${Object.keys(nadFormations).length} NAD formations`,
)
