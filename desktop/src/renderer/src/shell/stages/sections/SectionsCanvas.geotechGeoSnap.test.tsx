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
 * The same contact, DERIVED from a geological one.
 *
 * Coupling is a property of the row (``parent_geo_contact_id``), not of how close some
 * geological contact happens to be. The old prompt keyed on proximity, which is why this
 * fixture did not need it; the consequence dialog asks the row, so the fixture has to say.
 */
const COUPLED_LITHO_CONTACT = {
  ...LITHO_CONTACT,
  parent_geo_contact_id: 'GEO-1',
} as FormationContactResponse

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
  coupled = false,
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
  ctx.geoModel.lithoContacts = [coupled ? COUPLED_LITHO_CONTACT : LITHO_CONTACT]
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

  it('GS1 — a coupled drag says the geological contact moves too', async () => {
    // Superseded 2026-08-10. This axis used to open the litho↔geo prompt and ask the
    // engineer which way to reconcile. One of its options — "snap litho to geological" —
    // pulls the contact BACK to the geological depth, which is the opposite of what this
    // screen is for: he is refining downward, geological → litho → geotech, so geology
    // follows the refinement rather than overruling it.
    //
    // So the geological contact is carried in the SAME write (the backend does it; see
    // the MoveRestatedContact unit tests), and the prompt's job here shrinks to naming
    // the consequence — which is exactly what the owner asked for: "the warning, moving
    // this boundary will move litho alongside it didn't appear. Or might even be litho
    // and geo sometimes."
    await commitDrag('geotechnical', 'g3', 8.5, [contact('GEO-1', 'geo-model-1', 7.05)], true)

    expect(screen.getByTestId('move-restated-contact-dialog')).toBeTruthy()
    expect(screen.getByTestId('move-restated-contact-geology')).toBeTruthy()
    // And NOT the old three-option prompt: two dialogs answering the same question with
    // different rules is how the two models drift apart.
    expect(screen.queryByTestId('litho-geo-snap-dialog')).toBeNull()
  })

  it('GS2 — an uncoupled drag names only the litho contact', async () => {
    // The coupling is read from the litho ROW's parent, not from depth proximity: about
    // one row in three carries one, so a dialog that always claimed geology would be
    // wrong most of the time, and one that never did would hide the cascade.
    await commitDrag('geotechnical', 'g3', 8.5, [])

    expect(screen.getByTestId('move-restated-contact-dialog')).toBeTruthy()
    expect(screen.queryByTestId('move-restated-contact-geology')).toBeNull()
  })

  it('GS3 — the litho axis still opens it, unchanged', async () => {
    // The control. Without it, moving the gate to the geotech axis rather than widening
    // it to both would pass GS1 and GS2.
    await commitDrag('lithostratigraphic', 'L-zand', 7, [contact('GEO-1', 'geo-model-1', 7.05)])

    expect(screen.getByTestId('litho-geo-snap-dialog')).toBeTruthy()
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

  // GS4 / GS6 / GS7 drove the old prompt's three options FROM this axis. Those options
  // are gone here: geology follows the refinement, in the same transaction, so there is
  // no direction left to choose. The claims did not vanish with them —
  //   * that the geological contact ends up at the new depth, and that its surfaces are
  //     staled, is pinned on the write itself (test_move_litho_layer_boundary.py and the
  //     MoveRestatedContact tests), where it cannot be bypassed by a UI change;
  //   * that cancelling costs nothing is CD2d.
  // The three options remain live on the LITHO axis, which is what GS3 above guards.

})
