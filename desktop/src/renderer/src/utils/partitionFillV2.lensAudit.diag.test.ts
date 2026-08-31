/**
 * partitionFillV2.lensAudit.diag.test.ts — THE LETTER-OF-THE-LAW LENS AUDIT (ruling 8i(e),
 * design partition-engine-v2.md §8, 2026-07-17 — "everything must lens, no narrow gap guard —
 * make it so that all 0-corr bodies lens in first instance").
 *
 * PROMOTED from an orchestrator walkthrough-dump probe to a PERMANENT env-gated diag (session
 * 19). Over ALL 14 real sections, on the FLAG-ON hoisted engine, it asserts the owner property:
 *
 *   EVERY corr-0 unit-side (per gap per side, using the SAME bridge-fed 2/1/0 arithmetic the
 *   engine emits against — ``effectiveCorrForSide`` with the directional bridge set from
 *   ``emitCurves``) MUST carry a PHASE-CLASSIFIABLE LENS FLANK anchored at its own column x AND
 *   one of its own contact elevations (top/base). A lens is a pair of ``term``/``subtdlens``/
 *   ``lens``-prefixed closing curves from the column corner to the apex; ONE such flank touching
 *   the unit's (colX, topElev) or (colX, baseElev) proves the lens exists.
 *
 * MISSING = a corr-0 unit-side with NO phase-1 flank at its column+elevations. Acceptance
 * (ruling 8i(e)): MISSING == 0 on every section. The ONLY permitted exclusion is the PHYSICAL
 * 1 mm snap collapse (``segmentDegenerate`` — a sub-snap flank the engine legitimately drops):
 * such a unit is listed individually in ``physicalCollapse`` and excluded from MISSING (NOT a
 * width policy — the ``SUB_SNAP_GAP_M`` threshold is DELETED). Any OTHER missing lens is a
 * ruling-8i(e) violation.
 *
 * Gate: SHAPE_AUDIT=1 (reuses the allowed audit env var, like the conformance gate — a distinct
 * LENS_AUDIT var is not in the harness allowlist). Pure reporter — never fails (instrument only).
 * Deterministic (no Date.now / Math.random; fixed iteration order). Dump: scripts/diag_lens_audit.json.
 * Run (desktop/): SHAPE_AUDIT=1 npx vitest run src/renderer/src/utils/partitionFillV2.lensAudit.diag.test.ts
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { type CorrelationEdge, type PartitionColumn } from './sectionPartition'
import { buildSectionInput } from './partitionFillV2/sectionGeom'
import { emitCurves } from './partitionFillV2/emitCurves'
import { effectiveCorrForSide } from './partitionFillV2/effectiveCorr'
import { setTwoSidedTerminations } from './partitionFillV2/tileFlags'
import { segmentDegenerate } from './partitionFillV2/snap'
import { type InputCurve, type Point } from './partitionFillV2/types'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const INPUT = resolve(REPO_ROOT, 'scripts/diag_allsections_input.json')
const NAMES = resolve(REPO_ROOT, 'scripts/diag_shape_audit_names.json')
const DUMP = resolve(REPO_ROOT, 'scripts/diag_lens_audit.json')

interface RawUnit {
  layerId: string; topDepthM: number; baseDepthM: number; formationId: string; bodyId: string | null
}
interface RawCol { investigationId: string; surfaceElevM: number | null; units: RawUnit[] }
interface RawSection {
  sectionId: string; name: string; columns: RawCol[]; alongM: number[]
  edges: { a: string; b: string; aSide?: string; bSide?: string }[]
}

const round = (x: number): number => Math.round(x * 1000) / 1000

function prepare(sec: RawSection, nameOf: (id: string) => string): {
  columns: PartitionColumn[]; alongM: number[]; edges: CorrelationEdge[]; colNames: string[]
} {
  const keep = sec.columns
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.surfaceElevM != null && c.units.length > 0)
  const columns: PartitionColumn[] = keep.map(({ c }) => ({
    investigationId: c.investigationId,
    surfaceElevM: c.surfaceElevM as number,
    units: c.units,
  }))
  const alongM = keep.map(({ i }) => sec.alongM[i])
  const colNames = keep.map(({ c }) => nameOf(c.investigationId))
  const edges: CorrelationEdge[] = sec.edges.map((e) => ({
    a: e.a, b: e.b,
    aSide: (e.aSide ?? 'top') as 'top' | 'base',
    bSide: (e.bSide ?? 'top') as 'top' | 'base',
  }))
  return { columns, alongM, edges, colNames }
}

/** A curve id whose face is a PHASE-1 lens flank (0-corr lens closing) — the sweep's ``term``,
 * the sub-TD ``subtdlens``, and the enclosed-lens ``lens`` vocabulary. NOT ``oflank`` (onlap,
 * phase 2), NOT ``flood``/``close``/``bandc``/``tie``/``col``/``surface``/``bridge`` (fill/line art). */
