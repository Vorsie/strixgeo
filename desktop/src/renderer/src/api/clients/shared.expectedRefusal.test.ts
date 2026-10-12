// Walker finding 2026-10-12: deleting a model that another model refines is
// refused by the backend with a 409. That refusal is the app working (the
// backend safety net behind the disabled delete button), not a bug, so the
// API core must log it as a WARNING, never as a console error (the walker
// counts console errors). It still leaves a file trace as an api-refusal.
// Any other 409, and any other status on that path, stays an error.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../utils/diagnostics', () => ({ captureDiagnostic: vi.fn() }))
vi.mock('../../utils/log', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn(), success: vi.fn() },
}))

import { captureDiagnostic } from '../../utils/diagnostics'
import { log } from '../../utils/log'
import { request, setBaseUrl } from './shared'
import { resetNetworkHealth } from '../networkHealth'

const BASE = 'http://127.0.0.1:8765'
const captureMock = captureDiagnostic as unknown as ReturnType<typeof vi.fn>
const REFINED_DETAIL =
  'This model cannot be deleted while another model refines it. Delete the dependent ' +
  '(lithostratigraphic / geotechnical) model first.'

beforeEach(() => {
  resetNetworkHealth()
  setBaseUrl(BASE)
  captureMock.mockClear()
  vi.mocked(log.warn).mockClear()
  vi.mocked(log.error).mockClear()
})
afterEach(() => {
  vi.restoreAllMocks()
  resetNetworkHealth()
})

const jsonResponse = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('a refused model delete (another model refines it) is a warning, not an error', () => {
  it('DELETE of a geology model answered 409 logs a warning and still captures an api-refusal', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ detail: REFINED_DETAIL }, 409))

    await expect(request('DELETE', '/projects/p1/geology/models/m1')).rejects.toMatchObject({
      status: 409,
    })

    expect(log.error).not.toHaveBeenCalled()
    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(captureMock).toHaveBeenCalledTimes(1)
    expect(captureMock.mock.calls[0][0].kind).toBe('api-refusal')
  })

  it('a 409 on another path stays an error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ detail: 'conflict' }, 409))

    await request('DELETE', '/projects/p1/geology/contacts/c1').catch(() => undefined)

    expect(log.error).toHaveBeenCalledTimes(1)
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('a 500 on the model delete path stays an error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ detail: 'boom' }, 500))

    await request('DELETE', '/projects/p1/geology/models/m1').catch(() => undefined)

    expect(log.error).toHaveBeenCalledTimes(1)
    expect(log.warn).not.toHaveBeenCalled()
  })
})
