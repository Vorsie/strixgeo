/**
 * GAPLESS GATE REPLAY — clauses 1-3 over the owner's real gap scenes.
 *
 * The clause LOGIC is pinned on synthetic scenes in ``gaplessGate/clauses2d.
 * test.ts``, ``sectionClosure.test.ts`` and ``index.test.ts``. THIS arm reads
 * the same live dump ``geotechGapWeld.diag.test.ts`` replays
 * (``scripts/geofill_live_dump.json`` — each entry carries a
 * ``HierarchicalGeotechFillInput`` verbatim, written by the app's own
 * ``__GEOFILL_SAVE()`` probe) and runs the three 2-D clauses over every gap
 * scene it contains, so the gate's verdict on the CURRENT model is visible
 * without opening the app.
 *
 * CLAUSE 4 IS OUT OF SCOPE HERE, deliberately. Section-closure compares a
 * whole BUILD's litho-frame section set against what actually landed in the
 * payload (``buildVoxelRequest``'s own ``frameBySectionId`` vs ``out``); the
 * live dump is a snapshot of individual GAP scenes, one ``fillGap`` call each,
 * with no section-level frame/payload bookkeeping to replay. Clause 4 has its
 * own wiring test instead (``buildVoxelRequest.gaplessGate.test.ts``).
 *
 * Each dump entry has no section id/name of its own (it is a gap scene, not a
 * section) — the dump's own key stands in for both, so a violation line reads
 * exactly like the entry it points back to (matching ``geotechGapWeld.diag.
 * test.ts``'s own convention).
 *
 * INPUT      scripts/geofill_live_dump.json — an UNTRACKED read-only capture
 *            written by the app's own ``__GEOFILL_SAVE()`` probe while
 *            dogfeeding (see ``geotechGapWeld.diag.test.ts`` for how it is
 *            produced). Dormant — skipped, not failed — when this file is
 *            absent, matching that sibling's own convention for this dump.
 * REPORT     scripts/throwaway_gapless_gate.txt, every armed run.
 *
 * Dormant unless GAPLESS_GATE=1.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { clauses2dForSection } from './gaplessGate/clauses2d'
import {
  computeHierarchicalGeotechFill,
  type HierarchicalGeotechFillInput,
} from './geotechHierarchicalFill'
import type { SectionRegion } from './sectionPartition'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const DUMP = resolve(REPO_ROOT, 'scripts/geofill_live_dump.json')
const REPORT = resolve(REPO_ROOT, 'scripts/throwaway_gapless_gate.txt')

interface LiveEntry {
  inputs: Omit<HierarchicalGeotechFillInput, 'packingClassOf'> & {
    packingClassOf: [string, string][]
  }
  regions: SectionRegion[]
}

describe('gapless gate replay — clauses 1-3 on the live model', () => {
  if (process.env.GAPLESS_GATE !== '1' || !existsSync(DUMP)) {
    it.skip('dormant (set GAPLESS_GATE=1 with scripts/geofill_live_dump.json present)', () => {})
    return
  }

  it('reports what clauses 1-3 say about every scene in the dump', () => {
    const NL = String.fromCharCode(10)
    const dump = JSON.parse(readFileSync(DUMP, 'utf8')) as Record<string, LiveEntry>
    const lines: string[] = []
    let scenes = 0
    let failingClauses = 0
    let notEvaluated = 0

    for (const key of Object.keys(dump)) {
      const entry = dump[key]
      const classOf = new Map(entry.inputs.packingClassOf)
      const hierarchical = computeHierarchicalGeotechFill({ ...entry.inputs, packingClassOf: classOf })
      const clauses = clauses2dForSection({
        sectionId: key,
        sectionName: key,
        hierarchical,
        lithoRegions: entry.inputs.lithoRegions,
        alongM: entry.inputs.alongM,
        // The dump's own litho columns — the list the scene's gap indices are
        // valid against, exactly as ``buildVoxelRequest`` supplies the frame's.
        columnInvestigationIds: entry.inputs.lithoColumns.map(c => c.investigationId),
      })
      scenes += 1
      lines.push(`########## ${key}`)
      for (const clause of clauses) {
        lines.push(`  ${clause.key}: ${clause.status}`)
        if (clause.status === 'not-evaluated') {
          notEvaluated += 1
          lines.push(`    reason: ${clause.notEvaluatedReason}`)
        }
        if (clause.status === 'fail') {
          failingClauses += 1
          for (const e of clause.entries) lines.push(`    - ${e.label}`)
        }
      }
    }

    lines.unshift(
      `scenes=${scenes} failingClauseInstances=${failingClauses} notEvaluatedClauseInstances=${notEvaluated}`,
      '',
    )
    writeFileSync(REPORT, lines.join(NL) + NL, 'utf8')
    console.info(lines.join(NL))
    // Report-only on live data, matching every other diag arm in this repo:
    // the dump is a snapshot of a model mid-edit, so a red here must not
    // block a suite. The rule is enforced on the synthetic pins.
    expect(scenes).toBeGreaterThan(0)
  })
})
