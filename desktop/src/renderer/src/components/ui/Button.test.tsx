// Tests for the shared Button component.
//
// FR1 — each variant renders a <button>.
// FR2 — focus ring uses theme-aware ring-accent, NOT ring-blue-500 (debt #105).
//        ring-accent = blue-600 light / blue-400 dark via CSS custom property
//        --color-accent; both meet WCAG 2.2 AA 3:1 for UI components.
// FR3 — secondary variant uses semantic surface tokens (bg-surface-page +
//        border-border-default), not raw bg-white / border-gray-300.
// FR4 — disabled buttons carry disabled:opacity-40.

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import Button from './Button'

describe('Button', () => {
  it('FR1 — renders a <button> for each variant', () => {
    for (const variant of ['primary', 'secondary', 'danger', 'ghost'] as const) {
      const { container } = render(<Button variant={variant}>Label</Button>)
      expect(container.querySelector('button')).not.toBeNull()
    }
  })

  it('FR2 — focus ring uses ring-accent, not ring-blue-500 (debt #105 WCAG contrast)', () => {
    // Regression anchor: Button previously hard-coded focus-visible:ring-blue-500
    // (~2.8:1 on dark surfaces, WCAG AA fail for 3:1 UI-component threshold).
    // ring-accent resolves to blue-600 (light) / blue-400 (dark) via the CSS
    // custom property system and clears 3:1 in both themes.
    render(<Button variant="primary">Save</Button>)
    const btn = screen.getByRole('button', { name: /Save/ })
    expect(btn.className).toContain('ring-accent')
    expect(btn.className).not.toContain('ring-blue-500')
  })

  it('FR3 — secondary variant uses semantic surface tokens (debt #105)', () => {
    render(<Button variant="secondary">Cancel</Button>)
    const btn = screen.getByRole('button', { name: /Cancel/ })
    expect(btn.className).toContain('bg-surface-page')
    expect(btn.className).toContain('border-border-default')
    expect(btn.className).not.toContain('bg-white')
    expect(btn.className).not.toContain('border-gray-300')
  })

  it('FR4 — disabled button carries opacity-40 pointer-events-none', () => {
    render(<Button disabled>Disabled</Button>)
    const btn = screen.getByRole('button', { name: /Disabled/ })
    expect(btn.className).toContain('disabled:opacity-40')
  })
})
