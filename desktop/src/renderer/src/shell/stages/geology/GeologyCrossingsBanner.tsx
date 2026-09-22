// Geology inspector — surface-crossing validation banners.
//
// Extracted verbatim from the inline JSX of GeologyInspector.tsx (debt #201
// god-component decomposition round). Presentational only: the parent owns the
// crossings-validation hook (debt #18 stale-gating) and the issue-click
// navigation handler.
//
// Three mutually-exclusive-in-practice states, each byte-identical to the
// originals:
//   * pendingBuild — surfaces are stale, so the cached TIN was deliberately NOT
//     validated. Neutral info tone (no known problem, only an unbuilt model).
//   * validationFailed — the validator request errored (audit F10); silence
//     here would read as "no crossings" and the engineer would Build + export.
//   * crossingIssues — the amber warning list; each row is clickable when it
//     carries contact ids, navigating to the offending section.

import { AlertTriangle, Info } from 'lucide-react'

import type { GapIssueResponse } from '../../../api/client'
import type { Translator } from '../../../i18n/translate'

interface GeologyCrossingsBannerProps {
  /** Surfaces are stale → the validator was skipped (debt #18). */
  pendingBuild: boolean
  /** The validator request errored (audit F10). */
  validationFailed: boolean
  /** Detected cross-formation crossing issues (empty when the model is clean). */
  crossingIssues: readonly GapIssueResponse[]
  /** Navigate to the section that owns an issue's contacts. */
  onClickIssue: (issue: GapIssueResponse) => void
  /** The sentence to show for an issue; absent = the backend's English ``detail``. */
  describeIssue?: (issue: GapIssueResponse) => string
  t: Translator
}

/**
 * Renders the surface-crossing validation banners for the geology inspector.
 *
 * Parameters
 * ----------
 * pendingBuild
 *     True when surfaces are stale and validation was skipped.
 * validationFailed
 *     True when the validation request errored.
 * crossingIssues
 *     The detected crossing issues (each row is clickable when it has contacts).
 * onClickIssue
 *     Fired when the user clicks an issue row that carries contact ids.
 * t
 *     The active-language translator.
 *
 * Returns
 * -------
 * JSX.Element
 *     A fragment of the applicable banners (empty when none apply).
 */
export default function GeologyCrossingsBanner({
  pendingBuild,
  validationFailed,
  crossingIssues,
  onClickIssue,
  describeIssue,
  t,
}: GeologyCrossingsBannerProps): JSX.Element {
  return (
    <>
      {/* Validation-pending state (debt #18): surfaces are stale, so
          the cached TIN was deliberately NOT validated. Neutral info
          tone — NOT an amber alarm — because there is no known
          problem, only an unbuilt model. Clears automatically once
          Build refreshes the TINs (staleSurfaceCount → 0 re-runs the
          hook). */}
      {pendingBuild && (
        <div
          className="rounded border border-border-subtle bg-surface-app px-2 py-1.5 text-[11px] text-text-muted"
          role="status"
          aria-label={t('geology.surfaceValidationPending')}
          data-testid="crossings-pending-banner"
        >
          <div className="flex items-center gap-1.5">
            <Info size={12} />
            <span>{t('geology.crossingsNotChecked')}</span>
          </div>
        </div>
      )}

      {/* Validation FAILED (audit F10): the request errored, so the issue list is
          empty for the same reason a clean model's is. Silence here would read as
          "no crossings" and the engineer would Build + export on it. */}
      {validationFailed && (
        <div
          className="rounded border border-status-amber bg-amber-50 dark:bg-amber-950/30 px-2 py-1.5 text-[11px] text-text-primary"
          role="alert"
          aria-label={t('geology.surfaceValidationFailed')}
          data-testid="crossings-check-failed"
        >
          <div className="flex items-center gap-1.5">
            <AlertTriangle size={12} />
            <span>{t('geology.crossingsCheckFailed')}</span>
          </div>
        </div>
      )}

      {/* Surface crossings banner — amber warning, refetched on every contact
          mutation (crossingsRefreshCounter bumps). Only shown for a FRESH
          model: when surfaces are stale the hook suppresses the fetch and
          the pending banner above is shown instead (debt #18), so this is
          always a trustworthy result. Click an issue row to highlight the
          offending contacts on the section canvas. */}
      {crossingIssues.length > 0 && (
        <div
          className="rounded border border-status-amber bg-amber-50 dark:bg-amber-950/30 px-2 py-1.5 text-[11px] text-text-primary"
          role="alert"
          aria-label={t('geology.surfaceCrossingWarnings')}
          data-testid="crossings-banner"
        >
          <div className="flex items-center gap-1.5 font-medium">
            <AlertTriangle size={12} />
            <span>
              {t(
                crossingIssues.length === 1
                  ? 'geology.crossingsDetectedOne'
                  : 'geology.crossingsDetectedMany',
                { n: crossingIssues.length },
              )}
            </span>
          </div>
          <ul className="mt-1 ml-5 list-disc space-y-0.5">
            {crossingIssues.map((issue, idx) => {
              const hasContacts = issue.contact_ids.length > 0
              return (
                <li key={`${issue.formation_ids.join('-')}-${idx}`}>
                  {hasContacts ? (
                    <button
                      type="button"
                      className="w-full cursor-pointer rounded px-1 py-0.5 text-left hover:bg-amber-100 dark:hover:bg-amber-950/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-status-amber"
                      onClick={() => onClickIssue(issue)}
                      title={t('geology.openOffendingSection')}
                      data-testid="crossings-banner-item"
                    >
                      {describeIssue ? describeIssue(issue) : issue.detail}
                    </button>
                  ) : (
                    describeIssue ? describeIssue(issue) : issue.detail
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </>
  )
}
