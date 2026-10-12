// Contract for the litho model-kind picker (#55 step 1):
//  - null until a geological backbone exists (litho needs a parent)
//  - "none yet" + New when no litho model
//  - select switches the active litho model (activate by id)
//  - the inline create flow calls handleCreateLithoModel(name)
//
// useShell is mocked so this stays a focused unit (no AppShell tree).

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ModelKindPicker from './ModelKindPicker'

const handleCreateLithoModel = vi.fn()
const handleActivateLithoModel = vi.fn()
const handleDeleteLithoModel = vi.fn()

let geoModel: Record<string, unknown>

vi.mock('../../ShellContext', () => ({
  useShell: () => ({ geoModel }),
}))

function model(id: string, name: string, kind: string, active = false) {
  return {
    id,
    app_project_id: 'p',
    name,
    description: null,
    is_active: active,
    excluded_borehole_ids: [],
    kind,
    parent_model_id: kind === 'geological' ? null : 'g1',
    created_at: '',
    updated_at: '',
  }
}

beforeEach(() => {
  handleCreateLithoModel.mockReset().mockResolvedValue(model('l9', 'New', 'lithostratigraphic'))
  handleActivateLithoModel.mockReset().mockResolvedValue(undefined)
  handleDeleteLithoModel.mockReset().mockResolvedValue(undefined)
  geoModel = {
    activeGeologicalModel: model('g1', 'Geo backbone', 'geological', true),
    models: [],
    activeLithoModel: null,
    handleCreateLithoModel,
    handleActivateLithoModel,
    handleDeleteLithoModel,
  }
})

