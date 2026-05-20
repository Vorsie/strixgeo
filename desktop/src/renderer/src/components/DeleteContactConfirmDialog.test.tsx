// Tests for DeleteContactConfirmDialog (debt #62 item 1 — replaces
// the prior naked window.confirm for contact deletion).
//
// D1 — open shows the dialog with the formation name in the title.
// D2 — Cancel button fires onCancel, never onConfirm (the safety rail).
// D3 — "Delete contact" button fires onConfirm.
// D4 — Cancel receives default focus on open (irreversible-action rule:
//      an accidental Enter must NOT delete).
// D5 — open=false renders nothing.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import DeleteContactConfirmDialog from './DeleteContactConfirmDialog'

afterEach(() => cleanup())

describe('DeleteContactConfirmDialog', () => {
  it('D1 — open shows the dialog with the formation name in the title', () => {
    render(
      <DeleteContactConfirmDialog
        open
        formationName="Boom Klei"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    const title = screen.getByText(/delete contact at/i)
    expect(title).not.toBeNull()
    // Formation name renders inside the title (the span uses font-bold).
    expect(screen.getByText('Boom Klei')).not.toBeNull()
  })

  it('D2 — Cancel button fires onCancel, never onConfirm', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(
      <DeleteContactConfirmDialog
        open
        formationName="Zand"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('D3 — "Delete contact" button fires onConfirm', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(
      <DeleteContactConfirmDialog
        open
        formationName="Zand"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /delete contact/i }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('D4 — Cancel button receives default focus on open', () => {
    render(
      <DeleteContactConfirmDialog
        open
        formationName="Zand"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    const cancel = screen.getByRole('button', { name: /cancel/i })
    // Irreversible-action rule (docs/ux.md): an accidental Enter
    // must NOT fire the destructive action.
    expect(document.activeElement).toBe(cancel)
  })

  it('D5 — open=false renders nothing', () => {
    const { container } = render(
      <DeleteContactConfirmDialog
        open={false}
        formationName="Zand"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(container.querySelector('button')).toBeNull()
  })
})
