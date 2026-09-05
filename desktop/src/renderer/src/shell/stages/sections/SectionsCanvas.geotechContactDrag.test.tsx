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

import { render, cleanup, act, fireEvent, screen } from '@testing-library/react'
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
        moveRestatedContact: vi.fn().mockResolvedValue({
          layer_ids: ['g2', 'g3'],
          litho_upper_layer_id: 'L-klei',
          litho_lower_layer_id: 'L-zand',
          geo_contact_id: null,
        }),
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
function layer(
  id: string,
  top: number,
  base: number,
  anchor: { cpt_id: string | null; borehole_id: string | null } = {
    cpt_id: 'cpt-1',
    borehole_id: null,
  },
): LithoLayerResponse {
  return makeLithoLayer({
    id,
    depth_top_m: top,
    depth_base_m: base,
    cpt_id: anchor.cpt_id,
    borehole_id: anchor.borehole_id,
  })
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
  onBorehole = false,
): ShellContextValue {
  const ctx = makeShellCtx(axis)
  const anchor = onBorehole ? { cpt_id: null, borehole_id: 'bh-1' } : { cpt_id: 'cpt-1', borehole_id: null }
  ctx.geoModel.geotechLayers = [
    layer('g1', 0, 2, anchor),
    layer('g2', 2, 4, anchor),
    layer('g3', 4, 7, anchor),
    layer('g4', 7, 10, anchor),
  ]
  ctx.geoModel.lithoLayers = [layer('L-klei', 0, 4, anchor), layer('L-zand', 4, 10, anchor)]
  ctx.geoModel.lithoContacts = [
    onBorehole ? { ...LITHO_CONTACT, cpt_id: null, borehole_id: 'bh-1' } : LITHO_CONTACT,
  ]
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
  onBorehole = false,
): Promise<{ patch: ReturnType<typeof vi.fn>; ctx: ShellContextValue }> {
  const patch = vi.fn().mockResolvedValue(undefined)
  const ctx = ctxFor(axis, patch, onBorehole)
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

/**
 * Accept the consequence prompt the drag opened.
 *
 * The gesture is two steps now: the drag names what it will move, the engineer agrees.
 * A test that skipped the prompt would pass over the one thing the owner asked for.
 */
async function confirmMove(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTestId('move-restated-contact-confirm'))
  })
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

  it('CD1 — a long drag moves the boundary to the FIRST one crossed, in every model', async () => {
    // Released at 8.5 m, past the packing boundary at 7 m. One drag consumes one boundary.
    // What moves is no longer the litho row ALONE: the packing bands either side move with
    // it, because a restated contact is one boundary recorded in two models and moving one
    // of them splits it — the owner's log showed the second drag then failing to find its
    // own contact.
    await commitDrag('geotechnical', 'g3', 8.5)
    await confirmMove()

    expect(api.geology.moveRestatedContact).toHaveBeenCalledTimes(1)
    expect(api.geology.moveRestatedContact).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'g2',
      'g3',
      7,
    )
  })

  it('CD2 — a drag short of the next boundary NUDGES the contact there', async () => {
    // Reversed on owner dogfeed 2026-08-09: refusing a sub-boundary drag made a small
    // correction impossible, and answered "The contact did not move". The boundary is
    // the wall (CD1 still clamps at it); short of it the depth is the engineer's.
    await commitDrag('geotechnical', 'g3', 4.4)
    await confirmMove()

    expect(api.geology.moveRestatedContact).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'g2',
      'g3',
      4.4,
    )
  })

  it('CD2c — and the drag ASKS before it writes anything', async () => {
    // The owner asked for this twice: "the warning, moving this boundary will move litho
    // alongside it didn't appear." Every other verb on this axis stays inside the
    // geotechnical model; this one edits the level above, and nothing on screen says so.
    await commitDrag('geotechnical', 'g3', 8.5)

    expect(screen.queryByTestId('move-restated-contact-dialog')).not.toBeNull()
    expect(api.geology.moveRestatedContact).not.toHaveBeenCalled()
  })

  it('CD2d — and cancelling it writes nothing at all', async () => {
    await commitDrag('geotechnical', 'g3', 8.5)
    await act(async () => {
      fireEvent.click(screen.getByTestId('move-restated-contact-cancel'))
    })

    expect(api.geology.moveRestatedContact).not.toHaveBeenCalled()
  })

  it('CD2b — but a release with no travel writes nothing', async () => {
    // The press-and-release that picks a contact or opens a menu is not a nudge, and
    // must not PATCH the depth the row already has.
    const { patch } = await commitDrag('geotechnical', 'g3', 4)

    expect(patch).not.toHaveBeenCalled()
  })

  it('CD3 — an internal packing boundary writes nothing', async () => {
    // g1 and g2 both sit in the KLEI body, so the 2 m boundary is packing, not a
    // contact: a packing boundary never crosses a litho contact and this drag is not
    // the verb that moves it.
    const { patch } = await commitDrag('geotechnical', 'g2', 3.5)

    expect(patch).not.toHaveBeenCalled()
  })

  it('CD4 — the litho axis commits the depth it was given, unclamped', async () => {
    // The control: without it, deleting the whole contact drag would pass CD2 and CD3.
    const { patch } = await commitDrag('lithostratigraphic', 'L-zand', 4.4)

    expect(patch).toHaveBeenCalledWith('L-zand', 4.4, false, 'top')
  })

  // ── Nothing happened is a thing that has to be SAID ──────────────────────────
  //
  // The whole task started from "sometimes I can't grab the contact handles any more":
  // a gesture that moves under the cursor and then commits nothing, with the reason
  // only in a DEBUG log the owner will never open. Every path that declines this drag
  // has to answer out loud, in the terms the engineer is working in.

  it('CD5 — a release with no travel says nothing at all', async () => {
    // It used to warn "drag it past a packing boundary" whenever no boundary was
    // crossed, which after the nudge ruling would fire on every successful small
    // correction. A no-travel release is not a failed gesture either — it is a click.
    const { ctx } = await commitDrag('geotechnical', 'g3', 4)

    expect(ctx.toasts.toast).not.toHaveBeenCalledWith(
      'warning',
      expect.stringContaining('packing boundary'),
    )
  })

  it('CD6 — on a borehole it says the column has none, which is a different answer', async () => {
    // Worth telling apart from CD5: "drag further" is worth trying again and "this
    // column carries no cone resistance" never will be, and both look identical from
    // the outside.
    const { patch, ctx } = await commitDrag('geotechnical', 'g3', 8.5, true)

    expect(patch).not.toHaveBeenCalled()
    expect(ctx.toasts.toast).toHaveBeenCalledWith(
      'warning',
      expect.stringContaining('borehole carries no cone resistance'),
    )
  })

  it('CD7 — and a packing boundary says which kind of boundary it is', async () => {
    const { ctx } = await commitDrag('geotechnical', 'g2', 3.5)

    expect(ctx.toasts.toast).toHaveBeenCalledWith(
      'warning',
      expect.stringContaining('not a lithological contact'),
    )
  })

  it('CD8 — a move that lands says nothing: the boundary moving IS the feedback', async () => {
    // The counterweight to CD5-CD7. A toast on every successful drag would train the
    // owner to dismiss them without reading, which is how the ones that matter stop
    // being read too.
    //
    // Filtered rather than "never called": this fixture's section sits at (0,0)→(100,0),
    // outside Lambert 72, so the canvas raises its own CRS warning on mount. Asserting
    // silence outright would pin that unrelated toast instead of this one.
    const { ctx } = await commitDrag('geotechnical', 'g3', 8.5)

    const aboutTheDrag = (ctx.toasts.toast as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([, message]) => typeof message === 'string' && message.includes('packing'),
    )
    expect(aboutTheDrag).toEqual([])
  })
})
