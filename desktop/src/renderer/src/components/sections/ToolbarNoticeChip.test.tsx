// The geotech "N pending here" chip — passive and interactive contracts.
//
// Mirrors CrossingTieWarningChip.test.tsx, which is the shipped precedent for a
// count that became findable (owner ask 2026-08-23). This chip got the same ask
// on 2026-08-25:
//
//   > "now i get a one pending notification but i don't see any pending ties?
//   > Why don't we make that clickable so it highlights the tie?"
//
//   PTC1  it renders the count and the tooltip it is given
//   PTC2  WITHOUT onReveal it stays a plain label — no button, no focus stop
//   PTC3  WITH onReveal it becomes a real button, focusable and named
//   PTC4  a click asks the caller to reveal
//   PTC5  Enter and Space work too
//   PTC6  an unrelated key does nothing
//   PTC7  the tooltip says it can be clicked, so the affordance is discoverable
//   PTC8  amber is not the only cue — the label carries the meaning in words

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ToolbarNoticeChip from './ToolbarNoticeChip'

afterEach(() => cleanup())

function renderChip(onReveal?: () => void) {
  return render(
    <ToolbarNoticeChip
      label="1 pending here"
      title="1 of 1 packing tie proposed on this section (0 accepted model-wide)."
      onReveal={onReveal}
    />,
  )
}

describe('ToolbarNoticeChip — the passive contract', () => {
  it('PTC1: it renders the count and the tooltip it is given', () => {
    renderChip()
    const chip = screen.getByTestId('geotech-pending-tie-chip')
    expect(chip.textContent).toContain('1 pending here')
    expect(chip.getAttribute('title')).toContain('proposed on this section')
  })

  it('PTC2: WITHOUT onReveal it is a plain label, not a focus stop', () => {
    // A chip that swallowed a click without doing anything would be worse than
    // the label it replaces — so the affordance only exists where it can act.
    renderChip()
    const chip = screen.getByTestId('geotech-pending-tie-chip')
    expect(chip.tagName.toLowerCase()).not.toBe('button')
    expect(chip.getAttribute('tabindex')).toBeNull()
    expect(chip.getAttribute('role')).not.toBe('button')
  })
})

describe('ToolbarNoticeChip — reveal the tie', () => {
  it('PTC3: WITH onReveal it is a real button, focusable and named', () => {
    renderChip(() => {})
    const chip = screen.getByTestId('geotech-pending-tie-chip')
    expect(chip.tagName.toLowerCase()).toBe('button')
    // A native button is in the tab order without a tabindex, and the
    // accessible name has to say what pressing it does.
    expect(chip.getAttribute('aria-label') ?? '').toMatch(/pending/i)
  })

  it('PTC4: a click asks the caller to reveal the next pending tie', () => {
    const onReveal = vi.fn()
    renderChip(onReveal)
    fireEvent.click(screen.getByTestId('geotech-pending-tie-chip'))
    expect(onReveal).toHaveBeenCalledTimes(1)
  })

  it('PTC5: Enter and Space activate it, because it is a real submit-free button', () => {
    // Keyboard activation is the PLATFORM's here, not ours: a native
    // <button type="button"> is activated by Enter and Space and dispatches the
    // same click PTC4 pins. That is why this chip is a button rather than a
    // styled <span> with a hand-written keydown handler — the crossing chip
    // needed one only because an SVG <g> gets nothing for free.
    //
    // jsdom does not synthesise that activation from a raw keyDown, so the
    // assertion is on the element that carries the behaviour.
    renderChip(() => {})
    const chip = screen.getByTestId('geotech-pending-tie-chip')
    expect(chip).toBeInstanceOf(HTMLButtonElement)
    // type="button" — inside a form, a default-type button would SUBMIT on
    // Enter instead of revealing the tie.
    expect((chip as HTMLButtonElement).type).toBe('button')
    expect(chip.hasAttribute('disabled')).toBe(false)
  })

  it('PTC6: no other key reveals anything', () => {
    // Guards against a later hand-rolled keydown handler that fires on any key.
    const onReveal = vi.fn()
    renderChip(onReveal)
    fireEvent.keyDown(screen.getByTestId('geotech-pending-tie-chip'), { key: 'a' })
    expect(onReveal).not.toHaveBeenCalled()
  })

  it('PTC7: the tooltip says it can be clicked', () => {
    renderChip(() => {})
    const title = screen.getByTestId('geotech-pending-tie-chip').getAttribute('title') ?? ''
    expect(title.toLowerCase()).toContain('click')
  })

  it('PTC8: the meaning is in the words, not only in the amber', () => {
    // docs/ux.md: never encode information by colour alone.
    renderChip(() => {})
    expect(screen.getByTestId('geotech-pending-tie-chip').textContent).toContain('pending')
  })
})
