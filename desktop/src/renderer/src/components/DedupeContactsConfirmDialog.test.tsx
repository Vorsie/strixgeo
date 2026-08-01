// Tests for DedupeContactsConfirmDialog — the gate that Dedupe never had.
//
// Dedupe DB-deletes formation contacts, including hand-placed ones, and there is
// no undo behind it. docs/ux.md puts that squarely in "irreversible": confirm
// first, Cancel default-focused, and an action-named button.
//
// AC1 — open shows the title.
// AC2 — open=false renders nothing.
// AC3 — "Remove duplicates" fires onConfirm, never onCancel.
// AC4 — Cancel fires onCancel, never onConfirm.
// AC5 — busy disables both buttons.
// AC6 — Cancel has default focus (an accidental Enter must not delete picks).
// AC7 — it says how many contacts go, and across how many pairs.
// AC8 — one of each reads as singular.
// AC9 — it says the removal cannot be undone.
// AC10 — with nothing to remove it says so, rather than claiming a number; the
//         run is still allowed, because the loaded list may be behind the server.
// AC11 — it names what survives, so the engineer can predict which pick he keeps.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import DedupeContactsConfirmDialog from './DedupeContactsConfirmDialog'

afterEach(() => cleanup())

/** The dialog card, for text assertions (Modal renders into the body). */
function card(): Element | null {
  return document.body.querySelector('[data-testid="dedupe-contacts-confirm-dialog"]')
}

describe('DedupeContactsConfirmDialog', () => {
  it('AC1 — open shows the title', () => {
    render(
      <DedupeContactsConfirmDialog
        open
        duplicateContacts={2}
        duplicatePairs={1}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )
    expect(screen.getByText(/remove duplicate contacts\?/i)).not.toBeNull()
  })

  it('AC2 — open=false renders nothing', () => {
    const { container } = render(
      <DedupeContactsConfirmDialog
        open={false}
        duplicateContacts={2}
        duplicatePairs={1}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )
    expect(container.querySelector('button')).toBeNull()
  })

  it('AC3 — Remove duplicates fires onConfirm, never onCancel', () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    render(
      <DedupeContactsConfirmDialog
        open
        duplicateContacts={2}
        duplicatePairs={1}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /remove duplicates/i }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('AC4 — Cancel fires onCancel, never onConfirm', () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    render(
      <DedupeContactsConfirmDialog
        open
        duplicateContacts={2}
        duplicatePairs={1}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('AC5 — busy disables both buttons', () => {
    render(
      <DedupeContactsConfirmDialog
        open
        busy
        duplicateContacts={2}
        duplicatePairs={1}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )
    const cancel = screen.getByRole('button', { name: /^cancel$/i }) as HTMLButtonElement
    const confirm = screen.getByRole('button', {
      name: /remove duplicates/i,
    }) as HTMLButtonElement
    expect(cancel.disabled).toBe(true)
    expect(confirm.disabled).toBe(true)
  })

  it('AC6 — Cancel has default focus on open', () => {
    render(
      <DedupeContactsConfirmDialog
        open
        duplicateContacts={2}
        duplicatePairs={1}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /^cancel$/i }))
  })

  it('AC7 — says how many contacts go, and across how many pairs', () => {
    render(
      <DedupeContactsConfirmDialog
        open
        duplicateContacts={7}
        duplicatePairs={3}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )
    const count = document.body.querySelector('[data-testid="dedupe-contacts-count"]')
    expect(count).not.toBeNull()
    expect(count?.textContent).toContain('7 contacts')
    expect(count?.textContent).toContain('3')
  })

  it('AC8 — one contact on one pair reads as singular', () => {
    render(
      <DedupeContactsConfirmDialog
        open
        duplicateContacts={1}
        duplicatePairs={1}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )
    const count = document.body.querySelector('[data-testid="dedupe-contacts-count"]')
    expect(count?.textContent).toContain('1 contact ')
    expect(count?.textContent).not.toContain('contacts')
    expect(count?.textContent).not.toContain('pairs')
  })

  it('AC9 — says the removal cannot be undone', () => {
    render(
      <DedupeContactsConfirmDialog
        open
        duplicateContacts={4}
        duplicatePairs={2}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )
    expect(card()?.textContent).toMatch(/cannot be undone/i)
  })

  it('AC10 — with nothing to remove it invents no number, and still lets the run happen', () => {
    const onConfirm = vi.fn()
    render(
      <DedupeContactsConfirmDialog
        open
        duplicateContacts={0}
        duplicatePairs={0}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    )
    expect(document.body.querySelector('[data-testid="dedupe-contacts-count"]')).toBeNull()
    const nothing = document.body.querySelector('[data-testid="dedupe-contacts-nothing"]')
    expect(nothing).not.toBeNull()
    const confirm = screen.getByRole('button', {
      name: /remove duplicates/i,
    }) as HTMLButtonElement
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('AC11 — names what survives so the engineer can predict which pick he keeps', () => {
    render(
      <DedupeContactsConfirmDialog
        open
        duplicateContacts={2}
        duplicatePairs={1}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )
    const survivor = document.body.querySelector('[data-testid="dedupe-contacts-survivor"]')
    expect(survivor).not.toBeNull()
    expect(survivor?.textContent).toMatch(/hand-placed/i)
  })
})
