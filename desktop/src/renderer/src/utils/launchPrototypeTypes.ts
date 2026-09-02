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
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'disabled'

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
}
