/**
 * Local persistence for the activation authority (Electron main process) —
 * PROTOTYPE. Debt #3.
 *
 * Stores one file — ``<userData>/activation.json`` — holding the device's
 * current {@link Licence}, a monotonic clock {@link ClockAnchor} (reused from
 * the beta-expiry primitive for rollback defence) and a stable per-installation
 * device id. {@link ../activation.evaluateActivation} owns the rules; this
 * module owns the bytes.
 *
 * Mirrors ``betaExpiryStore.ts`` exactly: it must not ``import 'electron'`` (so
 * vitest can exercise it), so ``index.ts`` injects ``app.getPath('userData')``
 * via {@link configureActivationStore}. Every damaged-file path resolves to a
 * safe empty state rather than throwing.
 *
 * ## Trust posture (prototype)
 *
 * The file is plain, UNSIGNED JSON in a directory the user owns. A production
 * build stores an Ed25519-signed licence here and verifies the signature before
 * trusting the dates (Option C, activation memo). The prototype omits the
 * signature on purpose — the shape is the contract; the crypto is the TODO.
 */

import { existsSync, mkdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'

import { writeFileAtomic } from './atomicWrite'
import { advanceAnchor, type ClockAnchor } from './betaExpiry'
import { LICENCE_TIERS, type Licence } from './activation'

/** Name of the activation file inside the user-data directory. */
export const ACTIVATION_FILENAME = 'activation.json'

/** Envelope discriminator — a file not carrying this value is foreign, skipped. */
export const ACTIVATION_KIND = 'strixgeo.activation'

/** Envelope version — bumped only if the field set changes shape. */
export const ACTIVATION_FORMAT_VERSION = 1

/** Read cap — the file holds one licence and two numbers; larger is not ours. */
export const ACTIVATION_CAP_BYTES = 16 * 1024

/** The persisted state. All fields optional so a partial/legacy file degrades. */
export interface ActivationState {
  /** The device's current licence, or ``null`` when never activated. */
  licence: Licence | null
  /** Monotonic clock anchor for rollback defence. */
  anchor: ClockAnchor | null
  /** Stable per-installation device id, generated once and kept. */
  deviceId: string
}

/** Injected configuration — the directory the activation file lives in. */
export interface ActivationStoreConfig {
  /** Absolute path to Electron's ``userData`` directory. */
  userDataDir: string
}

let config: ActivationStoreConfig | null = null

/**
 * Point the store at a user-data directory.
 *
 * Parameters
 * ----------
 * next : ActivationStoreConfig
 *     Directory the activation file lives in.
 */
export function configureActivationStore(next: ActivationStoreConfig): void {
  config = next
}

/** Drop the configuration — test-only, so one spec cannot leak into the next. */
export function resetActivationStoreForTests(): void {
  config = null
}

/** The configuration, or a loud failure naming the call that was skipped. */
function requireConfig(): ActivationStoreConfig {
  if (!config) {
    throw new Error('activation store used before configureActivationStore() — call it at startup')
  }
  return config
}

/** Absolute path of the activation file. */
export function activationStatePath(): string {
  return join(requireConfig().userDataDir, ACTIVATION_FILENAME)
}

/** True for a number we are willing to compare against a clock. */
function isUsableInstant(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Read the persisted state, filling a fresh device id when absent.
 *
 * Returns
 * -------
 * ActivationState
 *     The stored state. A missing/oversized/unparseable/foreign file yields an
 *     empty state (no licence, no anchor) with a NEWLY minted device id — never
 *     a throw, so a corrupt file cannot brick the app or skip the check.
 */
export function readActivationState(): ActivationState {
  const path = activationStatePath()
  const fresh = (): ActivationState => ({ licence: null, anchor: null, deviceId: randomUUID() })
  if (!existsSync(path)) return fresh()

  let raw: unknown
  try {
    const text = readFileSync(path, 'utf-8')
    if (text.length > ACTIVATION_CAP_BYTES) return fresh()
    raw = JSON.parse(text)
  } catch {
    return fresh()
  }

  if (typeof raw !== 'object' || raw === null) return fresh()
  const envelope = raw as Record<string, unknown>
  if (envelope.kind !== ACTIVATION_KIND) return fresh()

  const deviceId = typeof envelope.deviceId === 'string' && envelope.deviceId ? envelope.deviceId : randomUUID()
  const licence = isPlausibleLicence(envelope.licence) ? (envelope.licence as Licence) : null
  const anchor = isPlausibleAnchor(envelope.anchor) ? (envelope.anchor as ClockAnchor) : null
  return { licence, anchor, deviceId }
}

/**
 * A shape check — enough to reject a hand-edited/foreign licence.
 *
 * The file is plain, UNSIGNED JSON in a directory the user owns (the Ed25519
 * signature is the production TODO), so every field is validated by TYPE and the
 * tier against the known set: a text editor changing ``tier`` to ``"gold"`` or
 * flipping ``isTrial`` to a string must read back as "no licence", never as a
 * trusted seat.
 */
function isPlausibleLicence(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const l = value as Record<string, unknown>
  return (
    typeof l.key === 'string' &&
    typeof l.tier === 'string' &&
    (LICENCE_TIERS as readonly string[]).includes(l.tier) &&
    typeof l.isTrial === 'boolean' &&
    typeof l.deviceId === 'string' &&
    typeof l.deviceLabel === 'string' &&
    isUsableInstant(l.issuedAtMs) &&
    isUsableInstant(l.expiresAtMs) &&
    isUsableInstant(l.graceWindowMs)
  )
}

/** Anchor shape check — last-seen must not predate first-seen. */
function isPlausibleAnchor(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const a = value as Record<string, unknown>
  return isUsableInstant(a.firstSeenMs) && isUsableInstant(a.lastSeenMs) && a.lastSeenMs >= a.firstSeenMs
}

/**
 * Write the state atomically.
 *
 * A write failure is swallowed by the caller path (see {@link recordActivationLaunch});
 * this function surfaces it so tests can assert on a real write.
 */
export function writeActivationState(state: ActivationState): void {
  const cfg = requireConfig()
  mkdirSync(cfg.userDataDir, { recursive: true })
  const envelope = {
    kind: ACTIVATION_KIND,
    format_version: ACTIVATION_FORMAT_VERSION,
    deviceId: state.deviceId,
    licence: state.licence,
    anchor: state.anchor,
  }
  writeFileAtomic(activationStatePath(), `${JSON.stringify(envelope, null, 2)}\n`)
}

/**
 * Record that the app is running now: advance the anchor and persist.
 *
 * Best-effort write — a read-only user-data directory must not stop the app —
 * and returns the in-memory state, which is the right input for this launch's
 * decision regardless of whether the write landed.
 *
 * Parameters
 * ----------
 * nowMs : number
 *     Current wall-clock time, epoch ms.
 *
 * Returns
 * -------
 * ActivationState
 *     The state as it stands after this launch (anchor advanced).
 */
export function recordActivationLaunch(nowMs: number): ActivationState {
  const current = readActivationState()
  const next: ActivationState = { ...current, anchor: advanceAnchor(current.anchor, nowMs) }
  try {
    writeActivationState(next)
  } catch {
    // Best effort — the decision for THIS launch is already made from `next`.
  }
  return next
}
