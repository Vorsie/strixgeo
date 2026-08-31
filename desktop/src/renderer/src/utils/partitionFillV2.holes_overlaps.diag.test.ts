/**
 * partitionFillV2.holes_overlaps.diag.test.ts — interior holes + different-lithology
 * overlaps HARD GATE (S38 audit item 9) for the partition engine v2 output, mirroring
 * the v1 diag (partitionFill.holes_overlaps.diag.test.ts). Runs ``computeSectionFillV2``
 * on all 14 real sections (REAL alongM) and reports, per section:
 *
 *   HOLES-above-TD — interior vertical-coverage holes ABOVE the shallow TD of the
 *                    gap (the deeper of the two bracketing columns' TDs).
 *   HOLES-sub-TD   — holes BELOW that shallow TD.
 *   OVERLAPS       — vertical overlap between DIFFERENT-formation regions at the
 *                    same fraction (any amount = paint-level spill).
 *
 * TWO hard-gated blocks (both under HOLES_DIAG=1):
 *   FLAG-OFF (default engine state) — a TRUE partition: above-TD holes 0, sub-TD holes 0,
 *            different-litho overlaps 0. Byte-identical to the pre-campaign engine.
 *   FLAG-ON  (setTwoSidedTerminations(true)) — the product path. The ONE accepted above-TD
 *            hole baseline is pinned BY IDENTITY: every above-TD hole sits at Cross-section 2
 *            gap 17 (the sloping-enclosure wall, AUDIT_PROMPT Known Issues). Currently 20
 *            sampled holes; the gate asserts holes exist ONLY at CS2-g17 (a count DROP at
 *            g17 is fine — a new above-TD hole ANYWHERE ELSE fails). Sub-TD holes 0,
 *            different-litho overlaps 0.
 *
 * Run: HOLES_DIAG=1 npx vitest run src/renderer/src/utils/partitionFillV2.holes_overlaps.diag.test.ts --disableConsoleIntercept
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  type CorrelationEdge,
  type PartitionColumn,
  type PartitionPoint,
} from './sectionPartition'
import { computeSectionFillV2 } from './partitionFillV2'
import { setTwoSidedTerminations } from './partitionFillV2/tileFlags'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const INPUT = resolve(REPO_ROOT, 'scripts/diag_allsections_input.json')

interface RawUnit {
  layerId: string
  topDepthM: number
  baseDepthM: number
  formationId: string
  bodyId: string | null
}
interface RawCol {
  investigationId: string
  surfaceElevM: number | null
  units: RawUnit[]
}
interface RawSection {
  sectionId: string
  name: string
  columns: RawCol[]
  edges: { a: string; b: string; aSide?: string; bSide?: string }[]
  alongM: number[]
}

/** Elevation intervals covered by a simple polygon at vertical line x=f. */
function coveredIntervals(poly: readonly PartitionPoint[], f: number): [number, number][] {
  const ys: number[] = []
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % n]
    const [x1, x2] = [a.fraction, b.fraction]
    if ((x1 <= f && x2 > f) || (x2 <= f && x1 > f)) {
      const t = (f - x1) / (x2 - x1)
      ys.push(a.elevation + t * (b.elevation - a.elevation))
    }
  }
  ys.sort((p, q) => p - q)
  const out: [number, number][] = []
  for (let i = 0; i + 1 < ys.length; i += 2) out.push([ys[i], ys[i + 1]])
  return out
}

function mergeIntervals(iv: [number, number][], eps: number): [number, number][] {
  const s = iv.filter(([a, b]) => b - a > 1e-9).sort((p, q) => p[0] - q[0])
  const out: [number, number][] = []
  for (const [a, b] of s) {
    if (out.length && a <= out[out.length - 1][1] + eps) {
      out[out.length - 1][1] = Math.max(out[out.length - 1][1], b)
    } else out.push([a, b])
  }
  return out
}

/** One above-TD hole, keyed by the (section, gap) that owns it — the identity the
 * flag-ON gate pins the CS2-g17 baseline against. */
interface AboveHole {
  section: string
  gapIndex: number
  detail: string
}

/** One different-litho overlap pair, keyed by (section, gap, litho-pair). Ruling 8s pins the
 * 3 known cm-slivers by identity on the flag-ON ratchet — a region-construction defect the
 * enclosing-contour clip will later remove, NOT a reason to re-cap the lens. */
interface OverlapPair {
  section: string
  gapIndex: number
  key: string
  maxVcm: number
}

interface ScanResult {
  totalAboveTD: number
  totalSubTD: number
  totalOverlapPairs: number
  aboveHoles: AboveHole[]
  overlaps: OverlapPair[]
}

/** Run the holes/overlaps scan over all 14 real sections at the CURRENT engine flag
 * state and return the structured tallies. Console output mirrors the historical
 * reporter so a red is diagnosable. */
