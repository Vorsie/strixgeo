// Behaviour net for the pre-build enclosed-lens merge fan-out (debt #243).
//
// The rules these cases encode are the owner's, in the owner's words:
//   * "fire it on BUILD, with a report" — the caller gets back counts it can
//     put in a toast, phrased per SECTION and per EDGE.
//   * the merge is section-scoped, so a model-wide run is one call per section.
//   * one section failing must not cost the whole build — the rest still merge.
//   * a re-run must be a no-op the report describes as such (idempotent).
//
// The sequential-not-parallel rule is a correctness rule, not a style one: each
// merge POST re-resolves body identity model-wide and commits, so two in flight
// at once race on the same body_id re-stamp.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  describeEnclosedLensMerge,
  mergeEnclosedLensesForBuild,
  type EnclosedLensMergeReport,
} from './mergeEnclosedLensesForBuild'

const { mergeMock } = vi.hoisted(() => ({ mergeMock: vi.fn() }))

vi.mock('../../../api/client', () => ({
  api: { geology: { mergeEnclosedLenses: mergeMock } },
}))

const SECTIONS = [{ id: 'sec-1' }, { id: 'sec-2' }, { id: 'sec-3' }]

beforeEach(() => {
  mergeMock.mockReset()
})

describe('mergeEnclosedLensesForBuild', () => {
  it('calls the merge once per section — the merge is section-scoped', async () => {
    mergeMock.mockResolvedValue({ edges_created: 0, edges_skipped_existing: 0 })

    await mergeEnclosedLensesForBuild('proj-1', 'model-1', SECTIONS)

    expect(mergeMock).toHaveBeenCalledTimes(3)
    expect(mergeMock.mock.calls.map(c => c[2])).toEqual(['sec-1', 'sec-2', 'sec-3'])
  })

  it('runs the sections one at a time — a second merge never starts before the first resolves', async () => {
    let inFlight = 0
    let maxInFlight = 0
    mergeMock.mockImplementation(async () => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await Promise.resolve()
      inFlight -= 1
      return { edges_created: 1, edges_skipped_existing: 0 }
    })

    await mergeEnclosedLensesForBuild('proj-1', 'model-1', SECTIONS)

    expect(maxInFlight).toBe(1)
  })

  it('reports edges created and how many sections actually merged something', async () => {
    mergeMock
      .mockResolvedValueOnce({ edges_created: 2, edges_skipped_existing: 0 })
      .mockResolvedValueOnce({ edges_created: 0, edges_skipped_existing: 0 })
      .mockResolvedValueOnce({ edges_created: 3, edges_skipped_existing: 1 })

    const report = await mergeEnclosedLensesForBuild('proj-1', 'model-1', SECTIONS)

    expect(report.edgesCreated).toBe(5)
    expect(report.edgesSkippedExisting).toBe(1)
    expect(report.sectionsMerged).toBe(2)
    expect(report.sectionsAttempted).toBe(3)
    expect(report.failedSectionIds).toEqual([])
  })

  it('re-running after everything is already merged reports zero created — idempotent', async () => {
    mergeMock.mockResolvedValue({ edges_created: 0, edges_skipped_existing: 4 })

    const report = await mergeEnclosedLensesForBuild('proj-1', 'model-1', SECTIONS)

    expect(report.edgesCreated).toBe(0)
    expect(report.sectionsMerged).toBe(0)
    expect(report.edgesSkippedExisting).toBe(12)
  })

  it('one section failing does not abort the build — the others still merge', async () => {
    mergeMock
      .mockResolvedValueOnce({ edges_created: 1, edges_skipped_existing: 0 })
      .mockRejectedValueOnce(new Error('500'))
      .mockResolvedValueOnce({ edges_created: 2, edges_skipped_existing: 0 })

    const report = await mergeEnclosedLensesForBuild('proj-1', 'model-1', SECTIONS)

    expect(mergeMock).toHaveBeenCalledTimes(3)
    expect(report.edgesCreated).toBe(3)
    expect(report.failedSectionIds).toEqual(['sec-2'])
  })

  it('with no sections it makes no call at all', async () => {
    const report = await mergeEnclosedLensesForBuild('proj-1', 'model-1', [])

    expect(mergeMock).not.toHaveBeenCalled()
    expect(report.sectionsAttempted).toBe(0)
    expect(report.edgesCreated).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// The report the owner asked for
// ---------------------------------------------------------------------------

function report(over: Partial<EnclosedLensMergeReport> = {}): EnclosedLensMergeReport {
  return {
    edgesCreated: 0,
    edgesSkippedExisting: 0,
    sectionsMerged: 0,
    sectionsAttempted: 3,
    failedSectionIds: [],
    ...over,
  }
}

describe('describeEnclosedLensMerge', () => {
  it('says nothing when nothing changed and nothing failed — every build after the first', () => {
    expect(describeEnclosedLensMerge(report({ edgesSkippedExisting: 12 }))).toBeNull()
  })

  it('reports what was merged, in correlations and sections', () => {
    const out = describeEnclosedLensMerge(report({ edgesCreated: 5, sectionsMerged: 2 }))

    expect(out).toEqual({
      type: 'success',
      message: 'Merged enclosed-lens bodies: 5 new correlations across 2 sections.',
    })
  })

  it('singularises a one-correlation, one-section merge', () => {
    const out = describeEnclosedLensMerge(report({ edgesCreated: 1, sectionsMerged: 1 }))

    expect(out?.message).toBe('Merged enclosed-lens bodies: 1 new correlation across 1 section.')
  })

  it('warns, not succeeds, when a section failed alongside a real merge', () => {
    const out = describeEnclosedLensMerge(
      report({ edgesCreated: 4, sectionsMerged: 1, failedSectionIds: ['sec-2'] }),
    )

    expect(out?.type).toBe('warning')
    expect(out?.message).toContain('1 section failed')
  })

  it('warns when everything failed — the bodies stay split and the user must know', () => {
    const out = describeEnclosedLensMerge(report({ failedSectionIds: ['sec-1', 'sec-2'] }))

    expect(out).toEqual({
      type: 'warning',
      message: 'Enclosed-lens merge failed on 2 sections — those bodies stay split.',
    })
  })
})
