// A litho contact dragged from the geotech axis may also be a GEOLOGICAL contact.
//
// 136 of the owner's 418 litho layers carry a parent_geo_contact_id — roughly one drag in
// three lands on a coupled contact — so moving the litho row alone would silently walk it
// away from the geological surface it restates. The litho axis has answered this since
// debt #134 with a three-option prompt (snap the litho contact to the geo depth, move the
// geological contact down with its surface rebuild, or keep them separate), and the owner's
// ruling for the geotech axis was "same mental model": the same prompt, not a second
// mechanism that decides for him.
//
// Pinned claims:
//   GS1  A coupled drag on the geotech axis opens the prompt.
//   GS2  An uncoupled drag on the geotech axis does not.
//   GS3  The litho axis still opens it — the control that proves the gate did not simply
//        move rather than widen.
//   GS4  Choosing "snap litho to geological" from the geotech axis writes the geo depth
//        onto the litho row.
//   GS5  A refused drag opens nothing: it wrote nothing, so there is nothing to reconcile.
//   GS6  Choosing "move geological to litho" moves the GEO row to where the litho contact
//        landed, and rebuilds the surfaces that hang off it.
//   GS7  Cancelling writes nothing — "keep them separate" has to mean it.
//
// GS6 and GS7 are characterisation tests, not TDD: the three option handlers never carried
// an axis guard, so they worked the moment the prompt could open at all. They are here
// because the prompt opening is now the only thing standing between this axis and a
// surface-rebuild cascade, and an untested cascade is one that can rot quietly.

import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '../../../api/client'
import type { FormationContactResponse, LithoLayerResponse } from '../../../api/client'
import { ShellContext } from '../../ShellContext'
import type { ShellContextValue } from '../../ShellContext'
import SectionsCanvas from './SectionsCanvas'
import { makeLithoLayer } from './__fixtures__/lithoLayer'
import { makeShellCtx } from './__fixtures__/sectionsShellContext'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

/** Updated on every SectionPanel render — the handler a drag commit calls. */
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
// A drag of the 4 m boundary released at 8.5 m consumes the packing boundary at 7 m, so
// the litho contact commits at 7.00 — where a geological contact at 7.05 is one twentieth
// of a metre away, well inside the 0.20 m default snap tolerance.
// ---------------------------------------------------------------------------

/**
 * One layer row on the CPT column.
 *
 * @param id Layer id.
 * @param top Depth of the top, in metres below the collar.
 * @param base Depth of the base, in metres below the collar.
 */
function layer(id: string, top: number, base: number): LithoLayerResponse {
  return makeLithoLayer({ id, depth_top_m: top, depth_base_m: base })
}

/**
 * A contact on the fixture CPT column.
 *
 * @param id Contact id.
 * @param modelId Owning model — litho rows and geological rows live in different models.
 * @param depthTopM Depth of the contact, in metres below the collar.
 */
