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
    parent_geological_model_id: kind === 'geological' ? null : 'g1',
    created_at: '',
    updated_at: '',
  }
}

beforeEach(() => {
  handleCreateLithoModel.mockReset().mockResolvedValue(model('l9', 'New', 'lithostratigraphic'))
  handleActivateLithoModel.mockReset().mockResolvedValue(undefined)
  geoModel = {
    activeGeologicalModel: model('g1', 'Geo backbone', 'geological', true),
    models: [],
    activeLithoModel: null,
    handleCreateLithoModel,
    handleActivateLithoModel,
  }
})

describe('ModelKindPicker (#55)', () => {
  it('renders nothing without a geological backbone', () => {
    geoModel.activeGeologicalModel = null
    render(<ModelKindPicker />)
    expect(screen.queryByTestId('model-kind-picker')).toBeNull()
  })

  it('shows "none yet" + New when no litho model exists', () => {
    render(<ModelKindPicker />)
    expect(screen.getByTestId('model-kind-picker')).toBeInTheDocument()
    expect(screen.getByText('none yet')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'New lithostratigraphic model' }),
    ).toBeInTheDocument()
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
      name: 'Active lithostratigraphic model',
    })
    expect((select as HTMLSelectElement).value).toBe('l1')
    fireEvent.change(select, { target: { value: 'l2' } })
    expect(handleActivateLithoModel).toHaveBeenCalledWith('l2')
  })

  it('inline create flow calls handleCreateLithoModel with the typed name', async () => {
    render(<ModelKindPicker />)
    fireEvent.click(
      screen.getByRole('button', { name: 'New lithostratigraphic model' }),
    )
    const input = screen.getByLabelText('New lithostratigraphic model name')
    fireEvent.change(input, { target: { value: '  Quay 7 lithology  ' } })
    fireEvent.click(
      screen.getByRole('button', { name: 'Create lithostratigraphic model' }),
    )
    expect(handleCreateLithoModel).toHaveBeenCalledWith('Quay 7 lithology')
  })

  it('does not submit an empty name', () => {
    render(<ModelKindPicker />)
    fireEvent.click(
      screen.getByRole('button', { name: 'New lithostratigraphic model' }),
    )
    const create = screen.getByRole('button', {
      name: 'Create lithostratigraphic model',
    })
    expect(create).toBeDisabled()
    fireEvent.click(create)
    expect(handleCreateLithoModel).not.toHaveBeenCalled()
  })
})
