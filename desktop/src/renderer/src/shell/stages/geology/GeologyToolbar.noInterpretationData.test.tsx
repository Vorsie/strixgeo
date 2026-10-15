// Walker finding 2026-10-15 (seed 2319386379, steps 704 and 854): "Fill from
// boreholes" on a project whose boreholes carry no interpretation data showed
// its explanation as a red, sticky ERROR toast. Nothing failed: the scan ran,
// found no stratigraphy, and the message names the other path. The rule, in
// the ruling's words:
//
//   N1  an empty discovery is an expected, explained state: the explanation is
//       a WARNING toast, never an error, and no selection dialog opens

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellContext } from '../../ShellContext'
import type { ShellContextValue } from '../../ShellContext'
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

const NO_INTERPRETATION_EN =
  'No borehole carries interpretation data. Add formations manually in the inspector instead.'

function makeCtx(
  toast: (type: 'success' | 'error' | 'warning', message: string) => void,
): ShellContextValue {
  const base = makeShellCtx('geological')
  return {
    ...base,
    toasts: { ...base.toasts, toast },
    // One visible borehole enables the Fill verb.
    visibleBoreholes: [{ id: 'bh-1', name: 'BH-1' } as never],
    geoModel: {
      ...base.geoModel,
      // The scan finds no stratigraphy on any borehole.
      discoverBoreholeFormations: async () => ({ candidates: [], collisions: [] }),
    },
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Geology toolbar: Fill from boreholes with no interpretation data', () => {
  it('N1: the explanation is a warning toast, not an error, and no dialog opens', async () => {
    const toast = vi.fn()
    render(
      <ShellContext.Provider value={makeCtx(toast)}>
        <GeologyToolbar />
      </ShellContext.Provider>,
    )
    fireEvent.click(screen.getByTestId('geology-fill-from-boreholes-button'))
    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith('warning', NO_INTERPRETATION_EN))
    expect(toast).not.toHaveBeenCalledWith('error', expect.anything())
    expect(screen.queryByRole('button', { name: 'Apply selection' })).toBeNull()
  })
})
