// Behavioural pins for the deactivate / transfer flow at the orchestration layer
// (debt #3, self-service deactivate ruling 15).
//
// The rule the owner's ruling implies, in its own words: deactivating "frees the
// seat so the same key activates on the next machine — that IS the transfer".
// The consequence the code must get right is WHEN the LOCAL licence file is
// cleared, because a half-completed transfer that strands the seat on the server
// is the worst outcome (contract §6). So:
//
//  * a successful release clears the local licence (the app returns to the
//    activation screen);
//  * a 404 (the server has no binding for this device = already released there)
//    ALSO clears locally — the transfer is effectively already done;
//  * a 401 (the server refused) KEEPS the local licence and reports the error —
//    the seat may still be held, so never destroy the local proof of it;
//  * a network failure KEEPS the local licence and reports the error, for the
//    same reason (an offline deactivate must fail loudly, contract §6).
//
// The store is pointed at a temp dir and the repository is a fake that throws the
// interface's DeactivateFailedError, so no network and no Electron — vitest runs
// it under src/main/**.

import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DEFAULT_OFFLINE_GRACE_WINDOW_MS, type Licence } from './activation'
import { ActivationService } from './activationService'
import {
  DeactivateFailedError,
  type ActivateRequest,
  type ActivationRepository,
  type DeviceIdentity,
  type IssueResult,
} from './activationRepository'
import {
  configureActivationStore,
  readActivationState,
  resetActivationStoreForTests,
  writeActivationState,
} from './activationStore'

const now = Date.parse('2026-09-01T12:00:00.000Z')

/** A stored, live paid licence — the state a deactivate acts on. */
function activeLicence(deviceId: string): Licence {
  return {
    key: 'STRIX-SOLO-DEMO',
    tier: 'solo',
    isTrial: false,
    deviceId,
    deviceLabel: 'Laptop A',
    issuedAtMs: now,
    expiresAtMs: now + 200 * 24 * 60 * 60 * 1000,
    graceWindowMs: DEFAULT_OFFLINE_GRACE_WINDOW_MS,
  }
}

/**
 * A repository whose deactivate does exactly what the constructor was told:
 * resolve, or throw a {@link DeactivateFailedError} carrying a given status.
 * activate / startTrial are unused here.
 */
class FakeRepository implements ActivationRepository {
  constructor(private readonly onDeactivate: () => Promise<void>) {}
  activate(_request: ActivateRequest): Promise<IssueResult> {
    return Promise.resolve({ ok: false, code: 'unreachable', message: 'unused' })
  }
  startTrial(_device: DeviceIdentity): Promise<IssueResult> {
    return Promise.resolve({ ok: false, code: 'unreachable', message: 'unused' })
  }
  deactivate(_deviceId: string): Promise<void> {
    return this.onDeactivate()
  }
}

function makeService(onDeactivate: () => Promise<void>): ActivationService {
  return new ActivationService({
    repository: new FakeRepository(onDeactivate),
    deviceLabel: 'Laptop A',
    now: () => now,
  })
}

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'strix-activation-service-'))
  configureActivationStore({ userDataDir: dir, deviceIdSeed: 'device-A' })
  writeActivationState({ licence: activeLicence('device-A'), anchor: null, deviceId: 'device-A' })
})

afterEach(() => {
  resetActivationStoreForTests()
  rmSync(dir, { recursive: true, force: true })
})

