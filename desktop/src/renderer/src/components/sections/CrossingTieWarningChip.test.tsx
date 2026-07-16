// Render tests for CrossingTieWarningChip — the amber §8-Q4 crossing-tie warning
// surface for the section editor.
//
//   CHIP1  conflictCount > 0 → the chip renders (amber badge + warning text).
//   CHIP2  conflictCount === 0 → nothing renders (no false warning).
//   CHIP3  the chip is non-interactive (pointer-events: none — never steals a
//          click from the section gestures beneath it).
//   CHIP4  singular vs plural copy ("1 crossing correlation tie" vs "N ... ties").

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import CrossingTieWarningChip from './CrossingTieWarningChip'

afterEach(() => cleanup())

function renderChip(count: number): HTMLElement {
  const { container } = render(
    <svg>
      <CrossingTieWarningChip conflictCount={count} plotLeft={10} plotTop={20} />
    </svg>,
  )
  return container
}

describe('CrossingTieWarningChip — §8 Q4 crossing-tie warning surface', () => {
  it('CHIP1: renders the amber warning when there is at least one conflict', () => {
    const c = renderChip(2)
    const chip = c.querySelector('[data-testid="crossing-tie-warning"]')
    expect(chip).not.toBeNull()
    const text = chip?.querySelector('text')?.textContent ?? ''
    expect(text).toContain('crossing correlation ties')
    expect(text).toContain('resolve to restore bands')
    // Amber fill on the badge rect (the project warning colour).
    const rect = chip?.querySelector('rect')
    expect(rect?.getAttribute('fill')).toBe('#f59e0b')
  })

  it('CHIP2: renders NOTHING when there are no conflicts (no false warning)', () => {
    const c = renderChip(0)
    expect(c.querySelector('[data-testid="crossing-tie-warning"]')).toBeNull()
  })

  it('CHIP3: is non-interactive (pointer-events none — no focus/click steal)', () => {
    const c = renderChip(1)
    const chip = c.querySelector('[data-testid="crossing-tie-warning"]') as SVGGElement
    expect(chip.style.pointerEvents).toBe('none')
  })

  it('CHIP4: singular copy for exactly one conflict', () => {
    const c = renderChip(1)
    const text = c.querySelector('[data-testid="crossing-tie-warning"] text')?.textContent ?? ''
    expect(text).toContain('1 crossing correlation tie —')
    expect(text).not.toContain('ties')
  })
})
