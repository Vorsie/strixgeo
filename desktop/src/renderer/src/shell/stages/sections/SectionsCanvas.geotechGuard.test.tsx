// Guard rejection UX — handleCreateGeotechPackingCorrelation
//
// When the backend rejects a packing-correlation POST with a 422
// (CrossLithoBodyCorrelationError), the handler MUST:
//   GG1 — surface the server's own detail string via toast('error', <message>),
//         not a hardcoded fallback.
//   GG2 — NOT add an optimistic edge (the edge list stays unchanged).
//
// TDD: tests written first against the CURRENT hardcoded-fallback implementation
// so they fail red, then the implementation is changed to turn them green.

import { render, cleanup, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShellContext } from '../../ShellContext'
import type { ShellContextValue } from '../../ShellContext'
import SectionsCanvas from './SectionsCanvas'
import type { FormationContactResponse } from '../../../api/client'
import type { ContactGestureState } from '../../../components/sections/CorrelationEdgesOverlay'
import { makeShellCtx } from './__fixtures__/sectionsShellContext'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

/** Captures the contactGestureState prop on each render. */
let capturedContactGestureState: ContactGestureState | undefined = undefined

vi.mock('../../../components/SectionPanel', () => ({
  default: (props: {
    contactGestureState?: ContactGestureState
    contacts?: readonly FormationContactResponse[]
    axisMode?: string
    [key: string]: unknown
  }) => {
    capturedContactGestureState = props.contactGestureState
    return null
  },
}))

vi.mock('../../../components/MapView', () => ({
  default: () => null,
}))

/** Mutable: tests override per-case. */
const mockCreateContactCorrelation = vi.fn().mockResolvedValue(undefined)

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client')
  return {
    ...actual,
    setBaseUrl: vi.fn(),
    api: {
      geology: {
        validateCrossings: vi.fn().mockResolvedValue({ model_id: '', issues: [] }),
        createContactCorrelation: (...args: unknown[]) =>
          mockCreateContactCorrelation(...args),
        deleteContactCorrelation: vi.fn().mockResolvedValue(undefined),
        listContactCorrelations: vi.fn().mockResolvedValue([]),
        listGeotechPackingCorrelations: vi.fn().mockResolvedValue([]),
      },
      virtueleBoring: {
        getModels: vi.fn().mockResolvedValue([]),
      },
      section: {
        list: vi.fn().mockResolvedValue([]),
        get: vi.fn(),
      },
    },
  }
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handleCreateGeotechPackingCorrelation — guard rejection UX', () => {
  beforeEach(() => {
    capturedContactGestureState = undefined
    mockCreateContactCorrelation.mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  it('GG0 — activeGeotechModel null → correlate gesture is a silent no-op (no API call, no toast)', async () => {
    // The geotech axis is still selected so contactGestureState exists and
    // onContactCorrelate is wired to handleCreateGeotechPackingCorrelation.
    // The handler guards `if (!activeGeotechModel) { log.warn; return }` —
    // no API call, no toast: the user must run "Subdivide all bodies" first.
    const baseCtx = makeShellCtx('geotechnical')
    const ctx: ShellContextValue = {
      ...baseCtx,
      geoModel: { ...baseCtx.geoModel, activeGeotechModel: null },
    }

    render(
      <ShellContext.Provider value={ctx}>
        <SectionsCanvas />
      </ShellContext.Provider>,
    )

    expect(capturedContactGestureState?.onContactCorrelate).toBeDefined()

    await act(async () => {
      await capturedContactGestureState!.onContactCorrelate!('contact-a', 'contact-b', 'top', 'top')
    })

    // GG0a: no API call — the guard returned before reaching the endpoint.
    expect(mockCreateContactCorrelation).not.toHaveBeenCalled()

    // GG0b: the guard is truly silent (log.warn only) — no correlation toast.
    // Scoped to correlation toasts rather than "no toast at all": the fixture
    // section is a synthetic (0,0)→(100,0) line in EPSG:31370, which the
    // coordinate-plausibility guard rightly flags on mount. That toast is a
    // different subject and its own tests cover it.
    expect(ctx.toasts.toast).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('correlation'),
    )
    expect(ctx.toasts.toast).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('packing'),
    )
  })

  it('GG1 — 422 cross-body error surfaces the server message verbatim, not a generic fallback', async () => {
    // The server sends the CrossLithoBodyCorrelationError detail string.
    // post() throws: new Error(detail.detail) — so err.message IS the server string.
    const serverMessage =
      'these bands are in different litho bodies — correlate the lithology first in the litho stage'
    mockCreateContactCorrelation.mockRejectedValueOnce(new Error(serverMessage))

    const ctx = makeShellCtx('geotechnical')

    render(
      <ShellContext.Provider value={ctx}>
        <SectionsCanvas />
      </ShellContext.Provider>,
    )

    // contactGestureState.onContactCorrelate is wired on the geotech axis.
    expect(capturedContactGestureState?.onContactCorrelate).toBeDefined()

    await act(async () => {
      await capturedContactGestureState!.onContactCorrelate!('contact-a', 'contact-b', 'top', 'top')
    })

    // GG1: toast fires with the exact server message, NOT a generic string.
    expect(ctx.toasts.toast).toHaveBeenCalledWith('error', serverMessage)
    expect(ctx.toasts.toast).not.toHaveBeenCalledWith(
      'error',
      'Could not create the packing correlation — try again.',
    )
  })

  it('GG2 — 422 does NOT add an optimistic edge (no success toast fired)', async () => {
    const serverMessage =
      'these bands are in different litho bodies — correlate the lithology first in the litho stage'
    mockCreateContactCorrelation.mockRejectedValueOnce(new Error(serverMessage))

    const ctx = makeShellCtx('geotechnical')

    render(
      <ShellContext.Provider value={ctx}>
        <SectionsCanvas />
      </ShellContext.Provider>,
    )

    await act(async () => {
      await capturedContactGestureState!.onContactCorrelate!('contact-a', 'contact-b', 'top', 'top')
    })

    // GG2: no success toast — the edge was NOT optimistically added.
    expect(ctx.toasts.toast).not.toHaveBeenCalledWith('success', expect.any(String))
    // Exactly one ERROR toast, and it is the server's. (Counting ALL toasts
    // would also catch the coordinate-plausibility toast the synthetic
    // (0,0)→(100,0) fixture section legitimately raises on mount.)
    const errorToasts = vi
      .mocked(ctx.toasts.toast)
      .mock.calls.filter(([type]) => type === 'error')
    expect(errorToasts).toEqual([['error', serverMessage]])
  })
})
