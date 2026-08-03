/**
 * SectionsCanvas.staleEdges.test.tsx — a slow section's correlation ties must never
 * land on the section the engineer has since opened.
 *
 * Owner's rule: "the ribbons I see on a section are the ties I drew ON that section."
 * Sections share investigations, so section A's ties reference layer ids that also
 * appear in section B's columns — a late A response does not look wrong to the
 * partition, it silently paints A's bands and lenses onto B.
 *
 * SectionPanel is mocked so the test can read the ``contactEdges`` prop it receives.
 * MapView is mocked because Leaflet needs a real DOM.
 */

import { render, cleanup, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShellContext } from '../../ShellContext'
import type { ShellContextValue } from '../../ShellContext'
import SectionsCanvas from './SectionsCanvas'
import { makeBorehole, makeLithoModel, makeSection, makeStubContext } from './__fixtures__/shellStub'
import { useSectionScope } from '../../../components/sections/SectionScopeContext'

// --- captured scope --------------------------------------------------------
//
// The edges reach the overlays through SectionScopeContext, so the SectionPanel
// stand-in reads them from the scope the canvas publishes.

let capturedContactEdges: readonly { id: string }[] | undefined

vi.mock('../../../components/SectionPanel', () => ({
  default: (): null => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    capturedContactEdges = useSectionScope().contactEdges as
      | readonly { id: string }[]
      | undefined
    return null
  },
}))

vi.mock('../../../components/MapView', () => ({ default: () => null }))

// One deferred promise per section id — the test decides when each resolves.
const pending = new Map<
  string,
  { resolve: (rows: unknown[]) => void; reject: (err: unknown) => void }
>()
const listContactCorrelations = vi.fn(
  (_projectId: string, _modelId: string, sectionId?: string | null) =>
    new Promise<unknown[]>((resolve, reject) => {
      pending.set(sectionId ?? '', { resolve, reject })
    }),
)

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client')
  return {
    ...actual,
    setBaseUrl: vi.fn(),
    api: {
      geology: {
        validateCrossings: vi.fn().mockResolvedValue({ model_id: '', issues: [] }),
        acceptLithoSuggestions: vi.fn(),
        createContactCorrelation: vi.fn().mockResolvedValue(undefined),
        deleteContactCorrelation: vi.fn().mockResolvedValue(undefined),
        listContactCorrelations: (...args: [string, string, (string | null)?]) =>
          listContactCorrelations(...args),
      },
      virtueleBoring: { getModels: vi.fn().mockResolvedValue([]) },
      section: { list: vi.fn().mockResolvedValue([]), get: vi.fn() },
    },
  }
})

// --- helpers ---------------------------------------------------------------

const SECTION_A = makeSection({ id: 'sec-A', name: 'Cross-section A' })
const SECTION_B = makeSection({ id: 'sec-B', name: 'Cross-section B' })

/** A litho-axis context whose selected section is ``sectionId``. */
function lithoCtx(sectionId: string): ShellContextValue {
  const ctx = makeStubContext({
    section: sectionId === 'sec-A' ? SECTION_A : SECTION_B,
    lithoModel: makeLithoModel(),
    sectionModelAxis: 'lithostratigraphic',
    visibleBoreholes: [makeBorehole('bh-1', 50, 0)],
  })
  return {
    ...ctx,
    sections: {
      ...ctx.sections,
      sections: [SECTION_A, SECTION_B],
      visibleSections: [SECTION_A, SECTION_B],
      selectedSectionId: sectionId,
    },
  }
}

/** A correlation-edge row, shaped as the API returns it. */
function edge(id: string): Record<string, unknown> {
  return {
    id,
    model_id: 'litho-model-1',
    section_id: 'sec-A',
    layer_a_id: 'la',
    layer_b_id: 'lb',
    layer_a_side: 'top',
    layer_b_side: 'top',
    status: 'approved',
    source: 'manual',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

beforeEach(() => {
  capturedContactEdges = undefined
  pending.clear()
  listContactCorrelations.mockClear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('correlation ties are scoped to the section on screen', () => {
  it("a slow section's ties do not land on the section opened after it", async () => {
    const { rerender } = render(
      <ShellContext.Provider value={lithoCtx('sec-A')}>
        <SectionsCanvas />
      </ShellContext.Provider>,
    )
    expect(pending.has('sec-A')).toBe(true)

    // The engineer switches to section B before A's fetch comes back.
    rerender(
      <ShellContext.Provider value={lithoCtx('sec-B')}>
        <SectionsCanvas />
      </ShellContext.Provider>,
    )
    // B answers first — empty, nothing tied on B yet.
    await act(async () => {
      pending.get('sec-B')?.resolve([])
    })
    expect(capturedContactEdges).toEqual([])

    // A's response finally arrives, carrying ties drawn on A.
    await act(async () => {
      pending.get('sec-A')?.resolve([edge('edge-on-A')])
    })
    expect(capturedContactEdges).toEqual([])
  })

  it("the section just opened shows nothing while its own ties are still loading", async () => {
    // The residual the late-response guard does not cover: between the switch and
    // the new section's response there is a window — seconds while a build is
    // running — in which the previous section's ribbons are still in state. Blank
    // is the honest answer for a section whose ties nobody has read yet.
    const { rerender } = render(
      <ShellContext.Provider value={lithoCtx('sec-A')}>
        <SectionsCanvas />
      </ShellContext.Provider>,
    )
    await act(async () => {
      pending.get('sec-A')?.resolve([edge('edge-on-A')])
    })
    expect(capturedContactEdges).toHaveLength(1)

    // Switch to B; B's fetch is dispatched but has NOT come back.
    await act(async () => {
      rerender(
        <ShellContext.Provider value={lithoCtx('sec-B')}>
          <SectionsCanvas />
        </ShellContext.Provider>,
      )
    })
    expect(pending.has('sec-B')).toBe(true)

    expect(capturedContactEdges).toEqual([])
  })

  it("a failed fetch for the newly-opened section clears the previous section's ties", async () => {
    const { rerender } = render(
      <ShellContext.Provider value={lithoCtx('sec-A')}>
        <SectionsCanvas />
      </ShellContext.Provider>,
    )
    await act(async () => {
      pending.get('sec-A')?.resolve([edge('edge-on-A')])
    })
    expect(capturedContactEdges).toHaveLength(1)

    rerender(
      <ShellContext.Provider value={lithoCtx('sec-B')}>
        <SectionsCanvas />
      </ShellContext.Provider>,
    )
    await act(async () => {
      pending.get('sec-B')?.reject(new Error('backend down'))
    })
    // B could not be validated, so it must show NOTHING — never A's ribbons.
    expect(capturedContactEdges).toEqual([])
  })
})
