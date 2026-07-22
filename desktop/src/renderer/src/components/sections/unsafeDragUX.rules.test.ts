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
} from '../../utils/partitionFill'
import { computeSectionFillV2 } from '../../utils/partitionFillV2'
import { classifyOverrideOutcome } from '../../utils/partitionFillV2/computeSectionFillV2'
import { setTwoSidedTerminations } from '../../utils/partitionFillV2/tileFlags'
import {
  handleFillColor,
  isDragRejected,
  REJECT_COLOR,
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
  it('isDragRejected is true ONLY for the rejected-unsafe status', () => {
    expect(isDragRejected('rejected-unsafe')).toBe(true)
    expect(isDragRejected('applied')).toBe(false)
    expect(isDragRejected('unsupported')).toBe(false)
    expect(isDragRejected(null)).toBe(false)
  })

  it('handleFillColor recolours ONLY the actively-dragged body when its drag is rejected', () => {
    // The dragged body IS the rejected one → red.
    expect(handleFillColor('bodyA', 'bodyA', NORMAL_COLOR)).toBe(REJECT_COLOR)
    // A different body (or none dragged) → the normal colour, never red.
    expect(handleFillColor('bodyB', 'bodyA', NORMAL_COLOR)).toBe(NORMAL_COLOR)
    expect(handleFillColor('bodyA', null, NORMAL_COLOR)).toBe(NORMAL_COLOR)
  })

  it('shouldPersistDrag is false ONLY for a rejected-unsafe release (snap-back), true otherwise', () => {
    expect(shouldPersistDrag('rejected-unsafe')).toBe(false) // snap back — do not persist the unsafe node
    expect(shouldPersistDrag('applied')).toBe(true) // safe reshape persists normally
    expect(shouldPersistDrag('unsupported')).toBe(true) // no override / v1 → today's behaviour (persist)
    expect(shouldPersistDrag(null)).toBe(true)
  })
})

// ===========================================================================
// RED-1 + RED-2 driven by a REAL CS1 rejected-unsafe outcome — the status the
// overlay reads per frame drives the red handle + the snap-back.
// ===========================================================================
describe.skipIf(!RUN)('unsafeDragUX on a real CS1 rejected-unsafe outcome', () => {
  function realRejectedOutcome(): { status: OverrideStatus; rejectedBody: string } {
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
    return { status: outcome.status, rejectedBody: shapeable[0]!.bodyId as string }
  }

  it('RED-1 — a rejected-unsafe drag drives a RED handle for the dragged body', () => {
    setTwoSidedTerminations(true)
    try {
      const { status, rejectedBody } = realRejectedOutcome()
      // The aggressive multi-tip reach must be rejected on real CS1 (else the fixture is not exercising
      // the unsafe path — a bug-class problem per the campaign's RED discipline).
      expect(status, `expected rejected-unsafe on the aggressive reach, got ${status}`).toBe('rejected-unsafe')
      // The dragged body is the rejected body → its handle renders red.
      const rejectedDragBody = isDragRejected(status) ? rejectedBody : null
      expect(handleFillColor(rejectedBody, rejectedDragBody, NORMAL_COLOR)).toBe(REJECT_COLOR)
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

// Local mirror of the engine status union so the test does not import an internal-only alias.
type OverrideStatus = 'applied' | 'rejected-unsafe' | 'unsupported'
