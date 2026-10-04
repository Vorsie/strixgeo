// Owner 2026-10-04: the Data-stage detail pane needs two on/off switches,
// "Stratigraphic boundaries" and "Lithological boundaries", next to the
// DOV overlay control. Reversible: a click fires immediately, no confirm.

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ContactOverlayToggles } from './ContactOverlayToggles'

describe('ContactOverlayToggles', () => {
  it('shows both switches with their pressed state', () => {
    render(
      <ContactOverlayToggles visibility={{ geology: true, litho: false }} onToggle={() => {}} />,
    )
    const strat = screen.getByRole('button', { name: 'Stratigraphic boundaries' })
    const litho = screen.getByRole('button', { name: 'Lithological boundaries' })
    expect(strat.getAttribute('aria-pressed')).toBe('true')
    expect(litho.getAttribute('aria-pressed')).toBe('false')
  })

  it('a click on a switch toggles that source only, at once', () => {
    const onToggle = vi.fn()
    render(
      <ContactOverlayToggles visibility={{ geology: true, litho: true }} onToggle={onToggle} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Lithological boundaries' }))
    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(onToggle).toHaveBeenCalledWith('litho')
    fireEvent.click(screen.getByRole('button', { name: 'Stratigraphic boundaries' }))
    expect(onToggle).toHaveBeenLastCalledWith('geology')
  })
})
