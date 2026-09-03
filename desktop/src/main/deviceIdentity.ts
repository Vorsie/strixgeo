/**
 * Stable per-machine device identity (Electron main process). Debt #3.
 *
 * The activation issuer binds a licence to a *device* (owner ruling 15: one
 * device per Solo seat). For that binding to be usable the client has to send
 * the server an id that is the SAME on every launch of the same machine — and,
 * ideally, the same after the user reinstalls the app — yet DIFFERENT on a
 * genuinely different machine. This module derives that id.
 *
 * ## What the id is built from, and why
 *
 * The default id is a hash of hardware facts Node's ``os`` module exposes
 * without shelling out or a native dependency:
 *
 * * ``platform`` + ``arch`` — the OS/CPU family;
 * * ``cpuModel`` (``os.cpus()[0].model``) — the CPU is socketed/soldered
 *   hardware, so it is the single most reinstall-stable, machine-tied value the
 *   platform hands us for free;
 * * a whole-GiB bucket of ``os.totalmem()`` — discriminates two machines that
 *   share a CPU model; rounded to GiB so the small run-to-run variance
 *   ``totalmem`` reports never shifts the id.
 *
 * **Survives a reinstall** because none of those values live in the app's own
 * files — reinstalling the app cannot change the CPU. **Does not survive a new
 * machine** because a different box has different hardware.
 *
 * Deliberately EXCLUDED from the stable id (both are volatile enough to cause a
 * false "new device", which for a 1-device Solo seat means a support ticket):
 *
 * * **MAC address** — docking stations, VPN adapters and USB NICs add and remove
 *   interfaces, changing the "primary" MAC under the user's feet;
 * * **hostname** — the user can rename their PC at will. It is used only as the
 *   human {@link DeviceIdentity.deviceLabel}, never as part of the id.
 *
 * ## Known weakness, and why it is acceptable here
 *
 * Two identical machines (same CPU model + RAM) hash to the SAME id. For a
 * single-seat product that under-counts rather than over-counts seats, and the
 * real seat authority is the SERVER-side binding, not this fingerprint — the
 * fingerprint only has to let a machine recognise *itself* across launches and
 * reinstalls. A production build that needs true uniqueness should feed the OS
 * machine GUID (Windows ``MachineGuid`` / Linux ``/etc/machine-id`` / macOS
 * ``IOPlatformUUID``) in as {@link DeviceIdentityInputs.machineId}; when present
 * it dominates the hash. Reading it is platform-specific (registry / file /
 * ``ioreg``) and is left out of the default collector to avoid shelling out and
 * a new dependency in this slice.
 *
 * The pure function {@link computeDeviceIdentity} takes every input as an
 * argument so vitest exercises it with no ``os`` mock; {@link collectDeviceIdentityInputs}
 * is the thin impure reader.
 */

import { execFileSync } from 'child_process'
import { createHash } from 'crypto'
import { arch, cpus, hostname, platform, totalmem } from 'os'

import type { DeviceIdentity } from './activationRepository'

/** The machine facts the device id is derived from. */
export interface DeviceIdentityInputs {
  /** Machine name (``os.hostname()``) — the human label only, never the id. */
  hostname: string
  /** ``os.platform()`` — win32 / darwin / linux. */
  platform: string
  /** ``os.arch()`` — x64 / arm64 / … . */
  arch: string
  /** ``os.cpus()[0].model`` — the reinstall-stable hardware anchor. */
  cpuModel: string
  /** ``os.totalmem()`` in bytes — bucketed to whole GiB before hashing. */
  totalMemoryBytes: number
  /**
   * An OS-provided stable machine GUID, when a caller can supply one. When
   * present and non-empty it DOMINATES the hash (eliminating the identical-hardware
   * collision); the default collector leaves it ``null``.
   */
  machineId?: string | null
}

/** Hex characters kept from the SHA-256 digest — 128 bits is ample and compact. */
const DEVICE_ID_HEX_LENGTH = 32

/** Bytes per gibibyte, for the memory bucket. */
const BYTES_PER_GIB = 1024 ** 3

/**
 * Hash a fixed field list to a short hex id.
 *
 * The fields are joined with the ASCII unit separator (0x1f), a byte that cannot
 * occur in any of the hardware strings, so two different field lists can never
 * collide by concatenation.
 *
 * Parameters
 * ----------
 * parts : readonly string[]
 *     The ordered fields to fold into the digest.
 *
 * Returns
 * -------
 * string
 *     The first {@link DEVICE_ID_HEX_LENGTH} hex characters of the SHA-256 digest.
 */
function hashHex(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('')).digest('hex').slice(0, DEVICE_ID_HEX_LENGTH)
}

