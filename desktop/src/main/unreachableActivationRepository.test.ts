// Behavioural pins for the packaged no-server issuer (debt #3, audit C3(a)).
//
// The rule, in the owner's own words: "a non-beta packaged build with no issuer
// cannot activate". This repository is what a packaged build gets when no
// activation URL is configured — instead of the mock, whose published demo keys
// would otherwise let a packaged build activate. So:
//
//  * activate → unreachable (never a licence, whatever key is entered);
//  * startTrial → unreachable (no server, no trial);
//  * deactivate → fails loudly (a null-status DeactivateFailedError), so the
//    orchestration layer keeps the local licence rather than stranding a seat.
//
// No Electron, no network — vitest runs it under src/main/**.

import { describe, expect, it } from 'vitest'

import { DeactivateFailedError } from './activationRepository'
import { UnreachableActivationRepository } from './unreachableActivationRepository'

describe('UnreachableActivationRepository', () => {
  const repo = new UnreachableActivationRepository()

  it('cannot activate — any key answers unreachable, never a licence', async () => {
    const result = await repo.activate({ key: 'STRIX-SOLO-DEMO', deviceId: 'd', deviceLabel: 'L' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('unreachable')
  })

  it('cannot start a trial — unreachable', async () => {
    const result = await repo.startTrial({ deviceId: 'd', deviceLabel: 'L' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('unreachable')
  })

  it('deactivate fails loudly with a null-status error (never strand a seat)', async () => {
    const err = await repo.deactivate('d').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DeactivateFailedError)
    expect((err as DeactivateFailedError).status).toBeNull()
  })
})
