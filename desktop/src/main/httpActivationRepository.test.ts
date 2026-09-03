// Behavioural pins for the HTTP activation issuer (debt #3).
//
// This is the production-shaped ActivationRepository that talks to the
// strixgeo.com service over the contract in docs/design/activation-api-contract.md.
// The cases pin the two things a real server round-trip has to get right:
//
//  * the contract's WIRE licence maps to the internal Licence (grace crosses the
//    wire as whole days, timestamps as epoch ms, tier validated against the set);
//  * every contract error maps to the interface's IssueFailureCode, and anything
//    that is not a clean refusal — a network failure, a timeout, a 5xx, an
//    unreadable body — becomes `unreachable`, the code the offline path is built
//    on. The final case reuses the grace-test shape from activation.test.ts to
//    prove the consequence the owner cares about: with the server unreachable,
//    the stored in-grace licence still opens the app (ruling 14).
//
// fetch is injected, so no network and no Electron — vitest runs it under
// src/main/**.

import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DEFAULT_OFFLINE_GRACE_WINDOW_MS, type Licence } from './activation'
import { ActivationService } from './activationService'
import {
  configureActivationStore,
  resetActivationStoreForTests,
  writeActivationState,
} from './activationStore'
import { HttpActivationRepository, maskLicenceKey } from './httpActivationRepository'
import { DeactivateFailedError } from './activationRepository'
import { MockActivationRepository } from './mockActivationRepository'

const DAY_MS = 24 * 60 * 60 * 1000
const now = Date.parse('2026-09-01T12:00:00.000Z')

const DEVICE = { deviceId: 'device-A', deviceLabel: 'Laptop A' }

/** A well-formed WIRE licence (the contract's shape), one field overridable. */
function wireLicence(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key: 'STRIX-XXXX-AB12',
    tier: 'solo',
    seatId: 'seat-1',
    isTrial: false,
    issuedAt: now,
    expiresAt: now + 365 * DAY_MS,
    graceDays: 30,
    deviceId: 'device-A',
    deviceLabel: 'Laptop A',
    ...overrides,
  }
}

/** A fetch that resolves to the given status + JSON body. */
function fetchReturning(status: number, body: unknown): typeof fetch {
  return (async () => ({ status, json: async () => body })) as unknown as typeof fetch
}

/** A fetch that throws — a DNS / connection failure. */
function fetchThrowing(): typeof fetch {
  return (async () => {
    throw new Error('ECONNREFUSED')
  }) as unknown as typeof fetch
}

/** A fetch that never answers until the request's own timeout aborts it. */
function fetchHanging(): typeof fetch {
  return ((_url: unknown, init?: { signal?: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('AbortError')))
    })) as unknown as typeof fetch
}

function makeRepo(fetchImpl: typeof fetch, extra: Record<string, unknown> = {}): HttpActivationRepository {
  return new HttpActivationRepository({ baseUrl: 'https://example.test/api/', fetchImpl, ...extra })
}