function scanAllSections(raw: { sections: RawSection[]; formationNames: Record<string, string> }): ScanResult {
  const fname = (id: string): string => raw.formationNames[id] ?? id.slice(0, 8)
  let totalAboveTD = 0
  let totalSubTD = 0
  let totalOverlapPairs = 0
  const aboveHoles: AboveHole[] = []
  const overlaps: OverlapPair[] = []

  for (const sec of raw.sections) {
    const keep = sec.columns
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.surfaceElevM != null && c.units.length > 0)
    const columns: PartitionColumn[] = keep.map(({ c }) => ({
      investigationId: c.investigationId,
      surfaceElevM: c.surfaceElevM as number,
      units: c.units,
    }))
    const alongM = keep.map(({ i }) => sec.alongM[i])
    // Per-column TD ELEVATION (deepest base) — for the above/sub-TD hole split.
    const tdElev = columns.map((c) =>
      Math.min(...c.units.map((u) => c.surfaceElevM - u.baseDepthM)),
    )
    const edges: CorrelationEdge[] = sec.edges.map((e) => ({
      a: e.a,
      b: e.b,
      aSide: (e.aSide ?? 'top') as 'top' | 'base',
      bSide: (e.bSide ?? 'top') as 'top' | 'base',
    }))
    const regions = computeSectionFillV2(columns, edges, undefined, alongM)

    const byGap = new Map<number, typeof regions>()
    for (const r of regions) {
      if (!byGap.has(r.gapIndex)) byGap.set(r.gapIndex, [])
      byGap.get(r.gapIndex)!.push(r)
    }

    let aboveTD = 0
    let subTD = 0
    const holeSamples: string[] = []
    const overlapPairs = new Map<string, { maxV: number }>()

    for (const [gi, regs] of byGap) {
      // The gap's shallow-TD elevation = the HIGHER of the two bracketing TDs
      // (the shallower test bottoms out first). Holes below it are sub-TD.
      const shallowTD = Math.max(tdElev[gi] ?? -Infinity, tdElev[gi + 1] ?? -Infinity)
      for (let f = 0.02; f < 0.985; f += 0.02) {
        // ---- holes: union of ALL coverage, interior gaps ----
        const all: [number, number][] = []
        for (const r of regs) all.push(...coveredIntervals(r.polygon, f))
        const merged = mergeIntervals(all, 0.0005)
        for (let k = 0; k + 1 < merged.length; k++) {
          const holeTop = merged[k + 1][0]
          const holeBot = merged[k][1]
          const hole = holeTop - holeBot
          if (hole > 0.0005 && hole < 5) {
            // Classify: a hole whose TOP is at/below the shallow TD is sub-TD.
            const isSubTD = holeTop <= shallowTD + 0.01
            if (isSubTD) subTD++
            else {
              aboveTD++
              const detail = `gap${gi} f=${f.toFixed(2)} hole=${(hole * 1000).toFixed(1)}mm at elev ${holeBot.toFixed(2)} (shallowTD ${shallowTD.toFixed(2)})`
              aboveHoles.push({ section: sec.name, gapIndex: gi, detail })
              if (holeSamples.length < 8) holeSamples.push(detail)
            }
          }
        }
        // ---- overlaps between DIFFERENT formations ----
        for (let a = 0; a < regs.length; a++) {
          for (let b = a + 1; b < regs.length; b++) {
            if (regs[a].formationId === regs[b].formationId) continue
            const ia = coveredIntervals(regs[a].polygon, f)
            const ib = coveredIntervals(regs[b].polygon, f)
            for (const [a1, a2] of ia)
              for (const [b1, b2] of ib) {
                const v = Math.min(a2, b2) - Math.max(a1, b1)
                if (v > 0.001) {
                  const key = `gap${gi} ${fname(regs[a].formationId)}(${regs[a].kind})×${fname(regs[b].formationId)}(${regs[b].kind})`
                  const cur = overlapPairs.get(key)
                  if (!cur || v > cur.maxV) overlapPairs.set(key, { maxV: v })
                }
              }
          }
        }
      }
    }

    const ovl = [...overlapPairs.entries()].sort((p, q) => q[1].maxV - p[1].maxV)
    for (const [k, v] of ovl) {
      // The key is ``gap<gi> ...``; recover the gap index for the identity ratchet.
      const gapMatch = k.match(/^gap(\d+)/)
      overlaps.push({
        section: sec.name,
        gapIndex: gapMatch ? Number(gapMatch[1]) : -1,
        key: k,
        maxVcm: v.maxV * 100,
      })
    }
    totalAboveTD += aboveTD
    totalSubTD += subTD
    totalOverlapPairs += ovl.length
    console.log(
      `\n=== ${sec.name}: regions=${regions.length} holesAboveTD=${aboveTD} holesSubTD=${subTD} diffLithoOverlapPairs=${ovl.length}`,
    )
    for (const s of holeSamples) console.log('   HOLE-aboveTD  ', s)
    for (const [k, v] of ovl.slice(0, 6))
      console.log(`   OVLP   ${k} maxVertOverlap=${(v.maxV * 100).toFixed(1)}cm`)
  }
  console.log(
    `\n########## V2 TOTALS: holesAboveTD=${totalAboveTD} holesSubTD=${totalSubTD} overlapPairs=${totalOverlapPairs} ##########`,
  )
  return { totalAboveTD, totalSubTD, totalOverlapPairs, aboveHoles, overlaps }
}

