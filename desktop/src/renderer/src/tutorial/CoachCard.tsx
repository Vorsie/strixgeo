// The coach card — the tutorial's speech bubble (spec §"The tutorial, as the
// user sees it"). It sits beside the spotlighted control (or docked bottom-right
// when the control is off screen), names the chapter and step, explains what to
// do in a few sentences, and carries the navigation chrome.
//
// A do-it step (completes by observable state) shows NO Next button — a hint
// says the tutorial moves on by itself. An explain step carries Next / Finish.
// Back / Skip step / Skip tutorial are always available. When the chapter has a
// worked-example clip (A7), a "Watch the clip" button opens it in the browser.
//
// The card gets out of the way two ways (owner, 2026-09-13 "the tutorial windows
// are sometimes in my way"):
//   - DRAG: the header row is a grab handle; a pointer drag relocates the card,
//     clamped inside the viewport margins, and the dragged spot overrides the
//     computed placement while the SAME step is shown. A step change re-places it
//     (the next anchor may be anywhere). A drop that would cover the spotlighted
//     control snaps just off it (owner: "It never covers the control it points
//     at"), the geometry living in coachCardPlacement.ts.
//   - FOLD: a chevron collapses the card to a compact pill docked bottom-right;
//     it STAYS folded across step changes until unfolded, and the spotlight ring
//     keeps working so the user still sees where to click. The folded state is
//     session-only renderer state, never persisted.

import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'

import { useT } from '../i18n/translate'
import type { MessageKey } from '../i18n/locales/en'
import type { CatalogueStep } from './tutorialCatalogue'
import type { ChapterProgress } from './tutorialMachine'
import {
  clampCardIntoViewport,
  nudgeCardOffSpotlight,
  placeCoachCard,
  type AnchorRect,
  type CardPosition,
  type PlacedCard,
} from './coachCardPlacement'

/** Fixed card footprint used both for layout and for the placement decision. */
export const CARD_WIDTH = 340
export const CARD_HEIGHT = 240

/** The card footprint as a size object (stable reference for the drag helpers). */
const CARD_SIZE = { width: CARD_WIDTH, height: CARD_HEIGHT }

/** The folded pill's footprint — used only to dock it bottom-right. */
const PILL_SIZE = { width: 220, height: 44 }

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
  /** Where the card sits (the computed placement; a drag overrides it). */
  placement: PlacedCard
  /** The spotlighted control's rect, so a dragged drop can snap off it. */
  spotlightRect?: AnchorRect | null
  /** The window inner size (drives the drag clamp + the docked pill). Defaults
   *  to the live window size, so the isolated-card tests need not pass it. */
  viewport?: { width: number; height: number }
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
 * @returns  The positioned card, or the folded pill.
 */
