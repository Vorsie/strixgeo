// Red-first pins for the coach-card drag + fold behaviour (owner, 2026-09-13:
// "I do notice that the tutorial windows are sometimes in my way"). The rules,
// in the owner's words, are the test names:
//
//  - "The tutorial card is in my way, so I drag it aside and it stays there"
//  - "I fold the card to a small pill and unfold it when I want to read the next step"
//  - "It never covers the control it points at" (dragged case)
//  - the card stays folded across step changes; a step change re-places a dragged card
//
// The card owns the drag offset + folded state so it is testable in isolation;
// the drag uses window pointer listeners (robust to jsdom's lack of real pointer
// capture), so the move/up are fired on `window`.

import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import CoachCard, { type CoachCardProps } from './CoachCard'
import type { CatalogueStep } from './tutorialCatalogue'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const STEP: CatalogueStep = {
  id: 'project-name',
  chapter: 1,
  anchor: 'welcome-project-name-input',
  done: 'next',
  titleKey: 'tutorial.project-name.title',
  bodyKey: 'tutorial.project-name.body',
  stage: 'welcome',
}

const NEXT_STEP: CatalogueStep = {
  id: 'project-create',
  chapter: 1,
  anchor: 'welcome-new-project-button',
  done: { state: 'projectOpen' },
  titleKey: 'tutorial.project-create.title',
  bodyKey: 'tutorial.project-create.body',
  stage: 'welcome',
}

function baseProps(overrides: Partial<CoachCardProps> = {}): CoachCardProps {
  return {
    step: STEP,
    chapterTitleKey: 'tutorial.chapter.1',
    progress: { chapterIndex: 1, chapterCount: 8, stepIndex: 1, stepCount: 4 },
    placement: { left: 120, top: 80, placement: 'right' },
    isExplain: true,
    isLast: false,
    offscreen: false,
    canBack: true,
    onBack: vi.fn(),
    onNext: vi.fn(),
    onSkipStep: vi.fn(),
    onSkipTutorial: vi.fn(),
    ...overrides,
  }
}

/** Drag the card by (dx, dy) via the header handle, using window move/up. */
function dragBy(dx: number, dy: number): void {
  const handle = screen.getByTestId('tutorial-card-handle')
  fireEvent.pointerDown(handle, { clientX: 500, clientY: 500, pointerId: 1 })
  fireEvent.pointerMove(window, { clientX: 500 + dx, clientY: 500 + dy, pointerId: 1 })
  fireEvent.pointerUp(window, { clientX: 500 + dx, clientY: 500 + dy, pointerId: 1 })
}

describe('coach card — drag', () => {
  it('The tutorial card is in my way, so I drag it aside and it stays there', () => {
    const { rerender } = render(<CoachCard {...baseProps()} />)
    const card = screen.getByTestId('tutorial-coach-card')
    expect(card.style.left).toBe('120px')
    expect(card.style.top).toBe('80px')

    dragBy(60, 60)
    expect(card.style.left).toBe('180px')
    expect(card.style.top).toBe('140px')

    // A parent re-place of the SAME step must not move the dragged card back.
    rerender(<CoachCard {...baseProps({ placement: { left: 500, top: 400, placement: 'below' } })} />)
    expect(card.style.left).toBe('180px')
    expect(card.style.top).toBe('140px')
  })

  it('It never covers the control it points at (a drop over the spotlight snaps off)', () => {
    // The card starts on top of the spotlight; a small drag keeps it covering
    // the control, so the drop snaps just below the spotlight.
    render(
      <CoachCard
        {...baseProps({
          spotlightRect: { left: 200, top: 150, right: 280, bottom: 230, width: 80, height: 80 },
        })}
      />,
    )
    const card = screen.getByTestId('tutorial-coach-card')
    dragBy(5, 5) // drop at 125,85 still covers 200..280 x 150..230
    expect(card.style.left).toBe('125px')
    expect(card.style.top).toBe('246px') // spotlight.bottom (230) + gap (16)
  })

  it('a step change re-places a dragged card (the next anchor may be anywhere)', () => {
    const { rerender } = render(<CoachCard {...baseProps()} />)
    const card = screen.getByTestId('tutorial-coach-card')
    dragBy(60, 60)
    expect(card.style.left).toBe('180px')

    rerender(
      <CoachCard {...baseProps({ step: NEXT_STEP, placement: { left: 500, top: 400, placement: 'below' } })} />,
    )
    expect(card.style.left).toBe('500px')
    expect(card.style.top).toBe('400px')
  })
})

describe('coach card — fold', () => {
  it('I fold the card to a small pill and unfold it when I want to read the next step', () => {
    render(<CoachCard {...baseProps()} />)
    // Fold: the full card is gone, a compact pill remains.
    fireEvent.click(screen.getByTestId('tutorial-fold'))
    expect(screen.queryByTestId('tutorial-coach-card')).toBeNull()
    const pill = screen.getByTestId('tutorial-coach-pill')
    expect(pill.tagName).toBe('BUTTON') // Enter/Space unfold it (native button)
    expect(pill.textContent).toContain('Tutorial')
    expect(pill.textContent).toContain('1/4')

    // Unfold: the full card returns with its body text.
    fireEvent.click(pill)
    expect(screen.queryByTestId('tutorial-coach-pill')).toBeNull()
    expect(screen.getByTestId('tutorial-coach-card')).toBeTruthy()
  })

  it('the card stays folded across step changes until unfolded', () => {
    const { rerender } = render(<CoachCard {...baseProps()} />)
    fireEvent.click(screen.getByTestId('tutorial-fold'))
    expect(screen.getByTestId('tutorial-coach-pill')).toBeTruthy()

    rerender(<CoachCard {...baseProps({ step: NEXT_STEP })} />)
    expect(screen.queryByTestId('tutorial-coach-card')).toBeNull()
    expect(screen.getByTestId('tutorial-coach-pill')).toBeTruthy()
  })

  it('the fold and unfold controls carry accessible names', () => {
    render(<CoachCard {...baseProps()} />)
    expect(screen.getByLabelText('Fold tutorial card')).toBeTruthy()
    fireEvent.click(screen.getByTestId('tutorial-fold'))
    expect(screen.getByLabelText('Unfold tutorial card')).toBeTruthy()
  })

  it('the navigation buttons still work while unfolded (machine untouched)', () => {
    const onNext = vi.fn()
    render(<CoachCard {...baseProps({ onNext })} />)
    fireEvent.click(screen.getByTestId('tutorial-next'))
    expect(onNext).toHaveBeenCalledTimes(1)
  })
})
