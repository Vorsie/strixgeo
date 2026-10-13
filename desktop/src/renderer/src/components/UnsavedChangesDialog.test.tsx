import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import UnsavedChangesDialog from './UnsavedChangesDialog'
import type { UnsavedWorkSummary } from '../utils/unsavedWorkSummary'

/**
 * A saved project with no session work — the neutral baseline the older
 * tests use. Individual tests override only the field they exercise.
 */
function makeSummary(overrides: Partial<UnsavedWorkSummary> = {}): UnsavedWorkSummary {
  return {
    hasSavedSnapshot: true,
    importedCpts: 0,
    importedBoreholes: 0,
    importedFormations: 0,
    importedSections: 0,
    importedContacts: 0,
    hasInterpretationEdits: false,
    hasMetadataEdits: false,
    ...overrides,
  }
}

/** Everything the dialog renders, as one flat string, for copy assertions. */
function dialogText(): string {
  return screen.getByTestId('unsaved-changes-dialog').textContent ?? ''
}

describe('UnsavedChangesDialog', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <UnsavedChangesDialog
        open={false}
        projectName="Site A"
        summary={makeSummary()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders the prompt with the project name and three buttons', () => {
    render(
      <UnsavedChangesDialog
        open
        projectName="Site A"
        summary={makeSummary()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByText(/Save changes to/)).toBeInTheDocument()
    expect(screen.getByText('Site A')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Cancel/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Discard/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Save/ })).toBeInTheDocument()
  })

  it('Save / Discard / Cancel buttons fire their handlers', () => {
    const onSave = vi.fn()
    const onDiscard = vi.fn()
    const onCancel = vi.fn()
    render(
      <UnsavedChangesDialog
        open
        projectName="Site A"
        summary={makeSummary()}
        onSave={onSave}
        onDiscard={onDiscard}
        onCancel={onCancel}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Save/ }))
    expect(onSave).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Discard/ }))
    expect(onDiscard).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Cancel/ }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('Esc cancels (delegated to Modal)', () => {
    const onCancel = vi.fn()
    render(
      <UnsavedChangesDialog
        open
        projectName="Site A"
        summary={makeSummary()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        onCancel={onCancel}
      />,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalled()
  })

  it('disables every action button while busy', () => {
    render(
      <UnsavedChangesDialog
        open
        projectName="Site A"
        summary={makeSummary()}
        busy
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: /Cancel/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Discard/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Save/ })).toBeDisabled()
  })

  it('default-focuses Cancel so an accidental Enter does not discard', () => {
    render(
      <UnsavedChangesDialog
        open
        projectName="Site A"
        summary={makeSummary()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: /Cancel/ })).toHaveFocus()
  })

  it('DK2 — Cancel button uses semantic dark-mode-aware tokens (debt #105)', () => {
    // Regression anchor: UnsavedChangesDialog.Cancel previously used raw
    // bg-white + border-gray-300 + text-gray-700 with no dark: variants.
    // Semantic tokens (bg-surface-page, border-border-default, text-text-primary)
    // resolve correctly in both themes via CSS custom properties.
    render(
      <UnsavedChangesDialog
        open
        projectName="Site A"
        summary={makeSummary()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    const cancel = screen.getByRole('button', { name: /Cancel/ })
    expect(cancel.className).toContain('bg-surface-page')
    expect(cancel.className).toContain('text-text-primary')
    expect(cancel.className).not.toContain('text-gray-')
    expect(cancel.className).not.toContain('bg-white')
  })
})