export default function CoachCard(props: CoachCardProps): JSX.Element {
  const t = useT()
  const { step, progress, placement } = props

  // Session-only chrome state: a dragged override (null = follow the computed
  // placement) and whether the card is folded to a pill. Neither is persisted.
  const [dragOffset, setDragOffset] = useState<CardPosition | null>(null)
  const [folded, setFolded] = useState(false)
  const [dragging, setDragging] = useState(false)

  // Latest viewport + spotlight, read inside window pointer listeners without
  // making them effect deps (a resize mid-drag must not tear the drag down).
  const viewport = props.viewport ?? { width: window.innerWidth, height: window.innerHeight }
  const viewportRef = useRef(viewport)
  viewportRef.current = viewport
  const spotlightRef = useRef<AnchorRect | null>(props.spotlightRect ?? null)
  spotlightRef.current = props.spotlightRect ?? null

  // The drag gesture's anchors, and the last clamped position seen during it.
  const dragRef = useRef<{ startX: number; startY: number; startLeft: number; startTop: number } | null>(
    null,
  )
  const lastPosRef = useRef<CardPosition | null>(null)

  // A step change re-places the card (the next anchor may be anywhere), so the
  // dragged override is cleared. The folded state is deliberately NOT reset here.
  useEffect(() => {
    setDragOffset(null)
  }, [step.id])

  const handleMove = useCallback((event: PointerEvent) => {
    const drag = dragRef.current
    if (drag === null) return
    const raw: CardPosition = {
      left: drag.startLeft + (event.clientX - drag.startX),
      top: drag.startTop + (event.clientY - drag.startY),
    }
    const clamped = clampCardIntoViewport(raw, CARD_SIZE, viewportRef.current)
    lastPosRef.current = clamped
    setDragOffset(clamped)
  }, [])

  const handleUp = useCallback(() => {
    window.removeEventListener('pointermove', handleMove)
    window.removeEventListener('pointerup', handleUp)
    dragRef.current = null
    setDragging(false)
    const dropped = lastPosRef.current
    if (dropped !== null) {
      // Snap off the control the card points at (owner: "It never covers ...").
      setDragOffset(nudgeCardOffSpotlight(dropped, CARD_SIZE, spotlightRef.current, viewportRef.current))
    }
  }, [handleMove])

  // Tear the window listeners down if the card unmounts mid-drag.
  useEffect(() => {
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }
  }, [handleMove, handleUp])

  // The effective card position: a clamped drag override, else the placement.
  const draggedPos = dragOffset !== null ? clampCardIntoViewport(dragOffset, CARD_SIZE, viewport) : null
  const effectivePos: CardPosition = draggedPos ?? { left: placement.left, top: placement.top }

  const onHandlePointerDown = (event: React.PointerEvent): void => {
    // Start the drag from wherever the card currently sits.
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startLeft: effectivePos.left,
      startTop: effectivePos.top,
    }
    lastPosRef.current = effectivePos
    setDragging(true)
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    // Pointer capture keeps the move stream flowing over other elements; jsdom
    // has no real capture, so guard the call.
    try {
      ;(event.currentTarget as Element).setPointerCapture?.(event.pointerId)
    } catch {
      /* capture is a nicety, not a requirement */
    }
  }

  // Folded: a compact pill docked bottom-right; a button so Enter/Space unfold
  // it. The spotlight ring is drawn by the overlay and stays on while folded.
  if (folded) {
    const dock = placeCoachCard(null, PILL_SIZE, viewport)
    return (
      <button
        type="button"
        data-testid="tutorial-coach-pill"
        aria-label={t('tutorial.ui.unfoldCard')}
        title={t('tutorial.ui.unfoldCard')}
        onClick={() => setFolded(false)}
        className="fixed z-[10000] inline-flex items-center gap-2 rounded-full border border-border-default bg-surface-card px-3 py-2 text-[11px] font-medium text-text-secondary shadow-2xl pointer-events-auto hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        style={{ left: dock.left, top: dock.top }}
      >
        <span className="tabular-nums">
          {t('tutorial.ui.foldedPill', { n: progress.stepIndex, total: progress.stepCount })}
        </span>
        <ChevronUp size={14} className="shrink-0" />
      </button>
    )
  }

  return (
    <div
      data-testid="tutorial-coach-card"
      role="dialog"
      aria-label={t(step.titleKey as MessageKey)}
      className="fixed z-[10000] rounded-xl border border-border-default bg-surface-card shadow-2xl pointer-events-auto flex flex-col"
      style={{ left: effectivePos.left, top: effectivePos.top, width: CARD_WIDTH }}
    >
      {/* Header — a grab handle to drag the card aside, plus the fold control.
          A drag from anywhere on this row relocates the card; the fold button
          swallows its own pointerdown so a click there never starts a drag. */}
      <div
        data-testid="tutorial-card-handle"
        onPointerDown={onHandlePointerDown}
        className={`flex items-start justify-between gap-2 px-4 pt-3 select-none ${
          dragging ? 'cursor-grabbing' : 'cursor-grab'
        }`}
      >
        <div className="text-[11px] font-semibold uppercase tracking-wide text-accent">
          {t(props.chapterTitleKey as MessageKey)}
        </div>
        <button
          type="button"
          data-testid="tutorial-fold"
          aria-label={t('tutorial.ui.foldCard')}
          title={t('tutorial.ui.foldCard')}
          onPointerDown={e => e.stopPropagation()}
          onClick={() => setFolded(true)}
          className="-mr-1 -mt-0.5 shrink-0 rounded p-1 text-text-muted hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <ChevronDown size={15} />
        </button>
      </div>

      <div className="px-4 pt-1 pb-3">
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
