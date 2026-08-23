/**
 * Extract the committed, anonymised Cross-section 1 slice the CS1 GOLDEN
 * MASTER gate runs on (`desktop/src/renderer/src/utils/__fixtures__/
 * cs1_golden_input.json`).
 *
 * Why a NEW fixture rather than reusing ``cs1_geotech_frozen.json``: that one
 * was anonymised on 2026-07-06 and carries NO geotech edges, and the geotech
 * ties are exactly what drives the packing fill. Its ``glay-*`` ids also no
 * longer map onto the model, which has been re-subdivided many times since.
 * The two old fixtures stay untouched — ``partitionFill.cs1frozen.test.ts``
 * and ``partitionFill.oneGesture.cs1.test.ts`` still assert on them.
 *
 * ANONYMISATION (ids only — geometry is kept verbatim):
 *   investigationId  -> col-00 … col-NN     (ascending along-section)
 *   litho layerId    -> lay-000 …           (column order, then depth)
 *   geotech layerId  -> glay-000 …          (ditto)
 *   litho formation  -> formation-<soil>    (readable: formation-sand, …)
 *   geotech formation-> nad-<soil>-<class>  (readable: nad-silt-14, …)
 *   bodyId           -> body-NN / gbody-NN  (null stays null)
 *
 * Elevations, depths and along-positions are kept VERBATIM and unshifted, on
 * purpose: a golden-master failure has to be legible against what the owner
 * sees on screen ("the SILT-14 quad in gap 13 at −5.27") without decoding an
 * offset. The identifying information is the investigation names, and those
 * are gone.
 *
 * Regenerate the INPUT (only when the fixture must be re-cut from a newer
 * model — this replaces the frozen scene, so re-freeze the golden after):
 *   uv run python scripts/dump_geotech_axis_inputs.py
 *   node scripts/extract_cs1_golden_fixture.mjs
 *   cd desktop && CS1_GOLDEN_FREEZE=1 npx vitest run src/renderer/src/utils/cs1GoldenMaster.test.tsx
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const SRC = resolve(REPO, 'scripts/throwaway_geotech_axis_inputs.json')
const OUT = resolve(REPO, 'desktop/src/renderer/src/utils/__fixtures__/cs1_golden_input.json')
const SECTION = 'Cross-section 1'

const SOIL_WORD = { ZAND: 'sand', KLEI: 'clay', SILT: 'silt', VEEN: 'peat', GRIND: 'gravel' }

const raw = JSON.parse(readFileSync(SRC, 'utf8'))
const section = raw.sections.find((s) => s.name === SECTION)
if (!section) throw new Error(`${SECTION} not in the dump — re-run dump_geotech_axis_inputs.py`)

const nadMeta = raw.refinementBundle.nadMeta ?? {}
const lithoSoilByFormationId = raw.refinementBundle.lithoSoilByFormationId ?? {}

/** The engine's own column filter + order (mirrors every consumer). */
function ordered(arm) {
  return arm.columns
    .map((c, i) => ({ c, along: arm.alongM[i] }))
    .filter(({ c }) => c.surfaceElevM != null && c.units.length > 0)
    .sort((p, q) => p.along - q.along)
}

const lithoOrdered = ordered(section)
const geoOrdered = ordered(section.geotech)

// ---- id maps -------------------------------------------------------------
const colOf = new Map()
lithoOrdered.forEach(({ c }, i) => colOf.set(c.investigationId, `col-${String(i).padStart(2, '0')}`))
// A geotech-only column (rare) still needs a stable name.
geoOrdered.forEach(({ c }) => {
  if (!colOf.has(c.investigationId)) colOf.set(c.investigationId, `col-x${colOf.size}`)
})

const lithoFormOf = new Map()
const geoFormOf = new Map()
const layerOf = new Map()
const glayerOf = new Map()
const bodyOf = new Map()
const gbodyOf = new Map()

const nameFormation = (fid) => {
  if (lithoFormOf.has(fid)) return lithoFormOf.get(fid)
  const soil = lithoSoilByFormationId[fid]
  const word = SOIL_WORD[soil] ?? (soil ? String(soil).toLowerCase() : 'unknown')
  // Several litho formations can share a soil; keep them distinct but readable.
  let name = `formation-${word}`
  let n = 1
  while ([...lithoFormOf.values()].includes(name)) name = `formation-${word}-${++n}`
  lithoFormOf.set(fid, name)
  return name
}

