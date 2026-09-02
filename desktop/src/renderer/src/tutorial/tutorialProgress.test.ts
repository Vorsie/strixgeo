// Red-first pins for tutorial progress persistence (spec §Architecture:
// "localStorage read/write with the same try/catch discipline as
// onboardingSeen.ts"). Progress persists per user; reopening resumes at the
// last incomplete step; malformed or absent storage degrades to null, never a
// throw on the start path.

import { afterEach, describe, expect, it } from 'vitest'

import {
  TUTORIAL_PROGRESS_KEY,
  clearTutorialProgress,
  loadTutorialProgress,
  saveTutorialProgress,
} from './tutorialProgress'

afterEach(() => {
  localStorage.clear()
})

describe('tutorialProgress', () => {
  it('returns null when nothing is stored', () => {
    expect(loadTutorialProgress()).toBeNull()
  })

  it('round-trips a saved progress', () => {
    saveTutorialProgress({ stepId: 'c', completed: ['a', 'b'] })
    expect(loadTutorialProgress()).toEqual({ stepId: 'c', completed: ['a', 'b'] })
  })

  it('round-trips a finished progress (stepId null)', () => {
    saveTutorialProgress({ stepId: null, completed: ['a', 'b', 'c'] })
    expect(loadTutorialProgress()).toEqual({ stepId: null, completed: ['a', 'b', 'c'] })
  })

  it('clears the stored progress', () => {
    saveTutorialProgress({ stepId: 'c', completed: ['a'] })
    clearTutorialProgress()
    expect(loadTutorialProgress()).toBeNull()
  })

  it('returns null for malformed JSON instead of throwing', () => {
    localStorage.setItem(TUTORIAL_PROGRESS_KEY, '{not json')
    expect(loadTutorialProgress()).toBeNull()
  })

  it('returns null for a wrong-shaped object', () => {
    localStorage.setItem(TUTORIAL_PROGRESS_KEY, JSON.stringify({ foo: 1 }))
    expect(loadTutorialProgress()).toBeNull()
    localStorage.setItem(TUTORIAL_PROGRESS_KEY, JSON.stringify({ stepId: 5, completed: [] }))
    expect(loadTutorialProgress()).toBeNull()
    localStorage.setItem(
      TUTORIAL_PROGRESS_KEY,
      JSON.stringify({ stepId: 'a', completed: 'nope' }),
    )
    expect(loadTutorialProgress()).toBeNull()
  })
})
