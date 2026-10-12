// Walker finding 2026-10-12, geological twin: deleting a geological model that
// a lithostratigraphic model refines is refused by the backend (409). The
// toolbar disables the action; the 409 stays the safety net and is an expected
// refusal: logged as a warning, never as a console error (the walker counts
// console errors). The local model state is left untouched. Any other failure
// stays an error.

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
import { useGeologicalModelOps } from './useGeologicalModelOps'

const setActiveGeologicalModel = vi.fn()

function setup() {
  const { result } = renderHook(() =>
    useGeologicalModelOps({
      project: { id: 'p1' } as ProjectResponse,
      activeGeologicalModel: { id: 'geo-1', kind: 'geological' } as GeologicalModelResponse,
      formations: [],
      currentLumping: null,
      addToManifest: vi.fn(),
      removeFromManifest: vi.fn(),
      addToSessionImports: vi.fn(),
      removeFromSessionImports: vi.fn(),
      pushUndo: vi.fn(),
      markMutated: vi.fn(),
      toast: vi.fn(),
      setFormations: vi.fn(),
      setContacts: vi.fn(),
      setSurfacesByFormationId: vi.fn(),
      setActiveGeologicalModel,
      setFormationsRefreshCounter: vi.fn(),
      refetchFormations: vi.fn(),
      refetchSurfaces: vi.fn(),
      refetchLithoContacts: vi.fn(),
      activeLithoModel: null,
      setActiveLithoModel: vi.fn(),
    }),
  )
  return result.current
}

beforeEach(() => {
  deleteModel.mockReset()
  setActiveGeologicalModel.mockReset()
  vi.mocked(log.error).mockClear()
  vi.mocked(log.warn).mockClear()
})

describe('handleDeleteModel: a refused delete (a litho model refines it)', () => {
  it('logs a warning, not an error, and keeps the local model', async () => {
    deleteModel.mockRejectedValue(new ApiError('refused', 409))
    const ops = setup()

    await expect(ops.handleDeleteModel()).rejects.toBeInstanceOf(ApiError)

    expect(log.error).not.toHaveBeenCalled()
    expect(log.warn).toHaveBeenCalled()
    expect(setActiveGeologicalModel).not.toHaveBeenCalled()
  })

  it('any other failure is still logged as an error', async () => {
    deleteModel.mockRejectedValue(new ApiError('boom', 500))
    const ops = setup()

    await expect(ops.handleDeleteModel()).rejects.toBeInstanceOf(ApiError)

    expect(log.error).toHaveBeenCalled()
  })
})
