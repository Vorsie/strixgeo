// Every geotech tie gesture that fails must SAY it failed.
//
// Owner dogfeed 2026-08-02: the backend went away mid-session
// (ERR_CONNECTION_REFUSED). Right-click → Disconnect kept "working" — the edge
// vanished from the canvas because the removal is optimistic, the DELETE was
// refused, the catch wrote one `log.warn` nobody was reading, and the refetch
// silently put the edge back. From the engineer's chair a correlation flickered
// and nothing was said. Minutes of clicks were lost that way.
//
// The rule, in the owner's words: if I asked for something and it did not
// happen, tell me — name the thing I asked for, not "an error occurred".
// Error toasts are sticky (useToasts, 2026-08-02), so a message written here
// survives until it is read.

import { renderHook, act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useGeotechPackingCorrelation } from './useGeotechPackingCorrelation'
import type { GeologicalModelResponse } from '../../../api/client'

const mockDeleteContactCorrelation = vi.fn()
const mockCreateContactCorrelation = vi.fn()
const mockConfirmEdgeReview = vi.fn()
const mockAcceptSingleContactCorrelation = vi.fn()

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client')
  return {
    ...actual,
    api: {
      geology: {
        deleteContactCorrelation: (...a: unknown[]) => mockDeleteContactCorrelation(...a),
        createContactCorrelation: (...a: unknown[]) => mockCreateContactCorrelation(...a),
        confirmEdgeReview: (...a: unknown[]) => mockConfirmEdgeReview(...a),
        acceptSingleContactCorrelation: (...a: unknown[]) =>
          mockAcceptSingleContactCorrelation(...a),
      },
    },
  }
})

const GEOTECH_MODEL: GeologicalModelResponse = {
  id: 'geotech-model-1',
  app_project_id: 'proj-1',
  name: 'Geotechnical Model',
  description: null,
  is_active: true,
  excluded_borehole_ids: [],
  kind: 'geotechnical',
  parent_model_id: 'litho-model-1',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

/** What the browser throws when the backend is not listening. */
function connectionRefused(): TypeError {
  return new TypeError('Failed to fetch')
}

function makeDeps(toast: ReturnType<typeof vi.fn>) {
  return {
    activeGeotechModel: GEOTECH_MODEL,
    projectId: 'proj-1',
    selectedSectionId: 'sec-1',
    refetchContactEdges: () => Promise.resolve(),
    refetchGeotechPackingEdges: () => Promise.resolve(),
    requestGeotechLayersRefetch: vi.fn(),
    markMutated: vi.fn(),
    markBoreholesStale: vi.fn(),
    toast,
    setArmedContactId: vi.fn(),
    setArmedContactSide: vi.fn(),
    setLastTargetTestId: vi.fn(),
    setContactCorrelationEdges: vi.fn(),
    setGeotechPackingEdges: vi.fn(),
    undoStack: { push: vi.fn() },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDeleteContactCorrelation.mockResolvedValue(undefined)
  mockCreateContactCorrelation.mockResolvedValue(undefined)
  mockConfirmEdgeReview.mockResolvedValue({ edges_confirmed: 1 })
  mockAcceptSingleContactCorrelation.mockResolvedValue({
    edges_accepted: 1,
    ordinals_changed: 0,
  })
})

describe('ET1 — a failed disconnect is announced, not just logged', () => {
  it('toasts an error naming the disconnect when the DELETE is refused', async () => {
    const toast = vi.fn()
    mockDeleteContactCorrelation.mockRejectedValue(connectionRefused())

    const { result } = renderHook(() => useGeotechPackingCorrelation(makeDeps(toast) as never))

    await act(async () => {
      await result.current.handleDeleteGeotechPackingCorrelation('layer-a', 'layer-b', 'base', 'top')
    })

    expect(toast).toHaveBeenCalledTimes(1)
    const [severity, message] = toast.mock.calls[0] as [string, string]
    expect(severity).toBe('error')
    // Names the action the engineer asked for — "an error occurred" would not
    // tell them WHICH of the last dozen clicks did not take.
    expect(message.toLowerCase()).toContain('disconnect')
  })

  it('says nothing when the disconnect succeeds', async () => {
    const toast = vi.fn()

    const { result } = renderHook(() => useGeotechPackingCorrelation(makeDeps(toast) as never))

    await act(async () => {
      await result.current.handleDeleteGeotechPackingCorrelation('layer-a', 'layer-b', 'base', 'top')
    })

    expect(toast).not.toHaveBeenCalled()
  })
})

describe('ET2 — a failed confirm-tie is announced', () => {
  it('toasts an error naming the confirm when the POST is refused', async () => {
    const toast = vi.fn()
    mockConfirmEdgeReview.mockRejectedValue(connectionRefused())

    const { result } = renderHook(() => useGeotechPackingCorrelation(makeDeps(toast) as never))

    await act(async () => {
      await result.current.handleConfirmGeotechPackingReview('edge-1')
    })

    const [severity, message] = toast.mock.calls[0] as [string, string]
    expect(severity).toBe('error')
    expect(message.toLowerCase()).toContain('confirm')
  })
})

describe('ET3 — a failed accept is announced', () => {
  it('toasts an error naming the accept when the POST is refused', async () => {
    const toast = vi.fn()
    mockAcceptSingleContactCorrelation.mockRejectedValue(connectionRefused())

    const { result } = renderHook(() => useGeotechPackingCorrelation(makeDeps(toast) as never))

    await act(async () => {
      await result.current.handleAcceptGeotechPackingCorrelation('edge-1')
    })

    const [severity, message] = toast.mock.calls[0] as [string, string]
    expect(severity).toBe('error')
    expect(message.toLowerCase()).toContain('accept')
  })
})
