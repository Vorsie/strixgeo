/**
 * Consent to transmit diagnostics (Electron main process) — debt #16.
 *
 * Two things are deliberately separated:
 *
 * * **Capture** is local, always on, and needs no consent — it produces a log
 *   file in the user's own app directory (see ``diagnosticsStore.ts``).
 * * **Transmission** needs a recorded, deliberate yes. This module is where
 *   that answer lives.
 *
 * The default is NO, and every failure mode reads as NO: an unparseable file, a
 * file from another app, a flag that is a string rather than a boolean. A
 * consent record is the one place where "fail open" is never defensible.
 *
 * ``diagnosticsUploader.ts`` reads this flag (through {@link readTransmissionConsent})
 * before it queues or uploads anything, so a "no" — the default, and every
 * damaged-file case — keeps the machine silent. There is no Settings UI to flip
 * it yet, so in practice a user cannot opt in through the app today; that toggle
 * is the remaining piece before transmission is usable.
 */

import { existsSync, mkdirSync, readFileSync } from 'fs'
import { join } from 'path'

import { writeFileAtomic } from './atomicWrite'
import { diagnosticsDirPath } from './diagnosticsStore'

/** Name of the consent file inside the diagnostics directory. */
export const CONSENT_FILENAME = 'consent.json'

/** Envelope discriminator — a file without it is not ours. */
export const CONSENT_KIND = 'strixgeo.diagnostics-consent'

/** Envelope version. */
export const CONSENT_FORMAT_VERSION = 1

/** Read cap — the file holds one boolean and one timestamp. */
const CONSENT_CAP_BYTES = 4 * 1024

/** The recorded answer, plus when it was given. */
export interface ConsentRecord {
  /** True only when the user explicitly opted in. */
  transmissionOptIn: boolean
  /** When the answer was recorded, ISO-8601. */
  decidedAt: string
}

/**
 * Absolute path of the consent file.
 *
 * Returns
 * -------
 * string
 *     ``<userData>/diagnostics/consent.json``.
 */
export function consentFilePath(): string {
  return join(diagnosticsDirPath(), CONSENT_FILENAME)
}

/**
 * Read the recorded consent decision.
 *
 * Returns
 * -------
 * ConsentRecord | null
 *     The record, or ``null`` when the user has never been asked, or when the
 *     file is absent, oversized, unparseable or foreign.
 */
export function readConsentRecord(): ConsentRecord | null {
  let path: string
  try {
    path = consentFilePath()
  } catch {
    // Store not configured yet — treat as "never asked" rather than throwing
    // into whatever start-up path wanted to know.
    return null
  }
  if (!existsSync(path)) return null

  let raw: unknown
  try {
    const text = readFileSync(path, 'utf-8')
    if (text.length > CONSENT_CAP_BYTES) return null
    raw = JSON.parse(text)
  } catch {
    return null
  }

  if (typeof raw !== 'object' || raw === null) return null
  const envelope = raw as Record<string, unknown>
  if (envelope.kind !== CONSENT_KIND) return null
  // Strictly a boolean: a truthy string ("false" is truthy!) must never read as
  // a yes.
  if (typeof envelope.transmissionOptIn !== 'boolean') return null

  return {
    transmissionOptIn: envelope.transmissionOptIn,
    decidedAt: typeof envelope.decidedAt === 'string' ? envelope.decidedAt : '',
  }
}

/**
 * Whether the user has opted in to transmitting diagnostics.
 *
 * Returns
 * -------
 * boolean
 *     ``true`` only for an explicit, readable, recorded opt-in.
 */
export function readTransmissionConsent(): boolean {
  return readConsentRecord()?.transmissionOptIn === true
}

/**
 * Record the user's answer.
 *
 * Parameters
 * ----------
 * optIn : boolean
 *     The answer. ``false`` is recorded rather than deleted, so the settings
 *     surface can tell "declined" from "never asked".
 * nowIso : string, optional
 *     Timestamp override — tests pin it; production leaves it unset.
 */
export function setTransmissionConsent(optIn: boolean, nowIso?: string): void {
  mkdirSync(diagnosticsDirPath(), { recursive: true })
  const record = {
    kind: CONSENT_KIND,
    format_version: CONSENT_FORMAT_VERSION,
    transmissionOptIn: optIn,
    decidedAt: nowIso ?? new Date().toISOString(),
  }
  writeFileAtomic(consentFilePath(), `${JSON.stringify(record, null, 2)}\n`)
}
