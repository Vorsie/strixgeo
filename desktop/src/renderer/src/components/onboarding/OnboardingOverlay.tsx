// First-launch onboarding overlay (debt #93).
//
// Owner ruling 24 (CLAUDE.local.md → "Rulings 2026-08-31"): onboarding is BOTH a
// worked sample project AND a skippable tour. This overlay is the front door:
//
//   welcome  →  choose (Load sample | Start from scratch)  →  start the tutorial?
//
// The old six-slide "tour" that only NAMED the stages is gone (spec
// 2026-09-02-guided-tutorial-design.md): the last screen now offers the
// hands-on guided tutorial, which highlights each control on the user's own
// project. It layers over the WelcomeScreen, is gated by App on the persisted
// "seen" flag (utils/onboardingSeen.ts), and is re-openable from Help.
//
// What is REAL vs MOCKED: the flow, the persistence gate and the copy are real;
// the "Load sample" DATA is a placeholder; see the onLoadSample prop and
// onboarding (#93) in docs/debt.md.

import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, FilePlus2, FolderOpen, PlayCircle, Rocket } from 'lucide-react'

import Modal from '../ui/Modal'
import Button from '../ui/Button'
import { useT } from '../../i18n/translate'

/** Which screen of the flow is showing. */
type Phase = 'welcome' | 'choose' | 'start'

/** What the user chose on the "choose" screen; executed when the flow finishes. */
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
  /** Activate the guided tutorial (App owns the tutorial-active flag). */
  onStartTutorial: () => void
  /**
   * Whether a worked example is bundled with this build. The sample card is
   * offered only then (owner 2026-09-04: with no file behind it the card led
   * straight into the tutorial on an empty project). Default false: never
   * offer what cannot be loaded.
   */
  sampleAvailable?: boolean
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
 *     Runs the sample-project intent when the flow finishes with it chosen.
 * onStartTutorial
 *     Activates the guided tutorial when the user chooses to start it.
 */
export default function OnboardingOverlay({
  open,
  onClose,
  onLoadSample,
  onStartTutorial,
  sampleAvailable = false,
}: Props): JSX.Element {
  const t = useT()

  const [phase, setPhase] = useState<Phase>('welcome')
  const [intent, setIntent] = useState<StartIntent>(null)

  // Reset to the first screen each time the overlay opens, so a re-open from
  // Help never resumes mid-flow.
  useEffect(() => {
    if (open) {
      setPhase('welcome')
      setIntent(null)
    }
  }, [open])

  function chooseAndStart(next: StartIntent): void {
    setIntent(next)
    setPhase('start')
  }

  /** Run the chosen intent and close. Sample is a stub in the prototype. */
  function finish(): void {
    if (intent === 'sample') onLoadSample()
    onClose()
  }

  /** Close onboarding, then hand off to the guided tutorial. */
  function startTutorial(): void {
    finish()
    onStartTutorial()
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
                {sampleAvailable && (
                <button
                  type="button"
                  onClick={() => chooseAndStart('sample')}
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
                )}
                <button
                  type="button"
                  onClick={() => chooseAndStart('scratch')}
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

          {phase === 'start' && (
            <div data-testid="onboarding-start">
              <div className="flex items-start gap-3 p-4 rounded-lg bg-surface-card border border-border-subtle mb-5">
                <PlayCircle size={22} className="mt-0.5 text-accent shrink-0" />
                <div>
                  <h2 id="onboarding-title" className="text-base font-semibold text-text-primary">
                    {t('onboarding.startTitle')}
                  </h2>
                  <p className="text-sm text-text-secondary mt-1 leading-relaxed">
                    {t('onboarding.startBody')}
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <Button variant="ghost" size="md" onClick={() => setPhase('choose')} data-testid="onboarding-start-back">
                  <ArrowLeft size={15} />
                  {t('onboarding.back')}
                </Button>
                <div className="flex items-center gap-2">
                  <Button variant="secondary" size="md" onClick={finish} data-testid="onboarding-start-skip">
                    {t('onboarding.startLater')}
                  </Button>
                  <Button variant="primary" size="md" onClick={startTutorial} data-testid="onboarding-start-tutorial">
                    {t('onboarding.startTutorial')}
                    <ArrowRight size={15} />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
