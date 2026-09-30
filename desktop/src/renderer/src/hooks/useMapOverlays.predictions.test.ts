// Rule (owner's dev log 2026-09-27/29): DOV being slow or unreachable is a
// degraded path, not a server error. The Virtuele Boring overlay is optional,
// so when the backend answers 503 ``dov_unreachable`` the app shows NO toast,
// the overlay stays empty, and the only trace is one log line naming the
// reason. (The shared request core already logs the single WARN for the 503;
// the hook must not add a second warning with the raw error object.)
// Any other failure keeps the existing warning.

import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../utils/log', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn(), success: vi.fn() },
}))

const { predictionsMock } = vi.hoisted(() => ({ predictionsMock: vi.fn() }))
vi.mock('../api/client', async importOriginal => {
  const actual = await importOriginal<typeof import('../api/client')>()
  return {
    ...actual,
    api: { ...actual.api, virtueleBoring: { ...actual.api.virtueleBoring, predictions: predictionsMock } },
  }
})

import { ApiError } from '../api/clients/shared'
import type { ProjectResponse } from '../api/client'
import { log } from '../utils/log'
import { useMapOverlays } from './useMapOverlays'

const UNREACHABLE = 'DOV is not reachable right now; the predictions will load when it is.'

function project(): ProjectResponse {
  return {
    id: 'p1',
    default_horizontal_epsg: 31370,
    view_state: { virtuele_boring: { modelA: 'g3dv3_F', modelB: null, maxDepthM: null } },
  } as unknown as ProjectResponse
}

function mount() {
  const toast = vi.fn()
  const hook = renderHook(() =>
    useMapOverlays({ project: project(), applyViewStatePatch: async () => true, toast }),
  )
  return { hook, toast }
}

beforeEach(() => {
  predictionsMock.mockReset()
  vi.mocked(log.warn).mockClear()
  vi.mocked(log.info).mockClear()
})

describe('useMapOverlays: Virtuele Boring predictions when DOV is unreachable', () => {
  it('a 503 dov_unreachable leaves the overlay empty, no toast, one info line with the reason', async () => {
    predictionsMock.mockRejectedValue(
      new ApiError(UNREACHABLE, 503, { detail: { code: 'dov_unreachable', message: UNREACHABLE } }),
    )

    const { hook, toast } = mount()

    await waitFor(() => expect(hook.result.current.virtueleBoringLoading).toBe(false))
    await waitFor(() => expect(predictionsMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(vi.mocked(log.info)).toHaveBeenCalled())
    expect(hook.result.current.virtueleBoringPredictions).toEqual([])
    expect(toast).not.toHaveBeenCalled()
    expect(vi.mocked(log.warn)).not.toHaveBeenCalled()
    const line = vi.mocked(log.info).mock.calls.find(c => c.join(' ').includes('dov_unreachable'))
    expect(line).toBeDefined()
  })

  it('any other failure still warns (a bug must stay visible)', async () => {
    predictionsMock.mockRejectedValue(new ApiError('boom', 500, { detail: 'boom' }))

    mount()

    await waitFor(() => expect(vi.mocked(log.warn)).toHaveBeenCalledTimes(1))
  })
})
