// The one deliberate exception to the geotech axis being view-only for contacts.
//
// A lithostratigraphic contact may be dragged from the geotech axis (owner ruling
// 2026-08-08): on finely interbedded ground the boundary the engineer wants to move IS the
// contact, and the cone resistance resolved it better than the driller's 0.5 m log grid
// did. What makes it an exception rather than a hole in the hierarchy is where the write
// lands — on the LITHO row the boundary restates, not on the geotech band that was
// grabbed, which the next "Subdivide all bodies" would discard without a word.
//
// These cases pin the SEAM: that SectionsCanvas actually applies the plan on the way to
// the PATCH. The rules themselves are pinned in geotechContactDrag.rules.test.ts; a green
// pure function nothing calls is exactly the failure this suite exists to catch.
//
// Pinned claims:
//   CD1  A drag past several packing boundaries PATCHes the litho row at the first one.
//   CD2  A drag that crosses no boundary writes nothing at all.
//   CD3  An internal packing boundary writes nothing — the hierarchy rule stands.
//   CD4  The litho axis is untouched: the depth it commits is the depth it was given.

import { render, cleanup, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FormationContactResponse, LithoLayerResponse } from '../../../api/client'
import { ShellContext } from '../../ShellContext'
import type { ShellContextValue } from '../../ShellContext'
import SectionsCanvas from './SectionsCanvas'
import { makeShellCtx } from './__fixtures__/sectionsShellContext'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

/** Updated on every SectionPanel render — the handler the drag commit would call. */
let capturedOnUpdateContactDepth:
  | ((id: string, depth: number, snapped: boolean, field?: 'top' | 'base') => Promise<void>)
  | undefined = undefined

vi.mock('../../../components/SectionPanel', () => ({
  default: (props: {
    onUpdateContactDepth?: (
      id: string,
      depth: number,
      snapped: boolean,
      field?: 'top' | 'base',
    ) => Promise<void>
    [key: string]: unknown
  }) => {
    capturedOnUpdateContactDepth = props.onUpdateContactDepth
    return null
  },
}))

vi.mock('../../../components/MapView', () => ({ default: () => null }))

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client')
  return {
    ...actual,
    setBaseUrl: vi.fn(),
    api: {
      geology: {
        validateCrossings: vi.fn().mockResolvedValue({ model_id: '', issues: [] }),
        createContactCorrelation: vi.fn().mockResolvedValue(undefined),
        deleteContactCorrelation: vi.fn().mockResolvedValue(undefined),
        listContactCorrelations: vi.fn().mockResolvedValue([]),
        listGeotechPackingCorrelations: vi.fn().mockResolvedValue([]),
        rebuildSurfaces: vi.fn().mockResolvedValue(undefined),
      },
      virtueleBoring: { getModels: vi.fn().mockResolvedValue([]) },
      section: { list: vi.fn().mockResolvedValue([]), get: vi.fn() },
    },
  }
})

// ---------------------------------------------------------------------------
// Fixtures — one CPT column:
//   litho:    KLEI 0 ..... 4        ZAND 4 ......... 10
//   packing:  g1 0-2 | g2 2-4     | g3 4-7 | g4 7-10
// so the boundary at 4 m restates the KLEI/ZAND contact, and 2 m and 7 m are the
// owner's own packing subdivision.
// ---------------------------------------------------------------------------

/**
 * One layer row on the CPT column.
 *
 * @param id Layer id.
 * @param top Depth of the top, in metres below the collar.
 * @param base Depth of the base, in metres below the collar.
 */
function layer(id: string, top: number, base: number): LithoLayerResponse {
  return {
    id,
    model_id: 'm',
    formation_id: `f-${id}`,
    cpt_id: 'cpt-1',
    borehole_id: null,
    depth_top_m: top,
    depth_base_m: base,
    status: 'accepted',
    source: 'manual',
    confidence: 'high',
    observation_id: null,
    observation_layer_id: null,
    parent_geo_contact_id: null,
    body_id: `body-${id}`,
    notes: null,
    created_at: '2026-08-08T00:00:00Z',
    updated_at: '2026-08-08T00:00:00Z',
  } as LithoLayerResponse
}

