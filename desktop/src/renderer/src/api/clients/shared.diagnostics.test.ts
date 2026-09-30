// L2 — a 4xx refusal must be diagnosable, and a mutating request that never
// answers must fail visibly instead of hanging.
//
// The rule (production-readiness audit L2 + M3 renderer half): today only a 5xx
// is captured to the local diagnostics log, so "it refused to delete the
// contact" (a 4xx with a machine code) leaves no file trace in a packaged
// build. Capture 4xx as an ``api-refusal`` (warning severity) carrying the
// ``detail.code``. And a mutating request (POST/PUT/PATCH/DELETE) that gets no
// answer must abort after a bounded time, so the busy state cannot hang forever.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../utils/diagnostics', () => ({ captureDiagnostic: vi.fn() }))
vi.mock('../../utils/log', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn(), success: vi.fn() },
}))

import { captureDiagnostic } from '../../utils/diagnostics'
import { log } from '../../utils/log'
import { fetchTracked, request, setBaseUrl } from './shared'
import { resetNetworkHealth } from '../networkHealth'

const BASE = 'http://127.0.0.1:8765'
const captureMock = captureDiagnostic as unknown as ReturnType<typeof vi.fn>

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

describe('L2 — 4xx refusals are captured as api-refusal', () => {
  it('captures a 422 refusal with its detail.code at warning severity', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ detail: { code: 'cpt_refresh_refused', message: 'broken file' } }, 422),
    )

    await request('POST', '/cpt/import', {}).catch(() => undefined)

    expect(captureMock).toHaveBeenCalledTimes(1)
    const arg = captureMock.mock.calls[0][0]
    expect(arg.kind).toBe('api-refusal')
    expect(arg.severity).toBe('warning')
    expect(arg.httpStatus).toBe(422)
    expect(arg.message).toContain('cpt_refresh_refused')
  })

  it('captures a 4xx with a plain-string detail (no code)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ detail: 'Project not found' }, 404))

    await request('DELETE', '/project/p1').catch(() => undefined)

    expect(captureMock).toHaveBeenCalledTimes(1)
    const arg = captureMock.mock.calls[0][0]
    expect(arg.kind).toBe('api-refusal')
    expect(arg.httpStatus).toBe(404)
    expect(arg.message).toContain('404')
  })

  it('still captures a 5xx as api-error, not api-refusal', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ detail: 'boom' }, 500))

    await request('GET', '/x').catch(() => undefined)

    expect(captureMock).toHaveBeenCalledTimes(1)
    expect(captureMock.mock.calls[0][0].kind).toBe('api-error')
  })

  it('does not capture anything on a 2xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ ok: true }, 200))

    await request('GET', '/x')

    expect(captureMock).not.toHaveBeenCalled()
  })
})

describe('degradable external-overlay GETs log a degraded WARN, not an ERROR', () => {
  // The DOV Virtuele Boring catalogue is an informative-only overlay the
  // backend proxies from an external DOV host. A 5xx there means DOV is
  // unreachable, a degraded state, not a bug in our code, so it must log at
  // WARN (degraded but continuing) and NOT be captured as an api-error a crash
  // bundle would carry. (walker findings 1-9, 2026-09-06: a down DOV host
  // logged nine identical 502 ERRORs in one 300-step session.)
  it('a 502 on the DOV lagenmodel catalogue warns and captures no diagnostic', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ detail: 'Cannot reach Virtuele Boring catalog' }, 502),
    )

    await request('GET', '/dov/virtuele-boring/lagenmodellen').catch(() => undefined)

    expect(vi.mocked(log.warn)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(log.error)).not.toHaveBeenCalled()
    expect(captureMock).not.toHaveBeenCalled()
  })

  // Owner's dev log 2026-09-27/29: DOV timing out used to 500 the predictions
  // sweep, logged as an ERROR "The server failed to complete this request".
  // The backend now answers 503 ``dov_unreachable`` — an unreachable external
  // host is degraded, not a bug: WARN, no crash-bundle diagnostic.
  it('a 503 dov_unreachable on the project predictions GET warns and captures no diagnostic', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(
        {
          detail: {
            code: 'dov_unreachable',
            message: 'DOV is not reachable right now; the predictions will load when it is.',
          },
        },
        503,
      ),
    )

    await request('GET', '/projects/p1/virtuele-boring/predictions?models=g3dv3_F').catch(
      () => undefined,
    )

    expect(vi.mocked(log.warn)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(log.error)).not.toHaveBeenCalled()
    expect(captureMock).not.toHaveBeenCalled()
  })

  it('a plain 500 on the project predictions GET is still a bug (ERROR + api-error)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ detail: 'boom' }, 500))

    await request('GET', '/projects/p1/virtuele-boring/predictions?models=g3dv3_F').catch(
      () => undefined,
    )

    expect(vi.mocked(log.error)).toHaveBeenCalledTimes(1)
    expect(captureMock).toHaveBeenCalledTimes(1)
  })

  it('still logs ERROR + captures api-error for an ordinary GET 502', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ detail: 'boom' }, 502))

    await request('GET', '/cpt/some-id/series').catch(() => undefined)

    expect(vi.mocked(log.error)).toHaveBeenCalledTimes(1)
    expect(captureMock).toHaveBeenCalledTimes(1)
    expect(captureMock.mock.calls[0][0].kind).toBe('api-error')
  })
})

describe('L2 / M3 — mutating requests carry an abort timeout', () => {
  it('attaches an AbortSignal to a POST when the caller gave none', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ ok: true }, 200))

    await request('POST', '/x', {})

    const init = fetchSpy.mock.calls[0][1]
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('does NOT time out a long-running compute mutation (the on-click build)', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ ok: true }, 200))

    // The voxel build runs for minutes — a 60 s guillotine would break it.
    await request(
      'POST',
      '/projects/p1/geology/models/m1/litho-solids/build-voxel',
      {},
    )

    expect(fetchSpy.mock.calls[0][1]?.signal).toBeUndefined()
  })

  it('leaves a GET without an injected timeout signal', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ ok: true }, 200))

    await request('GET', '/x')

    expect(fetchSpy.mock.calls[0][1]?.signal).toBeUndefined()
  })

  it('preserves a caller-provided signal on a mutating call', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ ok: true }, 200))
    const controller = new AbortController()

    await fetchTracked(`${BASE}/x`, { method: 'PATCH', signal: controller.signal })

    expect(fetchSpy.mock.calls[0][1]?.signal).toBe(controller.signal)
  })
})
