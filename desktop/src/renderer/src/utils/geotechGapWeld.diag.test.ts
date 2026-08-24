/**
 * GAP-WELD REPLAY — the canvas's EXACT inputs, replayed offline.
 *
 * The owner's dogfeed of 2026-08-24 (Cross-section 2, gap
 * GEO-23/125-S34 → GEO-10/117-B1) shows the right column's whole sand package
 * welded across the gap over the left column's closed constructs. The live
 * ``__GEOFILL_SAVE()`` probe wrote the fill's inputs AND its 327 emitted
 * regions to ``scripts/geofill_live_dump.json``; this replays them so the
 * defect is reproducible without the app, the DB, or a render.
 *
 * Dormant unless GAP_WELD=1. Report: scripts/throwaway_gap_weld.txt.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  computeHierarchicalGeotechFill,
  type HierarchicalGeotechFillInput,
} from './geotechHierarchicalFill'
import { fillGapProbe } from './geotechHierarchicalFill/constructive/fillGapProbe'
import type { SectionRegion } from './partitionFill'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const DUMP = resolve(REPO_ROOT, 'scripts/geofill_live_dump.json')
const OUT = resolve(REPO_ROOT, 'scripts/throwaway_gap_weld.txt')

interface LiveEntry {
  inputs: Omit<HierarchicalGeotechFillInput, 'packingClassOf'> & {
    packingClassOf: [string, string][]
  }
  regions: SectionRegion[]
}

/** A region's identity for a diff: gap, class, ring, rounded to the mm grid. */
function signatureOf(region: SectionRegion, classOf: ReadonlyMap<string, string>): string {
  const ring = region.polygon
    .map((p) => `${p.fraction.toFixed(4)},${p.elevation.toFixed(3)}`)
    .join(' ')
  return `g${region.gapIndex} ${classOf.get(region.formationId) ?? region.formationId} [${ring}]`
}

describe('gap-weld replay — the live dump reproduces offline', () => {
  if (process.env.GAP_WELD !== '1' || !existsSync(DUMP)) {
    it.skip('dormant (set GAP_WELD=1 with scripts/geofill_live_dump.json present)', () => {})
    return
  }
  it('reproduces the live regions and dumps gap 0', () => {
    const NL = String.fromCharCode(10)
    const dump = JSON.parse(readFileSync(DUMP, 'utf8')) as Record<string, LiveEntry>
    const entry = dump[Object.keys(dump)[0]]
    const classOf = new Map(entry.inputs.packingClassOf)
    fillGapProbe.enabled = true
    fillGapProbe.entries.length = 0
    let out!: ReturnType<typeof computeHierarchicalGeotechFill>
    try {
      out = computeHierarchicalGeotechFill({ ...entry.inputs, packingClassOf: classOf })
    } finally {
      fillGapProbe.enabled = false
    }
    // layer id → "CLASS top..base @ciN", so the construct dump reads as the
    // owner's own screen does.
    const label = new Map<string, string>()
    for (let ci = 0; ci < entry.inputs.geotechColumns.length; ci++) {
      const column = entry.inputs.geotechColumns[ci]
      for (const unit of column.units) {
        const surface = column.surfaceElevM as number
        label.set(
          unit.layerId,
          `${(classOf.get(unit.formationId) ?? unit.formationId.slice(-6)).padEnd(9)} ` +
            `${(surface - unit.topDepthM).toFixed(2)}..${(surface - unit.baseDepthM).toFixed(2)} @ci${ci}`,
        )
      }
    }

    const live = entry.regions.map((r) => signatureOf(r, classOf)).sort()
    const replayed = out.regions.map((r) => signatureOf(r, classOf)).sort()
    const onlyLive = live.filter((s) => !replayed.includes(s))
    const onlyReplayed = replayed.filter((s) => !live.includes(s))

    const lines: string[] = [
      `live regions: ${live.length}   replayed: ${replayed.length}`,
      `only in live: ${onlyLive.length}   only in replay: ${onlyReplayed.length}`,
      ...onlyLive.slice(0, 20).map((s) => `  LIVE-ONLY   ${s}`),
      ...onlyReplayed.slice(0, 20).map((s) => `  REPLAY-ONLY ${s}`),
      '',
      '=== gap 0 (S34 | B1), replayed ===',
    ]
    const gap0 = out.regions
      .filter((r) => r.gapIndex === 0)
      .map((r) => {
        let lo = Infinity
        let hi = -Infinity
        let fa = Infinity
        let fb = -Infinity
        for (const p of r.polygon) {
          if (p.elevation < lo) lo = p.elevation
          if (p.elevation > hi) hi = p.elevation
          if (p.fraction < fa) fa = p.fraction
          if (p.fraction > fb) fb = p.fraction
        }
        return {
          cls: classOf.get(r.formationId) ?? r.formationId,
          fa,
          fb,
          lo,
          hi,
        }
      })
      .sort((a, b) => b.hi - a.hi)
    for (const r of gap0) {
      lines.push(
        `  ${r.cls.padEnd(12)} [${r.fa.toFixed(2)}..${r.fb.toFixed(2)}] x [${r.lo.toFixed(2)}..${r.hi.toFixed(2)}]`,
      )
    }
    lines.push('', '=== gap 0 constructs, per (family, gap) run ===')
    for (const probe of fillGapProbe.entries) {
      if (probe.gapIndex !== 0) continue
      lines.push(`--- run cover=${probe.coverLayers.map((l) => l.slice(-6)).join(',')}`)
      for (const c of probe.constructs) {
        lines.push(
          `    ${(label.get(c.layer) ?? c.layer.slice(-6)).padEnd(34)} emit=${c.emit.padEnd(7)}` +
            ` topTied=${c.topTied ? 'Y' : 'n'} baseTied=${c.baseTied ? 'Y' : 'n'}` +
            (c.extendsToFar === true ? ' EXTENDS_TO_FAR' : ''),
        )
      }
      for (const f of probe.faces) {
        let lo = Infinity
        let hi = -Infinity
        let fa = Infinity
        let fb = -Infinity
        for (const [fr, el] of f.ring) {
          if (el < lo) lo = el
          if (el > hi) hi = el
          if (fr < fa) fa = fr
          if (fr > fb) fb = fr
        }
        lines.push(
          `    FACE ${f.role.padEnd(9)} [${fa.toFixed(2)}..${fb.toFixed(2)}] x [${lo.toFixed(2)}..${hi.toFixed(2)}]` +
            ` sample=(${f.sample[0].toFixed(3)},${f.sample[1].toFixed(2)}) -> ` +
            (f.owner === null ? '(residual)' : (label.get(f.owner) ?? f.owner.slice(-6))),
        )
      }
    }
    fillGapProbe.entries.length = 0
    writeFileSync(OUT, lines.join(NL) + NL)
    // GAP_WELD_BASELINE=1 asserts the replay still reproduces the dump exactly
    // — the check that PROVED the defect was reproducible offline before any
    // fix. Once the fix lands the two differ by design, so the ordinary run
    // only requires the replay to produce something and prints the diff.
    if (process.env.GAP_WELD_BASELINE === '1') {
      expect(onlyLive.length + onlyReplayed.length).toBe(0)
    }
    expect(out.regions.length).toBeGreaterThan(0)
  })
})
