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

// Owner finding 2026-10-07: a text-select drag that started inside the PDF
// import dialog and ran past its edge closed the whole dialog (and cancelled
// the triage). Rule: the backdrop dismisses ONLY when the press AND the
// release both happen on the backdrop itself. A press inside the dialog that
// is released on the backdrop must do nothing. The browser fires that click
// on the backdrop (the nearest common ancestor of the two targets), so the
// tests replay the exact sequence: mouseDown, mouseUp, click.
describe('Modal backdrop dismiss (drag-out must not close)', () => {
  function renderModal(onCancel: () => void, busy = false): {
    panel: HTMLElement
    backdrop: HTMLElement
  } {
    render(
      <Modal open labelledBy="t" onCancel={onCancel} busy={busy}>
        <Body />
      </Modal>,
    )
    const panel = screen.getByRole('dialog')
    const backdrop = panel.parentElement as HTMLElement
    return { panel, backdrop }
  }

  it('B1 - press inside the dialog, release on the backdrop: the dialog stays open', () => {
    const onCancel = vi.fn()
    const { panel, backdrop } = renderModal(onCancel)
    fireEvent.mouseDown(panel)
    fireEvent.mouseUp(backdrop)
    fireEvent.click(backdrop)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('B2 - press and release both on the backdrop: the dialog closes once', () => {
    const onCancel = vi.fn()
    const { backdrop } = renderModal(onCancel)
    fireEvent.mouseDown(backdrop)
    fireEvent.mouseUp(backdrop)
    fireEvent.click(backdrop)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('B3 - press on the backdrop, release inside the dialog: the dialog stays open', () => {
    const onCancel = vi.fn()
    const { panel, backdrop } = renderModal(onCancel)
    fireEvent.mouseDown(backdrop)
    fireEvent.mouseUp(panel)
    fireEvent.click(backdrop)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('B4 - while busy, a full backdrop click never closes the dialog', () => {
    const onCancel = vi.fn()
    const { backdrop } = renderModal(onCancel, true)
    fireEvent.mouseDown(backdrop)
    fireEvent.mouseUp(backdrop)
    fireEvent.click(backdrop)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('B5 - a stale backdrop press does not arm a later drag-out release', () => {
    // A press on the backdrop released inside the dialog, then a drag from
    // the dialog out to the backdrop: the first press must not count.
    const onCancel = vi.fn()
    const { panel, backdrop } = renderModal(onCancel)
    fireEvent.mouseDown(backdrop)
    fireEvent.mouseUp(panel)
    fireEvent.mouseDown(panel)
    fireEvent.mouseUp(backdrop)
    fireEvent.click(backdrop)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('B6 - Esc still cancels', () => {
    const onCancel = vi.fn()
    renderModal(onCancel)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('B7 - Esc while busy does nothing', () => {
    const onCancel = vi.fn()
    renderModal(onCancel, true)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).not.toHaveBeenCalled()
  })
})
