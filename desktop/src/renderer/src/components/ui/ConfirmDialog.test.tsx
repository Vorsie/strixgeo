// Tests for the generic <ConfirmDialog> (#165).
//
//   CD1  renders title + body + Cancel + confirm; confirm uses its label/variant.
//   CD2  Cancel is default-focused on open (accidental-Enter guard).
//   CD3  clicking confirm / secondary / cancel fires the right callback.
//   CD4  busy disables every button.
//   CD5  closed dialog renders nothing.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ConfirmDialog from './ConfirmDialog'

afterEach(cleanup)

describe('ConfirmDialog (#165)', () => {
  it('CD1 — renders title, body, Cancel and the confirm action', () => {
    render(
      <ConfirmDialog
        open
        labelledBy="t"
        title="Delete it?"
        body="This cannot be undone."
        confirm={{ label: 'Delete', onClick: vi.fn(), variant: 'danger', testid: 'confirm' }}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByText('Delete it?')).toBeTruthy()
    expect(screen.getByText('This cannot be undone.')).toBeTruthy()
    expect(screen.getByRole('button', { name: /cancel/i })).toBeTruthy()
    expect(screen.getByTestId('confirm').textContent).toBe('Delete')
  })

  it('CD2 — Cancel receives default focus on open', () => {
    render(
      <ConfirmDialog
        open
        labelledBy="t"
        title="X"
        confirm={{ label: 'Go', onClick: vi.fn() }}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: /cancel/i })).toHaveFocus()
  })

  it('CD3 — fires the right callback for cancel / secondary / confirm', () => {
    const onCancel = vi.fn()
    const onSkip = vi.fn()
    const onConfirm = vi.fn()
    render(
      <ConfirmDialog
        open
        labelledBy="t"
        title="X"
        confirm={{ label: 'Re-correlate', onClick: onConfirm, variant: 'danger' }}
        secondary={{ label: 'Skip', onClick: onSkip }}
        onCancel={onCancel}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /skip/i }))
    fireEvent.click(screen.getByRole('button', { name: /re-correlate/i }))
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onSkip).toHaveBeenCalledTimes(1)
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('CD4 — busy disables every button', () => {
    render(
      <ConfirmDialog
        open
        busy
        labelledBy="t"
        title="X"
        confirm={{ label: 'Save', onClick: vi.fn() }}
        secondary={{ label: 'Discard', onClick: vi.fn() }}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /discard/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled()
  })

  it('CD5 — renders nothing when closed', () => {
    const { container } = render(
      <ConfirmDialog
        open={false}
        labelledBy="t"
        title="X"
        confirm={{ label: 'Go', onClick: vi.fn() }}
        onCancel={vi.fn()}
      />,
    )
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })
})
