/**
 * The single place that decides WHICH activation issuer the app uses (Electron
 * main process). Debt #3.
 *
 * The client can talk to either the in-memory {@link MockActivationRepository}
 * (no network, the prototype's behaviour) or the real
 * {@link HttpActivationRepository} (the strixgeo.com service). This module is the
 * one config point that chooses, from a base URL:
 *
 * * **dev** (unpackaged) — the ``STRIXGEO_ACTIVATION_URL`` env var, so a
 *   developer can point the app at the local stub server (see the contract doc's
 *   run section). Unset → the mock.
 * * **packaged** — the {@link PACKAGED_ACTIVATION_URL} constant, set once when
 *   the real server lands. Until then it is ``null`` → the mock.
 *
 * ``null`` from either path means "use the mock", which is exactly the current
 * behaviour — so nothing changes for the owner's daily dogfeed until a URL is
 * deliberately provided.
 *
 * The MySQL-vs-SQLite engine the owner deferred lives entirely behind the URL;
 * this module only knows "a base URL, or not".
 */

import type { ActivationRepository } from './activationRepository'
import { HttpActivationRepository } from './httpActivationRepository'
import { MockActivationRepository } from './mockActivationRepository'

/** Env var naming the activation base URL in a dev build. */
export const ACTIVATION_URL_ENV = 'STRIXGEO_ACTIVATION_URL'

/**
 * The packaged-build activation base URL.
 *
 * ``null`` today: no production server exists, so a packaged build falls back to
 * the mock. Set this to the live URL (e.g. ``https://strixgeo.com/api/activation``)
 * in the same change that ships the server — it is the ONLY edit a packaged
 * build needs to go live.
 */
export const PACKAGED_ACTIVATION_URL: string | null = null

/** The two facts the URL choice depends on. */
export interface ActivationConfigInputs {
  /** ``process.env`` (or a subset), read for {@link ACTIVATION_URL_ENV}. */
  env: Partial<Record<string, string | undefined>>
  /** ``app.isPackaged`` — a packaged build ignores the dev env var. */
  packaged: boolean
}

/**
 * Trim a URL and strip trailing slashes; empty becomes ``null``.
 *
 * Parameters
 * ----------
 * url : string | null | undefined
 *     A candidate base URL.
 *
 * Returns
 * -------
 * string | null
 *     The normalised URL, or ``null`` when there is nothing usable.
 */
function normalizeBaseUrl(url: string | null | undefined): string | null {
  if (!url) return null
  const trimmed = url.trim().replace(/\/+$/, '')
  return trimmed || null
}

/**
 * The activation base URL for this build, or ``null`` to use the mock.
 *
 * Parameters
 * ----------
 * inputs : ActivationConfigInputs
 *     The env map and packaged flag.
 *
 * Returns
 * -------
 * string | null
 *     A normalised base URL, or ``null`` (→ mock) when none is configured.
 */
export function activationBaseUrl({ env, packaged }: ActivationConfigInputs): string | null {
  if (packaged) return normalizeBaseUrl(PACKAGED_ACTIVATION_URL)
  return normalizeBaseUrl(env[ACTIVATION_URL_ENV])
}

/** {@link ActivationConfigInputs} plus the app version the HTTP issuer sends. */
export interface ActivationRepositoryInputs extends ActivationConfigInputs {
  /** ``app.getVersion()`` — sent on activate/trial; optional. */
  appVersion?: string
}

/**
 * Build the activation issuer this build should use.
 *
 * Parameters
 * ----------
 * inputs : ActivationRepositoryInputs
 *     Env, packaged flag and app version.
 *
 * Returns
 * -------
 * ActivationRepository
 *     An {@link HttpActivationRepository} when a base URL is configured, the
 *     in-memory {@link MockActivationRepository} otherwise.
 */
export function createActivationRepository(inputs: ActivationRepositoryInputs): ActivationRepository {
  const baseUrl = activationBaseUrl(inputs)
  if (!baseUrl) return new MockActivationRepository()
  return new HttpActivationRepository({ baseUrl, appVersion: inputs.appVersion })
}