const nameNad = (fid) => {
  if (geoFormOf.has(fid)) return geoFormOf.get(fid)
  const meta = nadMeta[fid]
  const soil = meta?.soilCode ? String(meta.soilCode).toLowerCase() : 'unknown'
  const cls = meta?.nadClass ?? 'none'
  let name = `nad-${soil}-${cls}`
  let n = 1
  // Two ROWS of one class exist by design (provenance per litho/geo parent) —
  // they must stay DISTINCT here, or the fixture would erase the very thing
  // the render's class-keyed dissolve is about.
  while ([...geoFormOf.values()].includes(name)) name = `nad-${soil}-${cls}#${++n}`
  geoFormOf.set(fid, name)
  return name
}

const idIn = (map, key, prefix, width) => {
  if (key == null) return null
  if (!map.has(key)) map.set(key, `${prefix}${String(map.size).padStart(width, '0')}`)
  return map.get(key)
}

// ---- build ---------------------------------------------------------------
function buildColumns(list, { geotech }) {
  return list.map(({ c }) => ({
    investigationId: colOf.get(c.investigationId),
    surfaceElevM: c.surfaceElevM,
    units: [...c.units]
      .sort((a, b) => a.topDepthM - b.topDepthM)
      .map((u) => ({
        layerId: idIn(geotech ? glayerOf : layerOf, u.layerId, geotech ? 'glay-' : 'lay-', 3),
        topDepthM: u.topDepthM,
        baseDepthM: u.baseDepthM,
        formationId: geotech ? nameNad(u.formationId) : nameFormation(u.formationId),
        bodyId: idIn(geotech ? gbodyOf : bodyOf, u.bodyId, geotech ? 'gbody-' : 'body-', 2),
      })),
  }))
}

const columns = buildColumns(lithoOrdered, { geotech: false })
const geotechColumns = buildColumns(geoOrdered, { geotech: true })

function buildEdges(list, map) {
  const out = []
  for (const e of list) {
    const a = map.get(e.a)
    const b = map.get(e.b)
    // An edge onto a layer the fixture does not carry cannot be represented;
    // drop it and count it, never emit a dangling reference.
    if (a === undefined || b === undefined) continue
    out.push({ a, b, aSide: e.aSide ?? 'top', bSide: e.bSide ?? 'top' })
  }
  // SOURCE ORDER IS PRESERVED, deliberately. Sorting these for a prettier git
  // diff changed the engine output by one region on the first faithfulness
  // run — the fill is not order-invariant over its edge list. The fixture has
  // to be the scene the model actually presents, not a tidied one.
  return out
}

const edges = buildEdges(section.edges, layerOf)
const geotechEdges = buildEdges(section.geotech.edges, glayerOf)
const droppedLitho = section.edges.length - edges.length
const droppedGeo = section.geotech.edges.length - geotechEdges.length

const nadFormations = {}
for (const [fid, name] of geoFormOf) {
  const meta = nadMeta[fid] ?? {}
  nadFormations[name] = { nadClass: meta.nadClass ?? null, soilCode: meta.soilCode ?? null }
}
const lithoSoil = {}
for (const [fid, name] of lithoFormOf) lithoSoil[name] = lithoSoilByFormationId[fid] ?? null

const fixture = {
  provenance: [
    `Cross-section 1 of the owner's dev project, both models, extracted from`,
    `scripts/throwaway_geotech_axis_inputs.json. Ids anonymised; geometry verbatim.`,
    `Regenerate: scripts/extract_cs1_golden_fixture.mjs (see its header).`,
  ].join(' '),
  alongM: lithoOrdered.map(({ along }) => along),
  geotechAlongM: geoOrdered.map(({ along }) => along),
  columns,
  edges,
  geotechColumns,
  geotechEdges,
  nadFormations,
  lithoSoil,
}

writeFileSync(OUT, JSON.stringify(fixture, null, 1) + '\n')

const kib = (Buffer.byteLength(JSON.stringify(fixture, null, 1)) / 1024).toFixed(1)
console.log(`wrote ${OUT}  (${kib} KiB)`)
console.log(
  `  litho:   ${columns.length} cols / ${columns.reduce((n, c) => n + c.units.length, 0)} units / ${edges.length} edges${droppedLitho ? ` (${droppedLitho} dangling dropped)` : ''}`,
)
console.log(
  `  geotech: ${geotechColumns.length} cols / ${geotechColumns.reduce((n, c) => n + c.units.length, 0)} units / ${geotechEdges.length} edges${droppedGeo ? ` (${droppedGeo} dangling dropped)` : ''}`,
)
console.log(`  formations: ${Object.keys(lithoSoil).length} litho / ${Object.keys(nadFormations).length} nad`)
