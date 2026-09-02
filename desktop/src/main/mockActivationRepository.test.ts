// Behavioural pins for the MOCK activation issuer (prototype, debt #3).
//
// The repository is the seam the owner asked for: a THIN interface the real
// strixgeo.com service (MySQL, ruling "Activation host") will implement, with a
// local mock standing in for it so nothing touches the network. These pins
// paraphrase the rulings the mock has to honour:
//
//  * ruling 15 — "1 device per Solo seat." A Solo key bound to one device
//    refuses a second until the first is deactivated; deactivate/transfer frees
//    the slot. (The consequence the owner accepted: a reinstall is a support
//    email UNLESS self-service deactivate exists — so deactivate must work.)
//  * ruling 16 — "trial = a server-issued trial licence." startTrial issues a
//    real Licence on the same path, just time-limited and flagged isTrial.
//
// In-memory, no fs, no Electron — vitest runs it under src/main/**.

import { describe, expect, it } from 'vitest'

import { MockActivationRepository, SOLO_DEMO_KEY, STUDIO_DEMO_KEY } from './mockActivationRepository'

const now = Date.parse('2026-09-01T12:00:00.000Z')

describe('MockActivationRepository', () => {
  it('activates a known Solo key and binds it to the device', async () => {
    const repo = new MockActivationRepository(() => now)
    const result = await repo.activate({
      key: SOLO_DEMO_KEY,
      deviceId: 'device-A',
      deviceLabel: 'Laptop A',
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.licence.tier).toBe('solo')
      expect(result.licence.isTrial).toBe(false)
      expect(result.licence.deviceId).toBe('device-A')
      expect(result.licence.expiresAtMs).toBeGreaterThan(now)
    }
  })

  it('refuses an unknown key', async () => {
    const repo = new MockActivationRepository(() => now)
    const result = await repo.activate({
      key: 'NOT-A-REAL-KEY',
      deviceId: 'device-A',
      deviceLabel: 'Laptop A',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('unknown_key')
      // The rejection must not echo the entered key back (senior review): it is
      // untrusted input that ends up in logs, and the renderer shows a translated
      // message keyed on the code, not this string.
      expect(result.message).not.toContain('NOT-A-REAL-KEY')
    }
  })

  // ruling 15 — a Solo seat is one device.
  it('refuses a SECOND device on a Solo key until the first is deactivated', async () => {
    const repo = new MockActivationRepository(() => now)
    await repo.activate({ key: SOLO_DEMO_KEY, deviceId: 'device-A', deviceLabel: 'Laptop A' })

    const second = await repo.activate({ key: SOLO_DEMO_KEY, deviceId: 'device-B', deviceLabel: 'Laptop B' })
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.code).toBe('device_limit')

    // Self-service deactivate frees the seat (the flow ruling 15 made required).
    await repo.deactivate('device-A')
    const afterTransfer = await repo.activate({
      key: SOLO_DEMO_KEY,
      deviceId: 'device-B',
      deviceLabel: 'Laptop B',
    })
    expect(afterTransfer.ok).toBe(true)
  })

  it('re-activating the SAME device on a Solo key just refreshes it', async () => {
    const repo = new MockActivationRepository(() => now)
    await repo.activate({ key: SOLO_DEMO_KEY, deviceId: 'device-A', deviceLabel: 'Laptop A' })
    const again = await repo.activate({ key: SOLO_DEMO_KEY, deviceId: 'device-A', deviceLabel: 'Laptop A' })
    expect(again.ok).toBe(true)
  })

  it('a Studio key admits more than one device', async () => {
    const repo = new MockActivationRepository(() => now)
    await repo.activate({ key: STUDIO_DEMO_KEY, deviceId: 'device-A', deviceLabel: 'A' })
    const second = await repo.activate({ key: STUDIO_DEMO_KEY, deviceId: 'device-B', deviceLabel: 'B' })
    expect(second.ok).toBe(true)
  })

  // ruling 16 — trial is a real, server-issued, time-limited licence.
  it('issues a time-limited trial licence on the same path', async () => {
    const repo = new MockActivationRepository(() => now)
    const result = await repo.startTrial({ deviceId: 'device-A', deviceLabel: 'Laptop A' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.licence.isTrial).toBe(true)
      expect(result.licence.expiresAtMs).toBeGreaterThan(now)
    }
  })

  it('refuses a second trial on a device that already trialled', async () => {
    const repo = new MockActivationRepository(() => now)
    await repo.startTrial({ deviceId: 'device-A', deviceLabel: 'Laptop A' })
    const again = await repo.startTrial({ deviceId: 'device-A', deviceLabel: 'Laptop A' })
    expect(again.ok).toBe(false)
    if (!again.ok) expect(again.code).toBe('already_trialled')
  })
})
