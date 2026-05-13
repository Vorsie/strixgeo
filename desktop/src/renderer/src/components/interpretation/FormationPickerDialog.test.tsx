// Smoke + behaviour tests for FormationPickerDialog — the modal
// that opens after the user clicks a depth on a borehole or CPT in
// the cross-section. Verifies the dialog renders the right rows,
// the anchor subtitle reads correctly, and a row click dispatches
// the formation id through ``onSelect``.

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { GeologicalFormationResponse } from '../../api/client'
import FormationPickerDialog from './FormationPickerDialog'

function makeFormation(
  overrides: Partial<GeologicalFormationResponse> = {},
): GeologicalFormationResponse {
  return {
    id: 'f-1',
    app_project_id: 'P',
    name: 'Boom Klei',
    color: '#3b82f6',
    code: null,
    display_order: 0,
    regional_ref: 'Boom Fm',
    description: null,
    created_at: '2026-05-12T00:00:00Z',
    updated_at: '2026-05-12T00:00:00Z',
    ...overrides,
  }
}

describe('FormationPickerDialog — rendering', () => {
  it('renders the title + anchor subtitle when open', () => {
    render(
      <FormationPickerDialog
        open
        formations={[]}
        anchor={{
          kind: 'borehole',
          name: 'BH-1',
          depth_m: 2.5,
          elevationM: 7.5,
        }}
        onSelect={vi.fn()}
        onCreateFormation={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByText('Top of which formation?')).toBeInTheDocument()
    expect(screen.getByText(/BH-1/)).toBeInTheDocument()
    expect(screen.getByText(/2\.50 m/)).toBeInTheDocument()
    expect(screen.getByText(/\+7\.50 m TAW/)).toBeInTheDocument()
  })

  it('renders empty state when no formations exist', () => {
    render(
      <FormationPickerDialog
        open
        formations={[]}
        anchor={null}
        onSelect={vi.fn()}
        onCreateFormation={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByText(/No formations defined yet/i)).toBeInTheDocument()
  })

  it('lists every formation with name + regional reference', () => {
    const formations = [
      makeFormation({ id: 'a', name: 'Boom Klei', regional_ref: 'Boom Fm' }),
      makeFormation({ id: 'b', name: 'Diest Zand', regional_ref: 'Diest Fm' }),
    ]
    render(
      <FormationPickerDialog
        open
        formations={formations}
        anchor={null}
        onSelect={vi.fn()}
        onCreateFormation={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByText('Boom Klei')).toBeInTheDocument()
    expect(screen.getByText('Boom Fm')).toBeInTheDocument()
    expect(screen.getByText('Diest Zand')).toBeInTheDocument()
    expect(screen.getByText('Diest Fm')).toBeInTheDocument()
  })

  it('renders nothing when open is false', () => {
    const { container } = render(
      <FormationPickerDialog
        open={false}
        formations={[]}
        anchor={null}
        onSelect={vi.fn()}
        onCreateFormation={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })
})

describe('FormationPickerDialog — selection', () => {
  it('clicking a formation row fires onSelect with its id', async () => {
    const onSelect = vi.fn().mockResolvedValue(undefined)
    render(
      <FormationPickerDialog
        open
        formations={[makeFormation({ id: 'f-xyz', name: 'Boom Klei' })]}
        anchor={null}
        onSelect={onSelect}
        onCreateFormation={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByText('Boom Klei'))
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith('f-xyz'))
  })

  it('cancel button fires onCancel', () => {
    const onCancel = vi.fn()
    render(
      <FormationPickerDialog
        open
        formations={[]}
        anchor={null}
        onSelect={vi.fn()}
        onCreateFormation={vi.fn()}
        onCancel={onCancel}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('preserves the minus sign on negative-elevation anchors', () => {
    render(
      <FormationPickerDialog
        open
        formations={[]}
        anchor={{ kind: 'cpt', name: 'CPT-1', depth_m: 12, elevationM: -4.5 }}
        onSelect={vi.fn()}
        onCreateFormation={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByText(/-4\.50 m TAW/)).toBeInTheDocument()
  })
})
