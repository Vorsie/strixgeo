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
//
// Hand-edit warning (ruling B). Subdivide is model-wide and rebuilds every
// packing band, so it also destroys every band the engineer split or merged by
// hand. The dialog must name that loss, separately from the connections loss —
// losing your correlations and losing your hand-placed boundaries are different
// losses and an engineer weighs them differently.
//
// AC7 — with hand edits, the dialog names how many, and says they cannot be
//        recovered.
// AC8 — with NO hand edits, the dialog says nothing about them at all. An
//        empty warning ("0 hand edits will be lost") trains people to ignore
//        the real one.
// AC9 — one hand edit reads as singular.
// AC10 — it is a confirmation, not a block: with hand edits at risk the
//        confirm button still works.

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

  it('AC7 — names how many hand edits are at risk, and that they are unrecoverable', () => {
    render(
      <ReSubdivideConfirmDialog
        open
        handEditCount={3}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )
    const warning = document.body.querySelector('[data-testid="re-subdivide-hand-edits"]')
    expect(warning).not.toBeNull()
    expect(warning?.textContent).toContain('3')
    expect(warning?.textContent).toMatch(/hand/i)
    expect(warning?.textContent).toMatch(/cannot be recovered/i)
  })

  it('AC7b — the hand-edit loss stays distinct from the connections loss', () => {
    // Two different losses, two different sentences: an engineer who does not
    // care about losing auto-derivable ties may still care a great deal about
    // losing the boundaries he placed by hand.
    render(
      <ReSubdivideConfirmDialog
        open
        handEditCount={2}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )
    const dialog = document.body.querySelector('[data-testid="re-subdivide-confirm-dialog"]')
    expect(dialog?.textContent).toContain('manual connections you made will be cleared')
    const warning = document.body.querySelector('[data-testid="re-subdivide-hand-edits"]')
    expect(warning?.textContent).not.toContain('manual connections you made will be cleared')
  })

  it('AC8 — says nothing about hand edits when there are none', () => {
    render(
      <ReSubdivideConfirmDialog
        open
        handEditCount={0}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )
    expect(document.body.querySelector('[data-testid="re-subdivide-hand-edits"]')).toBeNull()
    const dialog = document.body.querySelector('[data-testid="re-subdivide-confirm-dialog"]')
    expect(dialog?.textContent).not.toMatch(/hand/i)
  })

  it('AC8b — omitting the count is the same as none', () => {
    render(<ReSubdivideConfirmDialog open onCancel={vi.fn()} onConfirm={vi.fn()} />)
    expect(document.body.querySelector('[data-testid="re-subdivide-hand-edits"]')).toBeNull()
  })

  it('AC9 — one hand edit reads as singular', () => {
    render(
      <ReSubdivideConfirmDialog
        open
        handEditCount={1}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )
    const warning = document.body.querySelector('[data-testid="re-subdivide-hand-edits"]')
    expect(warning?.textContent).toContain('1 hand-edited band ')
    expect(warning?.textContent).not.toContain('bands')
  })

  it('AC10 — hand edits at risk warn, they do not block: confirm still fires', () => {
    const onConfirm = vi.fn()
    render(
      <ReSubdivideConfirmDialog
        open
        handEditCount={7}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    )
    const confirm = screen.getByRole('button', { name: /re-subdivide/i }) as HTMLButtonElement
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})