describe('ModelKindPicker (#55)', () => {
  it('renders nothing without a geological backbone', () => {
    geoModel.activeGeologicalModel = null
    render(<ModelKindPicker />)
    expect(screen.queryByTestId('model-kind-picker')).toBeNull()
  })

  it('shows an actionable create CTA (not a muted "none yet") when empty', () => {
    render(<ModelKindPicker />)
    expect(screen.getByTestId('model-kind-picker')).toBeInTheDocument()
    expect(screen.queryByText('none yet')).toBeNull()
    // C1 empty-state CTA — names what creating it unlocks.
    const cta = screen.getByRole('button', {
      name: 'Create lithological model',
    })
    expect(cta).toBeInTheDocument()
    expect(cta).toHaveTextContent(/contacts on sections/i)
  })

  it('lists litho models and activates the chosen one', () => {
    geoModel.models = [
      model('g1', 'Geo backbone', 'geological', true),
      model('l1', 'Litho A', 'lithostratigraphic', true),
      model('l2', 'Litho B', 'lithostratigraphic'),
    ]
    geoModel.activeLithoModel = model('l1', 'Litho A', 'lithostratigraphic', true)
    render(<ModelKindPicker />)
    const select = screen.getByRole('combobox', {
      name: 'Active lithological model',
    })
    expect((select as HTMLSelectElement).value).toBe('l1')
    fireEvent.change(select, { target: { value: 'l2' } })
    expect(handleActivateLithoModel).toHaveBeenCalledWith('l2')
  })

  it('inline create flow calls handleCreateLithoModel with the typed name', () => {
    render(<ModelKindPicker />)
    // Empty state → the CTA enters create mode.
    fireEvent.click(
      screen.getByRole('button', { name: 'Create lithological model' }),
    )
    const input = screen.getByLabelText('New lithological model name')
    fireEvent.change(input, { target: { value: '  Quay 7 lithology  ' } })
    // In create mode the CTA is gone; the only such button is submit.
    fireEvent.click(
      screen.getByRole('button', { name: 'Create lithological model' }),
    )
    expect(handleCreateLithoModel).toHaveBeenCalledWith('Quay 7 lithology')
  })

  it('does not submit an empty name', () => {
    render(<ModelKindPicker />)
    fireEvent.click(
      screen.getByRole('button', { name: 'Create lithological model' }),
    )
    const create = screen.getByRole('button', {
      name: 'Create lithological model',
    })
    expect(create).toBeDisabled()
    fireEvent.click(create)
    expect(handleCreateLithoModel).not.toHaveBeenCalled()
  })

  it('delete flow: trash → confirm dialog → handleDeleteLithoModel(active id)', async () => {
    geoModel.models = [model('l1', 'Litho A', 'lithostratigraphic', true)]
    geoModel.activeLithoModel = model('l1', 'Litho A', 'lithostratigraphic', true)
    render(<ModelKindPicker />)
    // No destructive call until the user confirms.
    fireEvent.click(
      screen.getByRole('button', { name: 'Delete lithological model' }),
    )
    expect(handleDeleteLithoModel).not.toHaveBeenCalled()
    expect(
      screen.getByText('Delete lithological model?'),
    ).toBeInTheDocument()
    // Irreversible confirm button reads "Delete permanently" (common.deletePermanently),
    // distinct from the reversible project-local hide "Remove" (owner 2026-09-03).
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }))
    expect(handleDeleteLithoModel).toHaveBeenCalledWith('l1')
  })

  it('delete flow: Cancel does not call the delete handler', () => {
    geoModel.models = [model('l1', 'Litho A', 'lithostratigraphic', true)]
    geoModel.activeLithoModel = model('l1', 'Litho A', 'lithostratigraphic', true)
    render(<ModelKindPicker />)
    fireEvent.click(
      screen.getByRole('button', { name: 'Delete lithological model' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(handleDeleteLithoModel).not.toHaveBeenCalled()
  })

  it('"New" button enters create mode when litho models already exist', () => {
    geoModel.models = [model('l1', 'Litho A', 'lithostratigraphic', true)]
    geoModel.activeLithoModel = model('l1', 'Litho A', 'lithostratigraphic', true)
    render(<ModelKindPicker />)
    fireEvent.click(
      screen.getByRole('button', { name: 'New lithological model' }),
    )
    expect(
      screen.getByLabelText('New lithological model name'),
    ).toBeInTheDocument()
  })

  // Walker finding 2026-10-12: the backend refuses (409) to delete a model
  // that another model refines. The rule, in the ruling's words: when the
  // model to delete has a dependent model, the delete affordance is disabled
  // with an explanation, and the dialog shows the explanation instead of the
  // destructive button. No dependent model: the button stays active.
  const GEOTECH_BLOCK_EN =
    'This model cannot be deleted while another model refines it. Delete the geotechnical model first.'

  it('a litho model with a geotechnical child: the delete button is disabled and explains why', () => {
    const litho = model('l1', 'Litho A', 'lithostratigraphic', true)
    const geotech = { ...model('t1', 'Geotech A', 'geotechnical'), parent_model_id: 'l1' }
    geoModel.models = [model('g1', 'Geo backbone', 'geological', true), litho, geotech]
    geoModel.activeLithoModel = litho
    render(<ModelKindPicker />)
    const trash = screen.getByRole('button', { name: 'Delete lithological model' })
    expect(trash).toBeDisabled()
    expect(trash).toHaveAttribute('title', GEOTECH_BLOCK_EN)
    fireEvent.click(trash)
    expect(screen.queryByRole('button', { name: 'Delete permanently' })).toBeNull()
    expect(handleDeleteLithoModel).not.toHaveBeenCalled()
  })

  it('a geotechnical child of ANOTHER litho model does not block this one', () => {
    const litho = model('l1', 'Litho A', 'lithostratigraphic', true)
    const geotechOfOther = { ...model('t1', 'Geotech B', 'geotechnical'), parent_model_id: 'l2' }
    geoModel.models = [litho, model('l2', 'Litho B', 'lithostratigraphic'), geotechOfOther]
    geoModel.activeLithoModel = litho
    render(<ModelKindPicker />)
    const trash = screen.getByRole('button', { name: 'Delete lithological model' })
    expect(trash).toBeEnabled()
    expect(trash).toHaveAttribute('title', 'Delete the active lithological model')
  })

  it('the dialog, if open when a dependent appears, shows the explanation instead of the destructive button', () => {
    const litho = model('l1', 'Litho A', 'lithostratigraphic', true)
    geoModel.models = [litho]
    geoModel.activeLithoModel = litho
    const { rerender } = render(<ModelKindPicker />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete lithological model' }))
    expect(screen.getByRole('button', { name: 'Delete permanently' })).toBeInTheDocument()
    geoModel.models = [litho, { ...model('t1', 'Geotech A', 'geotechnical'), parent_model_id: 'l1' }]
    rerender(<ModelKindPicker />)
    expect(screen.queryByRole('button', { name: 'Delete permanently' })).toBeNull()
    expect(screen.getByText(GEOTECH_BLOCK_EN)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })
})
