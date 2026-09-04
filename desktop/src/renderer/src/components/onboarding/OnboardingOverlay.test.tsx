// Owner 2026-09-04 ("i could click example project and ended up in tutorial
// but there is no example project jet"): the onboarding offers the sample
// project only when a worked example is actually bundled.
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import OnboardingOverlay from './OnboardingOverlay'

afterEach(cleanup)

function openChoose(sampleAvailable: boolean): void {
  render(
    <OnboardingOverlay
      open
      onClose={vi.fn()}
      onLoadSample={vi.fn()}
      onStartTutorial={vi.fn()}
      sampleAvailable={sampleAvailable}
    />,
  )
  fireEvent.click(screen.getByTestId('onboarding-welcome-next'))
}

describe('OnboardingOverlay — the sample card follows the bundled file', () => {
  it('does not offer the sample project when none is bundled', () => {
    openChoose(false)
    expect(screen.queryByTestId('onboarding-choose-sample')).toBeNull()
    expect(screen.getByTestId('onboarding-choose-scratch')).toBeInTheDocument()
  })

  it('offers the sample project when it is bundled', () => {
    openChoose(true)
    expect(screen.getByTestId('onboarding-choose-sample')).toBeInTheDocument()
  })
})
