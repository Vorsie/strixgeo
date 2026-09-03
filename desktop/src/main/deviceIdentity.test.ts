// Behavioural pins for the device identity (debt #3).
//
// The id the issuer binds a licence to has to be stable per machine: the SAME on
// every launch and across a reinstall, DIFFERENT on another machine. These cases
// pin exactly that contract in the module's own terms:
//
//  * same hardware → same id (survives a reinstall — nothing in the app's files
//    feeds the id);
//  * different hardware → different id (a new machine is a new device);
//  * the hostname is only the human label, so renaming the PC must NOT move the id;
//  * an OS machine GUID, when supplied, dominates the hash (the uniqueness path a
//    production build wires in).
//
// computeDeviceIdentity is pure — every input is an argument — so vitest runs it
// with no os mock, under src/main/**.

import { describe, expect, it } from 'vitest'

import {
  computeDeviceIdentity,
  parseMachineGuidFromRegQuery,
  type DeviceIdentityInputs,
} from './deviceIdentity'

const BASE: DeviceIdentityInputs = {
  hostname: 'WORKSTATION-7',
  platform: 'win32',
  arch: 'x64',
  cpuModel: '13th Gen Intel(R) Core(TM) i7-13700HX',
  totalMemoryBytes: 64 * 1024 ** 3,
  machineId: null,
}

describe('computeDeviceIdentity', () => {
  it('is stable — the same hardware yields the same id (survives a reinstall)', () => {
    expect(computeDeviceIdentity(BASE).deviceId).toBe(computeDeviceIdentity({ ...BASE }).deviceId)
  })

  it('changes when the CPU model changes (a different machine)', () => {
    const other = computeDeviceIdentity({ ...BASE, cpuModel: 'AMD Ryzen 9 7940HS' })
    expect(other.deviceId).not.toBe(computeDeviceIdentity(BASE).deviceId)
  })

  it('changes with the platform or arch', () => {
    expect(computeDeviceIdentity({ ...BASE, platform: 'linux' }).deviceId).not.toBe(
      computeDeviceIdentity(BASE).deviceId,
    )
    expect(computeDeviceIdentity({ ...BASE, arch: 'arm64' }).deviceId).not.toBe(
      computeDeviceIdentity(BASE).deviceId,
    )
  })

  it('buckets memory to whole GiB — sub-GiB variance does not move the id', () => {
    const jitter = computeDeviceIdentity({ ...BASE, totalMemoryBytes: 64 * 1024 ** 3 - 4 * 1024 ** 2 })
    expect(jitter.deviceId).toBe(computeDeviceIdentity(BASE).deviceId)
    const doubled = computeDeviceIdentity({ ...BASE, totalMemoryBytes: 128 * 1024 ** 3 })
    expect(doubled.deviceId).not.toBe(computeDeviceIdentity(BASE).deviceId)
  })

  it('uses the hostname only as the label — a rename does not move the id', () => {
    const renamed = computeDeviceIdentity({ ...BASE, hostname: 'ROBIN-LAPTOP' })
    expect(renamed.deviceId).toBe(computeDeviceIdentity(BASE).deviceId)
    expect(renamed.deviceLabel).toBe('ROBIN-LAPTOP')
  })

  it('falls back to a placeholder label when the hostname is blank', () => {
    expect(computeDeviceIdentity({ ...BASE, hostname: '   ' }).deviceLabel).toBe('this device')
  })

  it('lets a supplied machine GUID dominate — same GUID, same id, despite hardware differences', () => {
    const a = computeDeviceIdentity({ ...BASE, machineId: 'ABCDEF-0123' })
    const b = computeDeviceIdentity({ ...BASE, cpuModel: 'something else', machineId: 'ABCDEF-0123' })
    expect(a.deviceId).toBe(b.deviceId)
    // …and a different GUID is a different id.
    const c = computeDeviceIdentity({ ...BASE, machineId: 'ZZZZ-9999' })
    expect(c.deviceId).not.toBe(a.deviceId)
    // …and the GUID id differs from the hardware-only id (namespaced).
    expect(a.deviceId).not.toBe(computeDeviceIdentity(BASE).deviceId)
  })

  it('produces a compact hex id', () => {
    expect(computeDeviceIdentity(BASE).deviceId).toMatch(/^[0-9a-f]{32}$/)
  })
})

// The Windows MachineGuid — fed in as ``machineId`` so it dominates the id and
// two identical office laptops differ (owner ruling 15). The impure reader shells
// out; the extraction of the value from ``reg query`` output is pure and pinned
// here (the domination behaviour itself is pinned in the GUID case above).
describe('parseMachineGuidFromRegQuery', () => {
  it('pulls the GUID out of real reg query output', () => {
    const output = [
      '',
      'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography',
      '    MachineGuid    REG_SZ    a1b2c3d4-1234-5678-9abc-def012345678',
      '',
    ].join('\r\n')
    expect(parseMachineGuidFromRegQuery(output)).toBe('a1b2c3d4-1234-5678-9abc-def012345678')
  })

  it('returns null when there is no MachineGuid line', () => {
    expect(parseMachineGuidFromRegQuery('ERROR: The system was unable to find the specified key')).toBeNull()
    expect(parseMachineGuidFromRegQuery('')).toBeNull()
  })
})
