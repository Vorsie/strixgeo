/**
 * THROWAWAY DIAG — dump the emitted CURVES of one gap of a real section.
 *
 * Dormant unless CURVE_PROBE=1. Env: CURVE_GAPS (comma list of gap indices),
 * SECTION_DUMP_NAME, CURVE_ARM (litho|geotech). Writes
 * scripts/throwaway_curve_probe.txt.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'vitest'

import { emitCurves } from './emitCurves'
import { buildArrangement } from './arrangement'
import { labelFaces } from './labelFaces'
import { buildSectionInput } from './sectionGeom'
import { setTwoSidedTerminations } from './tileFlags'
import type { CorrelationEdge, PartitionColumn } from '../sectionPartition'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../../..')
const INPUT = resolve(REPO_ROOT, 'scripts/throwaway_geotech_axis_inputs.json')
const OUT = resolve(REPO_ROOT, 'scripts/throwaway_curve_probe.txt')

describe('CURVE probe diag', () => {
  if (process.env.CURVE_PROBE !== '1' || !existsSync(INPUT)) {
    it.skip('dormant (set CURVE_PROBE=1)', () => {})
    return
  }
  it('dumps curves of the named gaps', () => {
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as any
    const name = process.env.SECTION_DUMP_NAME ?? 'Cross-section 1'
    const sec = raw.sections.find((s: any) => s.name === name)
    const arm = process.env.CURVE_ARM === 'geotech' ? sec.geotech : sec
    const paired = arm.columns
      .map((c: any, i: number) => ({ c, a: arm.alongM[i] }))
      .filter(({ c }: any) => c.surfaceElevM != null && c.units.length > 0)
      .sort((p: any, q: any) => p.a - q.a)
    const columns: PartitionColumn[] = paired.map(({ c }: any) => ({
      investigationId: c.investigationId,
      surfaceElevM: c.surfaceElevM,
      units: [...c.units].sort((a: any, b: any) => a.topDepthM - b.topDepthM),
    }))
    const alongM: number[] = paired.map(({ a }: any) => a)
    const edges: CorrelationEdge[] = arm.edges.map((e: any) => ({
      a: e.a,
      b: e.b,
      aSide: e.aSide ?? 'top',
      bSide: e.bSide ?? 'top',
    }))
    const nad = raw.refinementBundle.nadMeta
    const soil = raw.refinementBundle.lithoSoilByFormationId
    const nm = (id: string): string =>
      nad[id] ? `${nad[id].soilCode}-${nad[id].nadClass}` : soil[id] ? `L:${soil[id]}` : id.slice(0, 8)

    const prev = setTwoSidedTerminations(true)
    const lines: string[] = []
    try {
      const section = buildSectionInput(columns, edges, undefined, alongM)
      const { curves, lensLabels } = emitCurves(section)
      const arrangement = buildArrangement(curves)
      const labelled = labelFaces(arrangement.faces, section.columns, lensLabels, arrangement, [])
      for (const g of (process.env.CURVE_GAPS ?? '7').split(',').map(Number)) {
        const x0 = section.columns[g].x
        const x1 = section.columns[g + 1].x
        lines.push(`===== GAP ${g}  x ${x0.toFixed(2)}..${x1.toFixed(2)} =====`)
        const fr = (x: number): string => ((x - x0) / (x1 - x0)).toFixed(3)
        for (const c of curves) {
          const inGap = c.points.some((p) => p.x >= x0 - 1e-6 && p.x <= x1 + 1e-6)
          if (!inGap) continue
          const lbl = lensLabels.get(c.id)
          lines.push(
            `  ${c.id} [${c.kind}]${lbl ? ' lbl=' + nm(lbl.formationId) : ''} ` +
              c.points.map((p) => `(${fr(p.x)},${p.y.toFixed(2)})`).join(''),
          )
        }
        lines.push('  --- FACES ---')
        for (const lf of labelled) {
          const poly = lf.face.polygon
          const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length
          if (cx < x0 - 1e-6 || cx > x1 + 1e-6) continue
          lines.push(
            `  face ${lf.formationId ? nm(lf.formationId) : '(none)'} klass=${lf.klass} ` +
              `seeds=[${(lf.seedRefs ?? []).join(' ')}] ` +
              `curves=[${lf.face.boundingCurveIds.join(' ')}] ` +
              poly.map((p) => `(${fr(p.x)},${p.y.toFixed(2)})`).join(''),
          )
        }
      }
    } finally {
      setTwoSidedTerminations(prev)
    }
    writeFileSync(OUT, lines.join('\n'))
  })
})
