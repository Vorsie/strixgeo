// Rule (installer #7, 2026-09-03 21:03): a packaged beta blocks at the licence
// page with the engine DEFERRED. The boot hook must not ask the main process
// for API readiness while the activation gate is closed — that answer is "not
// running", and treating it as a crash paints "Kon de StrixGeo API niet
// starten" over the key page. Once the gate opens the engine is spawned and
// the wait begins.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

import { useAppBoot } from './useAppBoot'

type ApiWaitResult = boolean | 'still-starting'

const waitForApi = vi.fn<() => Promise<ApiWaitResult>>()
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

  it('keeps waiting when a live backend outlasts the initial boot budget', async () => {
    let finishNextWait: ((value: ApiWaitResult) => void) | undefined
    waitForApi
      .mockResolvedValueOnce('still-starting')
      .mockImplementationOnce(() => new Promise(resolve => { finishNextWait = resolve }))

    const { result } = renderHook(() => useAppBoot(true))

    await waitFor(() => expect(result.current.takingLong).toBe(true))
    expect(result.current.apiError).toBe(false)
    expect(waitForApi).toHaveBeenCalledTimes(2)

    finishNextWait?.(true)
    await waitFor(() => expect(result.current.ready).toBe(true))
  })

  // Rule (owner, 2026-09-20): every boot path ends somewhere the user can act
  // on. A readiness check that throws must show the boot-error screen, not
  // leave the loading spinner up with a silent console rejection.
  it('a readiness check that rejects still reaches the boot error screen', async () => {
    waitForApi.mockRejectedValueOnce(new Error('ipc channel closed'))

    const { result } = renderHook(() => useAppBoot(true))

    await waitFor(() => expect(result.current.apiError).toBe(true))
    expect(result.current.ready).toBe(false)
  })
})
