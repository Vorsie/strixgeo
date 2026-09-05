// The pure tutorial step machine (spec §Architecture).
//
// It owns no React and no storage — it maps `(progress, observable state)` to
// the next `progress`. `tutorialProgress.ts` persists the result; `useTutorialState`
// supplies the state; `TutorialOverlay` renders `currentStep(...)`.
//
// Progress is a serialisable `{ stepId, completed }` pair. `stepId === null`
// means the tutorial is finished. `completed` records the ids that are done —
// a do-it step joins it when its fact turns true, an explain step when the user
// clicks Next. Every function takes the step list as a parameter so the machine
// stays catalogue-agnostic and exhaustively testable against a fixture.

import type { CatalogueStep } from './tutorialCatalogue'
import type { TutorialState } from './tutorialState'

/** Serialisable tutorial progress. `stepId === null` ⇒ finished. */
export interface TutorialProgress {
  /** The step the user is on, or `null` when the tutorial is finished. */
  stepId: string | null
  /** Ids of steps already completed (never re-armed). */
  completed: string[]
}

/**
 * Whether a step's completion condition is met.
 *
 * An explain step (`done: 'next'`) is satisfied only once its id is in
 * `completed`. A do-it step (`done: { state }`) is satisfied when its named
 * observable fact is truthy — `Boolean(0)` is `false`, so a count "> 0" and a
 * boolean flag share one rule.
 *
 * @param step  The step to test.
 * @param state  The current observable state.
 * @param completed  The set of completed step ids.
 * @returns  True when the step is satisfied.
 */
function isSatisfied(step: CatalogueStep, state: TutorialState, completed: Set<string>): boolean {
  if (step.done === 'next') return completed.has(step.id)
  return Boolean(state[step.done.state])
}

/**
 * The starting progress — the first step with nothing completed.
 *
 * @param steps  The ordered step list.
 * @returns  Fresh progress, or a finished progress if the list is empty.
 */
export function initialProgress(steps: readonly CatalogueStep[]): TutorialProgress {
  return { stepId: steps[0]?.id ?? null, completed: [] }
}

/** Alias of {@link initialProgress} for the "Restart tutorial" gesture. */
export function restart(steps: readonly CatalogueStep[]): TutorialProgress {
  return initialProgress(steps)
}

/**
 * Fresh progress that respects the app context at start (owner ruling 3).
 *
 * When a project is already open, the project-creation steps (the ``'welcome'``
 * stage — "Name your project" / "Create the project") make no sense, so they
 * are marked completed and the walk begins at the first non-welcome step (the
 * project-settings step). From the welcome screen (no project open) this is
 * exactly {@link initialProgress}. The completed welcome ids keep Back from
 * resurfacing steps the user can never act on.
 *
 * @param steps  The ordered step list.
 * @param context  Whether a project is currently open.
 * @returns  Fresh progress positioned for the current context.
 */
export function initialProgressForContext(
  steps: readonly CatalogueStep[],
  context: { projectOpen: boolean },
): TutorialProgress {
  if (!context.projectOpen) return initialProgress(steps)
  const firstReal = steps.findIndex(s => s.stage !== 'welcome')
  // No non-welcome step (degenerate catalogue) → behave like a plain start.
  if (firstReal <= 0) return initialProgress(steps)
  return {
    stepId: steps[firstReal].id,
    completed: steps.slice(0, firstReal).map(s => s.id),
  }
}

/** Whether the tutorial has run past its last step. */
export function isFinished(progress: TutorialProgress): boolean {
  return progress.stepId === null
}

/**
 * Resolve the step object the user is currently on.
 *
 * @param progress  Current progress.
 * @param steps  The ordered step list.
 * @returns  The step, or `null` when finished / not found.
 */
export function currentStep(
  progress: TutorialProgress,
  steps: readonly CatalogueStep[],
): CatalogueStep | null {
  if (progress.stepId === null) return null
  return steps.find(s => s.id === progress.stepId) ?? null
}

/**
 * Auto-advance on observable state.
 *
 * From the current step forward, complete every satisfied do-it step and step
 * over already-completed explain steps, stopping at the first step that still
 * needs the user (an unsatisfied do-it step, or an explain step awaiting Next).
 * An unknown stored `stepId` resets to the first step. A finished progress is
 * returned unchanged.
 *
 * @param progress  Current progress.
 * @param state  The current observable state.
 * @param steps  The ordered step list.
 * @returns  The advanced progress.
 */
