// A cancelled build must tell the engineer WHY, not "check the connection".
//
// Audit 2026-08-02, Class 1: the build swallowed missing inputs and toasted
// "Built N bodies". Now the request builder refuses with a
// ``VoxelBuildInputsError`` whose message is written for the engineer — this
// pins that the handler surfaces that message verbatim and never POSTs a
// build, so no generation is persisted from a partial input set.

import { renderHook, act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const listLithoSolids = vi.fn()
const buildVoxelLithoModel = vi.fn()

vi.mock('../api/client', () => ({
  api: {
    geology: {
      listLithoSolids: (...args: unknown[]) => listLithoSolids(...args),
      buildVoxelLithoModel: (...args: unknown[]) => buildVoxelLithoModel(...args),
    },
  },
}))

vi.mock('../utils/log', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

import { useLithoSolids } from './useLithoSolids'
import { VoxelBuildInputsError } from '../utils/voxelBuildInputsError'

beforeEach(() => {
  vi.clearAllMocks()
  listLithoSolids.mockResolvedValue([])
  buildVoxelLithoModel.mockResolvedValue({ bodies_built: 3, bodies_flagged: 0, solids: [] })
})

describe('useLithoSolids — BR1: a refused build reaches the user', () => {
  it('toasts the refusal message and does not POST a build', async () => {
    const toast = vi.fn()
    const refusal = new VoxelBuildInputsError(
      'Could not build — correlations failed to load for 1 of 14 cross-section(s): ' +
        'Tie-section 12. Nothing was changed; retry the build.',
    )

    const { result } = renderHook(() => useLithoSolids('proj-1', 'model-1', toast))

    await act(async () => {
      await result.current.buildLithoSolids(() => Promise.reject(refusal))
    })

    expect(buildVoxelLithoModel).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith('error', refusal.message)
  })

  it('still shows the generic connection copy for an unrelated failure', async () => {
    const toast = vi.fn()

    const { result } = renderHook(() => useLithoSolids('proj-1', 'model-1', toast))

    await act(async () => {
      await result.current.buildLithoSolids(() => Promise.reject(new Error('socket hang up')))
    })

    expect(toast).toHaveBeenCalledWith('error', expect.stringContaining('check the connection'))
  })
})

// A build that built NOTHING also DELETED the stored 3-D model. It must never
// read as a build that happened.
describe('useLithoSolids — BR2: an empty build is never a green success', () => {
  const request = { sections: [{}] }
  const builder = (): Promise<unknown> => Promise.resolve(request)

  it('warns, names the cause, and says the stored model was cleared', async () => {
    const toast = vi.fn()
    buildVoxelLithoModel.mockResolvedValue({
      bodies_built: 0,
      bodies_flagged: 0,
      solids: [],
      empty_reason:
        'the investigations do not frame an area — a footprint needs at least 3 that do not sit on one line',
    })

    const { result } = renderHook(() => useLithoSolids('proj-1', 'model-1', toast))

    await act(async () => {
      await result.current.buildLithoSolids(builder as never)
    })

    const [severity, message] = toast.mock.calls.at(-1) as [string, string]
    expect(severity).toBe('warning')
    expect(message).toContain('one line')
    expect(message).toMatch(/cleared|removed|gone/i)
  })

  it('leaves a build that produced bodies on the plain success copy', async () => {
    const toast = vi.fn()
    buildVoxelLithoModel.mockResolvedValue({
      bodies_built: 4,
      bodies_flagged: 0,
      solids: [],
      empty_reason: null,
    })

    const { result } = renderHook(() => useLithoSolids('proj-1', 'model-1', toast))

    await act(async () => {
      await result.current.buildLithoSolids(builder as never)
    })

    expect(toast).toHaveBeenCalledWith('success', expect.stringContaining('Built 4 bodies'))
  })
})
