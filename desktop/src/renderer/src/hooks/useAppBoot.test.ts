import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

import { useAppBoot } from './useAppBoot'
import { log } from '../utils/log'
// Mock the readiness answer with the SAME union the real IPC returns, from its
// single source of truth, so a new state added there would flag a mock that no
// longer matches (item 2). Type-only, dependency-free .d.ts — no runtime import.
import type { BackendReadyResult } from '../../../main/backendReadyResult'

// Capture what the boot hook logs so the failure-message wording can be pinned.
vi.mock('../utils/log', () => ({
  log: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

const waitForApi = vi.fn<() => Promise<BackendReadyResult>>()
const getApiBaseUrl = vi.fn<() => Promise<string>>()

beforeEach(() => {
  waitForApi.mockReset()
  getApiBaseUrl.mockReset().mockResolvedValue('http://127.0.0.1:8765')
  vi.mocked(log.error).mockClear()
  vi.mocked(log.info).mockClear()
  vi.stubGlobal('window', Object.assign(window, { electron: { waitForApi, getApiBaseUrl } }))
})
afterEach(() => vi.unstubAllGlobals())

describe('useAppBoot', () => {
  it('waits for the API at mount and reports ready', async () => {
    waitForApi.mockResolvedValue(true)
    const { result } = renderHook(() => useAppBoot())
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(waitForApi).toHaveBeenCalledTimes(1)
  })

  it('a false readiness answer is the boot error', async () => {
    waitForApi.mockResolvedValue(false)
    const { result } = renderHook(() => useAppBoot())
    await waitFor(() => expect(result.current.apiError).toBe(true))
  })

  it('keeps waiting when a live backend outlasts the initial boot budget', async () => {
    let finishNextWait: ((value: BackendReadyResult) => void) | undefined
    waitForApi
      .mockResolvedValueOnce('still-starting')
      .mockImplementationOnce(() => new Promise(resolve => { finishNextWait = resolve }))

    const { result } = renderHook(() => useAppBoot())

    await waitFor(() => expect(result.current.takingLong).toBe(true))
    expect(result.current.apiError).toBe(false)
    expect(waitForApi).toHaveBeenCalledTimes(2)

    finishNextWait?.(true)
    await waitFor(() => expect(result.current.ready).toBe(true))
  })

  // Rule (owner finding 6): a false readiness answer can mean the backend
  // process crashed OR that a foreign process is already holding port 8765. The
  // failure the renderer logs must not accuse the backend of having exited, or
  // support hunts a crash traceback that does not exist for the foreign-port case.
  it('logs the failure cause-neutrally, naming the foreign-port case too', async () => {
    waitForApi.mockResolvedValue(false)
    const { result } = renderHook(() => useAppBoot())
    await waitFor(() => expect(result.current.apiError).toBe(true))
    const logged = vi
      .mocked(log.error)
      .mock.calls.map(args => args.join(' '))
      .join('\n')
    expect(logged).toMatch(/port 8765|foreign/i)
  })

  // Rule (owner, 2026-09-20): every boot path ends somewhere the user can act
  // on. A readiness check that throws must show the boot-error screen, not
  // leave the loading spinner up with a silent console rejection.
  it('a readiness check that rejects still reaches the boot error screen', async () => {
    waitForApi.mockRejectedValueOnce(new Error('ipc channel closed'))

    const { result } = renderHook(() => useAppBoot())

    await waitFor(() => expect(result.current.apiError).toBe(true))
    expect(result.current.ready).toBe(false)
  })
})
