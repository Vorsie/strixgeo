// Ground-surface refresh pin (owner walk of installer #20/#21, 2026-09-06).
//
// Owner's words: "after I change a bed polygon the 3D ground surface shows the
// new bed without reopening the project". The shared 3-D fetch keys the ground
// surface on the bed-override refresh nonce carried on the shell bus, so a bed
// change re-fires ``buildGroundSurface`` while the stage stays mounted. A
// re-render that does NOT change the nonce keeps the cached request (no refetch
// on unrelated bus churn).

import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'

import { api } from '../../../api/client'
import { ShellContext } from '../../ShellContext'
import type { ShellContextValue } from '../../ShellContext'
import { useBody3DViewState } from './useBody3DViewState'

const STABLE_TOAST = vi.fn()

/** Minimal shell bus carrying only the fields ``useBody3DViewState`` reads. */
function makeShell(groundRefreshNonce: number): ShellContextValue {
  return {
    project: { id: 'proj-1' },
    visibleCpts: [],
    visibleBoreholes: [],
    sections: { visibleSections: [] },
    toasts: { toast: STABLE_TOAST },
    bedOverrides: { groundRefreshNonce },
  } as unknown as ShellContextValue
}

describe('useBody3DViewState — the 3-D ground surface refetches after a bed change', () => {
  let buildGroundSurface: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    buildGroundSurface = vi
      .spyOn(api.geology, 'buildGroundSurface')
      .mockResolvedValue({ vertices: [], triangles: [] } as never)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function renderWithNonce(getNonce: () => number) {
    const resetRef = { current: null } as React.MutableRefObject<(() => void) | null>
    function wrapper({ children }: { children: React.ReactNode }): JSX.Element {
      return <ShellContext.Provider value={makeShell(getNonce())}>{children}</ShellContext.Provider>
    }
    return renderHook(
      () =>
        useBody3DViewState({
          modelId: 'm1',
          resetSplitViewportRef: resetRef,
          fenceActive: false,
          footprintActive: false,
        }),
      { wrapper },
    )
  }

  it('GR1 — bumping the bed-override nonce re-fires buildGroundSurface without a model switch', async () => {
    let nonce = 0
    const { rerender } = renderWithNonce(() => nonce)

    await waitFor(() => expect(buildGroundSurface).toHaveBeenCalledTimes(1))

    // A bed polygon was added / edited / deleted -> the shell bus nonce bumps.
    nonce = 1
    rerender()

    await waitFor(() => expect(buildGroundSurface).toHaveBeenCalledTimes(2))
  })

  it('GR2 — a re-render that does not change the nonce keeps the cached request', async () => {
    const nonce = 0
    const { rerender } = renderWithNonce(() => nonce)

    await waitFor(() => expect(buildGroundSurface).toHaveBeenCalledTimes(1))

    // Unrelated bus churn (a new render) must not re-fetch the terrain mesh.
    rerender()
    rerender()

    await new Promise(r => setTimeout(r, 0))
    expect(buildGroundSurface).toHaveBeenCalledTimes(1)
  })
})