export function advance(
  progress: TutorialProgress,
  state: TutorialState,
  steps: readonly CatalogueStep[],
): TutorialProgress {
  if (progress.stepId === null) return progress
  if (steps.length === 0) return { stepId: null, completed: [] }

  let idx = steps.findIndex(s => s.id === progress.stepId)
  const done = new Set(progress.completed)
  if (idx === -1) {
    // Unknown id (storage from an older catalogue) — reset to a clean start.
    idx = 0
    done.clear()
  }

  while (idx < steps.length) {
    const step = steps[idx]
    if (step.done === 'next') {
      if (done.has(step.id)) {
        idx += 1
        continue
      }
      break
    }
    if (isSatisfied(step, state, done)) {
      done.add(step.id)
      idx += 1
      continue
    }
    break
  }

  const stepId = idx < steps.length ? steps[idx].id : null
  return { stepId, completed: [...done] }
}

/**
 * Complete the current step and move to the next (the Next button, and Skip
 * tutorial-step-that-is-done). Marks the step completed so it never re-arms.
 *
 * @param progress  Current progress.
 * @param steps  The ordered step list.
 * @returns  Progress on the next step (or finished).
 */
export function completeStep(
  progress: TutorialProgress,
  steps: readonly CatalogueStep[],
): TutorialProgress {
  if (progress.stepId === null) return progress
  const idx = steps.findIndex(s => s.id === progress.stepId)
  if (idx === -1) return restart(steps)
  const completed = progress.completed.includes(progress.stepId)
    ? progress.completed
    : [...progress.completed, progress.stepId]
  const stepId = idx + 1 < steps.length ? steps[idx + 1].id : null
  return { stepId, completed }
}

/**
 * Skip the current step — move forward WITHOUT marking it complete, so a later
 * Back re-shows it (the "Skip step" button).
 *
 * @param progress  Current progress.
 * @param steps  The ordered step list.
 * @returns  Progress on the next step (or finished).
 */
export function skipStep(
  progress: TutorialProgress,
  steps: readonly CatalogueStep[],
): TutorialProgress {
  if (progress.stepId === null) return progress
  const idx = steps.findIndex(s => s.id === progress.stepId)
  if (idx === -1) return restart(steps)
  const stepId = idx + 1 < steps.length ? steps[idx + 1].id : null
  return { stepId, completed: progress.completed }
}

/**
 * Step back to the previous step (the Back button). Clamps at the first step;
 * from a finished progress, returns to the last step. `completed` is untouched.
 *
 * @param progress  Current progress.
 * @param steps  The ordered step list.
 * @returns  Progress on the previous step.
 */
export function back(
  progress: TutorialProgress,
  steps: readonly CatalogueStep[],
): TutorialProgress {
  if (steps.length === 0) return progress
  if (progress.stepId === null) {
    return { stepId: steps[steps.length - 1].id, completed: progress.completed }
  }
  const idx = steps.findIndex(s => s.id === progress.stepId)
  if (idx <= 0) return progress
  return { stepId: steps[idx - 1].id, completed: progress.completed }
}

/** Chapter/step position for the progress strip ("chapter i of n, step j of m"). */
export interface ChapterProgress {
  /** 1-based chapter position among the chapters that have steps. */
  chapterIndex: number
  /** Number of chapters that have steps. */
  chapterCount: number
  /** 1-based step position within its chapter. */
  stepIndex: number
  /** Number of steps in the chapter. */
  stepCount: number
}

/**
 * Compute the progress-strip position of a step.
 *
 * @param step  The step to locate.
 * @param steps  The ordered step list.
 * @returns  The chapter and in-chapter position.
 */
export function chapterProgress(
  step: CatalogueStep,
  steps: readonly CatalogueStep[],
): ChapterProgress {
  const chapters = [...new Set(steps.map(s => s.chapter))].sort((a, b) => a - b)
  const inChapter = steps.filter(s => s.chapter === step.chapter)
  return {
    chapterIndex: chapters.indexOf(step.chapter) + 1,
    chapterCount: chapters.length,
    stepIndex: inChapter.findIndex(s => s.id === step.id) + 1,
    stepCount: inChapter.length,
  }
}
