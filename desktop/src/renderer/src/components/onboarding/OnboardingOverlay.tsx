// First-launch onboarding overlay (prototype, debt #93).
//
// Owner ruling 24 (CLAUDE.local.md → "Rulings 2026-08-31"): onboarding is BOTH a
// worked sample project AND a skippable tour. This overlay is that flow:
//
//   welcome  →  choose (Load sample | Start from scratch)  →  skippable tour
//
// It layers over the WelcomeScreen and is gated by App on the persisted "seen"
// flag (utils/onboardingSeen.ts). It is also re-openable from Help → Getting
// started…, so it is intentionally stateless about WHY it opened — App decides.
//
// What is REAL vs MOCKED: the flow, the persistence gate and the tour copy are
// real; the "Load sample" DATA is a placeholder — see the onLoadSample prop and
// the design note (docs/design/onboarding-activation-updater-proto.md).

import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, Database, Download, FilePlus2, FolderOpen, Layers, Boxes, Ruler, Spline, Rocket } from 'lucide-react'

import Modal from '../ui/Modal'
import Button from '../ui/Button'
import { useT, type Translator } from '../../i18n/translate'

/** Which screen of the flow is showing. */
type Phase = 'welcome' | 'choose' | 'tour'

/** What the user chose on the "choose" screen; executed when the tour finishes. */
type StartIntent = 'sample' | 'scratch' | null

interface Props {
  open: boolean
  /** Dismiss the overlay. App marks onboarding seen here. */
  onClose: () => void
  /**
   * Execute the "Load sample project" intent. Stubbed in App (the sample
   * ``.strix`` is not bundled in the prototype) — see the design note.
   */
  onLoadSample: () => void
}

/** The six spine stages, one sentence each (from the i18n catalogue). */
function useSpineStages(t: Translator): ReadonlyArray<{ icon: JSX.Element; title: string; body: string }> {
  return useMemo(
    () => [
      { icon: <Database size={18} />, title: t('onboarding.stageImport'), body: t('onboarding.stageImportBody') },
      { icon: <Layers size={18} />, title: t('onboarding.stageGeology'), body: t('onboarding.stageGeologyBody') },
      { icon: <Boxes size={18} />, title: t('onboarding.stageLitho'), body: t('onboarding.stageLithoBody') },
      { icon: <Ruler size={18} />, title: t('onboarding.stageGeotech'), body: t('onboarding.stageGeotechBody') },
      { icon: <Spline size={18} />, title: t('onboarding.stageSections'), body: t('onboarding.stageSectionsBody') },
      { icon: <Download size={18} />, title: t('onboarding.stageExport'), body: t('onboarding.stageExportBody') },
    ],
    [t],
  )
}

/**
 * The first-launch onboarding overlay.
 *
 * Parameters
 * ----------
 * open
 *     Whether the overlay is shown; renders nothing when false.
 * onClose
 *     Dismiss handler (skip or finish). App marks the "seen" flag here.
 * onLoadSample
 *     Runs the sample-project intent when the tour finishes with it chosen.
 */
