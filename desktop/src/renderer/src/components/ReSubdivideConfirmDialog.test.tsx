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
// Hand-edit warning (ruling B). Subdivide rebuilds every packing band it
// reaches, so it also destroys the ones the engineer split or merged by hand.
// The dialog must name that loss, separately from the connections loss —
// losing your correlations and losing your hand-placed boundaries are different
// losses and an engineer weighs them differently. Since 2026-08-15 the reach is
// ONE section, and so is the count (see AC12–AC14 at the bottom).
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
    expect(dialog?.textContent).toContain('manual connections you made there will be cleared')
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
    expect(dialog?.textContent).toContain('manual connections you made there will be cleared')
    const warning = document.body.querySelector('[data-testid="re-subdivide-hand-edits"]')
    expect(warning?.textContent).not.toContain('manual connections you made there will be cleared')
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
    // The COUNTED noun is what has to read singular. The old assertion banned
    // the substring "bands" from the whole paragraph, which also caught the
    // sentence's own "this section's packing bands".
    expect(warning?.textContent).not.toContain('1 hand-edited bands')
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

// Scope disclosure (owner ruling 2026-08-15). Step 1 became section-scoped —
// "i want subdivide cpt's also to be section scoped" — but the verb is still
// wipe-and-rebuild over the WHOLE geotech model. A scoped re-run therefore
// rebuilds this section's columns and leaves the others with nothing, which the
// engineer cannot possibly infer from a menu item that says "on this section".
//
// It said so until the rebuild stopped doing that. A scoped subdivide now
// deletes only the columns it rebuilds, so the sentence describing the other
// sections' loss became a warning about something that cannot happen — and
// there is no "on all sections" item left for it to send anyone to.
//
// AC11  a scoped re-run says NOTHING about other sections losing their bands

describe('ReSubdivideConfirmDialog — the other sections are no longer at risk', () => {
  it('AC11 — the dialog never claims other sections lose their packing bands', () => {
    render(<ReSubdivideConfirmDialog open onCancel={vi.fn()} onConfirm={vi.fn()} />)
    const dialog = document.body.querySelector('[data-testid="re-subdivide-confirm-dialog"]')
    expect(document.body.querySelector('[data-testid="re-subdivide-scope"]')).toBeNull()
    expect(dialog?.textContent ?? '').not.toMatch(/other section/i)
    expect(dialog?.textContent ?? '').not.toMatch(/on all sections/i)
  })
})

// The warning names the section it is about (owner, dogfeed 2026-08-15):
//
//   "We do however get an overwrite popup on cs2 while there is no subdivision
//   there yet. Now it seems like it is warning that i'll overwrite CS 1"
//
// The dialog was reading the model while the press reads one section, so it
// could only be understood as a threat to whichever section the engineer had
// worked on. Naming the section is what closes that gap: the sentence and the
// press describe the same thing.
//
// AC12  the section being subdivided is named in the body
// AC13  the hand-edit count is stated as belonging to THAT section
// AC14  no hedging: the count is the in-scope one, so it is not "any of them"

describe('ReSubdivideConfirmDialog — it names the section it is about', () => {
  it('AC12 — the section being subdivided is named', () => {
    render(
      <ReSubdivideConfirmDialog
        open
        sectionName="Cross-section 2"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )
    const dialog = document.body.querySelector('[data-testid="re-subdivide-confirm-dialog"]')
    expect(dialog?.textContent ?? '').toContain('Cross-section 2')
  })

  it('AC13 — the hand-edit warning names the same section, and only its bands', () => {
    render(
      <ReSubdivideConfirmDialog
        open
        sectionName="Cross-section 2"
        handEditCount={3}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )
    const warning = document.body.querySelector('[data-testid="re-subdivide-hand-edits"]')
    expect(warning?.textContent ?? '').toContain('Cross-section 2')
    expect(warning?.textContent ?? '').toContain('3 hand-edited band')
  })

  it('AC14 — the count is definite, not "any of them that sit on it"', () => {
    // It used to hedge because the number was the MODEL's while the press was
    // the section's. The number is now the section's, so the hedge would be
    // the lie.
    render(
      <ReSubdivideConfirmDialog
        open
        sectionName="Cross-section 2"
        handEditCount={3}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )
    const warning = document.body.querySelector('[data-testid="re-subdivide-hand-edits"]')
    expect(warning?.textContent ?? '').not.toMatch(/any of the/i)
    expect(warning?.textContent ?? '').not.toMatch(/in this model/i)
  })
})