describe('v2 holes + different-litho overlaps HARD GATE (S38)', () => {
  if (process.env.HOLES_DIAG !== '1') {
    it.skip('dormant (set HOLES_DIAG=1)', () => {})
    return
  }

  const raw = existsSync(INPUT)
    ? (JSON.parse(readFileSync(INPUT, 'utf8')) as { sections: RawSection[]; formationNames: Record<string, string> })
    : null

  // FLAG-OFF: the default engine state must be a TRUE partition — no holes anywhere, no
  // different-litho overlaps. Byte-identical to the pre-campaign engine (§37 baseline).
  it('FLAG-OFF: true partition on all 14 sections (0/0/0)', () => {
    expect(existsSync(INPUT)).toBe(true)
    console.log('\n===== FLAG-OFF (default engine state) =====')
    const res = scanAllSections(raw!)
    expect(res.totalAboveTD, 'flag-OFF above-TD interior holes must be 0 (true partition)').toBe(0)
    expect(res.totalSubTD, 'flag-OFF sub-TD holes must be 0 (deep-to-deep substrate closes them)').toBe(0)
    expect(res.totalOverlapPairs, 'flag-OFF different-litho overlap pairs must be 0').toBe(0)
  })

  // FLAG-ON: the product path. The ONE accepted above-TD hole baseline is CS2-g17 (the
  // sloping-enclosure wall). Assert every above-TD hole sits at Cross-section 2 gap 17 —
  // pinned BY IDENTITY, not a loose total. A count drop at g17 is fine; a new above-TD
  // hole at ANY other (section, gap) fails. Sub-TD holes 0, different-litho overlaps 0.
  it('FLAG-ON: above-TD holes ONLY at Cross-section 2 gap 17 (the accepted wall)', () => {
    expect(existsSync(INPUT)).toBe(true)
    console.log('\n===== FLAG-ON (setTwoSidedTerminations(true)) =====')
    const prev = setTwoSidedTerminations(true)
    let res: ScanResult
    try {
      res = scanAllSections(raw!)
    } finally {
      setTwoSidedTerminations(prev)
    }
    // ZERO above-TD holes on the product path (session 49). The CS1-g3 / CS2-g17 / CS2-g21
    // annulus "walls" are CLOSED: they were never the merge-annulus rebuild §49 feared but a
    // FLOOD/LENS APEX DIVERGENCE — under ruling 8b-rev the corr-0 lens apex reaches 0.45·gap while
    // the corr-0 flood wedge converged at the gap MIDPOINT (0.50·gap), leaving a razor-thin
    // double-covered sliver at every interior corr-0 lens. Converging the flood AT the lens apex
    // (``emitFloodWedge``, ruling 8g/8q — "the matrix detours around the wedge") makes the
    // enclosing-matrix band own the space past the apex hole-free. So the invariant is now
    // absolute: no above-TD hole anywhere.
    const offMsg = res.aboveHoles.map((h) => `${h.section} ${h.detail}`).join('; ')
    expect(
      res.aboveHoles.length,
      `flag-ON above-TD holes must be ZERO (session 49 flood-apex fix). Holes found: ${offMsg || '(none)'}`,
    ).toBe(0)
    // Sub-TD holes must be 0 on the product path.
    expect(res.totalSubTD, 'flag-ON sub-TD holes must be 0').toBe(0)
    // RULING 8n / 8b-rev (owner, "0.45 stands, matrix detours" + "the wrap may not cross a given
    // tie/band line"): the last different-litho overlap is GONE. History: the session-49 flood-apex
    // fix (flood converges AT the lens apex) killed two of the three original slivers (CS1-g5
    // ZAND×SILT 14.7cm, CS2-g13 ZAND×KLEI 2.8cm); the last (CS2-g13 KLEI(quad)×ZAND 24.3cm) was a
    // BAND-INTERVAL collision: the ZAND matched-pair band's BASE contour (``bandc``, a sloping
    // correlation line) crossed the KLEI interbed lens's 0.45 diamond, but ``interiorLensReachToTies``
    // only fitted against resolved TIES, not band contours. Session 50 added the gap's matched-pair
    // band contours to the lens collision brackets (``gapBandContourBrackets`` in ``drawTermination``)
    // so the diamond shortens to fit strictly inside them — the SAME tie-fit ladder, a band contour
    // IS a bracket, no new guard. The engine is now a TRUE partition: holes 0/0, overlaps 0/0. Any
    // NEW different-litho overlap ANYWHERE is a regression and fails this gate.
    const offMsgO = res.overlaps.map((o) => `${o.section} ${o.key} ${o.maxVcm.toFixed(1)}cm`).join('; ')
    expect(
      res.overlaps.length,
      `flag-ON different-litho overlaps must be ZERO (session 50 band-contour lens clamp). Overlaps found: ${offMsgO || '(none)'}`,
    ).toBe(0)
  })
})