export default function OnboardingOverlay({ open, onClose, onLoadSample }: Props): JSX.Element {
  const t = useT()
  const stages = useSpineStages(t)

  const [phase, setPhase] = useState<Phase>('welcome')
  const [tourIndex, setTourIndex] = useState(0)
  const [intent, setIntent] = useState<StartIntent>(null)

  // Reset to the first screen each time the overlay opens, so a re-open from
  // Help never resumes mid-tour.
  useEffect(() => {
    if (open) {
      setPhase('welcome')
      setTourIndex(0)
      setIntent(null)
    }
  }, [open])

  function chooseAndTour(next: StartIntent): void {
    setIntent(next)
    setTourIndex(0)
    setPhase('tour')
  }

  function finish(): void {
    // The chosen intent runs on the way out. Sample is a stub in the prototype.
    if (intent === 'sample') onLoadSample()
    onClose()
  }

  function advanceTour(): void {
    if (tourIndex < stages.length - 1) setTourIndex(i => i + 1)
    else finish()
  }

  function retreatTour(): void {
    if (tourIndex > 0) setTourIndex(i => i - 1)
    else setPhase('choose')
  }

  return (
    <Modal
      open={open}
      onCancel={onClose}
      labelledBy="onboarding-title"
      cardClassName="w-[540px] max-w-[92vw]"
      testid="onboarding-overlay"
    >
      <div className="flex flex-col">
        {/* Header — a Skip affordance is always available (ruling 24: skippable). */}
        <div className="flex items-center justify-between px-6 pt-5 pb-1">
          <div className="flex items-center gap-2 text-accent">
            <Rocket size={18} />
            <span className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
              {t('app.name')}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            data-testid="onboarding-skip"
            className="text-xs text-text-muted hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded px-1"
          >
            {t('onboarding.skip')}
          </button>
        </div>

        <div className="px-6 pb-6 pt-2">
          {phase === 'welcome' && (
            <div data-testid="onboarding-welcome">
              <h2 id="onboarding-title" className="text-xl font-semibold text-text-primary mb-2">
                {t('onboarding.welcomeTitle')}
              </h2>
              <p className="text-sm text-text-secondary leading-relaxed mb-6">
                {t('onboarding.welcomeBody')}
              </p>
              <div className="flex justify-end">
                <Button
                  variant="primary"
                  size="md"
                  onClick={() => setPhase('choose')}
                  data-testid="onboarding-welcome-next"
                >
                  {t('onboarding.next')}
                  <ArrowRight size={15} />
                </Button>
              </div>
            </div>
          )}

          {phase === 'choose' && (
            <div data-testid="onboarding-choose">
              <h2 id="onboarding-title" className="text-lg font-semibold text-text-primary mb-4">
                {t('onboarding.chooseTitle')}
              </h2>
              <div className="flex flex-col gap-3">
                <button
                  type="button"
                  onClick={() => chooseAndTour('sample')}
                  data-testid="onboarding-choose-sample"
                  className="flex items-start gap-3 text-left p-4 rounded-lg border border-border-default hover:bg-surface-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <FolderOpen size={20} className="mt-0.5 text-accent shrink-0" />
                  <span>
                    <span className="block text-sm font-medium text-text-primary">
                      {t('onboarding.sampleTitle')}
                    </span>
                    <span className="block text-xs text-text-secondary mt-0.5">
                      {t('onboarding.sampleBody')}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => chooseAndTour('scratch')}
                  data-testid="onboarding-choose-scratch"
                  className="flex items-start gap-3 text-left p-4 rounded-lg border border-border-default hover:bg-surface-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <FilePlus2 size={20} className="mt-0.5 text-accent shrink-0" />
                  <span>
                    <span className="block text-sm font-medium text-text-primary">
                      {t('onboarding.scratchTitle')}
                    </span>
                    <span className="block text-xs text-text-secondary mt-0.5">
                      {t('onboarding.scratchBody')}
                    </span>
                  </span>
                </button>
              </div>
              <div className="flex justify-between mt-5">
                <Button variant="ghost" size="md" onClick={() => setPhase('welcome')}>
                  <ArrowLeft size={15} />
                  {t('onboarding.back')}
                </Button>
              </div>
            </div>
          )}

          {phase === 'tour' && (
            <div data-testid="onboarding-tour">
              <div className="text-[11px] font-medium uppercase tracking-wide text-text-muted mb-1">
                {t('onboarding.tourTitle')}
              </div>
              <p className="text-xs text-text-secondary mb-4">{t('onboarding.tourIntro')}</p>

              {/* One stage at a time, with a progress dot rail. */}
              <div className="flex items-start gap-3 p-4 rounded-lg bg-surface-card border border-border-subtle min-h-[104px]">
                <div className="mt-0.5 text-accent shrink-0">{stages[tourIndex].icon}</div>
                <div>
                  <h2 id="onboarding-title" className="text-base font-semibold text-text-primary">
                    {stages[tourIndex].title}
                  </h2>
                  <p className="text-sm text-text-secondary mt-1 leading-relaxed">
                    {stages[tourIndex].body}
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-center gap-1.5 mt-4" aria-hidden>
                {stages.map((s, i) => (
                  <span
                    key={s.title}
                    className={`h-1.5 rounded-full transition-all ${
                      i === tourIndex ? 'w-5 bg-accent' : 'w-1.5 bg-border-default'
                    }`}
                  />
                ))}
              </div>

              <div className="flex items-center justify-between mt-4">
                <Button variant="ghost" size="md" onClick={retreatTour} data-testid="onboarding-tour-back">
                  <ArrowLeft size={15} />
                  {t('onboarding.back')}
                </Button>
                <span className="text-[11px] text-text-muted">
                  {t('onboarding.stepCount', { current: tourIndex + 1, total: stages.length })}
                </span>
                <Button variant="primary" size="md" onClick={advanceTour} data-testid="onboarding-tour-next">
                  {tourIndex < stages.length - 1 ? t('onboarding.next') : t('onboarding.done')}
                  <ArrowRight size={15} />
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
