// Geology inspector — always-on pick consistency banner (uncertainty slice A0).
//
// Presentational only: the inspector owns useContactConsistency and the
// open-a-section navigation. Styling matches GeologyCrossingsBanner (amber
// for a known problem, neutral for "still checking" and for formations the
// engine could not check). A clean model renders nothing: silence is the
// success state, as for the crossings banner. A formation with too few picks
// or a failed fit is therefore always named, so it never reads as clean.

import { AlertTriangle, Info } from 'lucide-react'

import type { FormationPickCheckResponse } from '../../../api/client'
import type { PickCheckStatus } from '../../../hooks/useContactConsistency'
import type { Translator } from '../../../i18n/translate'

interface PickCheckBannerProps {
  status: PickCheckStatus
  formations: readonly FormationPickCheckResponse[]
  /** Open a cross-section through these contacts (flagged pick + its nearest). */
  onShow: (contactIds: readonly string[]) => void
  t: Translator
}

const AMBER =
  'rounded border border-status-amber bg-amber-50 dark:bg-amber-950/30 px-2 py-1.5 text-[11px] text-text-primary'
const NEUTRAL = 'rounded border border-border-subtle bg-surface-app px-2 py-1.5 text-[11px] text-text-muted'

/**
 * Fewest picks a formation needs before it is checked. Mirrors the backend
 * ``MIN_PICKS`` (``domain/services/geostat/geostat_constants.py``); below it the
 * engine answers ``too_few_picks``. Keep the two in step.
 */
export const PICK_CHECK_MIN_PICKS = 6

/** One neutral line per formation the engine did not (fully) check. */
function neutralLines(formations: readonly FormationPickCheckResponse[], t: Translator): { id: string; text: string }[] {
  const lines: { id: string; text: string }[] = []
  for (const f of formations) {
    if (f.status === 'too_few_picks') {
      lines.push({
        id: f.formation_id,
        text: t('geology.pickCheck.tooFewPicks', { formation: f.formation_name, n: f.n_picks, min: PICK_CHECK_MIN_PICKS }),
      })
    } else if (f.status === 'fit_failed') {
      // The reason is the backend's raw English diagnostic, shown as is on
      // purpose: it is for the engineer to report, not translated prose.
      lines.push({
        id: f.formation_id,
        text: t('geology.pickCheck.fitFailed', { formation: f.formation_name, reason: f.reason ?? '' }),
      })
    } else if (f.flags.length === 0 && f.refit_fallbacks > 0) {
      // A flagged formation names its fallbacks in the amber block instead.
      lines.push({
        id: f.formation_id,
        text: t('geology.pickCheck.refitFallbacksNamed', { formation: f.formation_name, n: f.refit_fallbacks }),
      })
    }
  }
  return lines
}

/**
 * Render the pick consistency banner.
 *
 * Parameters
 * ----------
 * status
 *     Hook status: idle, computing, ready or failed.
 * formations
 *     Per-formation results from the engine.
 * onShow
 *     Fired with the flagged pick's and its nearest test's contact ids.
 * t
 *     The active-language translator.
 *
 * Returns
 * -------
 * JSX.Element
 *     The banner, or an empty fragment for a clean model.
 */
export default function PickCheckBanner({ status, formations, onShow, t }: PickCheckBannerProps): JSX.Element {
  const flagged = formations.filter(f => f.flags.length > 0)
  const count = flagged.reduce((n, f) => n + f.flags.length, 0)
  const notes = neutralLines(formations, t)
  const notesBlock =
    notes.length > 0 ? (
      <div className={NEUTRAL} role="status" data-testid="pick-check-unchecked">
        {notes.map(n => (
          <div key={n.id} className="flex items-center gap-1.5">
            <Info size={12} />
            <span>{n.text}</span>
          </div>
        ))}
      </div>
    ) : null

  if (status === 'failed') {
    return (
      <div className={AMBER} role="alert" data-testid="pick-check-failed">
        <div className="flex items-center gap-1.5">
          <AlertTriangle size={12} />
          <span>{t('geology.pickCheck.failed')}</span>
        </div>
      </div>
    )
  }
  if (status === 'computing' && count === 0) {
    return (
      <div className="space-y-1">
        <div className={NEUTRAL} role="status" data-testid="pick-check-computing">
          <div className="flex items-center gap-1.5">
            <Info size={12} />
            <span>{t('geology.pickCheck.computing')}</span>
          </div>
        </div>
        {notesBlock}
      </div>
    )
  }
  if (count === 0) return notesBlock ?? <></>

  return (
    <div className="space-y-1">
      <div className={AMBER} role="alert" data-testid="pick-check-banner">
        <div className="flex items-center gap-1.5 font-medium">
          <AlertTriangle size={12} />
          <span>{count === 1 ? t('geology.pickCheck.titleOne') : t('geology.pickCheck.titleMany', { n: count })}</span>
        </div>
        {flagged.map(f => (
          <div key={f.formation_id} className="mt-1" data-testid={`pick-check-formation-${f.formation_id}`}>
            <div className="font-medium">{f.formation_name}</div>
            <ul className="ml-5 list-disc space-y-0.5">
              {f.flags.map(flag => (
                <li key={flag.contact_id}>
                  <div>
                    {t('geology.pickCheck.row', {
                      test: flag.investigation_name,
                      pick: flag.pick_elevation_m.toFixed(2),
                      expected: flag.predicted_elevation_m.toFixed(2),
                      sigma: flag.sigma_m.toFixed(2),
                      times: Math.abs(flag.z).toFixed(1),
                    })}
                  </div>
                  <div className="text-text-muted">
                    {t('geology.pickCheck.nearest', {
                      test: flag.nearest.investigation_name,
                      distance: flag.nearest.distance_m.toFixed(1),
                      pick: flag.nearest.pick_elevation_m.toFixed(2),
                    })}
                  </div>
                  <button
                    type="button"
                    className="mt-0.5 rounded px-1 py-0.5 underline hover:bg-amber-100 dark:hover:bg-amber-950/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-status-amber"
                    onClick={() => onShow([flag.contact_id, flag.nearest.contact_id])}
                    data-testid={`pick-check-show-${flag.contact_id}`}
                  >
                    {t('geology.pickCheck.show')}
                  </button>
                </li>
              ))}
            </ul>
            {f.fit !== null && f.coverage_90 !== null && (
              <div className="mt-0.5 text-text-muted">
                {t('geology.pickCheck.fitLine', {
                  range: Math.round(f.fit.range_m),
                  nugget: f.fit.nugget_sd_m.toFixed(2),
                  coverage: Math.round(f.coverage_90 * 100),
                })}
              </div>
            )}
            {f.refit_fallbacks > 0 && (
              <div className="mt-0.5 text-text-muted">
                {t('geology.pickCheck.refitFallbacks', { n: f.refit_fallbacks })}
              </div>
            )}
          </div>
        ))}
      </div>
      {notesBlock}
    </div>
  )
}
