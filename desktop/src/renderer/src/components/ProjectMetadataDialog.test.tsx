import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import ProjectMetadataDialog from './ProjectMetadataDialog'
import type { ProjectResponse } from '../api/client'

// Behaviour-oriented tests for the full project metadata editor. The
// dialog is mostly a controlled form; we cover the load → edit → save
// path, the tag-input chip semantics, and the required-name validation.

const PROJECT: ProjectResponse = {
  id: '01k-FIXTURE',
  name: 'Antwerp port',
  project_number: 'GEO-2026-042',
  client: 'Port of Antwerp',
  site_label: 'Quay 7',
  description: 'Foundation investigation',
  tags: ['foundation', 'marine'],
  default_horizontal_epsg: 31370,
  default_vertical_epsg: 5710,
  phase: 'design',
  status: 'active',
  archived_at: null,
  created_at: '2026-05-10T10:00:00Z',
  updated_at: '2026-05-10T10:00:00Z',
}

describe('ProjectMetadataDialog', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <ProjectMetadataDialog
        open={false}
        project={PROJECT}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('pre-populates every field from the project on open', () => {
    render(
      <ProjectMetadataDialog
        open
        project={PROJECT}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
      />,
    )

    expect((screen.getByLabelText(/^Name/) as HTMLInputElement).value).toBe(
      'Antwerp port',
    )
    expect(
      (screen.getByLabelText(/Project number/) as HTMLInputElement).value,
    ).toBe('GEO-2026-042')
    expect((screen.getByLabelText(/Client/) as HTMLInputElement).value).toBe(
      'Port of Antwerp',
    )
    expect(
      (screen.getByLabelText(/Site \/ location label/) as HTMLInputElement)
        .value,
    ).toBe('Quay 7')
    expect(
      (screen.getByLabelText(/Description/) as HTMLTextAreaElement).value,
    ).toBe('Foundation investigation')
    // Tags render as chips.
    expect(screen.getByText('foundation')).toBeInTheDocument()
    expect(screen.getByText('marine')).toBeInTheDocument()
    expect(
      (screen.getByLabelText(/Default horizontal CRS/) as HTMLSelectElement)
        .value,
    ).toBe('31370')
    expect(
      (screen.getByLabelText(/Default vertical CRS/) as HTMLSelectElement).value,
    ).toBe('5710')
    expect((screen.getByLabelText(/^Phase/) as HTMLSelectElement).value).toBe(
      'design',
    )
    expect((screen.getByLabelText(/^Status/) as HTMLSelectElement).value).toBe(
      'active',
    )
  })

  it('Save fires onSubmit with the full PATCH payload', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <ProjectMetadataDialog
        open
        project={PROJECT}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />,
    )

    // Tweak the description; everything else stays identical.
    fireEvent.change(screen.getByLabelText(/Description/), {
      target: { value: 'updated' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Antwerp port',
          project_number: 'GEO-2026-042',
          client: 'Port of Antwerp',
          site_label: 'Quay 7',
          description: 'updated',
          tags: ['foundation', 'marine'],
          default_horizontal_epsg: 31370,
          default_vertical_epsg: 5710,
          phase: 'design',
          status: 'active',
        }),
      ),
    )
  })

  it('empty optional fields are sent as null on save', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <ProjectMetadataDialog
        open
        project={PROJECT}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />,
    )
    fireEvent.change(screen.getByLabelText(/Client/), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText(/Description/), {
      target: { value: '   ' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    const patch = onSubmit.mock.calls[0][0]
    expect(patch.client).toBeNull()
    expect(patch.description).toBeNull()
  })

  it('appends a tag on Enter, dropping duplicates case-insensitively', () => {
    render(
      <ProjectMetadataDialog
        open
        project={PROJECT}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
      />,
    )
    const tagInput = screen.getByLabelText(/^Tags/) as HTMLInputElement

    fireEvent.change(tagInput, { target: { value: 'phase-2' } })
    fireEvent.keyDown(tagInput, { key: 'Enter' })
    expect(screen.getByText('phase-2')).toBeInTheDocument()
    expect(tagInput.value).toBe('')

    // Duplicate (case-insensitive) is dropped — count chip-remove
    // buttons rather than text-content (the description fixture also
    // contains the word "Foundation" so a regex text match would
    // false-positive there).
    fireEvent.change(tagInput, { target: { value: 'FOUNDATION' } })
    fireEvent.keyDown(tagInput, { key: 'Enter' })
    // Original two chips (foundation + marine) plus the new phase-2 = 3.
    expect(screen.getAllByTitle(/^Remove /).length).toBe(3)
  })

  it('comma also commits the tag draft', () => {
    render(
      <ProjectMetadataDialog
        open
        project={PROJECT}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
      />,
    )
    const tagInput = screen.getByLabelText(/^Tags/) as HTMLInputElement
    fireEvent.change(tagInput, { target: { value: 'urgent' } })
    fireEvent.keyDown(tagInput, { key: ',' })
    expect(screen.getByText('urgent')).toBeInTheDocument()
    expect(tagInput.value).toBe('')
  })

  it('Backspace on empty input removes the last tag', () => {
    render(
      <ProjectMetadataDialog
        open
        project={PROJECT}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
      />,
    )
    const tagInput = screen.getByLabelText(/^Tags/) as HTMLInputElement
    fireEvent.keyDown(tagInput, { key: 'Backspace' })
    // 'marine' was the last in the fixture; gone now.
    expect(screen.queryByText('marine')).not.toBeInTheDocument()
    expect(screen.getByText('foundation')).toBeInTheDocument()
  })

  it('clicking a chip X removes that tag', () => {
    render(
      <ProjectMetadataDialog
        open
        project={PROJECT}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByTitle('Remove foundation'))
    expect(screen.queryByText('foundation')).not.toBeInTheDocument()
    expect(screen.getByText('marine')).toBeInTheDocument()
  })

  it('Save disabled when name is empty after trim', () => {
    render(
      <ProjectMetadataDialog
        open
        project={PROJECT}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: '   ' } })
    expect(screen.getByRole('button', { name: /^Save$/ })).toBeDisabled()
  })

  it('Cancel button invokes onCancel', () => {
    const onCancel = vi.fn()
    render(
      <ProjectMetadataDialog
        open
        project={PROJECT}
        onCancel={onCancel}
        onSubmit={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Cancel/ }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('surfaces save errors and stays open', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('upstream 503'))
    render(
      <ProjectMetadataDialog
        open
        project={PROJECT}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(await screen.findByText(/upstream 503/)).toBeInTheDocument()
    // Form is still rendered (dialog didn't close).
    expect(screen.getByLabelText(/^Name/)).toBeInTheDocument()
  })
})
