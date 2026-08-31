/**
 * usePartitionGhostHandles.test.ts — the S78 perf-fix gates (pure parts).
 *
 * Two properties the deferred/keyed probe must hold, both testable WITHOUT a real
 * section (no DB, no diag JSON — synthetic columns) so they run in the normal suite:
 *
 *  1. ``topologyKey`` is STABLE under a pan/zoom — it serialises only the drag-
 *     independent VALUES (unit stacks / edges / along-metres / engine), so a change
 *     that touches ONLY screen x (which the key never reads) yields the SAME key →
 *     the memoised probe is reused, never re-run. It DIFFERS on any genuine topology
 *     change (a unit depth / a new edge / an along-metre / the engine flag).
 *
 *  2. Chunked accumulation == whole-set: the DEAD set is independent per region, so
 *     splitting the shapeable regions into arbitrary chunks and unioning the per-chunk
 *     ``detectDeadHandleBodies`` results reproduces the single-call result. (The hook
 *     accumulates exactly this way across idle callbacks.)
 *
 * The all-14-real-sections byte-equality of the oracle itself is pinned by
 * ``partitionGhostHandles.diag.test.ts`` (CS1_GATE=1); this file guards the S78
 * scheduling/keying layer that governs WHEN it runs.
 */
import { describe, expect, it } from 'vitest'

import {
  type CorrelationEdge,
  type PartitionColumn,
  type PartitionUnit,
  type SectionRegion,
} from '../../utils/partitionFill'
import { computeSectionFillV2 } from '../../utils/partitionFillV2'
import { setTwoSidedTerminations } from '../../utils/partitionFillV2/tileFlags'
import { isApexShapeable } from './partitionFillOverlayHelpers'
import { detectDeadHandleBodies } from './partitionGhostHandles'
import { topologyKey } from './usePartitionGhostHandles'

/** A tiny 3-column synthetic section with an enclosed lens (guaranteed a shapeable tip). */
function synthSection(): { columns: PartitionColumn[]; edges: CorrelationEdge[]; alongM: number[] } {
  const u = (
    layerId: string,
    formationId: string,
    bodyId: string,
    topDepthM: number,
    baseDepthM: number,
  ): PartitionUnit => ({ layerId, formationId, bodyId, topDepthM, baseDepthM })
  // Sand matrix on all three columns; a clay lens present ONLY on the middle column
  // → the middle clay pinches out into both gaps (an enclosed lens = shapeable tip).
  const columns: PartitionColumn[] = [
    {
      investigationId: 'L',
      surfaceElevM: 10,
      units: [u('l-sand', 'sand', 'b-sand', 0, 8)],
    },
    {
      investigationId: 'M',
      surfaceElevM: 10,
      units: [u('m-sand-top', 'sand', 'b-sand', 0, 3), u('m-clay', 'clay', 'b-clay', 3, 5), u('m-sand-bot', 'sand', 'b-sand', 5, 8)],
    },
    {
      investigationId: 'R',
      surfaceElevM: 10,
      units: [u('r-sand', 'sand', 'b-sand', 0, 8)],
    },
  ]
  // Correlate the sand tops so a continuous sand band forms (the lens sits inside it).
  const edges: CorrelationEdge[] = [
    { a: 'l-sand', b: 'm-sand-top', aSide: 'top', bSide: 'top' },
    { a: 'm-sand-top', b: 'r-sand', aSide: 'top', bSide: 'top' },
  ]
  return { columns, edges, alongM: [0, 50, 100] }
}

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

describe('S78 topologyKey — stable under pan/zoom, distinct on topology change', () => {
  const { columns, edges, alongM } = synthSection()

  it('identical inputs → identical key', () => {
    expect(topologyKey(columns, edges, alongM)).toBe(topologyKey(columns, edges, alongM))
  })

  it('the key ignores screen x (it never reads placedColumns / nudgedX)', () => {
    // The key is built ONLY from columns/edges/alongM/engine — there is no screen
    // input to it, so a pan/zoom (which changes only nudgedX elsewhere) cannot alter
    // it. Passing the SAME topology twice is exactly what a pan does to this hook.
    const before = topologyKey(columns, edges, alongM)
    // Simulate a re-render with fresh object identities but identical VALUES (what a
    // pan produces: colByInv/screenByInv rebuild, unit values unchanged).
    const columns2 = columns.map((c) => ({ ...c, units: c.units.map((u) => ({ ...u })) }))
    const edges2 = edges.map((e) => ({ ...e }))
    const alongM2 = [...alongM]
    expect(topologyKey(columns2, edges2, alongM2)).toBe(before)
  })

  it('a unit depth change → different key', () => {
    const moved = columns.map((c) =>
      c.investigationId === 'M'
        ? { ...c, units: c.units.map((u) => (u.layerId === 'm-clay' ? { ...u, baseDepthM: 6 } : u)) }
        : c,
    )
    expect(topologyKey(moved, edges, alongM)).not.toBe(topologyKey(columns, edges, alongM))
  })

  it('a new edge → different key', () => {
    const more = [...edges, { a: 'm-sand-bot', b: 'r-sand', aSide: 'base' as const, bSide: 'base' as const }]
    expect(topologyKey(columns, more, alongM)).not.toBe(topologyKey(columns, edges, alongM))
  })

  it('an along-metre shift → different key', () => {
    expect(topologyKey(columns, edges, [0, 60, 100])).not.toBe(topologyKey(columns, edges, alongM))
  })

  it('< 2 columns → empty key', () => {
    expect(topologyKey(columns.slice(0, 1), edges, alongM)).toBe('')
  })
})

describe('S78 chunked accumulation == whole-set (the deferred probe is order-independent)', () => {
  it('union of per-chunk DEAD sets == single-call DEAD set', () => {
    const { columns, edges, alongM } = synthSection()
    const base = computeV2(columns, edges, undefined, alongM)
    const shapeable = base.filter((r): r is SectionRegion & { bodyId: string } => !!r.bodyId && isApexShapeable(r))
    // A meaningful test needs at least one shapeable tip (the enclosed clay lens).
    expect(shapeable.length).toBeGreaterThan(0)

    const whole = detectDeadHandleBodies(base, columns, edges, alongM, computeV2)

    // Chunk the shapeable regions the way the hook does (arbitrary slice size) and
    // union the per-slice results — must equal the single-call set.
    const CHUNK = 2
    const accumulated = new Set<string>()
    for (let i = 0; i < shapeable.length; i += CHUNK) {
      const slice = detectDeadHandleBodies(base, columns, edges, alongM, computeV2, shapeable.slice(i, i + CHUNK))
      for (const k of slice) accumulated.add(k)
    }
    expect([...accumulated].sort()).toEqual([...whole].sort())
  })
})