function isLensFlankId(id: string): boolean {
  if (id.startsWith('subtdlens')) return true
  if (id.startsWith('lens')) return true
  // Bare ``term`` is the sweep's lens-closing allocator; ``oflank`` (onlap) does not start with ``term``.
  if (id.startsWith('term')) return true
  return false
}

/** Whether a point sits at (colX, elev) within snap tolerance (1 mm × a small slack). */
function atContact(p: Point, colX: number, elev: number): boolean {
  return Math.abs(p.x - colX) < 0.005 && Math.abs(p.y - elev) < 0.005
}

describe('v2 letter-of-the-law LENS audit (ruling 8i(e))', () => {
  if (process.env.SHAPE_AUDIT !== '1') {
    it.skip('dormant (set SHAPE_AUDIT=1)', () => {})
    return
  }

  it('every corr-0 unit-side carries a phase-1 lens flank (MISSING == 0 per section)', () => {
    expect(existsSync(INPUT)).toBe(true)
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as {
      sections: RawSection[]; formationNames: Record<string, string>
    }
    const nameMap: Record<string, string> = existsSync(NAMES)
      ? (JSON.parse(readFileSync(NAMES, 'utf8')) as Record<string, string>)
      : {}
    const fname = (id: string): string => raw.formationNames[id] ?? id.slice(0, 8)
    const nameOf = (id: string): string => nameMap[id] ?? id.slice(0, 8)

    interface MissRow {
      section: string; gap: number; side: 'left' | 'right'; colName: string
      formation: string; unitLayerId: string; topElev: number; baseElev: number
      physical: boolean
    }
    const missing: MissRow[] = []
    const physicalCollapse: MissRow[] = []
    // The boundary-lens residual (ui 0 / ui last, single neighbour differs): the sweep
    // legitimately withholds this lens because ``emitEnclosingFlood`` cannot bound a surface-/TD-
    // boundary lens hole-free yet (the documented +59-class fill-rebuild wall, session 19 measured
    // +65 holes when fired). Tracked SEPARATELY from ``missing`` so genuine 8i(e) violations stay 0.
    const boundaryResidual: MissRow[] = []
    const perSection: Record<string, unknown>[] = []
    const grand = { corr0Sides: 0, present: 0, missing: 0, physical: 0, boundary: 0 }

    const prev = setTwoSidedTerminations(true)
    try {
      for (const sec of raw.sections) {
        const { columns, alongM, edges, colNames } = prepare(sec, nameOf)
        if (columns.length < 2) continue
        const section = buildSectionInput(columns, edges, undefined, alongM)
        const { curves, activeTies, bridgeGapAnchored } = emitCurves(section)
        const geom = section.columns

        // Index the phase-1 lens flank endpoints for a fast per-contact lookup.
        const flankPts: { colX: number; elev: number; degenerate: boolean }[] = []
        for (const c of curves as InputCurve[]) {
          if (!isLensFlankId(c.id)) continue
          const pts = c.points
          if (pts.length < 2) continue
          // A lens flank endpoint that sits on a column corner is what anchors the unit.
          for (const p of pts) flankPts.push({ colX: p.x, elev: p.y, degenerate: false })
        }

        let secCorr0 = 0
        let secPresent = 0
        let secMissing = 0
        let secPhysical = 0
        let secBoundary = 0

        for (let ci = 0; ci < geom.length; ci++) {
          const col = geom[ci]
          for (const gi of [ci - 1, ci] as const) {
            if (gi < 0 || gi + 1 >= geom.length) continue
            const side: 'left' | 'right' = ci === gi ? 'left' : 'right'
            const facing = side === 'left' ? geom[gi + 1] : geom[gi]
            const left = side === 'left' ? col : facing
            const right = side === 'left' ? facing : col
            const corr = effectiveCorrForSide(gi, side, col, facing, left, right, activeTies, bridgeGapAnchored)
            const colX = col.x
            const facingX = facing.x
            for (let ui = 0; ui < col.units.length; ui++) {
              if ((corr[ui]?.corr ?? 0) !== 0) continue
              const u = col.units[ui]
              secCorr0++
              grand.corr0Sides++
              // A lens flank at THIS unit's column x, touching its top OR base contact.
              const has =
                flankPts.some((f) => atContact({ x: f.colX, y: f.elev }, colX, u.topElev)) ||
                flankPts.some((f) => atContact({ x: f.colX, y: f.elev }, colX, u.baseElev))
              if (has) {
                secPresent++
                grand.present++
                continue
              }
              // No flank found. Is this a PHYSICAL 1 mm collapse (the only permitted exclusion —
              // ruling 8i(e))? A lens whose apex snaps onto its own corner in a sub-snap gap is a
              // legitimate no-op. Test the would-be apex against both corners at the unit's mid.
              const apexElev = (u.topElev + u.baseElev) / 2
              // The apex fraction is bounded by the lens-reach cap; a sub-snap gap collapses it
              // regardless of the fraction, so test the extreme (apex on the column) for the floor.
              const apexNear: Point = { x: colX + 1e-4 * (facingX - colX), y: apexElev }
              const degenerate =
                segmentDegenerate({ x: colX, y: u.topElev }, apexNear) ||
                segmentDegenerate(apexNear, { x: colX, y: u.baseElev })
              const row: MissRow = {
                section: sec.name, gap: gi, side, colName: colNames[ci],
                formation: fname(u.formationId), unitLayerId: u.layerId,
                topElev: round(u.topElev), baseElev: round(u.baseElev), physical: degenerate,
              }
              // Boundary unit (ui 0 / ui last) whose single interior neighbour differs = the
              // documented fill-rebuild wall (session 19). The lens FLANK is legitimately withheld
              // pending the ``emitEnclosingFlood`` boundary-lens closure; not a genuine 8i(e) miss.
              const isBoundary = ui === 0 || ui + 1 >= col.units.length
              const neighbour = ui === 0 ? col.units[1] : col.units[ui - 1]
              const boundaryMinority = isBoundary && neighbour != null && neighbour.formationId !== u.formationId
              if (degenerate) {
                physicalCollapse.push(row)
                secPhysical++
                grand.physical++
              } else if (boundaryMinority) {
                boundaryResidual.push(row)
                secBoundary++
                grand.boundary++
              } else {
                missing.push(row)
                secMissing++
                grand.missing++
              }
            }
          }
        }

        perSection.push({
          section: sec.name, cols: columns.length,
          corr0Sides: secCorr0, present: secPresent, missing: secMissing,
          physical: secPhysical, boundaryResidual: secBoundary,
        })
        console.log(
          `\n=== ${sec.name}: corr0-sides=${secCorr0} present=${secPresent} ` +
            `MISSING=${secMissing} physical=${secPhysical} boundaryResidual=${secBoundary}`,
        )
        for (const r of missing.filter((x) => x.section === sec.name)) {
          console.log(
            `   MISSING gap${r.gap} [${r.side}] ${r.colName} ${r.formation} ` +
              `el[${r.baseElev}..${r.topElev}] layer=${r.unitLayerId.slice(0, 8)}`,
          )
        }
      }
    } finally {
      setTwoSidedTerminations(prev)
    }

    const dump = {
      generatedFor: '14 real sections, v2 flag-ON engine, ruling-8i(e) letter-of-the-law lens audit',
      acceptance: 'MISSING == 0 per section (physical 1 mm collapses + boundary-lens fill-wall excluded + listed)',
      grand,
      perSection,
      missing,
      boundaryResidual,
      physicalCollapse,
    }
    writeFileSync(DUMP, JSON.stringify(dump, null, 1))

    console.log('\n########## LENS AUDIT GRAND TOTALS ##########')
    console.log(`  corr-0 unit-sides: ${grand.corr0Sides}`)
    console.log(`  present (lens flank): ${grand.present}`)
    console.log(`  MISSING (ruling-8i(e) violation): ${grand.missing}`)
    console.log(`  boundary-lens residual (fill-rebuild wall, listed): ${grand.boundary}`)
    console.log(`  physical 1 mm collapse (excluded, listed): ${grand.physical}`)
    console.log(`  dumped -> ${DUMP}`)
    console.log('#############################################')

    // ---- HARD GATE (S38 audit item 9) ----
    // Ruling 8i(e): every corr-0 unit-side MUST carry a phase-1 lens flank. MISSING is the
    // letter-of-the-law violation count → assert 0. Each missing row names its
    // section/gap/side/colName/formation/elevations so a future red is diagnosable from the
    // message alone.
    const missingMsg = missing
      .map((r) => `${r.section} gap${r.gap} [${r.side}] ${r.colName} ${r.formation} el[${r.baseElev}..${r.topElev}] layer=${r.unitLayerId.slice(0, 8)}`)
      .join('; ')
    expect(missing.length, `ruling-8i(e) MISSING lens flanks (must be 0): ${missingMsg || '(none)'}`).toBe(0)
    expect(grand.missing, 'grand.missing must equal 0 (letter-of-the-law lens audit)').toBe(0)

    // boundaryResidual is NOT an accepted category on the CURRENT engine (S34 deletion D
    // un-gated the boundary-lens fill wall — every boundary corr-0 side now lenses). Measured
    // 0. Pin it exactly so a regression that reintroduces a withheld boundary lens fails here.
    const boundaryMsg = boundaryResidual
      .map((r) => `${r.section} gap${r.gap} [${r.side}] ${r.colName} ${r.formation} el[${r.baseElev}..${r.topElev}]`)
      .join('; ')
    expect(boundaryResidual.length, `boundary-lens residual (must be 0 on the S34-deletion-D engine): ${boundaryMsg || '(none)'}`).toBe(0)
    expect(grand.boundary, 'grand.boundary must equal 0').toBe(0)

    // physical 1 mm snap collapse: the ONLY permitted exclusion from MISSING (ruling 8i(e)).
    // Currently ZERO real corr-0 sides collapse sub-snap → pin 0. If a legitimate snap collapse
    // ever appears, update this to its exact count and list the instance(s) in the message.
    const physicalMsg = physicalCollapse
      .map((r) => `${r.section} gap${r.gap} [${r.side}] ${r.colName} ${r.formation} el[${r.baseElev}..${r.topElev}]`)
      .join('; ')
    expect(physicalCollapse.length, `physical 1 mm snap collapse (currently 0; list each if nonzero): ${physicalMsg || '(none)'}`).toBe(0)
    expect(grand.physical, 'grand.physical must equal 0').toBe(0)

    // Population lock: 32 corr-0 unit-sides on the 14 real sections, ALL present. A silent DROP
    // in corr0Sides (a guard reappearing that reclassifies a corr-0 side as corr-1) is caught here.
    expect(grand.corr0Sides, 'corr-0 unit-side population (14 real sections) must be 32').toBe(32)
    expect(grand.present, 'every corr-0 side must carry a lens flank (present == 32)').toBe(32)
  })
})
