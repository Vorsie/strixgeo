/**
 * CS1 HATCH DELTA — how much cover the current engine hands to "correlate me"
 * versus the frozen golden master, by gap and by area.
 *
 * The golden master reports WHICH rings moved; this reports HOW MUCH ground
 * changed hands, which is what decides whether a red there is an accepted
 * ruling or a regression.
 *
 * Dormant unless HATCH_DELTA=1. Report: scripts/throwaway_cs1_hatch_delta.txt.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { computeEngineSnapshot, type FrozenRegion } from './cs1GoldenMaster/engineSnapshot'
import { loadCs1Scene } from './cs1GoldenMaster/input'
import { fillGapProbe } from './geotechHierarchicalFill/constructive/fillGapProbe'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const GOLDEN = resolve(HERE, '__fixtures__/cs1_golden_master.json')
const OUT = resolve(REPO_ROOT, 'scripts/throwaway_cs1_hatch_delta.txt')

/** Ring area in square metres — fraction-space shoelace scaled by gap width. */
function areaM2(region: FrozenRegion, alongM: readonly number[]): number {
  const points = region.ring.split(' ').map((pair) => pair.split(',').map(Number))
  const width = Math.abs(alongM[region.gap + 1] - alongM[region.gap])
  let twice = 0
  for (let i = 0; i < points.length; i++) {
    const [fa, ea] = points[i]
    const [fb, eb] = points[(i + 1) % points.length]
    twice += fa * eb - fb * ea
  }
  return (Math.abs(twice) / 2) * width
}

describe('CS1 hatch delta — ground that changed hands', () => {
  if (process.env.HATCH_DELTA !== '1' || !existsSync(GOLDEN)) {
    it.skip('dormant (set HATCH_DELTA=1)', () => {})
    return
  }
  it('reports the classed/hatched area by gap', () => {
    const NL = String.fromCharCode(10)
    const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as {
      engine: { regions: FrozenRegion[]; fallback: FrozenRegion[] }
    }
    const scene = loadCs1Scene()
    const now = computeEngineSnapshot(scene)
    const alongM = scene.alongM

    const total = (rs: readonly FrozenRegion[]): number =>
      rs.reduce((sum, r) => sum + areaM2(r, alongM), 0)
    const byGap = (rs: readonly FrozenRegion[]): Map<number, number> => {
      const out = new Map<number, number>()
      for (const r of rs) out.set(r.gap, (out.get(r.gap) ?? 0) + areaM2(r, alongM))
      return out
    }

    const wasHatch = byGap(golden.engine.fallback)
    const nowHatch = byGap(now.fallback)
    const lines = [
      `classed area  frozen ${total(golden.engine.regions).toFixed(1)} m2` +
        ` -> now ${total(now.regions).toFixed(1)} m2`,
      `hatch area    frozen ${total(golden.engine.fallback).toFixed(1)} m2` +
        ` -> now ${total(now.fallback).toFixed(1)} m2`,
      `hatch regions frozen ${golden.engine.fallback.length} -> now ${now.fallback.length}`,
      '',
      'hatch by gap (m2):',
    ]
    for (const gap of [...new Set([...wasHatch.keys(), ...nowHatch.keys()])].sort((a, b) => a - b)) {
      lines.push(
        `  gap ${String(gap).padStart(2)}  ${(wasHatch.get(gap) ?? 0).toFixed(2)} -> ${(nowHatch.get(gap) ?? 0).toFixed(2)}`,
      )
    }
    // WHO ANSWERS CS1'S REMAINDER — the faces a column that does not border
    // the gap won, split by whether a flank band read the sample's own level.
    // The second number is the ground the 2026-08-24 ruling takes off the
    // stranger; the first is ground the flanks never read, which it leaves.
    fillGapProbe.enabled = true
    fillGapProbe.entries.length = 0
    try {
      computeEngineSnapshot(scene)
    } finally {
      fillGapProbe.enabled = false
    }
    let strangerUnread = 0
    let strangerRead = 0
    const strangerReadByGap = new Map<number, number>()
    for (const entry of fillGapProbe.entries) {
      const flankCis = new Set(entry.constructs.map((c) => c.ci))
      const flankSpans = entry.constructs.map((c) => [c.top, c.base] as const)
      const bandOf = new Map(entry.constructs.map((c) => [c.layer, c]))
      for (const face of entry.faces) {
        if (face.role !== 'fill' || face.owner === null) continue
        if (bandOf.has(face.owner)) continue
        const y = face.sample[1]
        const read = flankSpans.some(([top, base]) => y <= top && y >= base)
        const width = Math.abs(alongM[entry.gapIndex + 1] - alongM[entry.gapIndex])
        let twice = 0
        for (let i = 0; i < face.ring.length; i++) {
          const [fa, ea] = face.ring[i]
          const [fb, eb] = face.ring[(i + 1) % face.ring.length]
          twice += fa * eb - fb * ea
        }
        const area = (Math.abs(twice) / 2) * width
        if (read) {
          strangerRead += area
          strangerReadByGap.set(
            entry.gapIndex,
            (strangerReadByGap.get(entry.gapIndex) ?? 0) + area,
          )
        } else strangerUnread += area
        void flankCis
      }
    }
    fillGapProbe.entries.length = 0
    lines.push(
      '',
      `remainder won by a NON-FLANK column, flanks never read the level: ${strangerUnread.toFixed(1)} m2`,
      `remainder won by a NON-FLANK column, flanks DID read the level:   ${strangerRead.toFixed(1)} m2`,
      'the second, by gap (m2):',
    )
    for (const [gap, area] of [...strangerReadByGap].sort((a, b) => b[1] - a[1])) {
      lines.push(`  gap ${String(gap).padStart(2)}  ${area.toFixed(2)}`)
    }
    writeFileSync(OUT, lines.join(NL) + NL)
    expect(now.regions.length).toBeGreaterThan(0)
  })
})
