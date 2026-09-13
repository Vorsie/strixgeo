// The tutorial overlay — the target highlight + coach card (spec §Architecture;
// owner rulings 1-3, 2026-09-05).
//
// Mounted once by App (inside a ShellContext.Provider so it can read the shell
// bus). It owns the progress state, advances it on observable state, and renders
// nothing while inactive. The whole overlay is `pointer-events: none` so the
// user can still click anything — a tutorial that fights the app is worse than
// none (A2).
//
// Owner ruling 1: NO background dim. Instead of darkening the app, the overlay
// draws a clear ring + soft glow on the TARGET control, and — when that control
// lives in the right-hand inspector pane — a second ring around the pane, so the
// user sees exactly where to click.
//
// Owner ruling 2: a step may declare a CHAIN of anchors; `useAnchorRect` resolves
// the chain to the anchor the owner's rule picks (menu button → item → control).
//
// Owner ruling 3: starting the tutorial while a project is already open skips the
// project-creation (welcome) steps and begins at the project-settings step.

import { useCallback, useEffect, useRef, useState } from 'react'
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
  initialProgressForContext,
  isFinished,
  skipStep,
  type TutorialProgress,
} from './tutorialMachine'
import { loadTutorialProgress, saveTutorialProgress } from './tutorialProgress'
import { placeCoachCard, type AnchorRect } from './coachCardPlacement'
import CoachCard, { CARD_HEIGHT, CARD_WIDTH } from './CoachCard'
import type { MessageKey } from '../i18n/locales/en'

/** The testid the shell inspector rail carries, so the overlay can tell when a
 *  target lives in the right-hand pane and ring the pane too (owner ruling 1). */
const INSPECTOR_TESTID = 'shell-inspector'

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

/** Whether `inner`'s centre falls inside `outer` (used to detect a target that
 *  sits in the inspector pane). Both may be null. */
function centreInside(inner: AnchorRect | null, outer: AnchorRect | null): boolean {
  if (inner === null || outer === null || outer.width === 0 || outer.height === 0) return false
  const cx = inner.left + inner.width / 2
  const cy = inner.top + inner.height / 2
  return cx >= outer.left && cx <= outer.right && cy >= outer.top && cy <= outer.bottom
}

/**
 * The target highlight: a clear ring + soft glow on the control, and an optional
 * ring around the inspector pane when the control lives there. No dim (owner
 * ruling 1). Pointer-events none so clicks pass through.
 */
function Highlight({ rect, pane }: { rect: AnchorRect | null; pane: AnchorRect | null }): JSX.Element {
  const pad = 6
  const cut =
    rect === null
      ? null
      : { x: rect.left - pad, y: rect.top - pad, w: rect.width + pad * 2, h: rect.height + pad * 2 }
  return (
    <svg className="fixed inset-0 h-full w-full" width="100%" height="100%" aria-hidden>
      {/* Pane ring — a soft dashed frame around the inspector when the target
          sits inside it, so the eye is led to the right rail first. */}
      {pane && (
        <rect
          x={pane.left + 2}
          y={pane.top + 2}
          width={Math.max(pane.width - 4, 0)}
          height={Math.max(pane.height - 4, 0)}
          rx={6}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth={2}
          strokeDasharray="6 5"
          opacity={0.55}
        />
      )}
      {/* Target glow — a wide, low-opacity accent ring so the control reads as
          lit rather than boxed. Steady (no animation) to stay calm. */}
      {cut && (
        <rect
          x={cut.x}
          y={cut.y}
          width={cut.w}
          height={cut.h}
          rx={8}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth={9}
          opacity={0.3}
        />
      )}
      {/* Target ring — the crisp outline the user aims at. */}
      {cut && (
        <rect
          x={cut.x}
          y={cut.y}
          width={cut.w}
          height={cut.h}
          rx={8}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth={2.5}
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
  const [progress, setProgress] = useState<TutorialProgress>(() => {
    const loaded = loadTutorialProgress()
    if (loaded !== null && !isFinished(loaded)) return loaded
    return initialProgressForContext(TUTORIAL_STEPS, { projectOpen: state.projectOpen })
  })
  const [viewport, setViewport] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }))

  // The latest observable state, read inside the activation effect without
  // adding it to the deps (which would re-fire the effect mid-tutorial and reset
  // progress). Only `projectOpen` at ACTIVATION time drives the welcome-skip.
  const stateRef = useRef(state)
  stateRef.current = state

  // (Re)load progress each time the tutorial is activated. A resumable mid-way
  // run resumes at the last incomplete step; a fresh/finished run starts over —
  // skipping the project-creation steps when a project is already open (ruling 3).
  useEffect(() => {
    if (!active) return
    const loaded = loadTutorialProgress()
    const resume = loaded !== null && !isFinished(loaded)
    setProgress(
      resume
        ? loaded
        : initialProgressForContext(TUTORIAL_STEPS, { projectOpen: stateRef.current.projectOpen }),
    )
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

  // The step's anchor CHAIN (a single anchor is a one-element chain). The hook
  // resolves it to the anchor the owner's rule picks and tracks its rect.
  const chain = step ? (step.anchors ?? [step.anchor]) : null
  const primaryRect = useAnchorRect(chain)

  // Inspector-pane rect — used to ring the pane when the target sits inside it.
  const inspectorRect = useAnchorRect(INSPECTOR_TESTID)

  // A stage-tab fallback for steps whose chain resolved to nothing (control off
  // screen and the chain did not include the owning tab). Highlights the owning
  // tab when it is not already the active one.
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
  // Ring the inspector pane only when the resolved target actually sits inside it.
  const paneRect = centreInside(primaryRect, inspectorRect) ? inspectorRect : null
  const placement = placeCoachCard(spotlight, { width: CARD_WIDTH, height: CARD_HEIGHT }, viewport)
  const meta = chapterMeta(step.chapter)

  return createPortal(
    // z-[2147483647] (int32 max) so the ring + coach card paint ABOVE any modal
    // dialog (owner ruling 2, 2026-09-06): the shared Modal sits one below at
    // z-[2147483646], and both are position:fixed portalled to <body>, sharing
    // one flat root stacking context — so this z alone puts the guide on top,
    // where its ring can outline a field inside an open dialog. pointer-events
    // none keeps the dialog beneath fully clickable.
    <div className="fixed inset-0 z-[2147483647]" style={{ pointerEvents: 'none' }} data-testid="tutorial-overlay">
      <Highlight rect={spotlight} pane={paneRect} />
      <CoachCard
        step={step}
        chapterTitleKey={(meta?.titleKey ?? '') as MessageKey}
        progress={chapterProgress(step, TUTORIAL_STEPS)}
        videoUrl={meta?.videoUrl}
        onOpenExternal={openExternalUrl}
        placement={placement}
        spotlightRect={spotlight}
        viewport={viewport}
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
