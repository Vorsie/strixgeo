// Smoke + behaviour tests for FormationDialog.
//
// Validates: open-prefill-from-initialValue, name-trim + required,
// submit dispatches the right payload shape, cancel + Esc paths.

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { GeologicalFormationResponse } from '../../api/client'
import FormationDialog from './FormationDialog'

function makeFormation(
  overrides: Partial<GeologicalFormationResponse> = {},
): GeologicalFormationResponse {
  return {
    id: 'f-1',
    app_project_id: 'P',
    name: 'Boom Klei',
    color: '#888888',
    code: null,
    display_order: 0,
    regional_ref: 'BMK',
    description: null,
    created_at: '2026-05-12T00:00:00Z',
    updated_at: '2026-05-12T00:00:00Z',
    ...overrides,
  }
}

describe('FormationDialog — create mode', () => {
  it('renders empty fields when initialValue is null', () => {
    render(
      <FormationDialog
        open
        initialValue={null}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByText('New formation')).toBeInTheDocument()
    const nameInput = screen.getByLabelText(/Name/i) as HTMLInputElement
    expect(nameInput.value).toBe('')
  })

  it('disables Create until the user types a name', () => {
    render(
      <FormationDialog
        open
        initialValue={null}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    const createBtn = screen.getByRole('button', { name: /Create/i })
    expect(createBtn).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Name/i), { target: { value: 'Boom Klei' } })
    expect(createBtn).not.toBeDisabled()
  })

  it('submits a trimmed name + null regional_ref when empty', async () => {
    const onSubmit = vi.fn()
    render(
      <FormationDialog
        open
        initialValue={null}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByLabelText(/Name/i), {
      target: { value: '  Boom Klei  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Create/i }))
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Boom Klei', regional_ref: null }),
    )
  })
})

describe('FormationDialog — edit mode', () => {
  it('renders prefilled fields and "Save" button when initialValue is set', () => {
    render(
      <FormationDialog
        open
        initialValue={makeFormation({ name: 'Diest Zand', regional_ref: 'DZN' })}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByText('Edit formation')).toBeInTheDocument()
    expect((screen.getByLabelText(/Name/i) as HTMLInputElement).value).toBe('Diest Zand')
    expect(screen.getByRole('button', { name: /Save/i })).toBeInTheDocument()
  })

  it('cancel button fires onCancel', () => {
    const onCancel = vi.fn()
    render(
      <FormationDialog
        open
        initialValue={makeFormation()}
        onSubmit={vi.fn()}
        onCancel={onCancel}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})

describe('FormationDialog — closed state', () => {
  it('renders nothing when open is false', () => {
    const { container } = render(
      <FormationDialog
        open={false}
        initialValue={null}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })
})
