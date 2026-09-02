// Pins for the coach card (spec §Testing: placement; A7: the worked-example clip
// button). The card is presentational — these check the two behaviours a test can
// own without the whole overlay: the video button (present only with a URL, opens
// it through the injected external-link path) and that the card honours the
// placement it is handed.

import { render, screen, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import CoachCard, { type CoachCardProps } from './CoachCard'
import type { CatalogueStep } from './tutorialCatalogue'

afterEach(() => {
  document.body.replaceChildren()
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

describe('CoachCard', () => {
  it('renders no "Watch the clip" button when the chapter has no videoUrl', () => {
    render(<CoachCard {...baseProps()} />)
    expect(screen.queryByTestId('tutorial-watch-clip')).toBeNull()
  })

  it('renders the clip button when a videoUrl is set and opens it via the external-link path', () => {
    const onOpenExternal = vi.fn()
    render(
      <CoachCard {...baseProps({ videoUrl: 'https://example.com/clip.mp4', onOpenExternal })} />,
    )
    const button = screen.getByTestId('tutorial-watch-clip')
    fireEvent.click(button)
    expect(onOpenExternal).toHaveBeenCalledWith('https://example.com/clip.mp4')
  })

  it('shows Next on an explain step and hides Skip step', () => {
    render(<CoachCard {...baseProps({ isExplain: true })} />)
    expect(screen.getByTestId('tutorial-next')).toBeTruthy()
    expect(screen.queryByTestId('tutorial-skip-step')).toBeNull()
  })

  it('hides Next on a do-it step and offers Skip step instead', () => {
    render(<CoachCard {...baseProps({ isExplain: false })} />)
    expect(screen.queryByTestId('tutorial-next')).toBeNull()
    expect(screen.getByTestId('tutorial-skip-step')).toBeTruthy()
  })

  it('positions the card at the placement it is handed', () => {
    render(<CoachCard {...baseProps({ placement: { left: 200, top: 150, placement: 'below' } })} />)
    const card = screen.getByTestId('tutorial-coach-card')
    expect(card.style.left).toBe('200px')
    expect(card.style.top).toBe('150px')
  })
})
