/**
 * unsafeDragUX.rules.test.ts — SESSION 80 owner UX decision "red handle and snapback".
 *
 * When a live free-draw drag reaches a position the engine REJECTS as unsafe (would gap /
 * overlap → S79 ``OverrideOutcome.status === 'rejected-unsafe'``), the handle must render RED and
 * on mouse RELEASE the handle must SNAP BACK to the last applied (safe) geometry — the unsafe node
 * is NOT persisted. These are the pure DECISION primitives the overlay wiring consumes:
 *
 *   (RED-1)  the dragged body's handle renders RED while its live outcome is ``rejected-unsafe``;
 *            an ``applied`` (safe) drag keeps the normal handle colour; a body that is NOT the one
 *            being dragged is never recoloured (only the actively-dragged handle changes).
 *   (RED-2)  a drag that ends ``rejected-unsafe`` must NOT persist (snap back to the last applied
 *            geometry); a drag that ends ``applied`` persists normally.
 *
 * Each rule is proven RED against the current code (``unsafeDragUX.ts`` is absent) and turns GREEN
 * only when the Session-80 helper lands. Rule-3 (a supported drag stays normal + persists) is
 * covered by the ``applied``-branch assertions here and by the component render tests in
 * ``PartitionFillOverlay.unsafeDrag.test.tsx``.
 *
 * The ``rejected-unsafe`` outcome is produced on REAL CS1 (``scripts/diag_allsections_input.json``),
 * the campaign's hard rule — an aggressive multi-tip reach the S79 defect guard rejects.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  type CorrelationEdge,
  type LensApexOverride,
  lensApexOverrideKey,
  type PartitionColumn,
  type SectionRegion,
} from '../../utils/sectionPartition'
import { computeSectionFillV2 } from '../../utils/partitionFillV2'
import { classifyOverrideOutcome } from '../../utils/partitionFillV2/computeSectionFillV2'
import { setTwoSidedTerminations } from '../../utils/partitionFillV2/tileFlags'
import {
  type EditableTargetIdentity,
  handleColorForTarget,
  isDragRejected,
  type OverrideStatus,
  REJECT_COLOR,
  sameEditableTarget,
  shouldPersistDrag,
} from './unsafeDragUX'

const RUN = process.env.CS1_GATE === '1'
const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../../..')
const INPUT = resolve(REPO_ROOT, 'scripts/diag_allsections_input.json')

const NORMAL_COLOR = '#f59e0b' // LENS_COLOR (amber-400)

const TIP_FRACTION_EPS = 0.02
function isApexShapeable(region: SectionRegion): boolean {
  if (region.kind === 'lens') return true
  let fMin = Infinity
  let fMax = -Infinity
  let hasInteriorVertex = false
  for (const p of region.polygon) {
    if (p.fraction < fMin) fMin = p.fraction
    if (p.fraction > fMax) fMax = p.fraction
    if (p.fraction > TIP_FRACTION_EPS && p.fraction < 1 - TIP_FRACTION_EPS) hasInteriorVertex = true
  }
  const spansFullWidth = fMin <= TIP_FRACTION_EPS && fMax >= 1 - TIP_FRACTION_EPS
  return hasInteriorVertex && !spansFullWidth
}

function realSection(name: string): { columns: PartitionColumn[]; edges: CorrelationEdge[]; alongM: number[] } {
  const raw = JSON.parse(readFileSync(INPUT, 'utf8'))
  const sec = raw.sections.find((s: { name: string }) => s.name === name)
  if (!sec) throw new Error(`section ${name} not in diag input`)
  const keep = sec.columns
    .map((c: { surfaceElevM: number | null; units: unknown[] }, i: number) => ({ c, i }))
    .filter(({ c }: { c: { surfaceElevM: number | null; units: unknown[] } }) => c.surfaceElevM != null && c.units.length > 0)
  const columns: PartitionColumn[] = keep.map(
    ({ c }: { c: { investigationId: string; surfaceElevM: number; units: unknown[] } }) => ({
      investigationId: c.investigationId,
      surfaceElevM: c.surfaceElevM,
      units: c.units as PartitionColumn['units'],
    }),
  )
  const alongM = keep.map(({ i }: { i: number }) => sec.alongM[i])
  const edges: CorrelationEdge[] = sec.edges.map((e: { a: string; b: string; aSide?: string; bSide?: string }) => ({
    a: e.a,
    b: e.b,
    aSide: (e.aSide ?? 'top') as 'top' | 'base',
    bSide: (e.bSide ?? 'top') as 'top' | 'base',
  }))
  return { columns, edges, alongM }
}

// ===========================================================================
// Pure decision primitives — no real data needed (they operate on the status
// the engine already computed). These lock the OWNER decision "red + snapback".
// ===========================================================================
describe('unsafeDragUX — pure decision primitives', () => {
  it('isDragRejected is true for BOTH rejected statuses (unsafe + collapse), false otherwise', () => {
    expect(isDragRejected('rejected-unsafe')).toBe(true)
    expect(isDragRejected('rejected-collapse')).toBe(true) // S97 over-reach collapse → snap back too
    expect(isDragRejected('applied')).toBe(false)
    expect(isDragRejected('unsupported')).toBe(false)
    expect(isDragRejected(null)).toBe(false)
  })

  // (The body-level ``handleFillColor`` was REMOVED in §87 — superseded by the exact-identity
  //  ``handleColorForTarget`` below, which reddens only the dragged node, not every same-body handle.)

  it('shouldPersistDrag is false for BOTH rejected releases (snap-back), true otherwise', () => {
    expect(shouldPersistDrag('rejected-unsafe')).toBe(false) // snap back — do not persist the unsafe node
    expect(shouldPersistDrag('rejected-collapse')).toBe(false) // S97 over-reach collapse → snap back too
    expect(shouldPersistDrag('applied')).toBe(true) // safe reshape persists normally
    expect(shouldPersistDrag('unsupported')).toBe(true) // no override / v1 → today's behaviour (persist)
    expect(shouldPersistDrag(null)).toBe(true)
  })
})

// ===========================================================================
// §87 EXACT-IDENTITY primitives (CONFIRMED BUG #1: body-level reddening is too
// broad). A rejected drag must redden ONLY the exact dragged node, never every
// handle that shares the bodyId. The identity discriminates a lens node
// (bodyId + gap + edge + nodeIndex) from a boundary node (upper+lower body + gap
// + nodeIndex), so a body with several handles / a shared-boundary handle keeps
// its OTHER handles normal.
// ===========================================================================
describe('unsafeDragUX — exact editable-target identity (§87 BUG #1)', () => {
  const lensA0up: EditableTargetIdentity = { kind: 'lens', bodyId: 'A', gapIndex: 0, edge: 'upper', nodeIndex: 0 }
  const lensA0lo: EditableTargetIdentity = { kind: 'lens', bodyId: 'A', gapIndex: 0, edge: 'lower', nodeIndex: 0 }
  const lensA0up1: EditableTargetIdentity = { kind: 'lens', bodyId: 'A', gapIndex: 0, edge: 'upper', nodeIndex: 1 }
  const lensA5up: EditableTargetIdentity = { kind: 'lens', bodyId: 'A', gapIndex: 5, edge: 'upper', nodeIndex: 0 }
  const boundA_B0: EditableTargetIdentity = { kind: 'boundary', upperBodyId: 'A', lowerBodyId: 'B', gapIndex: 0, nodeIndex: 0 }

  it('sameEditableTarget is true only for a byte-for-byte identity match', () => {
    expect(sameEditableTarget(lensA0up, { ...lensA0up })).toBe(true)
    // Same body, DIFFERENT edge / node / gap → NOT the same target.
    expect(sameEditableTarget(lensA0up, lensA0lo)).toBe(false) // other edge of the SAME lens node position
    expect(sameEditableTarget(lensA0up, lensA0up1)).toBe(false) // other node index
    expect(sameEditableTarget(lensA0up, lensA5up)).toBe(false) // other gap (two-gap copy)
    // A lens node and a boundary node of the same body are different kinds → never equal.
    expect(sameEditableTarget(lensA0up, boundA_B0)).toBe(false)
    // Null / absent target never matches.
    expect(sameEditableTarget(lensA0up, null)).toBe(false)
    expect(sameEditableTarget(null, null)).toBe(false)
  })

  it('handleColorForTarget reddens ONLY the exact rejected node — a sibling handle of the same body stays normal', () => {
    // Body A is dragged on its upper node 0 into a rejection.
    const rejected = lensA0up
    // The dragged node → red.
    expect(handleColorForTarget(lensA0up, rejected, NORMAL_COLOR)).toBe(REJECT_COLOR)
    // A DIFFERENT handle of the SAME body A (BUG #1 reddened all of these) → normal.
    expect(handleColorForTarget(lensA0lo, rejected, NORMAL_COLOR)).toBe(NORMAL_COLOR)
    expect(handleColorForTarget(lensA0up1, rejected, NORMAL_COLOR)).toBe(NORMAL_COLOR)
    expect(handleColorForTarget(lensA5up, rejected, NORMAL_COLOR)).toBe(NORMAL_COLOR)
    // A shared-boundary handle whose upper body is A → normal (BUG #1 reddened it too).
    expect(handleColorForTarget(boundA_B0, rejected, NORMAL_COLOR)).toBe(NORMAL_COLOR)
    // No rejection active → everything normal.
    expect(handleColorForTarget(lensA0up, null, NORMAL_COLOR)).toBe(NORMAL_COLOR)
  })

  it('handleColorForTarget reddens the exact boundary node without touching the body’s lens handles', () => {
    const rejected = boundA_B0
    expect(handleColorForTarget(boundA_B0, rejected, NORMAL_COLOR)).toBe(REJECT_COLOR)
    // The same upper body A also owns a lens handle → it must stay normal.
    expect(handleColorForTarget(lensA0up, rejected, NORMAL_COLOR)).toBe(NORMAL_COLOR)
  })
})

// ===========================================================================
// RED-1 + RED-2 driven by a REAL CS1 rejected-unsafe outcome — the status the
// overlay reads per frame drives the red handle + the snap-back.
// ===========================================================================
describe.skipIf(!RUN)('unsafeDragUX on a real CS1 rejected-unsafe outcome', () => {
  function realRejectedOutcome(): { status: OverrideStatus; rejectedTarget: EditableTargetIdentity } {
    const { columns, edges, alongM } = realSection('Cross-section 1')
    const base = computeSectionFillV2(columns, edges, undefined, alongM)
    const shapeable = base.filter((r) => r.bodyId != null && isApexShapeable(r))
    const ov = new Map<string, LensApexOverride>()
    for (const r of shapeable) {
      const elevs = r.polygon.map((p) => p.elevation)
      const midElev = (Math.max(...elevs) + Math.min(...elevs)) / 2
      // 1.8 = far past the far column → an unsafe extreme clip for stacked tips (mirrors the S79 Rule-3
      // aggressive reach the defect guard rejects).
      ov.set(lensApexOverrideKey(r.bodyId as string, r.gapIndex), { fraction: 1.8, elevation: midElev })
    }
    const outcome = classifyOverrideOutcome(columns, edges, ov, alongM)
    // The EXACT node the first shapeable region's upper handle represents (§87 identity).
    const first = shapeable[0]!
    const rejectedTarget: EditableTargetIdentity = {
      kind: 'lens',
      bodyId: first.bodyId as string,
      gapIndex: first.gapIndex,
      edge: 'upper',
      nodeIndex: 0,
    }
    return { status: outcome.status, rejectedTarget }
  }

  it('RED-1 — a rejected-unsafe drag drives a RED handle for the EXACT dragged node only', () => {
    setTwoSidedTerminations(true)
    try {
      const { status, rejectedTarget } = realRejectedOutcome()
      // The aggressive multi-tip reach must be rejected on real CS1 (else the fixture is not exercising
      // the unsafe path — a bug-class problem per the campaign's RED discipline).
      expect(status, `expected rejected-unsafe on the aggressive reach, got ${status}`).toBe('rejected-unsafe')
      // The dragged node → red; a SIBLING node of the same body (its lower edge) stays normal (§87).
      const active = isDragRejected(status) ? rejectedTarget : null
      expect(handleColorForTarget(rejectedTarget, active, NORMAL_COLOR)).toBe(REJECT_COLOR)
      const sibling: EditableTargetIdentity = { ...rejectedTarget, edge: 'lower' } as EditableTargetIdentity
      expect(handleColorForTarget(sibling, active, NORMAL_COLOR)).toBe(NORMAL_COLOR)
    } finally {
      setTwoSidedTerminations(false)
    }
  })

  it('RED-2 — releasing at a rejected-unsafe position does NOT persist (snap back)', () => {
    setTwoSidedTerminations(true)
    try {
      const { status } = realRejectedOutcome()
      expect(status).toBe('rejected-unsafe')
      // On release the overlay must NOT call onSaveBoundary with the unsafe node.
      expect(shouldPersistDrag(status)).toBe(false)
    } finally {
      setTwoSidedTerminations(false)
    }
  })
})
