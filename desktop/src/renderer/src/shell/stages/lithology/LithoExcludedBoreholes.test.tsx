// Rendering net for the Lithology inspector's excluded-boreholes list (#65).
//
// The rule the entry asks for: surface the boreholes excluded from the litho
// build, each with a per-row "Include again". A model with no exclusions shows
// nothing (the section is for the exception, not a permanent empty box).

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import LithoExcludedBoreholes from './LithoExcludedBoreholes'
import { t } from '../../../i18n/translate'

afterEach(cleanup)

const NAMES = new Map<string, string>([
  ['bh-1', 'Borehole A'],
  ['bh-2', 'Borehole B'],
])

describe('LithoExcludedBoreholes', () => {
  it('renders nothing when no boreholes are excluded', () => {
    const { container } = render(
      <LithoExcludedBoreholes
        excludedBoreholeIds={[]}
        boreholeNameById={NAMES}
        onIncludeAgain={vi.fn()}
        t={t}
      />,
    )
    // Silent when there is no exclusion to surface.
    expect(container.querySelector('[data-testid="litho-excluded-boreholes"]')).toBeNull()
  })

  it('lists each excluded borehole by name with an Include-again control', () => {
    render(
      <LithoExcludedBoreholes
        excludedBoreholeIds={['bh-1', 'bh-2']}
        boreholeNameById={NAMES}
        onIncludeAgain={vi.fn()}
        t={t}
      />,
    )
    expect(screen.getByTestId('litho-excluded-boreholes')).toBeTruthy()
    expect(screen.getByText('Borehole A')).toBeTruthy()
    expect(screen.getByText('Borehole B')).toBeTruthy()
    expect(screen.getByTestId('litho-include-borehole-bh-1')).toBeTruthy()
    expect(screen.getByTestId('litho-include-borehole-bh-2')).toBeTruthy()
  })

  it('calls onIncludeAgain with the borehole id when Include again is clicked', () => {
    const onIncludeAgain = vi.fn()
    render(
      <LithoExcludedBoreholes
        excludedBoreholeIds={['bh-1']}
        boreholeNameById={NAMES}
        onIncludeAgain={onIncludeAgain}
        t={t}
      />,
    )
    fireEvent.click(screen.getByTestId('litho-include-borehole-bh-1'))
    expect(onIncludeAgain).toHaveBeenCalledTimes(1)
    expect(onIncludeAgain).toHaveBeenCalledWith('bh-1')
  })

  it('falls back to an unknown label when the id is not in the name map', () => {
    render(
      <LithoExcludedBoreholes
        excludedBoreholeIds={['bh-gone']}
        boreholeNameById={NAMES}
        onIncludeAgain={vi.fn()}
        t={t}
      />,
    )
    // A borehole excluded but no longer in the visible list still gets a row —
    // the engineer must be able to include it again even so.
    expect(screen.getByTestId('litho-include-borehole-bh-gone')).toBeTruthy()
    expect(screen.getByText(t('litho.excludedBoreholeUnknown'))).toBeTruthy()
  })
})
