// Tests for ReSubdivideConfirmDialog (connecting-geotech-units §7 — re-subdivide
// confirmation).
//
// AC1 — open shows the dialog title + body.
// AC2 — open=false renders nothing.
// AC3 — clicking Re-subdivide fires onConfirm, never onCancel.
// AC4 — clicking Cancel fires onCancel, never onConfirm.
// AC5 — busy disables both buttons.
// AC6 — Cancel button has default focus on open (irreversible-action rule:
//        an accidental Enter must NOT wipe manual packing connections).

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ReSubdivideConfirmDialog from './ReSubdivideConfirmDialog'

afterEach(() => cleanup())

describe('ReSubdivideConfirmDialog', () => {
  it('AC1 — open shows the dialog title and body', () => {
    render(<ReSubdivideConfirmDialog open onCancel={vi.fn()} onConfirm={vi.fn()} />)
    expect(screen.getByText(/re-subdivide geotech model\?/i)).not.toBeNull()
    const dialog = document.body.querySelector('[data-testid="re-subdivide-confirm-dialog"]')
    expect(dialog?.textContent).toContain('manual connections you made will be cleared')
  })

  it('AC2 — open=false renders nothing', () => {
    const { container } = render(
      <ReSubdivideConfirmDialog open={false} onCancel={vi.fn()} onConfirm={vi.fn()} />,
    )
    expect(container.querySelector('button')).toBeNull()
  })

  it('AC3 — Re-subdivide fires onConfirm, never onCancel', () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    render(<ReSubdivideConfirmDialog open onCancel={onCancel} onConfirm={onConfirm} />)
    fireEvent.click(screen.getByRole('button', { name: /re-subdivide/i }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('AC4 — Cancel fires onCancel, never onConfirm', () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    render(<ReSubdivideConfirmDialog open onCancel={onCancel} onConfirm={onConfirm} />)
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('AC5 — busy disables both buttons', () => {
    render(<ReSubdivideConfirmDialog open busy onCancel={vi.fn()} onConfirm={vi.fn()} />)
    const cancel = screen.getByRole('button', { name: /^cancel$/i }) as HTMLButtonElement
    const confirm = screen.getByRole('button', { name: /re-subdivide/i }) as HTMLButtonElement
    expect(cancel.disabled).toBe(true)
    expect(confirm.disabled).toBe(true)
  })

  it('AC6 — Cancel button has default focus on open', () => {
    render(<ReSubdivideConfirmDialog open onCancel={vi.fn()} onConfirm={vi.fn()} />)
    const cancel = screen.getByRole('button', { name: /^cancel$/i })
    // Irreversible-action rule (docs/ux.md): an accidental Enter must not
    // fire the Re-subdivide path and wipe manual packing connections.
    expect(document.activeElement).toBe(cancel)
  })
})
