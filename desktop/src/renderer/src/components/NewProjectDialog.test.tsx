import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import NewProjectDialog from './NewProjectDialog'

// Behaviour-oriented tests for the New Project modal. Pure component —
// no IPC, no API. We assert the user-facing contract: opens / closes /
// validates input / disables affordances while a submit is in flight.

describe('NewProjectDialog', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <NewProjectDialog open={false} onSubmit={vi.fn()} onCancel={vi.fn()} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders the title and the project-name input when open', () => {
    render(<NewProjectDialog open onSubmit={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByText('New project')).toBeInTheDocument()
    expect(screen.getByLabelText(/Project name/i)).toBeInTheDocument()
  })

  it('disables Create until the name is non-empty (after trim)', () => {
    render(<NewProjectDialog open onSubmit={vi.fn()} onCancel={vi.fn()} />)
    const create = screen.getByRole('button', { name: /Create/i })
    expect(create).toBeDisabled()

    const input = screen.getByLabelText(/Project name/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: '   ' } })
    expect(create).toBeDisabled()

    fireEvent.change(input, { target: { value: 'Site A' } })
    expect(create).not.toBeDisabled()
  })

  it('submits with the trimmed name on Enter', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<NewProjectDialog open onSubmit={onSubmit} onCancel={vi.fn()} />)

    const input = screen.getByLabelText(/Project name/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: '  Site A  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('Site A'))
  })

  it('submits with the trimmed name when Create is clicked', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<NewProjectDialog open onSubmit={onSubmit} onCancel={vi.fn()} />)

    fireEvent.change(screen.getByLabelText(/Project name/i), {
      target: { value: 'Site B' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Create/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('Site B'))
  })

  it('cancels via Escape key', () => {
    const onCancel = vi.fn()
    render(<NewProjectDialog open onSubmit={vi.fn()} onCancel={onCancel} />)
    // Esc fires from the document-level listener regardless of focus
    // location — confirm that pressing it triggers cancel.
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalled()
  })

  it('cancels when the Cancel button is clicked', () => {
    const onCancel = vi.fn()
    render(<NewProjectDialog open onSubmit={vi.fn()} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('does not call onSubmit when Enter pressed with empty input', () => {
    const onSubmit = vi.fn()
    render(<NewProjectDialog open onSubmit={onSubmit} onCancel={vi.fn()} />)
    const input = screen.getByLabelText(/Project name/i) as HTMLInputElement
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('disables affordances while onSubmit is in flight', async () => {
    // Hold the promise open so we can observe the busy state.
    let resolveSubmit: (() => void) | undefined
    const onSubmit = vi.fn().mockImplementation(
      () => new Promise<void>(resolve => {
        resolveSubmit = resolve
      }),
    )
    render(<NewProjectDialog open onSubmit={onSubmit} onCancel={vi.fn()} />)

    const input = screen.getByLabelText(/Project name/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Site C' } })
    fireEvent.click(screen.getByRole('button', { name: /Create/i }))

    // Mid-flight: input + buttons are disabled to block double-clicks.
    await waitFor(() => expect(input).toBeDisabled())
    expect(screen.getByRole('button', { name: /Cancel/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Create/i })).toBeDisabled()

    // Resolve the promise so the test cleans up cleanly.
    resolveSubmit?.()
  })
})