describe('ActivationService.deactivate', () => {
  it('clears the local licence on a successful release', async () => {
    const service = makeService(() => Promise.resolve())
    const result = await service.deactivate()
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.status.verdict.state).toBe('unactivated')
    // The file no longer carries a licence — the app returns to the activation screen.
    expect(readActivationState().licence).toBeNull()
  })

  it('clears the local licence on a 404 (device already released server-side)', async () => {
    const service = makeService(() =>
      Promise.reject(new DeactivateFailedError(404, 'device unknown')),
    )
    const result = await service.deactivate()
    expect(result.ok).toBe(true)
    expect(readActivationState().licence).toBeNull()
  })

  it('KEEPS the local licence on a 401 and reports the failure', async () => {
    const service = makeService(() =>
      Promise.reject(new DeactivateFailedError(401, 'unauthorised')),
    )
    const result = await service.deactivate()
    expect(result.ok).toBe(false)
    // The seat may still be held on the server — the local proof of it survives.
    expect(readActivationState().licence).not.toBeNull()
  })

  it('KEEPS the local licence on a network failure and reports the failure', async () => {
    const service = makeService(() =>
      Promise.reject(new DeactivateFailedError(null, 'could not reach the server')),
    )
    const result = await service.deactivate()
    expect(result.ok).toBe(false)
    expect(readActivationState().licence).not.toBeNull()
  })
})

// Launch-time refresh (audit H5): "on launch with a licence and a configured
// issuer, the client refreshes once and swallows unreachable" — and it is DORMANT
// while no server URL is configured (the mock/unreachable issuer omits refresh).
describe('ActivationService.refreshOnLaunch', () => {
  /** A repository whose refresh returns whatever the constructor was told. */
  class FakeRefreshRepository implements ActivationRepository {
    calls = 0
    constructor(private readonly onRefresh: (request: ActivateRequest) => Promise<IssueResult>) {}
    activate(): Promise<IssueResult> {
      return Promise.resolve({ ok: false, code: 'unreachable', message: 'unused' })
    }
    startTrial(): Promise<IssueResult> {
      return Promise.resolve({ ok: false, code: 'unreachable', message: 'unused' })
    }
    deactivate(): Promise<void> {
      return Promise.resolve()
    }
    refresh(request: ActivateRequest): Promise<IssueResult> {
      this.calls += 1
      return this.onRefresh(request)
    }
  }

  const RENEWED_END = now + 500 * 24 * 60 * 60 * 1000

  it('refreshes once and persists the renewed expiresAt when the issuer supports refresh', async () => {
    const repo = new FakeRefreshRepository(request =>
      Promise.resolve({ ok: true, licence: { ...activeLicence(request.deviceId), expiresAtMs: RENEWED_END } }),
    )
    const service = new ActivationService({ repository: repo, deviceLabel: 'Laptop A', now: () => now })

    await service.refreshOnLaunch()

    expect(repo.calls).toBe(1)
    // The renewal reached the client — the stored end moved forward.
    expect(readActivationState().licence?.expiresAtMs).toBe(RENEWED_END)
  })

  it('is dormant when the issuer has no refresh (no server URL) — licence unchanged', async () => {
    // FakeRepository (the deactivate fake) implements NO refresh.
    const before = readActivationState().licence?.expiresAtMs
    const service = makeService(() => Promise.resolve())
    await service.refreshOnLaunch()
    expect(readActivationState().licence?.expiresAtMs).toBe(before)
  })

  it('swallows an unreachable refresh — keeps the stored licence, never throws', async () => {
    const before = readActivationState().licence?.expiresAtMs
    const repo = new FakeRefreshRepository(() =>
      Promise.resolve({ ok: false, code: 'unreachable', message: 'offline' }),
    )
    const service = new ActivationService({ repository: repo, deviceLabel: 'Laptop A', now: () => now })
    await expect(service.refreshOnLaunch()).resolves.toBeUndefined()
    expect(readActivationState().licence?.expiresAtMs).toBe(before)
  })

  it('does not call refresh when there is no stored licence', async () => {
    writeActivationState({ licence: null, anchor: null, deviceId: 'device-A' })
    const repo = new FakeRefreshRepository(request =>
      Promise.resolve({ ok: true, licence: activeLicence(request.deviceId) }),
    )
    const service = new ActivationService({ repository: repo, deviceLabel: 'Laptop A', now: () => now })
    await service.refreshOnLaunch()
    expect(repo.calls).toBe(0)
  })
})
