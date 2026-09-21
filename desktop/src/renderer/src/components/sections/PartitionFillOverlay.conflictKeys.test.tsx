// CK — the ties the section MARKS are the ties the chip COUNTS.
//
// Owner ruling 2026-08-26 ("mark the crossing ties"). The mark is drawn by
// CorrelationEdgesOverlay, but only the fill engine knows two ties cross — it is what
// suspends them. This is the seam between those two facts, and the property that has to
// hold across it is identity: the keys published here come out of the SAME
// `TieConflict[]` that feeds the warning chip's count.
//
// If a future change ever computes the mark's keys separately, these cases are what
// notices — a chip reading "2 crossing ties" beside a section marking a different pair
// is worse than marking nothing, because it invites the engineer to delete the wrong tie.

import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TieConflict } from '../../utils/partitionFillV2'
import PartitionFillOverlay from './PartitionFillOverlay'
import type { Props } from './PartitionFillOverlay'
import { layer, column } from './__fixtures__/partitionFillScene'

/** Conflicts the mocked engine reports for the next render. */
const mockConflicts: { value: TieConflict[] } = { value: [] }

vi.mock('../../utils/partitionEngineSelect', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../utils/partitionEngineSelect')>()
  return {
    ...orig,
    computeSectionFillActiveWithDiagnostics: () => ({
      regions: [],
      // A FRESH array per call, as the real engine returns — handing back one stable
      // reference would let a re-publish guard that does nothing still look correct.
      conflicts: mockConflicts.value.map(c => ({ ...c })),
      reviewFlags: [],
    }),
  }
})

afterEach(() => {
  cleanup()
})
beforeEach(() => {
  mockConflicts.value = []
})

const BASE: Props = {
  lithoLayers: [layer({ id: 'l1', investigationId: 'L', formationId: 'fSand' }), layer({ id: 'l2', investigationId: 'R', formationId: 'fSand' })],
  placedColumns: [column({ investigationId: 'L', along: 0 }), column({ investigationId: 'R', along: 200 })],
  formationColorById: new Map([['fSand', '#fbbf24']]),
  showBands: true,
  levelToScreen: (l: number) => 100 - l * 10,
  plotTop: 0,
  plotBottom: 400,
}

function conflict(gapIndex: number, a: string, b: string): TieConflict {
  return { gapIndex, tieIds: [a, b], edgeKeys: [a, b] }
}

describe('PartitionFillOverlay — it publishes the conflicting ties it counts', () => {
  it('CK1 — every key of every reported conflict is published', () => {
    mockConflicts.value = [conflict(0, 'k-a', 'k-b')]
    const onChange = vi.fn()

    render(
      <svg>
        <PartitionFillOverlay {...BASE} onConflictEdgeKeysChange={onChange} />
      </svg>,
    )

    expect(onChange).toHaveBeenCalled()
    const published = onChange.mock.calls.at(-1)![0] as ReadonlySet<string>
    expect(new Set(published)).toEqual(new Set(['k-a', 'k-b']))
  })

  it('CK2 — the published set covers BOTH conflicts when two pairs are fighting', () => {
    // The chip would read "2" here; two pairs means four marked ties, not two.
    mockConflicts.value = [conflict(0, 'k-a', 'k-b'), conflict(3, 'k-c', 'k-d')]
    const onChange = vi.fn()

    render(
      <svg>
        <PartitionFillOverlay {...BASE} onConflictEdgeKeysChange={onChange} />
      </svg>,
    )

    const published = onChange.mock.calls.at(-1)![0] as ReadonlySet<string>
    expect(new Set(published)).toEqual(new Set(['k-a', 'k-b', 'k-c', 'k-d']))
  })

  it('CK3 — a section with nothing fighting publishes an empty set', () => {
    mockConflicts.value = []
    const onChange = vi.fn()

    render(
      <svg>
        <PartitionFillOverlay {...BASE} onConflictEdgeKeysChange={onChange} />
      </svg>,
    )

    // It may legitimately not fire at all (nothing changed from the empty start), but if
    // it does fire it must not claim a conflict.
    for (const call of onChange.mock.calls) {
      expect(Array.from(call[0] as ReadonlySet<string>)).toEqual([])
    }
  })

  it('CK4 — an unchanged conflict set is not re-published, even to a fresh callback', () => {
    // A caller that passes an inline arrow hands this a new function identity on every
    // render. Publishing on that alone would set state → re-render → new arrow →
    // publish again: a render loop whose only symptom is a hot section view.
    //
    // The engine result is already content-cached upstream (``engineResultRef``), so the
    // ONLY thing standing between an inline caller and that loop is the content
    // signature — which is what this drives.
    mockConflicts.value = [conflict(0, 'k-a', 'k-b')]
    const onChange = vi.fn()

    const { rerender } = render(
      <svg>
        <PartitionFillOverlay {...BASE} onConflictEdgeKeysChange={keys => onChange(keys)} />
      </svg>,
    )
    const afterFirst = onChange.mock.calls.length
    expect(afterFirst).toBeGreaterThan(0)

    rerender(
      <svg>
        <PartitionFillOverlay {...BASE} onConflictEdgeKeysChange={keys => onChange(keys)} />
      </svg>,
    )

    expect(onChange.mock.calls.length).toBe(afterFirst)
  })

  it('CK5 — the overlay works exactly as before when no one is listening', () => {
    mockConflicts.value = [conflict(0, 'k-a', 'k-b')]

    expect(() =>
      render(
        <svg>
          <PartitionFillOverlay {...BASE} />
        </svg>,
      ),
    ).not.toThrow()
  })
})
