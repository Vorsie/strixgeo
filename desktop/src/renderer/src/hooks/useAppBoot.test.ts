// Rule (installer #7, 2026-09-03 21:03): a packaged beta blocks at the licence
// page with the engine DEFERRED. The boot hook must not ask the main process
// for API readiness while the activation gate is closed — that answer is "not
// running", and treating it as a crash paints "Kon de StrixGeo API niet
// starten" over the key page. Once the gate opens the engine is spawned and
// the wait begins.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

import { useAppBoot } from './useAppBoot'

const waitForApi = vi.fn<() => Promise<boolean>>()
const getApiBaseUrl = vi.fn<() => Promise<string>>()

beforeEach(() => {
  waitForApi.mockReset()
  getApiBaseUrl.mockReset().mockResolvedValue('http://127.0.0.1:8765')
  vi.stubGlobal('window', Object.assign(window, { electron: { waitForApi, getApiBaseUrl } }))
})
afterEach(() => vi.unstubAllGlobals())

describe('useAppBoot — the activation gate comes first', () => {
  it('does not ask for API readiness while the gate is closed, and reports no error', async () => {
    waitForApi.mockResolvedValue(false)
    const { result } = renderHook(({ open }) => useAppBoot(open), { initialProps: { open: false } })
    await new Promise(r => setTimeout(r, 30))
    expect(waitForApi).not.toHaveBeenCalled()
    expect(result.current.apiError).toBe(false)
    expect(result.current.ready).toBe(false)
  })

  it('waits for the API once the gate opens and reports ready', async () => {
    waitForApi.mockResolvedValue(true)
    const { result, rerender } = renderHook(({ open }) => useAppBoot(open), { initialProps: { open: false } })
    rerender({ open: true })
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(waitForApi).toHaveBeenCalledTimes(1)
  })

  it('an open gate from the start behaves as before: a false answer is the boot error', async () => {
    waitForApi.mockResolvedValue(false)
    const { result } = renderHook(() => useAppBoot(true))
    await waitFor(() => expect(result.current.apiError).toBe(true))
  })
})
