// Render tests for CrossingTieWarningChip — the amber §8-Q4 crossing-tie warning
// surface for the section editor.
//
//   CHIP1  conflictCount > 0 → the chip renders (amber badge + warning text).
//   CHIP2  conflictCount === 0 → nothing renders (no false warning).
//   CHIP3  the chip is non-interactive (pointer-events: none — never steals a
//          click from the section gestures beneath it).
//   CHIP4  singular vs plural copy ("1 crossing correlation tie" vs "N ... ties").

import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

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
    expect(text).toContain('Resolve to restore bands')
    // Amber fill on the badge rect (the project warning colour).
    const rect = chip?.querySelector('rect')
    expect(rect?.getAttribute('fill')).toBe('#f59e0b')
  })

  it('CHIP2: renders NOTHING when there are no conflicts (no false warning)', () => {
    const c = renderChip(0)
    expect(c.querySelector('[data-testid="crossing-tie-warning"]')).toBeNull()
  })

  it('CHIP3: WITHOUT onJump it stays non-interactive (no focus/click steal)', () => {
    // The passive contract still holds wherever no jump handler is supplied —
    // the chip must never eat a click meant for the section gestures beneath.
    const c = renderChip(1)
    const chip = c.querySelector('[data-testid="crossing-tie-warning"]') as SVGGElement
    expect(chip.style.pointerEvents).toBe('none')
  })

  it('CHIP4: singular copy for exactly one conflict', () => {
    const c = renderChip(1)
    const text = c.querySelector('[data-testid="crossing-tie-warning"] text')?.textContent ?? ''
    expect(text).toContain('1 crossing correlation tie.')
    expect(text).not.toContain('ties')
  })
})

describe('CrossingTieWarningChip — jump-to-conflict', () => {
  // Owner ask 2026-08-23: *"make that clickable so it zooms to the first one,
  // and then when it is resolved it takes the second one"*. The count was
  // visible but the conflicts were not findable — on a wide section a crossing
  // easily sits outside the viewport.
  function renderJumpable(count: number, onJump: () => void): HTMLElement {
    const { container } = render(
      <svg>
        <CrossingTieWarningChip
          conflictCount={count}
          plotLeft={10}
          plotTop={20}
          onJump={onJump}
        />
      </svg>,
    )
    return container
  }

  const chipOf = (c: HTMLElement) =>
    c.querySelector('[data-testid="crossing-tie-warning"]') as SVGGElement

  it('CHIP5: WITH onJump it becomes interactive and focusable', () => {
    const chip = chipOf(renderJumpable(2, () => {}))
    expect(chip.style.pointerEvents).not.toBe('none')
    expect(chip.getAttribute('role')).toBe('button')
    expect(chip.getAttribute('tabindex')).toBe('0')
  })

  it('CHIP6: a click asks the caller to jump', () => {
    const onJump = vi.fn()
    fireEvent.click(chipOf(renderJumpable(2, onJump)))
    expect(onJump).toHaveBeenCalledTimes(1)
  })

  it('CHIP7: Enter and Space work too (it is a button, not a click target)', () => {
    // WCAG 2.2 AA — the section editor is keyboard-driven and an SVG <g> gets
    // none of a real button's behaviour for free.
    const onJump = vi.fn()
    const chip = chipOf(renderJumpable(2, onJump))
    fireEvent.keyDown(chip, { key: 'Enter' })
    fireEvent.keyDown(chip, { key: ' ' })
    expect(onJump).toHaveBeenCalledTimes(2)
  })

  it('CHIP8: an unrelated key does nothing', () => {
    const onJump = vi.fn()
    fireEvent.keyDown(chipOf(renderJumpable(2, onJump)), { key: 'a' })
    expect(onJump).not.toHaveBeenCalled()
  })

  it('CHIP9: the copy says it can be clicked, so the affordance is discoverable', () => {
    const text = chipOf(renderJumpable(2, () => {})).querySelector('text')?.textContent ?? ''
    expect(text).toContain('2 crossing correlation ties')
    expect(text.toLowerCase()).toContain('click')
  })

  it('CHIP10: still renders nothing at zero, handler or not', () => {
    const c = renderJumpable(0, () => {})
    expect(c.querySelector('[data-testid="crossing-tie-warning"]')).toBeNull()
  })
})