function contact(id: string, modelId: string, depthTopM: number): FormationContactResponse {
  return {
    id,
    model_id: modelId,
    formation_id: `f-${id}`,
    cpt_id: 'cpt-1',
    borehole_id: null,
    depth_top_m: depthTopM,
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
}

/** The litho contact the 4 m packing boundary restates — a hair off, as the real rows are. */
const LITHO_CONTACT = contact('L-zand', 'litho-model-1', 4.0000123)

/**
 * Render the canvas on one axis and fire one drag commit through the captured handler.
 *
 * @param axis Which model axis the section is on.
 * @param contactId The contact the drag grabbed.
 * @param toDepthM Where the drag released, in metres below the collar.
 * @param geoContacts Geological contacts in scope — the snap-candidate search space.
 * @returns The PATCH spy, for assertions on what (if anything) it received.
 */
async function commitDrag(
  axis: 'geotechnical' | 'lithostratigraphic',
  contactId: string,
  toDepthM: number,
  geoContacts: FormationContactResponse[],
): Promise<{ patch: ReturnType<typeof vi.fn>; ctx: ShellContextValue }> {
  const patch = vi.fn().mockResolvedValue(undefined)
  const ctx = makeShellCtx(axis)
  ctx.geoModel.geotechLayers = [
    layer('g1', 0, 2),
    layer('g2', 2, 4),
    layer('g3', 4, 7),
    layer('g4', 7, 10),
  ]
  ctx.geoModel.lithoLayers = [layer('L-klei', 0, 4), layer('L-zand', 4, 10)]
  ctx.geoModel.lithoContacts = [LITHO_CONTACT]
  ctx.geoModel.contacts = geoContacts
  ctx.geoModel.handleUpdateContactDepth =
    patch as unknown as ShellContextValue['geoModel']['handleUpdateContactDepth']

  render(
    <ShellContext.Provider value={ctx}>
      <SectionsCanvas />
    </ShellContext.Provider>,
  )
  expect(capturedOnUpdateContactDepth).toBeDefined()
  await act(async () => {
    await capturedOnUpdateContactDepth!(contactId, toDepthM, false, 'top')
  })
  return { patch, ctx }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SectionsCanvas — a coupled contact dragged from the geotech axis', () => {
  beforeEach(() => {
    capturedOnUpdateContactDepth = undefined
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('GS1 — landing within tolerance of a geological contact opens the prompt', async () => {
    await commitDrag('geotechnical', 'g3', 8.5, [contact('GEO-1', 'geo-model-1', 7.05)])

    expect(screen.getByTestId('litho-geo-snap-dialog')).toBeTruthy()
    // The one candidate is named by depth, so the engineer can see which surface he is
    // about to move before he picks a direction.
    expect(screen.getByText(/7\.05 m/)).toBeTruthy()
  })

  it('GS2 — landing nowhere near one opens nothing', async () => {
    // 7.50 m is 0.50 m from the committed 7.00 m — outside the 0.20 m default tolerance.
    const { patch } = await commitDrag('geotechnical', 'g3', 8.5, [
      contact('GEO-1', 'geo-model-1', 7.5),
    ])

    expect(patch).toHaveBeenCalledWith('L-zand', 7, false, 'top')
    expect(screen.queryByTestId('litho-geo-snap-dialog')).toBeNull()
  })

  it('GS3 — the litho axis still opens it, unchanged', async () => {
    // The control. Without it, moving the gate to the geotech axis rather than widening
    // it to both would pass GS1 and GS2.
    await commitDrag('lithostratigraphic', 'L-zand', 7, [contact('GEO-1', 'geo-model-1', 7.05)])

    expect(screen.getByTestId('litho-geo-snap-dialog')).toBeTruthy()
  })

  it('GS4 — "snap litho to geological" writes the geo depth onto the litho row', async () => {
    const { patch } = await commitDrag('geotechnical', 'g3', 8.5, [
      contact('GEO-1', 'geo-model-1', 7.05),
    ])
    patch.mockClear()

    await act(async () => {
      fireEvent.click(screen.getByTestId('snap-litho-to-geo'))
    })

    // snapped=true, and the drag's own edge — a base-edge drag must never write a top.
    expect(patch).toHaveBeenCalledWith('L-zand', 7.05, true, 'top')
    expect(screen.queryByTestId('litho-geo-snap-dialog')).toBeNull()
  })

  it('GS5 — a drag the geotech axis refuses opens nothing', async () => {
    // Released exactly where it started: no travel, so nothing was written and there is
    // no new litho depth for a geological contact to disagree with. (A drag that travels
    // but crosses no boundary is now a NUDGE and does write — see CD2.)
    const { patch } = await commitDrag('geotechnical', 'g3', 4, [
      contact('GEO-1', 'geo-model-1', 4.05),
    ])

    expect(patch).not.toHaveBeenCalled()
    expect(screen.queryByTestId('litho-geo-snap-dialog')).toBeNull()
  })

  it('GS6 — "move geological to litho" moves the GEO row and rebuilds its surfaces', async () => {
    const { patch } = await commitDrag('geotechnical', 'g3', 8.5, [
      contact('GEO-1', 'geo-model-1', 7.05),
    ])
    patch.mockClear()

    await act(async () => {
      fireEvent.click(screen.getByTestId('move-geo-to-litho'))
    })

    // 7.00 m — where the litho contact actually came to rest, which is the packing
    // boundary the drag was clamped to. Never 8.50: the release depth is a place the
    // contact never occupied, and a geological surface dragged there would be answering
    // a gesture nothing on screen made.
    expect(patch).toHaveBeenCalledWith('GEO-1', 7, false)
    // The cascade is the whole reason this option is the heavy one — the geological
    // surface is interpolated from its contacts, so moving one without rebuilding leaves
    // the surface hanging at the old depth.
    expect(api.geology.rebuildSurfaces).toHaveBeenCalledWith('proj-1', 'geo-model-1')
    expect(screen.queryByTestId('litho-geo-snap-dialog')).toBeNull()
  })

  it('GS7 — cancel leaves both contacts exactly where they were', async () => {
    // "Keep them separate" is a real answer on interbedded ground: the cone resistance
    // and the geological surface can legitimately disagree by a few centimetres, and the
    // engineer is allowed to say so. It must cost nothing to say.
    const { patch } = await commitDrag('geotechnical', 'g3', 8.5, [
      contact('GEO-1', 'geo-model-1', 7.05),
    ])
    patch.mockClear()

    await act(async () => {
      fireEvent.click(screen.getByTestId('snap-cancel'))
    })

    expect(patch).not.toHaveBeenCalled()
    expect(api.geology.rebuildSurfaces).not.toHaveBeenCalled()
    expect(screen.queryByTestId('litho-geo-snap-dialog')).toBeNull()
  })

})
