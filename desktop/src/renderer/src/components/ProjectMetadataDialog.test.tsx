import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import ProjectMetadataDialog from './ProjectMetadataDialog'
import type { ProjectResponse } from '../api/client'

// Behaviour-oriented tests for the metadata editor in placeholder mode.
// Form opens empty; current values appear as ghost placeholder text;
// only fields the user actually typed into are written on save.
//
// Dirty tracking and the imperative submit() handle drive the App's
// save-on-close flow — covered separately in App-level tests.

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

  it('opens with empty text fields and current values as placeholders', () => {
    render(
      <ProjectMetadataDialog
        open
        project={PROJECT}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
      />,
    )
    const name = screen.getByLabelText(/^Name/) as HTMLInputElement
    expect(name.value).toBe('')
    expect(name.placeholder).toBe('Antwerp port')

    const client = screen.getByLabelText(/^Client/) as HTMLInputElement
    expect(client.value).toBe('')
    expect(client.placeholder).toBe('Port of Antwerp')

    // Tags still render their chips (they don't follow the placeholder model).
    expect(screen.getByText('foundation')).toBeInTheDocument()
    expect(screen.getByText('marine')).toBeInTheDocument()

    // Dropdowns reflect the current value (no placeholder model for selects).
    expect(
      (screen.getByLabelText(/Default horizontal CRS/) as HTMLSelectElement)
        .value,
    ).toBe('31370')
    expect(
      (screen.getByLabelText(/^Phase/) as HTMLSelectElement).value,
    ).toBe('design')
  })

  it('Save is disabled when the form is untouched', () => {
    render(
      <ProjectMetadataDialog
        open
        project={PROJECT}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: /^Save$/ })).toBeDisabled()
  })

  it('Save enables once any text field gets a value', () => {
    render(
      <ProjectMetadataDialog
        open
        project={PROJECT}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByLabelText(/Description/), {
      target: { value: 'updated' },
    })
    expect(screen.getByRole('button', { name: /^Save$/ })).not.toBeDisabled()
  })

  it('PATCH payload contains only the fields the user actually edited', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <ProjectMetadataDialog
        open
        project={PROJECT}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />,
    )
    // Touch only the description.
    fireEvent.change(screen.getByLabelText(/Description/), {
      target: { value: 'updated text' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    const patch = onSubmit.mock.calls[0][0]
    // Only ``description`` is on the patch — every other field is absent.
    expect(patch).toEqual({ description: 'updated text' })
  })

  it('changing a dropdown alone produces a single-key patch', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <ProjectMetadataDialog
        open
        project={PROJECT}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />,
    )
    fireEvent.change(screen.getByLabelText(/^Status/), {
      target: { value: 'completed' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onSubmit.mock.calls[0][0]).toEqual({ status: 'completed' })
  })

  it('appends a tag on Enter, dropping case-insensitive duplicates', () => {
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

    fireEvent.change(tagInput, { target: { value: 'FOUNDATION' } })
    fireEvent.keyDown(tagInput, { key: 'Enter' })
    // Original two chips + the new phase-2 = 3 (no duplicate FOUNDATION).
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
    expect(screen.queryByText('marine')).not.toBeInTheDocument()
    expect(screen.getByText('foundation')).toBeInTheDocument()
  })

  it('clicking a chip X removes that tag and PATCHes only tags', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <ProjectMetadataDialog
        open
        project={PROJECT}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />,
    )
    fireEvent.click(screen.getByTitle('Remove foundation'))
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onSubmit.mock.calls[0][0]).toEqual({ tags: ['marine'] })
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
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'New name' } })
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(await screen.findByText(/upstream 503/)).toBeInTheDocument()
    // Dialog stays mounted with the form still rendered.
    expect(screen.getByLabelText(/^Name/)).toBeInTheDocument()
  })

  it('reports dirty state via onDirtyChange', () => {
    const onDirtyChange = vi.fn()
    render(
      <ProjectMetadataDialog
        open
        project={PROJECT}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
        onDirtyChange={onDirtyChange}
      />,
    )
    // Initial mount: clean.
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'X' } })
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: '' } })
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
  })
})
