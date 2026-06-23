// Tests for the shared <Modal> focus trap + focus restoration (#202).
//
//   M1  Tab from the last focusable element wraps to the first.
//   M2  Shift+Tab from the first focusable element wraps to the last.
//   M3  focus is restored to the trigger element when the modal closes.
//   M4  closed modal renders nothing (parity guard with the other dialogs).

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import Modal from './Modal'

afterEach(cleanup)

function Body(): React.JSX.Element {
  return (
    <div>
      <h2 id="t">Title</h2>
      <button>first</button>
      <button>middle</button>
      <button>last</button>
    </div>
  )
}

describe('Modal focus trap (#202)', () => {
  it('M1 — Tab from the last focusable wraps to the first', () => {
    render(
      <Modal open labelledBy="t" onCancel={vi.fn()}>
        <Body />
      </Modal>,
    )
    const last = screen.getByRole('button', { name: 'last' })
    last.focus()
    expect(last).toHaveFocus()

    fireEvent.keyDown(document, { key: 'Tab' })
    expect(screen.getByRole('button', { name: 'first' })).toHaveFocus()
  })

  it('M2 — Shift+Tab from the first focusable wraps to the last', () => {
    render(
      <Modal open labelledBy="t" onCancel={vi.fn()}>
        <Body />
      </Modal>,
    )
    const first = screen.getByRole('button', { name: 'first' })
    first.focus()
    expect(first).toHaveFocus()

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(screen.getByRole('button', { name: 'last' })).toHaveFocus()
  })

  it('M3 — focus returns to the trigger when the modal closes', () => {
    const trigger = document.createElement('button')
    trigger.textContent = 'open'
    document.body.appendChild(trigger)
    trigger.focus()
    expect(trigger).toHaveFocus()

    const { rerender } = render(
      <Modal open labelledBy="t" onCancel={vi.fn()}>
        <Body />
      </Modal>,
    )
    // Some element inside the card now holds focus, not the trigger.
    expect(trigger).not.toHaveFocus()

    rerender(
      <Modal open={false} labelledBy="t" onCancel={vi.fn()}>
        <Body />
      </Modal>,
    )
    expect(trigger).toHaveFocus()
    trigger.remove()
  })

  it('M4 — renders nothing when closed', () => {
    const { container } = render(
      <Modal open={false} labelledBy="t" onCancel={vi.fn()}>
        <Body />
      </Modal>,
    )
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })
})
