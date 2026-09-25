/**
 * The consequence sheet shown before a hand split or merge of packing sub-bands is
 * committed.
 *
 * Owner ruling 6 (docs/debt.md #227, 2026-08-01): *"if the qc is lower or higher then it
 * gets a warning that it will pull down or up the avg qc of the layer it is in"*. Owner
 * ruling 5: *"the user needs to be able to manually overrule everything"*. Together those
 * fix the shape of this dialog — it TELLS, it never VETOES. The action button is enabled
 * whatever the warnings say.
 *
 * It is deliberately not styled as an irreversible confirmation (``docs/ux.md``): no
 * destructive colour, focus lands on the action rather than on Cancel, and the action is
 * named after the verb ("Split band" / "Merge bands"). A split can be merged back and a
 * merge re-split, so treating it like a delete would read as a bigger commitment than it is.
 *
 * The numbers and every warning sentence are authored server-side, so the statistic and its
 * wording exist in one place. The dialog renders what it was handed and manufactures
 * nothing — including the phrase "representative qc", which is the MODEL'S chosen statistic
 * (ruling 7; median by default, and the sheet names any other choice). The owner asked for
 * "avg qc", but the classifier reads the model's ``representative_statistic``, so a
 * consequence computed with any other statistic would predict a reclassification that
 * never happens.
 */
import { geotechStatisticLabel } from '../../utils/geotechStatistic'
import { useEffect, useRef } from 'react'

import type { GeotechBandEditPlanResponse } from '../../api/client'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import { useT, type Translator } from '../../i18n/translate'

/** Props for the split / merge consequence sheet. */
export interface Props {
  /** Open when a plan is being previewed. */
  open: boolean
  /** What the edit would do, straight from the preview endpoint. */
  plan: GeotechBandEditPlanResponse
  /** Commit the edit. Fires even with warnings on screen — that is the point. */
  onConfirm: () => Promise<void> | void
  /** Dismiss without committing (Cancel / Esc / backdrop). */
  onCancel: () => void
  /** While true the action is disabled and the dialog cannot be dismissed. */
  busy?: boolean
}

/** Format a depth range the way the section readouts do. */
function depthRange(topM: number, baseM: number): string {
  return `${topM.toFixed(2)}–${baseM.toFixed(2)} m`
}

/** Render a NAD class for display, naming the null case rather than showing a blank. */
function classLabel(nadClass: number | null, t: Translator): string {
  return nadClass === null
    ? t('sections.bandDialog.needsReview')
    : t('sections.bandDialog.classLabel', { n: nadClass })
}

/**
 * Show what a proposed packing split or merge would do, then let it through.
 *
 * Parameters
 * ----------
 * props : Props
 *     The plan to render plus the commit / dismiss handlers.
 *
 * Returns
 * -------
 * JSX.Element
 *     The modal.
 */
export default function GeotechBandEditDialog({
  open,
  plan,
  onConfirm,
  onCancel,
  busy = false,
}: Props): JSX.Element {
  const t = useT()
  const confirmRef = useRef<HTMLButtonElement>(null)
  const isMerge = plan.kind === 'merge'
  const isMove = plan.kind === 'move'
  const isAbsorb = plan.kind === 'absorb'
  const verb = isAbsorb
    ? t('sections.bandDialog.verbAbsorb')
    : isMove
      ? t('sections.bandDialog.verbMove')
      : isMerge
        ? t('sections.bandDialog.verbMerge')
        : t('sections.bandDialog.verbSplit')
  // Ruling 6 under ruling 7: once the model's statistic is not the default,
  // the sheet names it — a number labelled bare "representative qc" would
  // read as the median it no longer is.
  const statisticLabel =
    plan.statistic !== undefined && plan.statistic !== 'median'
      ? ` (${geotechStatisticLabel(plan.statistic)})`
      : ''

  // Focus the ACTION, not Cancel. docs/ux.md puts default-focus on Cancel for irreversible
  // actions; this is not one (a split can be merged back), and defaulting to Cancel here
  // would read as a warning about danger rather than a statement of consequence.
  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => confirmRef.current?.focus(), 0)
    return () => clearTimeout(timer)
  }, [open])

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      labelledBy="geotech-band-edit-title"
      busy={busy}
      testid="geotech-band-edit-dialog"
      cardClassName="w-[30rem]"
    >
      <div className="p-6">
        <h2
          id="geotech-band-edit-title"
          className="text-base font-semibold text-text-primary mb-1"
        >
          {isAbsorb
            ? t('sections.bandDialog.absorbTitle')
            : isMove
              ? t('sections.bandDialog.moveTitle')
              : isMerge
                ? t('sections.bandDialog.mergeTitle')
                : t('sections.bandDialog.splitTitle')}
        </h2>
        <p className="text-xs text-text-secondary mb-4">
          {t('sections.bandDialog.rederiveBlurb', {
            range: depthRange(plan.parent_top_m, plan.parent_base_m),
          })}
        </p>

        <ul className="mb-4 space-y-1.5">
          {plan.intervals.map((interval, i) => (
            <li
              key={`${interval.depth_top_m}-${interval.depth_base_m}`}
              data-testid={`geotech-band-edit-interval-${i}`}
              className="text-xs text-text-primary border border-border-default rounded px-3 py-2 bg-surface-page"
            >
              <div className="flex justify-between gap-3">
                <span className="font-medium">
                  {depthRange(interval.depth_top_m, interval.depth_base_m)}
                </span>
                <span>
                  {interval.class_changed ? (
                    <>
                      {classLabel(interval.previous_nad_class, t)}
                      {' → '}
                      <span className="font-semibold">{classLabel(interval.nad_class, t)}</span>
                    </>
                  ) : (
                    <>
                      {classLabel(interval.nad_class, t)} {t('sections.bandDialog.unchanged')}
                    </>
                  )}
                </span>
              </div>
              {interval.median_qc_mpa !== null && (
                <div className="text-text-secondary mt-0.5">
                  {t('sections.bandDialog.representativeQc', {
                    statistic: statisticLabel,
                    value: interval.median_qc_mpa.toFixed(1),
                  })}
                </div>
              )}
              {interval.unclassifiable_reason !== null && (
                <div className="text-text-secondary mt-0.5">
                  {interval.unclassifiable_reason}
                </div>
              )}
            </li>
          ))}
        </ul>

        {plan.warnings.length > 0 ? (
          <ul className="mb-4 space-y-1.5">
            {plan.warnings.map((warning, i) => (
              <li
                key={`${warning.code}-${warning.depth_top_m}-${warning.depth_base_m}`}
                data-testid={`geotech-band-edit-warning-${i}`}
                className="text-xs text-amber-700 dark:text-amber-400 border border-amber-500/40 rounded px-3 py-2 bg-amber-500/5"
              >
                {warning.message}
              </li>
            ))}
          </ul>
        ) : (
          <p
            data-testid="geotech-band-edit-no-consequence"
            className="text-xs text-text-secondary mb-4"
          >
            {t('sections.bandDialog.sameClass')}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="md" onClick={onCancel} disabled={busy}>
            {t('common.cancel')}
          </Button>
          {/* Never disabled on warnings. Ruling 5: the owner can place a boundary the qc
              does not support, having been told what it costs. */}
          <Button
            ref={confirmRef}
            variant="primary"
            size="md"
            onClick={() => void onConfirm()}
            disabled={busy}
            data-testid="geotech-band-edit-confirm"
          >
            {verb}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
