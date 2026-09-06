// Pins for the bed-override ground-refresh nonce (owner walk of installer
// #20/#21, 2026-09-06).
//
// Owner's words: "after I change a bed polygon the 3D ground surface shows the
// new bed without reopening the project". The 3-D ground-surface fetch keys on
// this nonce; ``useBedOverrides`` bumps it after every create / update /
// delete so a bed change refetches the terrain mesh without a model switch.
// The section DEM line already updated from the list; only the 3-D mesh was
// stale, which is why the nonce lives here and rides the shell bus.

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '../api/client'
import type { BedOverrideResponse, ProjectResponse } from '../api/client'
import { useBedOverrides } from './useBedOverrides'

// The WGS84 -> projected transform runs proj4 on a real EPSG; the nonce logic
// does not care about the coordinates, so stub the projection to keep the test
// pure and fast.
vi.mock('./useWgs84', () => ({
  wgs84ToProjected: (): [number, number] => [100, 200],
}))

const PROJECT = { id: 'proj-1' } as unknown as ProjectResponse
const EPSG = 31370

function makeRow(id: string): BedOverrideResponse {
  return {
    id,
    app_project_id: 'proj-1',
    label: 'Canal bed',
    level_m: -4,
    epsg: EPSG,
    vertices: [
      [100, 200],
      [101, 200],
      [101, 201],
    ],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

function renderBedOverrides() {
  const toast = vi.fn()
  return renderHook(() => useBedOverrides({ project: PROJECT, epsg: EPSG, toast }))
}

describe('useBedOverrides — groundRefreshNonce bumps on every mutation', () => {
  beforeEach(() => {
    vi.spyOn(api.bedOverrides, 'list').mockResolvedValue([])
    vi.spyOn(api.bedOverrides, 'create').mockResolvedValue(makeRow('bo-1'))
    vi.spyOn(api.bedOverrides, 'update').mockResolvedValue(makeRow('bo-1'))
    vi.spyOn(api.bedOverrides, 'delete').mockResolvedValue(undefined as unknown as void)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('BN1 — a create (a new bed polygon added) bumps the nonce', async () => {
    const { result } = renderBedOverrides()
    await waitFor(() => expect(result.current.loading).toBe(false))

    const before = result.current.groundRefreshNonce
    act(() => {
      result.current.handlePolygonDrawn([
        { lat: 51, lng: 4 },
        { lat: 51, lng: 4.001 },
        { lat: 51.001, lng: 4.001 },
      ])
    })
    await act(async () => {
      await result.current.submit('Canal bed', -4)
    })

    expect(result.current.groundRefreshNonce).toBe(before + 1)
  })

  it('BN2 — an edit (a bed polygon changed) bumps the nonce', async () => {
    vi.spyOn(api.bedOverrides, 'list').mockResolvedValue([makeRow('bo-1')])
    const { result } = renderBedOverrides()
    await waitFor(() => expect(result.current.overrides).toHaveLength(1))

    const before = result.current.groundRefreshNonce
    act(() => {
      result.current.startEdit('bo-1')
    })
    await act(async () => {
      await result.current.submit('Canal bed', -5)
    })

    expect(result.current.groundRefreshNonce).toBe(before + 1)
  })

  it('BN3 — a delete (a bed polygon removed) bumps the nonce', async () => {
    vi.spyOn(api.bedOverrides, 'list').mockResolvedValue([makeRow('bo-1')])
    const { result } = renderBedOverrides()
    await waitFor(() => expect(result.current.overrides).toHaveLength(1))

    const before = result.current.groundRefreshNonce
    await act(async () => {
      await result.current.remove('bo-1')
    })

    expect(result.current.groundRefreshNonce).toBe(before + 1)
  })

  it('BN4 — a failed save leaves the nonce unchanged (nothing to refresh)', async () => {
    vi.spyOn(api.bedOverrides, 'create').mockRejectedValue(new Error('boom'))
    const { result } = renderBedOverrides()
    await waitFor(() => expect(result.current.loading).toBe(false))

    const before = result.current.groundRefreshNonce
    act(() => {
      result.current.handlePolygonDrawn([
        { lat: 51, lng: 4 },
        { lat: 51, lng: 4.001 },
        { lat: 51.001, lng: 4.001 },
      ])
    })
    await act(async () => {
      await result.current.submit('Canal bed', -4)
    })

    expect(result.current.groundRefreshNonce).toBe(before)
  })
})
