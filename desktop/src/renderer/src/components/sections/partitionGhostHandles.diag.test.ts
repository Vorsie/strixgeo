/**
 * partitionGhostHandles.diag.test.ts — the ALL-SECTIONS RENDERED-HANDLE gate (SESSION 77).
 *
 * The owner ruling (2026-07-22): the 24 residual DEAD apex handles measured in S76
 * are GHOST CONTACTS (interior convergence tips of a continuous same-litho band,
 * merge-welded then engine-suppressed by ruling 8m). They must render NO grab
 * handle — every handle the tool shows must reshape.
 *
 * THIS is the load-bearing gate: it drives ``detectDeadHandleBodies`` (the exact
 * probe the overlay memoises) across all 14 real sections and asserts that of the
 * handles ACTUALLY RENDERED after suppression (``shapeable − deadHandleBodies``),
 * DEAD-among-rendered == 0 — i.e. EVERY handle the owner is offered reshapes. It
 * also confirms the suppressed count matches the S76 dead measurement so a future
 * engine change that revives a tip shrinks the suppression rather than hiding a bug.
 *
 * Gated ``CS1_GATE=1`` (real ``scripts/diag_allsections_input.json``); skips in the
 * normal suite (the input JSON is a large gitignored dev artefact).
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  type CorrelationEdge,
  type PartitionColumn,
  type SectionRegion,
} from '../../utils/sectionPartition'
import { computeSectionFillV2 } from '../../utils/partitionFillV2'
import { setTwoSidedTerminations } from '../../utils/partitionFillV2/tileFlags'
import { isApexShapeable } from './partitionFillOverlayHelpers'
import { bodyFootprintSig, detectDeadHandleBodies } from './partitionGhostHandles'

const RUN = process.env.CS1_GATE === '1'
const HERE = dirname(fileURLToPath(import.meta.url))
// This file sits in ``components/sections/`` (5 levels under ``desktop/``); the
// S76 gate in ``utils/`` is 4. Resolve up to the repo root either way.
const REPO_ROOT = resolve(HERE, '../../../../../..')
const INPUT = resolve(REPO_ROOT, 'scripts/diag_allsections_input.json')

/** Every real section name in the all-sections diag input. */
const ALL_SECTIONS = [
  'Tie-section 4', 'Tie-section 13', 'Tie-section 5', 'Tie-section 6', 'Tie-section 7',
  'Tie-section 8', 'Tie-section 9', 'Tie-section 10', 'Tie-section 11', 'Tie-section 12',
  'Tie-section 14', 'Cross-section 3', 'Cross-section 1', 'Cross-section 2',
]

/** Build a real section from the all-sections diag input (drops empty columns; real alongM). */
function realSection(name: string): { columns: PartitionColumn[]; edges: CorrelationEdge[]; alongM: number[] } {
  const raw = JSON.parse(readFileSync(INPUT, 'utf8'))
  const sec = raw.sections.find((s: { name: string }) => s.name === name)
  if (!sec) throw new Error(`section ${name} not in diag input`)
  const keep = sec.columns
    .map((c: { surfaceElevM: number | null; units: unknown[] }, i: number) => ({ c, i }))
    .filter(({ c }: { c: { surfaceElevM: number | null; units: unknown[] } }) => c.surfaceElevM != null && c.units.length > 0)
  const columns: PartitionColumn[] = keep.map(({ c }: { c: { investigationId: string; surfaceElevM: number; units: unknown[] } }) => ({
    investigationId: c.investigationId,
    surfaceElevM: c.surfaceElevM,
    units: c.units as PartitionColumn['units'],
  }))
  const alongM = keep.map(({ i }: { i: number }) => sec.alongM[i])
  const edges: CorrelationEdge[] = sec.edges.map((e: { a: string; b: string; aSide?: string; bSide?: string }) => ({
    a: e.a,
    b: e.b,
    aSide: (e.aSide ?? 'top') as 'top' | 'base',
    bSide: (e.bSide ?? 'top') as 'top' | 'base',
  }))
  return { columns, edges, alongM }
}

/** The v2 engine, with the terminations-first sweep flag ON (the app's active v2). */
function computeV2(
  columns: readonly PartitionColumn[],
  edges: readonly CorrelationEdge[],
  overrides: Parameters<typeof computeSectionFillV2>[2],
  alongM: readonly number[] | undefined,
): SectionRegion[] {
  const prev = setTwoSidedTerminations(true)
  try {
    return computeSectionFillV2(columns, edges, overrides, alongM)
  } finally {
    setTwoSidedTerminations(prev)
  }
}

