import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import UnsavedChangesDialog from './UnsavedChangesDialog'

describe('UnsavedChangesDialog', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <UnsavedChangesDialog
        open={false}
        projectName="Site A"
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
