/**
 * Renderer-side DTO shapes for the launch prototypes (activation #3, updater #6).
 *
 * These MIRROR the main-process types (``src/main/activation.ts``,
 * ``src/main/activationService.ts``, ``src/main/updaterService.ts``) but are
 * declared here on purpose: the renderer cannot import from the main process, so
 * the IPC contract is duplicated at the boundary — the same pattern the preload
 * uses for ``RecentProject`` / ``RecoveryDescriptor``. When a main-process shape
 * changes, this file changes in lockstep.
 */

/** Activation states — mirrors ``LicenceState`` in src/main/activation.ts. */
export type LicenceStateDto =
  | 'unactivated'
  | 'trial'
  | 'active'
  | 'grace'
  | 'expired'
  | 'clock-rollback'
  | 'device-mismatch'

/** Commercial tiers — mirrors ``LicenceTier``. */
export type LicenceTierDto = 'solo' | 'pro' | 'studio'

/** The evaluated verdict — mirrors ``ActivationVerdict``. */
export interface ActivationVerdictDto {
  state: LicenceStateDto
  blocked: boolean
  tier: LicenceTierDto | null
  isTrial: boolean
  daysRemaining: number | null
  graceDaysRemaining: number | null
  expiresAtMs: number | null
  graceEndsAtMs: number | null
  reason: string
}

/** The status DTO the licensing screen renders — mirrors ``ActivationStatus``. */
export interface ActivationStatusDto {
  verdict: ActivationVerdictDto
  deviceLabel: string
  keyMasked: string | null
  isTrial: boolean
}

/** Why an activate/trial action failed — mirrors ``IssueFailureCode``. */
export type IssueFailureCodeDto = 'unknown_key' | 'device_limit' | 'already_trialled' | 'unreachable'

/** Result of an activate / trial / deactivate call — mirrors ``ActivationActionResult``. */
export type ActivationActionResultDto =
  | { ok: true; status: ActivationStatusDto }
  | { ok: false; code: IssueFailureCodeDto; message: string }

/** Updater lifecycle phases — mirrors ``UpdaterPhase`` in src/main/updaterService.ts. */
export type UpdaterPhaseDto =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  // The feed has nothing published yet (the closed beta's normal state) — calm,
  // not a failure. See the updater error handler (finding (g)).
  | 'no-release'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'disabled'

/** Why an updater check FAILED — mirrors ``UpdaterErrorReason`` in updaterPolicy.ts. */
export type UpdaterErrorReasonDto = 'offline' | 'blocked' | 'unexpected'

/** A renderer-safe update summary — mirrors ``UpdateAvailableNotice``. */
export interface UpdateNoticeDto {
  version: string
  releaseName: string | null
  releaseNotes: string | null
}

/** One updater state change pushed from main — mirrors ``UpdaterEvent``. */
export interface UpdaterEventDto {
  phase: UpdaterPhaseDto
  notice?: UpdateNoticeDto
  progressPercent?: number
  message?: string
  /** Present on ``error`` — which cause the renderer names (offline / blocked / unexpected). */
  errorReason?: UpdaterErrorReasonDto
}

/**
 * Build facts for Help → Licence + About — mirrors ``BuildDisplayInfo`` in
 * src/main/buildStamp.ts. Every field is ``null`` in a dev build.
 */
export interface BuildInfoDto {
  /** Short git SHA (8 hex chars), or ``null`` in a dev build. */
  sha: string | null
  /** Full git SHA, or ``null``. */
  shaFull: string | null
  /** Beta build identifier, or ``null``. */
  buildId: string | null
  /** Beta expiry instant, epoch ms; ``null`` when the build carries no stamp. */
  expiresAtMs: number | null
  /** Build timestamp, ISO-8601; ``null`` when unstamped. */
  builtAt: string | null
}