// The e2e teardown (``closeApp``) answers a dirty quit by test id, never by
// label — the app may run in Dutch — and falls back to a plain DOM click when
// Playwright's pointer click cannot land. These pins hold the DOM contract it
// relies on: the discard BUTTON itself (not only the card) carries the id, it
// sits inside the card in the main document (portal to body, no iframe), it is
// clickable outside a save, and a bare ``element.click()`` discards.
describe('UnsavedChangesDialog — the DOM the e2e teardown clicks', () => {
  it('the discard button carries data-testid="unsaved-discard-and-close" inside the dialog card', () => {
    render(
      <UnsavedChangesDialog
        open
        projectName="Site A"
        summary={makeSummary()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    const card = document.body.querySelector('[data-testid="unsaved-changes-dialog"]')
    expect(card).not.toBeNull()
    const discard = card!.querySelector('[data-testid="unsaved-discard-and-close"]')
    expect(discard).not.toBeNull()
    expect(discard!.tagName).toBe('BUTTON')
    expect(discard).toBeEnabled()
  })

  it('a bare DOM click on the discard button discards (the harness fallback)', () => {
    const onDiscard = vi.fn()
    const onCancel = vi.fn()
    render(
      <UnsavedChangesDialog
        open
        projectName="Site A"
        summary={makeSummary()}
        onSave={vi.fn()}
        onDiscard={onDiscard}
        onCancel={onCancel}
      />,
    )
    const discard = document.body.querySelector<HTMLButtonElement>(
      '[data-testid="unsaved-changes-dialog"] [data-testid="unsaved-discard-and-close"]',
    )
    discard!.click()
    expect(onDiscard).toHaveBeenCalledTimes(1)
    // The click must not leak to the backdrop and cancel the quit instead.
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('while a save is in flight the discard button is disabled, so the harness must not count on it', () => {
    render(
      <UnsavedChangesDialog
        open
        projectName="Site A"
        summary={makeSummary()}
        busy
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(
      document.body.querySelector('[data-testid="unsaved-discard-and-close"]'),
    ).toBeDisabled()
  })
})

// The copy must match the behaviour. Discard runs a full replace-restore of
// the project from the last-saved .gmproj, so an afternoon of correlating,
// dragging boundaries and accepting suggestions is reverted — not just the
// metadata the engineer typed. The old body promised "the database row stays
// as it was", which is the opposite of what happens.
describe('UnsavedChangesDialog — the copy names what Discard destroys', () => {
  it('says discarding reverts the project to its last saved state', () => {
    render(
      <UnsavedChangesDialog
        open
        projectName="Site A"
        summary={makeSummary({ hasInterpretationEdits: true })}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(dialogText()).toMatch(/reverts[\s\S]*last saved state/i)
  })

  it('never claims the database is left untouched', () => {
    render(
      <UnsavedChangesDialog
        open
        projectName="Site A"
        summary={makeSummary({ hasMetadataEdits: true })}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    const text = dialogText()
    expect(text).not.toMatch(/database row stays/i)
    expect(text).not.toMatch(/stays as it was/i)
  })

  it('names the kinds of work that revert, not merely "changes"', () => {
    render(
      <UnsavedChangesDialog
        open
        projectName="Site A"
        summary={makeSummary({
          importedCpts: 2,
          hasInterpretationEdits: true,
          hasMetadataEdits: true,
        })}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    const text = dialogText()
    expect(text).toMatch(/imported this session/i)
    expect(text).toMatch(/correlations/i)
    expect(text).toMatch(/boundary/i)
    expect(text).toMatch(/metadata editor/i)
  })

  it('warns that discarding cannot be undone', () => {
    render(
      <UnsavedChangesDialog
        open
        projectName="Site A"
        summary={makeSummary({ hasInterpretationEdits: true })}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(dialogText()).toMatch(/cannot be undone/i)
  })

  it('reports the session import counts it actually has', () => {
    render(
      <UnsavedChangesDialog
        open
        projectName="Site A"
        summary={makeSummary({ importedCpts: 3, importedBoreholes: 1, importedSections: 2 })}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    // Only the kinds actually imported are listed, and one of a kind reads
    // as one — an engineer should never be shown "1 boreholes" or a row of
    // zeroes for the kinds this session did not touch.
    expect(dialogText()).toMatch(/3 CPTs, 1 borehole and 2 sections imported this session/)
    expect(dialogText()).not.toMatch(/formation|geological contact/i)
  })

  it('says nothing about imports when nothing was imported this session', () => {
    render(
      <UnsavedChangesDialog
        open
        projectName="Site A"
        summary={makeSummary({ hasInterpretationEdits: true })}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(dialogText()).not.toMatch(/imported this session/i)
  })

  it('admits the interpretation edits are uncounted instead of inventing a number', () => {
    // Only a boolean dirty flag exists for correlations / drags / accepts —
    // there is no count to show, so the dialog says so.
    render(
      <UnsavedChangesDialog
        open
        projectName="Site A"
        summary={makeSummary({ hasInterpretationEdits: true })}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(dialogText()).toMatch(/not counted/i)
  })

  it('tells a never-saved project that discarding deletes rather than reverts', () => {
    render(
      <UnsavedChangesDialog
        open
        projectName="Site A"
        summary={makeSummary({ hasSavedSnapshot: false, importedCpts: 4 })}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    const text = dialogText()
    expect(text).toMatch(/never been saved/i)
    expect(text).not.toMatch(/last saved state/i)
  })

  it('the discard button names the whole scope, not just "Discard"', () => {
    render(
      <UnsavedChangesDialog
        open
        projectName="Site A"
        summary={makeSummary({ hasInterpretationEdits: true })}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByTestId('unsaved-discard-and-close')).toHaveTextContent(
      /discard all changes/i,
    )
    // The confirm button names its action too — never a bare "OK" / "Yes".
    const confirm = screen.getByTestId('unsaved-save-and-close')
    expect(confirm).toHaveTextContent(/save/i)
    expect(confirm).not.toHaveTextContent(/^(OK|Yes)$/i)
  })

  it('keeps Cancel default-focused so Enter cannot discard the session', () => {
    render(
      <UnsavedChangesDialog
        open
        projectName="Site A"
        summary={makeSummary({ hasInterpretationEdits: true })}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByTestId('unsaved-cancel')).toHaveFocus()
  })
})
