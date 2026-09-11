// Owner 2026-09-11 (a new project for a client): "i added boreholes, deleted
// some, made a section and the deleted boreholes showed up on the section."
// "Remove" is a project-local hide (review is_hidden). The hidden set was
// re-seeded from the server whenever the PROJECT OBJECT changed — and every
// PATCH of the project (view state, metadata, a section) re-identifies that
// object — so a seed fetched before the hide upserts had landed, or any
// failure to persist, put the removed boreholes straight back. The seed must
// run once per project OPEN (the id), never on a re-identified object.
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useInvestigationData } from './useInvestigationData'

vi.mock('../api/client', () => ({
  api: {
    review: {
      list: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue(undefined),
    },
    cpt: { list: vi.fn().mockResolvedValue([]), get: vi.fn(), plot: vi.fn() },
    borehole: { list: vi.fn().mockResolvedValue([]), get: vi.fn() },
  },
}))
vi.mock('../utils/log', () => ({
  log: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

import { api } from '../api/client'

const reviewList = api.review.list as unknown as ReturnType<typeof vi.fn>

function render(initialProject: { id: string; name: string }) {
  return renderHook(
    ({ project }: { project: { id: string; name: string } | null }) =>
      useInvestigationData({
        project,
        ready: false,
        toast: vi.fn(),
        pushUndo: vi.fn(),
        addToManifest: vi.fn(),
        setSessionImportCptIds: vi.fn(),
        setSessionImportBoreholeIds: vi.fn(),
        selectedId: null,
        setSelectedId: vi.fn(),
        selectedBoreholeId: null,
        setSelectedBoreholeId: vi.fn(),
        setView: vi.fn(),
      }),
    { initialProps: { project: initialProject } },
  )
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

describe('the hidden set survives a project object that re-identifies with the same id', () => {
  beforeEach(() => {
    reviewList.mockClear()
    reviewList.mockResolvedValue([])
  })

  it('a borehole removed a moment ago stays removed after a project PATCH', async () => {
    const h = render({ id: 'P1', name: 'Klant' })
    await flush()
    act(() => h.result.current.handleRemoveBoreholes(['b1']))
    expect(h.result.current.removedBoreholeIds.has('b1')).toBe(true)
    // The PATCH answer: same project, new object identity.
    h.rerender({ project: { id: 'P1', name: 'Klant' } })
    await flush()
    expect(h.result.current.removedBoreholeIds.has('b1')).toBe(true)
    expect(reviewList).toHaveBeenCalledTimes(1)
  })

  it('opening ANOTHER project re-seeds from that project', async () => {
    const h = render({ id: 'P1', name: 'Klant' })
    await flush()
    act(() => h.result.current.handleRemoveBoreholes(['b1']))
    reviewList.mockResolvedValueOnce([{ target_kind: 'borehole', target_id: 'b9', is_hidden: true }])
    h.rerender({ project: { id: 'P2', name: 'Ander' } })
    await flush()
    expect(h.result.current.removedBoreholeIds.has('b1')).toBe(false)
    expect(h.result.current.removedBoreholeIds.has('b9')).toBe(true)
    expect(reviewList).toHaveBeenCalledTimes(2)
  })
})