/**
 * Derive a stable device id and human label from machine facts. Pure.
 *
 * Parameters
 * ----------
 * inputs : DeviceIdentityInputs
 *     The machine facts (from {@link collectDeviceIdentityInputs} in production,
 *     hand-built in tests).
 *
 * Returns
 * -------
 * DeviceIdentity
 *     ``deviceId`` — the opaque, stable id sent to the issuer; ``deviceLabel`` —
 *     the hostname, shown on the deactivate/transfer screen.
 */
export function computeDeviceIdentity(inputs: DeviceIdentityInputs): DeviceIdentity {
  const deviceLabel = inputs.hostname.trim() || 'this device'

  const machineId = inputs.machineId?.trim()
  if (machineId) {
    // A real machine GUID is unique on its own; the platform tag guards against
    // the (astronomically unlikely) reuse of a GUID across OS families.
    return { deviceId: hashHex(['mid', inputs.platform, machineId]), deviceLabel }
  }

  const memGib = String(Math.round(inputs.totalMemoryBytes / BYTES_PER_GIB))
  const deviceId = hashHex(['hw', inputs.platform, inputs.arch, inputs.cpuModel.trim(), memGib])
  return { deviceId, deviceLabel }
}

/**
 * Extract the ``MachineGuid`` value from ``reg query`` output. Pure.
 *
 * ``reg query HKLM\SOFTWARE\Microsoft\Cryptography /v MachineGuid`` prints, among
 * blank lines, one line of the form ``    MachineGuid    REG_SZ    <guid>``. This
 * pulls the value token out of that line, whitespace-tolerant, and returns
 * ``null`` when the value is absent (a different OS, a locked-down box, an
 * unexpected format) so the caller falls back to the hardware hash.
 *
 * Parameters
 * ----------
 * stdout : string
 *     The captured standard output of the ``reg query`` call.
 *
 * Returns
 * -------
 * string | null
 *     The GUID string, or ``null`` when no ``MachineGuid`` line is present.
 */
export function parseMachineGuidFromRegQuery(stdout: string): string | null {
  for (const line of stdout.split(/\r?\n/)) {
    // REG_SZ is the value type; the GUID is the last whitespace-separated token.
    const match = line.match(/MachineGuid\s+REG_SZ\s+(\S+)/i)
    if (match) {
      const guid = match[1].trim()
      return guid || null
    }
  }
  return null
}

/**
 * Read the Windows ``MachineGuid`` from the registry, best-effort. Impure.
 *
 * The GUID is written once at OS install and is stable for the life of the
 * installation — the strongest per-machine discriminator available without a
 * native dependency, and the value that breaks the identical-hardware collision
 * two office laptops of the same model would otherwise hit (owner ruling 15: one
 * device per Solo seat). Reading it shells out to ``reg`` (a dependency-free path
 * on every Windows since XP); any failure — a non-Windows OS, a policy-locked
 * registry, a timeout — returns ``null`` and the id falls back to the hardware
 * hash, exactly the previous behaviour.
 *
 * Returns
 * -------
 * string | null
 *     The machine GUID on Windows when readable; ``null`` otherwise.
 */
export function collectWindowsMachineGuid(): string | null {
  if (platform() !== 'win32') return null
  try {
    const stdout = execFileSync(
      'reg',
      ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'],
      // A short timeout so a wedged registry never stalls launch; hide the console
      // window a GUI Electron app would otherwise flash.
      { encoding: 'utf8', timeout: 2000, windowsHide: true },
    )
    return parseMachineGuidFromRegQuery(stdout)
  } catch {
    return null
  }
}

/**
 * Read the machine facts from the current process. Impure (touches ``os`` and,
 * on Windows, the registry via {@link collectWindowsMachineGuid}).
 *
 * Returns
 * -------
 * DeviceIdentityInputs
 *     The live machine facts. ``machineId`` is the Windows ``MachineGuid`` when
 *     readable (it dominates the hash, eliminating the identical-hardware
 *     collision), else ``null`` (→ the hardware-only hash).
 */
export function collectDeviceIdentityInputs(): DeviceIdentityInputs {
  return {
    hostname: hostname(),
    platform: platform(),
    arch: arch(),
    cpuModel: cpus()[0]?.model ?? 'unknown-cpu',
    totalMemoryBytes: totalmem(),
    machineId: collectWindowsMachineGuid(),
  }
}

/**
 * The device identity for this installation — the collector composed with the
 * pure derivation.
 *
 * Returns
 * -------
 * DeviceIdentity
 *     This machine's stable id and human label.
 */
export function resolveDeviceIdentity(): DeviceIdentity {
  return computeDeviceIdentity(collectDeviceIdentityInputs())
}