describe.skipIf(!RUN)('S77 GHOST-handle suppression — every RENDERED handle reshapes', () => {
  it('across all 14: DEAD-among-rendered == 0 (ghost tips suppressed)', { timeout: 300000 }, () => {
    let totalShapeable = 0
    let totalRendered = 0
    let totalSuppressed = 0
    let deadAmongRendered = 0
    const perSection: string[] = []

    for (const name of ALL_SECTIONS) {
      const { columns, edges, alongM } = realSection(name)
      const base = computeV2(columns, edges, undefined, alongM)
      const shapeable = base.filter((r): r is SectionRegion & { bodyId: string } => !!r.bodyId && isApexShapeable(r))

      // The exact probe the overlay memoises: the DEAD (ghost) set to suppress.
      const dead = detectDeadHandleBodies(base, columns, edges, alongM, computeV2)

      // The handles ACTUALLY RENDERED after suppression = shapeable − dead.
      const rendered = shapeable.filter((r) => !dead.has(`${r.gapIndex}:${r.bodyId}`))

      // Load-bearing: of the rendered handles, EVERY one must reshape. Re-probe the
      // rendered set directly (independent of ``dead``) so the gate cannot pass by a
      // bookkeeping coincidence — it asserts the real post-suppression behaviour.
      let sectionDead = 0
      for (const r of rendered) {
        const singleDead = detectDeadHandleBodies(base, columns, edges, alongM, computeV2, [r])
        if (singleDead.size > 0) {
          sectionDead++
          deadAmongRendered++
        }
      }

      totalShapeable += shapeable.length
      totalRendered += rendered.length
      totalSuppressed += dead.size
      perSection.push(`${name}: shapeable=${shapeable.length} rendered=${rendered.length} suppressed=${dead.size} deadAmongRendered=${sectionDead}`)
    }

    // eslint-disable-next-line no-console
    console.info(
      `[S77 GHOST] shapeable=${totalShapeable} RENDERED=${totalRendered} suppressed=${totalSuppressed} ` +
        `DEAD-among-rendered=${deadAmongRendered}\n  ` +
        perSection.join('\n  '),
    )

    // THE OWNER RULING in test form: every handle the tool shows reshapes.
    expect(deadAmongRendered, `${deadAmongRendered} DEAD handle(s) still RENDERED — a ghost tip shows a grab affordance`).toBe(0)
    // The suppression is the ghost class (S76 measured 24 dead across all 14). It
    // must not silently swallow LIVE handles: rendered ≈ the S75 consumed count.
    expect(totalRendered, 'suppression removed live handles (rendered < 130)').toBeGreaterThanOrEqual(130)
    expect(totalSuppressed, 'suppressed count drifted far from the S76 ghost measurement (24)').toBeLessThanOrEqual(40)
  })
})

/**
 * RED-first micro-gate (real CS1): a KNOWN ghost tip (a same-litho FLOOD-convergence
 * interior seam — S76's engine-suppressed 8m class) must be in the DEAD set, while
 * a KNOWN live tip (a region whose single override DOES move its footprint) must NOT
 * be. This is the behaviour-shaped assertion the suppression is built to satisfy:
 * ghost → no handle; live → handle.
 */
describe.skipIf(!RUN)('S77 GHOST detection — ghost is dead, live is not', () => {
  it('CS1: at least one ghost tip is DEAD and at least one live tip is NOT', { timeout: 120000 }, () => {
    const { columns, edges, alongM } = realSection('Cross-section 1')
    const base = computeV2(columns, edges, undefined, alongM)
    const shapeable = base.filter((r): r is SectionRegion & { bodyId: string } => !!r.bodyId && isApexShapeable(r))
    const dead = detectDeadHandleBodies(base, columns, edges, alongM, computeV2)

    const live = shapeable.filter((r) => !dead.has(`${r.gapIndex}:${r.bodyId}`))
    const ghosts = shapeable.filter((r) => dead.has(`${r.gapIndex}:${r.bodyId}`))

    // CS1 has both classes (S76: consumed live tips + same-litho ghost tips).
    expect(ghosts.length, 'CS1 has no ghost tips — expected same-litho convergence seams').toBeGreaterThan(0)
    expect(live.length, 'CS1 has no live tips — expected enclosed lenses / bracketed onlaps').toBeGreaterThan(0)

    // A ghost's footprint is byte-static under its own override (that IS why it is a
    // ghost); a live tip's footprint moves. Confirm the discriminator directly.
    const ghost = ghosts[0]
    const gBefore = bodyFootprintSig(base, ghost.bodyId, ghost.gapIndex)
    expect(
      detectDeadHandleBodies(base, columns, edges, alongM, computeV2, [ghost]).size,
      `ghost ${ghost.gapIndex}:${ghost.bodyId} sig=${gBefore.slice(0, 40)} is not byte-static`,
    ).toBe(1)
    const liveTip = live[0]
    expect(
      detectDeadHandleBodies(base, columns, edges, alongM, computeV2, [liveTip]).size,
      `live ${liveTip.gapIndex}:${liveTip.bodyId} was flagged dead`,
    ).toBe(0)
  })
})