describe('HttpActivationRepository', () => {
  it('activates and maps the wire licence to the internal shape', async () => {
    const repo = makeRepo(fetchReturning(200, { licence: wireLicence() }))
    const result = await repo.activate({ ...DEVICE, key: 'STRIX-XXXX-AB12' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.licence.tier).toBe('solo')
      expect(result.licence.isTrial).toBe(false)
      expect(result.licence.deviceId).toBe('device-A')
      expect(result.licence.issuedAtMs).toBe(now)
      expect(result.licence.expiresAtMs).toBe(now + 365 * DAY_MS)
      // graceDays (30) crosses the wire; graceWindowMs is derived from it.
      expect(result.licence.graceWindowMs).toBe(30 * DAY_MS)
    }
  })

  it('backfills the device id/label onto the licence when the server omits them', async () => {
    const repo = makeRepo(fetchReturning(200, { licence: wireLicence({ deviceId: undefined, deviceLabel: undefined }) }))
    const result = await repo.activate({ ...DEVICE, key: 'STRIX-XXXX-AB12' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.licence.deviceId).toBe('device-A')
      expect(result.licence.deviceLabel).toBe('Laptop A')
    }
  })

  // Error mapping — the contract code → the interface IssueFailureCode.
  it('maps key_unknown (404) to unknown_key', async () => {
    const repo = makeRepo(fetchReturning(404, { error: { code: 'key_unknown' } }))
    const result = await repo.activate({ ...DEVICE, key: 'NOPE' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('unknown_key')
  })

  it('maps key_bound_elsewhere (409) to device_limit', async () => {
    const repo = makeRepo(fetchReturning(409, { error: { code: 'key_bound_elsewhere' } }))
    const result = await repo.activate({ ...DEVICE, key: 'STRIX-XXXX-AB12' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('device_limit')
  })

  it('maps seat_exhausted (409) to device_limit', async () => {
    const repo = makeRepo(fetchReturning(409, { error: { code: 'seat_exhausted' } }))
    const result = await repo.activate({ ...DEVICE, key: 'STRIX-XXXX-AB12' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('device_limit')
  })

  it('maps trial_already_used (409) to already_trialled', async () => {
    const repo = makeRepo(fetchReturning(409, { error: { code: 'trial_already_used' } }))
    const result = await repo.startTrial(DEVICE)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('already_trialled')
  })

  it('maps an unrecognised error code and a 5xx to unreachable', async () => {
    const unknownCode = makeRepo(fetchReturning(400, { error: { code: 'teapot' } }))
    const serverError = makeRepo(fetchReturning(503, { error: { code: 'maintenance' } }))
    const a = await unknownCode.activate({ ...DEVICE, key: 'STRIX-XXXX-AB12' })
    const b = await serverError.activate({ ...DEVICE, key: 'STRIX-XXXX-AB12' })
    expect(a.ok).toBe(false)
    if (!a.ok) expect(a.code).toBe('unreachable')
    expect(b.ok).toBe(false)
    if (!b.ok) expect(b.code).toBe('unreachable')
  })

  it('reports a network failure as unreachable, not a throw', async () => {
    const repo = makeRepo(fetchThrowing())
    const result = await repo.activate({ ...DEVICE, key: 'STRIX-XXXX-AB12' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('unreachable')
  })

  it('times a hanging request out and reports unreachable', async () => {
    const repo = makeRepo(fetchHanging(), { timeoutMs: 20 })
    const result = await repo.activate({ ...DEVICE, key: 'STRIX-XXXX-AB12' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('unreachable')
  })

  it('treats a 200 with an unreadable licence as unreachable', async () => {
    const repo = makeRepo(fetchReturning(200, { licence: { tier: 'gold' } }))
    const result = await repo.activate({ ...DEVICE, key: 'STRIX-XXXX-AB12' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('unreachable')
  })

  it('starts a trial and flags the licence isTrial', async () => {
    const repo = makeRepo(fetchReturning(200, { licence: wireLicence({ isTrial: true, key: 'STRIX-TRIAL' }) }))
    const result = await repo.startTrial(DEVICE)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.licence.isTrial).toBe(true)
  })

  it('resolves deactivate on 2xx and throws when the release fails', async () => {
    await expect(makeRepo(fetchReturning(200, { released: true })).deactivate('device-A')).resolves.toBeUndefined()
    await expect(makeRepo(fetchReturning(500, {})).deactivate('device-A')).rejects.toThrow()
    await expect(makeRepo(fetchThrowing()).deactivate('device-A')).rejects.toThrow()
  })

  it('throws a typed DeactivateFailedError carrying the HTTP status (null for a network failure)', async () => {
    // The status lets the orchestration layer tell a 404 (already released ->
    // clear locally) from a 401 / network failure (keep the local licence).
    const notFound = await makeRepo(fetchReturning(404, { error: { code: 'key_unknown' } }))
      .deactivate('device-A')
      .catch((err: unknown) => err)
    expect(notFound).toBeInstanceOf(DeactivateFailedError)
    expect((notFound as DeactivateFailedError).status).toBe(404)

    const unauthorised = await makeRepo(fetchReturning(401, {}))
      .deactivate('device-A')
      .catch((err: unknown) => err)
    expect(unauthorised).toBeInstanceOf(DeactivateFailedError)
    expect((unauthorised as DeactivateFailedError).status).toBe(401)

    const offline = await makeRepo(fetchThrowing())
      .deactivate('device-A')
      .catch((err: unknown) => err)
    expect(offline).toBeInstanceOf(DeactivateFailedError)
    expect((offline as DeactivateFailedError).status).toBeNull()
  })

  it('never hands the full key to the debug sink — last four only', async () => {
    const seen: string[] = []
    const repo = makeRepo(fetchReturning(200, { licence: wireLicence() }), {
      onDebug: (m: string) => seen.push(m),
    })
    await repo.activate({ ...DEVICE, key: 'STRIX-SECRET-9999' })
    expect(seen.join('\n')).not.toContain('STRIX-SECRET-9999')
    expect(seen.join('\n')).toContain('9999')
    expect(maskLicenceKey('STRIX-SECRET-9999')).toBe('••••9999')
    expect(maskLicenceKey('ab')).toBe('••••')
  })

  // audit H5 — POST /refresh re-issues the licence with a renewed expiresAt (the
  // instant that resets the client's offline-grace clock); an offline refresh is
  // `unreachable`, so the caller keeps the stored licence.
  it('refresh maps the renewed wire licence, and reports unreachable when offline', async () => {
    const renewed = now + 400 * DAY_MS
    const ok = await makeRepo(fetchReturning(200, { licence: wireLicence({ expiresAt: renewed }) })).refresh({
      ...DEVICE,
      key: 'STRIX-XXXX-AB12',
    })
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.licence.expiresAtMs).toBe(renewed)

    const offline = await makeRepo(fetchThrowing()).refresh({ ...DEVICE, key: 'STRIX-XXXX-AB12' })
    expect(offline.ok).toBe(false)
    if (!offline.ok) expect(offline.code).toBe('unreachable')
  })
})

// The offline consequence — reuse the activation.test.ts grace shape: with the
// server unreachable, the stored in-grace licence still opens the app, and the
// action call reports `unreachable` rather than destroying anything.
describe('offline: an unreachable server keeps a stored in-grace licence', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'strix-http-activation-'))
    configureActivationStore({ userDataDir: dir })
  })

  afterEach(() => {
    resetActivationStoreForTests()
    rmSync(dir, { recursive: true, force: true })
  })

  it('getStatus reads grace, and activate reports unreachable', async () => {
    // A paid licence 5 days past its end — 25 days of the 30-day grace remain.
    const licence: Licence = {
      key: 'STRIX-SOLO-DEMO',
      tier: 'solo',
      isTrial: false,
      deviceId: 'device-A',
      deviceLabel: 'Laptop A',
      issuedAtMs: now - 400 * DAY_MS,
      expiresAtMs: now - 5 * DAY_MS,
      graceWindowMs: DEFAULT_OFFLINE_GRACE_WINDOW_MS,
    }
    writeActivationState({ licence, anchor: null, deviceId: 'device-A' })

    const service = new ActivationService({
      repository: new HttpActivationRepository({ baseUrl: 'https://example.test', fetchImpl: fetchThrowing() }),
      deviceLabel: 'Laptop A',
      now: () => now,
    })

    const status = service.getStatus()
    expect(status.verdict.state).toBe('grace')
    expect(status.verdict.blocked).toBe(false)
    expect(status.verdict.graceDaysRemaining).toBe(25)

    const result = await service.activate('STRIX-SOLO-DEMO')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('unreachable')
  })

  it('the mock stays the fallback issuer (sanity — no base URL)', async () => {
    const service = new ActivationService({
      repository: new MockActivationRepository(() => now),
      deviceLabel: 'Laptop A',
      now: () => now,
    })
    const result = await service.activate('STRIX-SOLO-DEMO')
    expect(result.ok).toBe(true)
  })
})
