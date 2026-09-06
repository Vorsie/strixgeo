// An unreachable DOV Virtuele Boring catalogue is a degraded state, not a
// per-open error: the picker must report it ONCE and not re-ask on every
// subsequent CPT / borehole open (walker findings 1-9, 2026-09-06: a down
// DOV host was asked nine times in one 300-step session). These pins hold the
// session negative-cache behaviour.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

import { ApiError, api } from '../api/client'
import type { VirtueleBoringLagenmodelEntry } from '../api/client'
import {
  resetVirtueleBoringCatalogForTesting,
  useVirtueleBoringCatalog,
} from './useVirtueleBoringCatalog'

const ENTRIES: VirtueleBoringLagenmodelEntry[] = [
  { code: 'g3dv3_F', beschrijving: 'G3D v3.1 per formatie', resoluties: [50, 100] },
]

afterEach(() => {
  resetVirtueleBoringCatalogForTesting()
  vi.restoreAllMocks()
})

describe('useVirtueleBoringCatalog', () => {
  it('reports an unreachable catalogue once and does not re-ask when the next CPT opens', async () => {
    const spy = vi
      .spyOn(api.virtueleBoring, 'lagenmodellen')
      .mockRejectedValue(new ApiError('Cannot reach Virtuele Boring catalog', 502))

    // First CPT opens the picker -> one fetch, which fails.
    const first = renderHook(() => useVirtueleBoringCatalog(true))
    await waitFor(() => expect(first.result.current.failed).toBe(true))
    expect(first.result.current.status).toBe(502)
    expect(first.result.current.catalog).toBeNull()
    expect(spy).toHaveBeenCalledTimes(1)

    // Close it and open the NEXT CPT (a fresh mount, enabled again).
    first.unmount()
    const second = renderHook(() => useVirtueleBoringCatalog(true))

    // The failure is remembered for the session: no second network call, and
    // the picker still knows the catalogue is unavailable.
    await waitFor(() => expect(second.result.current.failed).toBe(true))
    expect(second.result.current.status).toBe(502)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('loads the catalogue once and serves later mounts from the session cache', async () => {
    const spy = vi.spyOn(api.virtueleBoring, 'lagenmodellen').mockResolvedValue(ENTRIES)

    const first = renderHook(() => useVirtueleBoringCatalog(true))
    await waitFor(() => expect(first.result.current.catalog).toEqual(ENTRIES))
    expect(first.result.current.failed).toBe(false)
    expect(spy).toHaveBeenCalledTimes(1)

    first.unmount()
    const second = renderHook(() => useVirtueleBoringCatalog(true))
    await waitFor(() => expect(second.result.current.catalog).toEqual(ENTRIES))
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('does not fetch while disabled (the picker never opened)', async () => {
    const spy = vi.spyOn(api.virtueleBoring, 'lagenmodellen').mockResolvedValue(ENTRIES)

    const { result } = renderHook(() => useVirtueleBoringCatalog(false))
    // Give any stray effect a tick to (not) fire.
    await Promise.resolve()
    expect(result.current.catalog).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })

  it('retries once the 10-minute interval has passed', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(0)
    const spy = vi
      .spyOn(api.virtueleBoring, 'lagenmodellen')
      .mockRejectedValueOnce(new ApiError('down', 502))
      .mockResolvedValueOnce(ENTRIES)

    const first = renderHook(() => useVirtueleBoringCatalog(true))
    await waitFor(() => expect(first.result.current.failed).toBe(true))
    expect(spy).toHaveBeenCalledTimes(1)
    first.unmount()

    // Still inside the window -> no re-ask.
    nowSpy.mockReturnValue(9 * 60 * 1000)
    const second = renderHook(() => useVirtueleBoringCatalog(true))
    await waitFor(() => expect(second.result.current.failed).toBe(true))
    expect(spy).toHaveBeenCalledTimes(1)
    second.unmount()

    // Past the window -> one fresh attempt, which now succeeds.
    nowSpy.mockReturnValue(11 * 60 * 1000)
    const third = renderHook(() => useVirtueleBoringCatalog(true))
    await waitFor(() => expect(third.result.current.catalog).toEqual(ENTRIES))
    expect(spy).toHaveBeenCalledTimes(2)
  })
})
