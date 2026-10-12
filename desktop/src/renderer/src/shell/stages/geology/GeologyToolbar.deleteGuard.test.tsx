// Walker finding 2026-10-12: the backend refuses (409) to delete a model that
// another model refines. The same gap exists one level up: a geological model
// with a lithostratigraphic child. The rule, in the ruling's words:
//
//   G1  a model with a dependent model: the delete affordance is disabled and
//       its hint explains why (no dialog, no request)
//   G2  no dependent model: the delete button stays active
//   G3  the 409 safety net renders the same sentence as an ordinary
//       (warning) toast, never the raw server text as an error

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellContext } from '../../ShellContext'
import type { ShellContextValue } from '../../ShellContext'
import type { GeologicalModelResponse } from '../../../api/client'
import { ApiError } from '../../../api/clients/shared'
import { makeShellCtx } from '../sections/__fixtures__/sectionsShellContext'
import GeologyToolbar from './GeologyToolbar'

vi.mock('../../../api/client', async () => {
  const actual =
    await vi.importActual<typeof import('../../../api/client')>('../../../api/client')
  return {
    ...actual,
    setBaseUrl: vi.fn(),
    api: {
      geology: {
        validateCrossings: vi.fn().mockResolvedValue({ model_id: '', issues: [] }),
      },
    },
  }
})

const LITHO_BLOCK_EN =
  'This model cannot be deleted while another model refines it. Delete the lithological model first.'

function makeModel(
  id: string,
  kind: GeologicalModelResponse['kind'],
  parent: string | null,
): GeologicalModelResponse {
  return {
    id,
    app_project_id: 'proj-1',
    name: id,
    description: null,
    is_active: true,
    excluded_borehole_ids: [],
    kind,
    parent_model_id: parent,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

function makeCtx(
  models: GeologicalModelResponse[],
  handleDeleteModel: () => Promise<void>,
  toast: (type: 'success' | 'error' | 'warning', message: string) => void,
): ShellContextValue {
  const base = makeShellCtx('geological')
  return {
    ...base,
    toasts: { ...base.toasts, toast },
    geoModel: {
      ...base.geoModel,
      activeGeologicalModel: makeModel('geo-1', 'geological', null),
      models,
      handleDeleteModel,
    },
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Geology toolbar: delete guard for a refined model', () => {
  it('G1: a geological model with a litho child: delete disabled, hint explains why', () => {
    const del = vi.fn().mockResolvedValue(undefined)
    const toast = vi.fn()
    render(
      <ShellContext.Provider
        value={makeCtx(
          [makeModel('geo-1', 'geological', null), makeModel('lit-1', 'lithostratigraphic', 'geo-1')],
          del,
          toast,
        )}
      >
        <GeologyToolbar />
      </ShellContext.Provider>,
    )
    const button = screen.getByTestId('geology-delete-stratigraphy')
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', LITHO_BLOCK_EN)
    fireEvent.click(button)
    expect(del).not.toHaveBeenCalled()
  })

  it('G2: no dependent model: delete stays active', () => {
    render(
      <ShellContext.Provider
        value={makeCtx([makeModel('geo-1', 'geological', null)], vi.fn(), vi.fn())}
      >
        <GeologyToolbar />
      </ShellContext.Provider>,
    )
    expect(screen.getByTestId('geology-delete-stratigraphy')).toBeEnabled()
  })

  it('G3: a 409 safety-net refusal toasts the explanation as a warning', async () => {
    // The local list does not know the child yet (another window, a stale
    // list): the button is active, the backend refuses.
    const del = vi.fn().mockRejectedValue(
      new ApiError('server text', 409, {
        detail: 'This model cannot be deleted while another model refines it.',
        method: 'DELETE',
        path: '/projects/proj-1/geology/models/geo-1',
      }),
    )
    const toast = vi.fn()
    render(
      <ShellContext.Provider
        value={makeCtx([makeModel('geo-1', 'geological', null)], del, toast)}
      >
        <GeologyToolbar />
      </ShellContext.Provider>,
    )
    fireEvent.click(screen.getByTestId('geology-delete-stratigraphy'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete stratigraphic model' }))
    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith('warning', LITHO_BLOCK_EN))
    expect(toast).not.toHaveBeenCalledWith('error', expect.anything())
  })
})
