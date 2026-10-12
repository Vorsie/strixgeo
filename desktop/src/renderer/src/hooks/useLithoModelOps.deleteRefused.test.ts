// Walker finding 2026-10-12: deleting a lithological model that a
// geotechnical model refines is refused by the backend (409). The picker now
// disables the action, but the 409 stays the backend safety net. The rule for
// that path, in the ruling's words: the refusal renders the same sentence as
// the disabled button's explanation, as an ordinary toast, and it is logged as
// a warning, never as a console error. Any other failure stays an error.

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const deleteModel = vi.fn()

vi.mock('../api/client', () => ({
  api: { geology: { deleteModel: (...args: unknown[]) => deleteModel(...args) } },
}))
vi.mock('../utils/log', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn(), success: vi.fn() },
}))

import { ApiError } from '../api/clients/shared'
import type { GeologicalModelResponse, ProjectResponse } from '../api/client'
import { log } from '../utils/log'
import { useLithoModelOps } from './useLithoModelOps'

const GEOTECH_BLOCK_EN =
  'This model cannot be deleted while another model refines it. Delete the geotechnical model first.'

const toast = vi.fn()
const refreshModels = vi.fn()
const refetchFormations = vi.fn()
const markMutated = vi.fn()

function setup() {
  const { result } = renderHook(() =>
    useLithoModelOps({
      project: { id: 'p1' } as ProjectResponse,
      activeLithoModelRef: { current: null as GeologicalModelResponse | null },
      activeGeologicalModelRef: { current: null as GeologicalModelResponse | null },
      refreshModels,
      refetchLithoContacts: vi.fn(),
      refetchFormations,
      refetchLithoSurfaces: vi.fn(),
      setGhostsByAnchor: vi.fn(),
      setFocusedSuggestAnchorId: vi.fn(),
      markMutated,
      toast,
    }),
  )
  return result.current
}

beforeEach(() => {
  deleteModel.mockReset()
  toast.mockReset()
  refreshModels.mockReset().mockResolvedValue([])
  refetchFormations.mockReset()
  markMutated.mockReset()
  vi.mocked(log.error).mockClear()
  vi.mocked(log.warn).mockClear()
})

describe('handleDeleteLithoModel: a refused delete (a geotechnical model refines it)', () => {
  it('logs a warning, not an error, and toasts the explanation as a warning', async () => {
    deleteModel.mockRejectedValue(
      new ApiError('server text', 409, {
        detail: 'This model cannot be deleted while another model refines it.',
        method: 'DELETE',
        path: '/projects/p1/geology/models/l1',
      }),
    )
    const ops = setup()

    await expect(ops.handleDeleteLithoModel('l1')).rejects.toBeInstanceOf(ApiError)

    expect(log.error).not.toHaveBeenCalled()
    expect(log.warn).toHaveBeenCalled()
    expect(toast).toHaveBeenCalledTimes(1)
    expect(toast).toHaveBeenCalledWith('warning', GEOTECH_BLOCK_EN)
    expect(markMutated).not.toHaveBeenCalled()
  })

  it('any other failure is still an error toast with an error log', async () => {
    deleteModel.mockRejectedValue(new ApiError('boom', 500))
    const ops = setup()

    await expect(ops.handleDeleteLithoModel('l1')).rejects.toBeInstanceOf(ApiError)

    expect(log.error).toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith('error', 'boom')
  })
})