/** The litho contact the 4 m boundary restates — a hair off, as the real rows are. */
const LITHO_CONTACT = {
  id: 'L-zand',
  model_id: 'litho-model-1',
  formation_id: 'f-zand',
  cpt_id: 'cpt-1',
  borehole_id: null,
  depth_top_m: 4.0000123,
  source: 'manual_pick',
  confidence: 'medium',
  observation_id: null,
  observation_layer_id: null,
  notes: null,
  synthetic_x: null,
  synthetic_y: null,
  synthetic_elevation_m: null,
  created_at: '2026-08-08T00:00:00Z',
  updated_at: '2026-08-08T00:00:00Z',
} as FormationContactResponse

/**
 * A shell context on one axis, wired with the fixture column and a spy PATCH.
 *
 * @param axis Which model axis the section is on.
 * @param patch The spy standing in for the contact-depth PATCH.
 */
function ctxFor(
  axis: 'geotechnical' | 'lithostratigraphic',
  patch: ReturnType<typeof vi.fn>,
): ShellContextValue {
  const ctx = makeShellCtx(axis)
  ctx.geoModel.geotechLayers = [
    layer('g1', 0, 2),
    layer('g2', 2, 4),
    layer('g3', 4, 7),
    layer('g4', 7, 10),
  ]
  ctx.geoModel.lithoLayers = [layer('L-klei', 0, 4), layer('L-zand', 4, 10)]
  ctx.geoModel.lithoContacts = [LITHO_CONTACT]
  ctx.geoModel.handleUpdateContactDepth = patch as unknown as ShellContextValue['geoModel']['handleUpdateContactDepth']
  return ctx
}

/**
 * Render the canvas and fire one drag commit through the captured handler.
 *
 * @param axis Which model axis the section is on.
 * @param contactId The contact the drag grabbed.
 * @param toDepthM Where the drag released, in metres below the collar.
 * @returns The PATCH spy, for assertions on what (if anything) it received.
 */
async function commitDrag(
  axis: 'geotechnical' | 'lithostratigraphic',
  contactId: string,
  toDepthM: number,
): Promise<ReturnType<typeof vi.fn>> {
  const patch = vi.fn().mockResolvedValue(undefined)
  render(
    <ShellContext.Provider value={ctxFor(axis, patch)}>
      <SectionsCanvas />
    </ShellContext.Provider>,
  )
  expect(capturedOnUpdateContactDepth).toBeDefined()
  await act(async () => {
    await capturedOnUpdateContactDepth!(contactId, toDepthM, false, 'top')
  })
  return patch
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SectionsCanvas — dragging a litho contact from the geotech axis', () => {
  beforeEach(() => {
    capturedOnUpdateContactDepth = undefined
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('CD1 — a long drag moves the litho row to the FIRST boundary crossed', async () => {
    // Released at 8.5 m, past the packing boundary at 7 m. One drag consumes one
    // boundary, and the row that moves is the litho contact, not the geotech band.
    const patch = await commitDrag('geotechnical', 'g3', 8.5)

    expect(patch).toHaveBeenCalledTimes(1)
    expect(patch).toHaveBeenCalledWith('L-zand', 7, false, 'top')
  })

  it('CD2 — a drag that crosses no boundary writes nothing', async () => {
    const patch = await commitDrag('geotechnical', 'g3', 4.4)

    expect(patch).not.toHaveBeenCalled()
  })

  it('CD3 — an internal packing boundary writes nothing', async () => {
    // g1 and g2 both sit in the KLEI body, so the 2 m boundary is packing, not a
    // contact: a packing boundary never crosses a litho contact and this drag is not
    // the verb that moves it.
    const patch = await commitDrag('geotechnical', 'g2', 3.5)

    expect(patch).not.toHaveBeenCalled()
  })

  it('CD4 — the litho axis commits the depth it was given, unclamped', async () => {
    // The control: without it, deleting the whole contact drag would pass CD2 and CD3.
    const patch = await commitDrag('lithostratigraphic', 'L-zand', 4.4)

    expect(patch).toHaveBeenCalledWith('L-zand', 4.4, false, 'top')
  })
})
