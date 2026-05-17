// Contract for the stale-gated crossings validator (debt #18):
//
//   * stale (staleSurfaceCount > 0) → NO fetch, pendingBuild=true,
//     crossingIssues empty (a stale cache is never validated).
//   * fresh → fetch, pendingBuild=false, issues from the API.
//   * Build clearing stale (1 → 0) re-runs the effect and fetches —
//     the "re-validate on rebuild" leg, with no extra wiring.
//   * no model → inert (no fetch, not pending).

import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useCrossingsValidation } from './useCrossingsValidation'
import { api } from '../api/client'

vi.mock('../api/client', () => ({
  api: { geology: { validateCrossings: vi.fn() } },
}))

const mockValidate = vi.mocked(api.geology.validateCrossings)

afterEach(() => {
  mockValidate.mockReset()
})

const issue = {
  kind: 'formation_crossing',
  detail: 'A crosses B',
  depth_m: null,
  contact_ids: [],
  formation_ids: ['a', 'b'],
}

describe('useCrossingsValidation (debt #18)', () => {
  it('fresh model → fetches and reports issues, not pending', async () => {
    mockValidate.mockResolvedValue({ model_id: 'm1', issues: [issue] })
    const { result } = renderHook(() =>
      useCrossingsValidation('p1', 'm1', 0, 0),
    )
    await waitFor(() => expect(result.current.crossingIssues).toHaveLength(1))
    expect(result.current.pendingBuild).toBe(false)
    expect(mockValidate).toHaveBeenCalledWith('p1', 'm1')
  })

  it('stale surfaces → no fetch, pendingBuild, empty issues', async () => {
    const { result } = renderHook(() =>
      useCrossingsValidation('p1', 'm1', 0, 3),
    )
    expect(result.current.pendingBuild).toBe(true)
    expect(result.current.crossingIssues).toEqual([])
    expect(mockValidate).not.toHaveBeenCalled()
  })

  it('Build clearing stale (1 → 0) triggers a fresh fetch', async () => {
    mockValidate.mockResolvedValue({ model_id: 'm1', issues: [issue] })
    const { result, rerender } = renderHook(
      ({ stale }: { stale: number }) =>
        useCrossingsValidation('p1', 'm1', 0, stale),
      { initialProps: { stale: 2 } },
    )
    expect(result.current.pendingBuild).toBe(true)
    expect(mockValidate).not.toHaveBeenCalled()

    rerender({ stale: 0 })
    await waitFor(() => expect(result.current.crossingIssues).toHaveLength(1))
    expect(result.current.pendingBuild).toBe(false)
    expect(mockValidate).toHaveBeenCalledTimes(1)
  })

  it('no model → inert (no fetch, not pending)', () => {
    const { result } = renderHook(() =>
      useCrossingsValidation('p1', null, 0, 0),
    )
    expect(result.current.pendingBuild).toBe(false)
    expect(result.current.crossingIssues).toEqual([])
    expect(mockValidate).not.toHaveBeenCalled()
  })

  it('a stale model with no model id is still not pending', () => {
    const { result } = renderHook(() =>
      useCrossingsValidation('p1', null, 0, 5),
    )
    expect(result.current.pendingBuild).toBe(false)
    expect(mockValidate).not.toHaveBeenCalled()
  })
})
