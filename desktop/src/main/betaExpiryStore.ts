/**
 * Persistence for the beta-expiry clock anchor (Electron main process).
 *
 * Stores one small file — ``<userData>/beta-anchor.json`` — holding the first
 * and highest instants this installation has ever observed. {@link betaExpiry}
 * owns the rules; this module owns the bytes.
 *
 * ## Why the userData directory is injected
 *
 * Same reason as ``recoveryStore.ts``: this module must not ``import
 * 'electron'`` so vitest can exercise it (see ``vitest.config.ts``).
 * ``index.ts`` calls {@link configureBetaExpiryStore} once at startup with
 * ``app.getPath('userData')``.
 *
 * ## Trust posture
 *
 * The file is plain, unsigned JSON in a directory the user owns. Deleting or
 * editing it is possible and is not treated as an error — it degrades to "no
 * anchor", and {@link evaluateBetaExpiry} still has the build stamp and the
 * corroborating recent-projects timestamps to work from. Signing the anchor
 * would need a key shipped inside the binary, which an unpacked asar hands over
 * anyway; it would buy the appearance of security, not security. The real fix
 * is server-issued licences — see the activation memo.
 *
 * Every damaged-file path resolves to ``null`` rather than to a throw: a
 * corrupt anchor must never be the reason a legitimate tester cannot open the
 * app, and it must never be a way to make the app *skip* the expiry check
 * either — ``null`` is the conservative answer on both counts.
 */

import { existsSync, mkdirSync, readFileSync } from 'fs'
import { join } from 'path'

import { writeFileAtomic } from './atomicWrite'
import { advanceAnchor, type ClockAnchor } from './betaExpiry'

/** Name of the anchor file inside the user-data directory. */
export const BETA_ANCHOR_FILENAME = 'beta-anchor.json'

/**
 * Envelope discriminator. A file that does not carry exactly this value is
 * foreign (a hand-copied config, a namesake from another app) and is skipped.
 */
export const BETA_ANCHOR_KIND = 'strixgeo.beta-anchor'

/** Envelope version. Bumped only if the field set changes shape. */
export const BETA_ANCHOR_FORMAT_VERSION = 1

/**
 * Read cap. The file holds two numbers; anything larger is not our file, and
 * reading it into main-process memory is pointless risk (cf. the caps in
 * ``recoveryStore.ts`` / ``index.ts``).
 */
export const BETA_ANCHOR_CAP_BYTES = 4 * 1024

/** Injected configuration — the directory the anchor file lives in. */
export interface BetaExpiryStoreConfig {
  /** Absolute path to Electron's ``userData`` directory. */
  userDataDir: string
}

let config: BetaExpiryStoreConfig | null = null

/**
 * Point the store at a user-data directory.
 *
 * Parameters
 * ----------
 * next : BetaExpiryStoreConfig
 *     Directory the anchor file lives in.
 */
export function configureBetaExpiryStore(next: BetaExpiryStoreConfig): void {
  config = next
}

/** Drop the configuration — test-only, so one spec cannot leak into the next. */
export function resetBetaExpiryStoreForTests(): void {
  config = null
}

/** The configuration, or a loud failure naming the call that was skipped. */
function requireConfig(): BetaExpiryStoreConfig {
  if (!config) {
    throw new Error('beta expiry store used before configureBetaExpiryStore() — call it at startup')
  }
  return config
}

/**
 * Absolute path of the anchor file.
 *
 * Returns
 * -------
 * string
 *     ``<userData>/beta-anchor.json``.
 *
 * Raises
 * ------
 * Error
 *     When {@link configureBetaExpiryStore} has not run.
 */
export function clockAnchorPath(): string {
  return join(requireConfig().userDataDir, BETA_ANCHOR_FILENAME)
}

/** True for a number we are willing to compare against a clock. */
function isUsableInstant(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Read the persisted anchor.
 *
 * Returns
 * -------
 * ClockAnchor | null
 *     The anchor, or ``null`` when the file is absent, oversized, unparseable,
 *     foreign, or internally inconsistent (last-seen before first-seen).
 */
export function readClockAnchor(): ClockAnchor | null {
  const path = clockAnchorPath()
  if (!existsSync(path)) return null

  let raw: unknown
  try {
    const text = readFileSync(path, 'utf-8')
    if (text.length > BETA_ANCHOR_CAP_BYTES) return null
    raw = JSON.parse(text)
  } catch {
    // Unreadable or unparseable — indistinguishable from absent, and treated
    // the same way on purpose (module docstring).
    return null
  }

  if (typeof raw !== 'object' || raw === null) return null
  const envelope = raw as Record<string, unknown>
  if (envelope.kind !== BETA_ANCHOR_KIND) return null
  if (!isUsableInstant(envelope.firstSeenMs) || !isUsableInstant(envelope.lastSeenMs)) return null
  if (envelope.lastSeenMs < envelope.firstSeenMs) return null

  return { firstSeenMs: envelope.firstSeenMs, lastSeenMs: envelope.lastSeenMs }
}

/**
 * Write the anchor, atomically.
 *
 * Parameters
 * ----------
 * anchor : ClockAnchor
 *     The anchor to persist.
 */
export function writeClockAnchor(anchor: ClockAnchor): void {
  const cfg = requireConfig()
  mkdirSync(cfg.userDataDir, { recursive: true })
  const envelope = {
    kind: BETA_ANCHOR_KIND,
    format_version: BETA_ANCHOR_FORMAT_VERSION,
    firstSeenMs: anchor.firstSeenMs,
    lastSeenMs: anchor.lastSeenMs,
  }
  writeFileAtomic(clockAnchorPath(), `${JSON.stringify(envelope, null, 2)}\n`)
}

/**
 * Record that the app is running right now and return the resulting anchor.
 *
 * Reads the anchor, moves it forward (never back — see {@link advanceAnchor})
 * and writes it again. A write failure is swallowed: a read-only user-data
 * directory must not prevent the app from starting, and the in-memory anchor
 * this returns is still the right input for the expiry decision on this launch.
 *
 * Parameters
 * ----------
 * nowMs : number
 *     Current wall-clock time, epoch ms.
 *
 * Returns
 * -------
 * ClockAnchor
 *     The anchor as it stands after this launch.
 */
export function recordLaunch(nowMs: number): ClockAnchor {
  const next = advanceAnchor(readClockAnchor(), nowMs)
  try {
    writeClockAnchor(next)
  } catch {
    // Best effort — see the docstring. The decision for THIS launch is already
    // made from the value we hold.
  }
  return next
}
