// Red-first pins for the pure tutorial step machine (spec §Testing:
// "advance on state, skip, back, restart, resume from persisted progress, a
// completed step never re-arms, unknown step id in storage resets").
//
// The machine is catalogue-agnostic: every function takes the step list as a
// parameter, so these pins run against a tiny fixture, not the real catalogue.

import { describe, expect, it } from 'vitest'

import type { CatalogueStep } from './tutorialCatalogue'
import type { TutorialState } from './tutorialState'
import {
  advance,
  back,
  chapterProgress,
  completeStep,
  currentStep,
  initialProgress,
  isFinished,
  restart,
  skipStep,
} from './tutorialMachine'

/** A four-step fixture spanning two chapters, mixing do-it and explain steps. */
const STEPS: readonly CatalogueStep[] = [
  { id: 'a', chapter: 1, anchor: 'x', done: { state: 'projectOpen' }, titleKey: 'a.t', bodyKey: 'a.b', stage: 'welcome' },
  { id: 'b', chapter: 1, anchor: 'x', done: 'next', titleKey: 'b.t', bodyKey: 'b.b', stage: 'welcome' },
  { id: 'c', chapter: 2, anchor: 'x', done: { state: 'cptCount' }, titleKey: 'c.t', bodyKey: 'c.b', stage: 'data' },
  { id: 'd', chapter: 2, anchor: 'x', done: 'next', titleKey: 'd.t', bodyKey: 'd.b', stage: 'data' },
]

/** All-false / all-zero observable state (first launch). */
function emptyState(): TutorialState {
  return {
    projectOpen: false,
    cptCount: 0,
    boreholeCount: 0,
    sectionCount: 0,
    geoModelExists: false,
    contactCount: 0,
    lumpingCount: 0,
    lithoAcceptedCount: 0,
    lithoSolidsBuilt: false,
    geotechModelExists: false,
  }
}

describe('tutorialMachine', () => {
  it('starts on the first step', () => {
    expect(initialProgress(STEPS)).toEqual({ stepId: 'a', completed: [] })
  })

  it('advances on observable state: a do-it step completes when its fact turns true', () => {
    // Project not yet open — stays on step a.
    expect(advance(initialProgress(STEPS), emptyState(), STEPS)).toEqual({
      stepId: 'a',
      completed: [],
    })
    // Project opens — step a completes and the walk stops at the explain step b.
    expect(advance(initialProgress(STEPS), { ...emptyState(), projectOpen: true }, STEPS)).toEqual({
      stepId: 'b',
      completed: ['a'],
    })
  })

  it('does not auto-advance past an explanation step (b needs a Next click)', () => {
    const atB = { stepId: 'b', completed: ['a'] }
    // Even with every later fact satisfied, an explain step blocks auto-advance.
    expect(advance(atB, { ...emptyState(), projectOpen: true, cptCount: 5 }, STEPS)).toEqual(atB)
  })

  it('a completed step never re-arms', () => {
    const atB = { stepId: 'b', completed: ['a'] }
    // projectOpen is still true, but a is completed and behind us — the walk
    // never returns to it.
    expect(advance(atB, { ...emptyState(), projectOpen: true }, STEPS)).toEqual(atB)
  })

  it('completeStep marks the current step done and moves to the next (the Next button)', () => {
    expect(completeStep({ stepId: 'b', completed: ['a'] }, STEPS)).toEqual({
      stepId: 'c',
      completed: ['a', 'b'],
    })
  })

  it('completeStep on the last step finishes the tutorial', () => {
    expect(completeStep({ stepId: 'd', completed: ['a', 'b', 'c'] }, STEPS)).toEqual({
      stepId: null,
      completed: ['a', 'b', 'c', 'd'],
    })
    expect(isFinished({ stepId: null, completed: [] })).toBe(true)
  })

  it('skipStep moves forward without completing the step', () => {
    expect(skipStep({ stepId: 'a', completed: [] }, STEPS)).toEqual({
      stepId: 'b',
      completed: [],
    })
  })

  it('back moves to the previous step and clamps at the first', () => {
    expect(back({ stepId: 'c', completed: ['a', 'b'] }, STEPS)).toEqual({
      stepId: 'b',
      completed: ['a', 'b'],
    })
    expect(back({ stepId: 'a', completed: [] }, STEPS)).toEqual({ stepId: 'a', completed: [] })
  })

  it('restart returns to the first step with a clean slate', () => {
    expect(restart(STEPS)).toEqual({ stepId: 'a', completed: [] })
  })

  it('resumes from persisted progress and completes the resumed step on state', () => {
    const persisted = { stepId: 'c', completed: ['a', 'b'] }
    // No CPTs yet — resume holds at c.
    expect(advance(persisted, emptyState(), STEPS)).toEqual(persisted)
    // A CPT imported — c completes, the walk stops at the explain step d.
    expect(advance(persisted, { ...emptyState(), cptCount: 1 }, STEPS)).toEqual({
      stepId: 'd',
      completed: ['a', 'b', 'c'],
    })
  })

  it('an unknown step id in storage resets to the first step', () => {
    expect(advance({ stepId: 'gone', completed: ['a', 'b'] }, emptyState(), STEPS)).toEqual({
      stepId: 'a',
      completed: [],
    })
  })

  it('currentStep resolves the step object, null when finished', () => {
    expect(currentStep({ stepId: 'c', completed: [] }, STEPS)?.id).toBe('c')
    expect(currentStep({ stepId: null, completed: [] }, STEPS)).toBeNull()
  })

  it('reports chapter and step position for the progress strip', () => {
    expect(chapterProgress(STEPS[2], STEPS)).toEqual({
      chapterIndex: 2,
      chapterCount: 2,
      stepIndex: 1,
      stepCount: 2,
    })
  })
})
