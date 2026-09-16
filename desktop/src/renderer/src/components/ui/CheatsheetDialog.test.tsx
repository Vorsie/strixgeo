// Unit tests for CheatsheetDialog (debt #95 — Help → Gesture cheatsheet).
//
//   CS1  closed (open=false) renders nothing.
//   CS2  open renders the title + the area group headings.
//   CS3  renders a known gesture row (the Alt+drag MOVE gesture).
//   CS4  search filters rows live — matching rows stay, unrelated rows go.
//   CS5  a search with no matches shows the empty-state message.
//   CS6  the X close button fires onClose.
//   CS7  Esc fires onClose (Modal wiring is live).

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import CheatsheetDialog from './CheatsheetDialog'

afterEach(() => cleanup())

describe('CheatsheetDialog', () => {
  it('CS1 — closed renders nothing', () => {
    render(<CheatsheetDialog open={false} onClose={vi.fn()} />)
    expect(screen.queryByTestId('cheatsheet-dialog')).toBeNull()
  })

  it('CS2 — open renders the title and the area group headings', () => {
    render(<CheatsheetDialog open onClose={vi.fn()} />)
    expect(screen.getByText('Gestures & shortcuts')).toBeTruthy()
    // A representative sample of the area headings.
    expect(screen.getByText('Global')).toBeTruthy()
    expect(screen.getByText('Map')).toBeTruthy()
    expect(screen.getByText('Sections: contacts')).toBeTruthy()
  })

  it('CS3 — renders the Alt+drag MOVE gesture', () => {
    render(<CheatsheetDialog open onClose={vi.fn()} />)
    expect(screen.getByText(/re-anchor.*existing contact/i)).toBeTruthy()
  })

  it('CS4 — search filters rows, keeping matches and dropping non-matches', () => {
    render(<CheatsheetDialog open onClose={vi.fn()} />)
    // "Reset zoom" exists before filtering.
    expect(screen.getByText(/reset zoom to 100/i)).toBeTruthy()
    fireEvent.change(screen.getByTestId('cheatsheet-search'), {
      target: { value: 'marquee' },
    })
    expect(screen.getByText(/marquee select/i)).toBeTruthy()
    // The zoom row does not match "marquee" and is filtered out.
    expect(screen.queryByText(/reset zoom to 100/i)).toBeNull()
  })

  it('CS5 — a no-match search shows the empty-state message', () => {
    render(<CheatsheetDialog open onClose={vi.fn()} />)
    fireEvent.change(screen.getByTestId('cheatsheet-search'), {
      target: { value: 'zzzznotagesture' },
    })
    expect(screen.getByTestId('cheatsheet-no-results')).toBeTruthy()
  })

  it('CS6 — the X close button fires onClose', () => {
    const onClose = vi.fn()
    render(<CheatsheetDialog open onClose={onClose} />)
    fireEvent.click(screen.getByTestId('cheatsheet-close'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('CS7 — Esc fires onClose', () => {
    const onClose = vi.fn()
    render(<CheatsheetDialog open onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
