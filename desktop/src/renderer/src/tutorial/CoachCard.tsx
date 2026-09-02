// The coach card — the tutorial's speech bubble (spec §"The tutorial, as the
// user sees it"). It sits beside the spotlighted control (or docked bottom-right
// when the control is off screen), names the chapter and step, explains what to
// do in a few sentences, and carries the navigation chrome.
//
// A do-it step (completes by observable state) shows NO Next button — a hint
// says the tutorial moves on by itself. An explain step carries Next / Finish.
// Back / Skip step / Skip tutorial are always available. When the chapter has a
// worked-example clip (A7), a "Watch the clip" button opens it in the browser.

import { CheckCircle2, ExternalLink } from 'lucide-react'

import { useT } from '../i18n/translate'
import type { MessageKey } from '../i18n/locales/en'
import type { CatalogueStep } from './tutorialCatalogue'
import type { ChapterProgress } from './tutorialMachine'
import type { PlacedCard } from './coachCardPlacement'

/** Fixed card footprint used both for layout and for the placement decision. */
export const CARD_WIDTH = 340
export const CARD_HEIGHT = 240

/** Props for the coach card. */
export interface CoachCardProps {
  /** The step being shown. */
  step: CatalogueStep
  /** i18n key of the step's chapter title. */
  chapterTitleKey: string
  /** The chapter/step position for the progress strip. */
  progress: ChapterProgress
  /** The chapter's worked-example clip URL, if the owner has set one (A7). */
  videoUrl?: string
  /** Open a URL in the system browser (reuses the app's external-link path). */
  onOpenExternal?: (url: string) => void
  /** Where the card sits. */
  placement: PlacedCard
  /** True when the step completes by a Next click (explain), false for do-it. */
  isExplain: boolean
  /** True when this is the final step (Next reads "Finish"). */
  isLast: boolean
  /** True when the target control is off screen (card is docked). */
  offscreen: boolean
  /** True when the fallback is highlighting the owning stage tab (so the hint
   *  reads "open the tab" instead of a generic off-screen note). */
  hasTab?: boolean
  /** Whether a Back step exists. */
  canBack: boolean
  /** Go to the previous step. */
  onBack: () => void
  /** Complete this explain step (Next / Finish). */
  onNext: () => void
  /** Skip this step without completing it. */
  onSkipStep: () => void
  /** End the tutorial. */
  onSkipTutorial: () => void
}

/**
 * The coach card.
 *
 * @param props  See {@link CoachCardProps}.
 * @returns  The positioned card.
 */
export default function CoachCard(props: CoachCardProps): JSX.Element {
  const t = useT()
  const { step, progress, placement } = props

  return (
    <div
      data-testid="tutorial-coach-card"
      role="dialog"
      aria-label={t(step.titleKey as MessageKey)}
      className="fixed z-[10000] rounded-xl border border-border-default bg-surface-card shadow-2xl pointer-events-auto flex flex-col"
      style={{ left: placement.left, top: placement.top, width: CARD_WIDTH }}
    >
      <div className="px-4 pt-3 pb-3">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-accent mb-1">
          {t(props.chapterTitleKey as MessageKey)}
        </div>
        <h2 className="text-sm font-semibold text-text-primary mb-1">
          {t(step.titleKey as MessageKey)}
        </h2>
        <p className="text-xs text-text-secondary leading-relaxed">{t(step.bodyKey as MessageKey)}</p>

        {props.offscreen && (
          <p className="mt-2 text-[11px] text-text-muted">
            {props.hasTab ? t('tutorial.ui.openTab') : t('tutorial.ui.offscreen')}
          </p>
        )}

        {!props.isExplain && !props.offscreen && (
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-accent">
            <CheckCircle2 size={13} className="shrink-0" />
            {t('tutorial.ui.doItHint')}
          </p>
        )}

        {props.videoUrl && (
          <button
            type="button"
            data-testid="tutorial-watch-clip"
            onClick={() => props.onOpenExternal?.(props.videoUrl as string)}
            className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded px-0.5"
          >
            <ExternalLink size={13} />
            {t('tutorial.ui.watchClip')}
          </button>
        )}
      </div>

      {/* Progress strip. */}
      <div className="px-4 py-1.5 border-t border-border-subtle text-[10px] text-text-muted tabular-nums">
        {t('tutorial.ui.progress', {
          chapter: progress.chapterIndex,
          chapterCount: progress.chapterCount,
          step: progress.stepIndex,
          stepCount: progress.stepCount,
        })}
      </div>

      {/* Navigation. */}
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-t border-border-subtle">
        <div className="flex items-center gap-1">
          <button
            type="button"
            data-testid="tutorial-back"
            onClick={props.onBack}
            disabled={!props.canBack}
            className="text-[11px] text-text-muted hover:text-text-primary disabled:opacity-40 disabled:hover:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded px-1.5 py-1"
          >
            {t('tutorial.ui.back')}
          </button>
          <button
            type="button"
            data-testid="tutorial-skip-tutorial"
            onClick={props.onSkipTutorial}
            className="text-[11px] text-text-muted hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded px-1.5 py-1"
          >
            {t('tutorial.ui.skipTutorial')}
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          {!props.isExplain && (
            <button
              type="button"
              data-testid="tutorial-skip-step"
              onClick={props.onSkipStep}
              className="text-[11px] text-text-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded px-2 py-1"
            >
              {t('tutorial.ui.skipStep')}
            </button>
          )}
          {props.isExplain && (
            <button
              type="button"
              data-testid="tutorial-next"
              onClick={props.onNext}
              className="text-xs font-medium text-text-on-accent bg-accent hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded px-3 py-1"
            >
              {props.isLast ? t('tutorial.ui.finish') : t('tutorial.ui.next')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
