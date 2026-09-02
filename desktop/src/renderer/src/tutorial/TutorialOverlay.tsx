// The tutorial overlay — the spotlight + coach card (spec §Architecture).
//
// Mounted once by App (inside a ShellContext.Provider so it can read the shell
// bus). It owns the progress state, advances it on observable state, and renders
// nothing while inactive. The dim layer is `pointer-events: none` so the user can
// still click anything — a tutorial that fights the app is worse than none (A2).
//
// The spotlight targets the current step's control. When that control is off
// screen (another stage open, a closed menu), it falls back to highlighting the
// owning stage tab (if that tab is not already active); failing that, the card
// docks bottom-right and explains where to look.

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import { useTutorialState } from './useTutorialState'
import { useAnchorRect } from './useAnchorRect'
import { chapterMeta, TUTORIAL_STEPS } from './tutorialCatalogue'
import {
  advance,
  back,
  chapterProgress,
  completeStep,
  currentStep,
  initialProgress,
  isFinished,
  skipStep,
  type TutorialProgress,
} from './tutorialMachine'
import { loadTutorialProgress, saveTutorialProgress } from './tutorialProgress'
import { placeCoachCard, type AnchorRect } from './coachCardPlacement'
import CoachCard, { CARD_HEIGHT, CARD_WIDTH } from './CoachCard'
import type { MessageKey } from '../i18n/locales/en'

/** Props for the overlay. */
export interface TutorialOverlayProps {
  /** Whether the tutorial is running. */
  active: boolean
  /** Called when the user skips the tutorial or reaches the end. */
  onExit: () => void
}

/**
 * Open a URL in the system browser via the app's existing external-link path:
 * `window.open` is denied a real window by the main process's
 * `setWindowOpenHandler`, which hands a trusted URL to `shell.openExternal`
 * instead (no new IPC — offline-first, videos are never bundled).
 *
 * @param url  The URL to open.
 */
function openExternalUrl(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer')
}

/** The dim + spotlight cut-out. Pointer-events none so clicks pass through. */
function Spotlight({ rect }: { rect: AnchorRect | null }): JSX.Element {
  const pad = 6
  const cut =
    rect === null
      ? null
      : { x: rect.left - pad, y: rect.top - pad, w: rect.width + pad * 2, h: rect.height + pad * 2 }
  return (
    <svg className="fixed inset-0 h-full w-full" width="100%" height="100%" aria-hidden>
      <defs>
        <mask id="tutorial-spotlight-mask">
          <rect x="0" y="0" width="100%" height="100%" fill="white" />
          {cut && <rect x={cut.x} y={cut.y} width={cut.w} height={cut.h} rx={8} fill="black" />}
        </mask>
      </defs>
      <rect
        x="0"
        y="0"
        width="100%"
        height="100%"
        fill="rgba(15, 23, 42, 0.5)"
        mask="url(#tutorial-spotlight-mask)"
      />
      {cut && (
        <rect
          x={cut.x}
          y={cut.y}
          width={cut.w}
          height={cut.h}
          rx={8}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth={2}
        />
      )}
    </svg>
  )
}

/**
 * The guided-tutorial overlay.
 *
 * @param props  See {@link TutorialOverlayProps}.
 * @returns  The portalled overlay, or `null` while inactive.
 */
export default function TutorialOverlay({ active, onExit }: TutorialOverlayProps): JSX.Element | null {
  const state = useTutorialState()
  const [progress, setProgress] = useState<TutorialProgress>(
    () => loadTutorialProgress() ?? initialProgress(TUTORIAL_STEPS),
  )
  const [viewport, setViewport] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }))

  // (Re)load progress each time the tutorial is activated. A finished run starts
  // over; a mid-way run resumes at the last incomplete step.
  useEffect(() => {
    if (!active) return
    let loaded = loadTutorialProgress() ?? initialProgress(TUTORIAL_STEPS)
    if (isFinished(loaded)) loaded = initialProgress(TUTORIAL_STEPS)
    setProgress(loaded)
  }, [active])

  // Auto-advance on observable state (nothing is faked — A4).
  useEffect(() => {
    if (!active) return
    setProgress(prev => {
      const next = advance(prev, state, TUTORIAL_STEPS)
      if (next.stepId === prev.stepId && next.completed.length === prev.completed.length) return prev
      saveTutorialProgress(next)
      return next
    })
  }, [active, state])

  // Keep the docked placement correct on window resize.
  useEffect(() => {
    const onResize = (): void => setViewport({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const step = active ? currentStep(progress, TUTORIAL_STEPS) : null

  // Primary anchor, then a stage-tab fallback when the control is off screen and
  // the tab is not already the active one.
  const primaryRect = useAnchorRect(step ? step.anchor : null)
  let tabTestid: string | null = null
  if (step && primaryRect === null && step.stage !== 'welcome') {
    const tabEl = document.querySelector(`[data-testid="stage-tab-${step.stage}"]`)
    if (tabEl && tabEl.getAttribute('aria-pressed') !== 'true') {
      tabTestid = `stage-tab-${step.stage}`
    }
  }
  const tabRect = useAnchorRect(tabTestid)

  // Exit once when the run finishes.
  useEffect(() => {
    if (active && progress.stepId === null) onExit()
  }, [active, progress.stepId, onExit])

  const handleBack = useCallback(() => {
    setProgress(prev => {
      const next = back(prev, TUTORIAL_STEPS)
      saveTutorialProgress(next)
      return next
    })
  }, [])
  const handleNext = useCallback(() => {
    setProgress(prev => {
      const next = completeStep(prev, TUTORIAL_STEPS)
      saveTutorialProgress(next)
      return next
    })
  }, [])
  const handleSkipStep = useCallback(() => {
    setProgress(prev => {
      const next = skipStep(prev, TUTORIAL_STEPS)
      saveTutorialProgress(next)
      return next
    })
  }, [])
  const handleSkipTutorial = useCallback(() => onExit(), [onExit])

  if (!active || step === null) return null

  const spotlight = primaryRect ?? tabRect
  const placement = placeCoachCard(spotlight, { width: CARD_WIDTH, height: CARD_HEIGHT }, viewport)
  const meta = chapterMeta(step.chapter)

  return createPortal(
    <div className="fixed inset-0 z-[9999]" style={{ pointerEvents: 'none' }} data-testid="tutorial-overlay">
      <Spotlight rect={spotlight} />
      <CoachCard
        step={step}
        chapterTitleKey={(meta?.titleKey ?? '') as MessageKey}
        progress={chapterProgress(step, TUTORIAL_STEPS)}
        videoUrl={meta?.videoUrl}
        onOpenExternal={openExternalUrl}
        placement={placement}
        isExplain={step.done === 'next'}
        isLast={step.id === TUTORIAL_STEPS[TUTORIAL_STEPS.length - 1].id}
        offscreen={primaryRect === null}
        hasTab={primaryRect === null && tabRect !== null}
        canBack={step.id !== TUTORIAL_STEPS[0].id}
        onBack={handleBack}
        onNext={handleNext}
        onSkipStep={handleSkipStep}
        onSkipTutorial={handleSkipTutorial}
      />
    </div>,
    document.body,
  )
}
