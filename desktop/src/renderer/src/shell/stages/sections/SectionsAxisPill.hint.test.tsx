// Owner 2026-09-11 on installer #32, a fresh project with no litho model yet:
// "scroll bar appeared, i dont like that." The toolbar's only non-verb, non-
// foldable child was the "no lithological model" hint, rendered nowrap, so at
// a narrow window it pushed the row past its width and the toolbar's
// scroll-zone answered with a horizontal scroll bar. The hint must give way
// (truncate) before that happens, keeping the full sentence on hover.
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import SectionsAxisPill from './SectionsAxisPill'

afterEach(cleanup)

describe('SectionsAxisPill — the no-litho hint never forces a scroll bar', () => {
  it('shrinks (truncates) instead of staying nowrap, and keeps the full text on hover', () => {
    render(
      <SectionsAxisPill
        short={false}
        isLitho={false}
        isGeotech={false}
        activeLithoModel={null}
        activeGeotechModel={null}
        onAxisChange={vi.fn()}
      />,
    )
    const hint = screen.getByTestId('sections-no-litho-hint')
    expect(hint.className).toMatch(/\btruncate\b/)
    expect(hint.className).toMatch(/\bmin-w-0\b/)
    expect(hint.className).not.toMatch(/whitespace-nowrap/)
    expect(hint.getAttribute('title')).toBe(hint.textContent)
  })
})
