// Section contact-filtering tests — "classification follows the test".
//
// Owner directive 2026-06-08 (supersedes the 2026-05-17 explicit-content
// directive FOR CLASSIFICATION): a section shows the geological contacts +
// accepted litho of EVERY test in its corridor, automatically, with no
// per-section seeding. A test is classified once and that classification
// renders on every section through it. The explicit-content invariant now
// applies to correlations only (out of scope here, unchanged). These tests
// verify the in-corridor render gate:
//
//   C1. In-corridor contacts render even with an EMPTY seeded set — the
//       reversal: classification follows the test, not the seed step.
//   C2. A contact whose anchor projects OUTSIDE the corridor (beyond the
//       projection buffer) does NOT render — the surviving half of the
//       filter (a section only shows what it actually projects).
//   C3. A contact whose anchor is EXCLUDED on the section is dropped, and a
//       contact whose anchor investigation is absent from the visible lists
//       is silently skipped (no crash).
//   T4/T4b. applyUpdatedSection still replaces the section by id (the seeded
//       set rides the bundle for compat; the mechanism is unchanged).
//   T5/T6/M1/M2. The seed/draw/manual-litho flows still thread the section id
//       and refresh the row — harmless now, kept for compat.
//
// SectionPanel is mocked so the test captures the props it receives.
// MapView is mocked because Leaflet requires a real DOM.

import { render, cleanup, act } from '@testing-library/react'
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

import { ShellContext } from '../../ShellContext'
import type { ShellContextValue } from '../../ShellContext'
import SectionsCanvas from './SectionsCanvas'
import type { FormationContactResponse, GeologicalModelResponse } from '../../../api/client'
import { useSectionScope } from '../../../components/sections/SectionScopeContext'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let capturedContacts: readonly FormationContactResponse[] | undefined = undefined
// Capture the section-aware callbacks so tests can invoke them (the real
// user gestures: manual draw â†’ onCreateContact, drag-copy â†’ onBatchCreateContacts).
let capturedOnCreateContact:
  | ((
      anchorKind: 'cpt' | 'borehole',
      anchorId: string,
      depth_m: number,
      formationId: string,
      snapped: boolean,
      sectionId?: string | null,
    ) => Promise<void>)
  | undefined = undefined
let capturedOnBatchCreateContacts:
  | ((creates: readonly unknown[]) => Promise<void>)
  | undefined = undefined
// Capture the manual litho unit create callback for M1/M2 tests.
let capturedOnManualLithoUnitCreate:
  | ((
      mainCode: string,
      admixtures: unknown[],
      anchorKind: 'cpt' | 'borehole',
      anchorId: string,
      depthM: number,
    ) => Promise<{ formationId: string } | null>)
  | undefined = undefined
// Capture axisMode so the geological-axis regression (S3) can assert the
// litho picker is NOT wired on the geology axis.
let capturedAxisMode: 'geological' | 'lithostratigraphic' | 'geotechnical' | undefined =
  undefined

// Capture correlateGestureState so the S5 test can invoke onCorrelate
// and assert the armed source is NOT cleared on a failed POST.
let capturedCorrelateGestureState:
  | { onCorrelate?: (a: string, b: string) => Promise<void> }
  | undefined = undefined

vi.mock('../../../components/SectionPanel', () => ({
  default: (props: {
    onCreateContact?: typeof capturedOnCreateContact
    onBatchCreateContacts?: typeof capturedOnBatchCreateContacts
    onManualLithoUnitCreate?: typeof capturedOnManualLithoUnitCreate
    correlateGestureState?: { onCorrelate?: (a: string, b: string) => Promise<void> }
  }) => {
    // Capture the props each time SectionPanel renders. ``contacts`` and
    // ``axisMode`` moved onto the SectionScope (debt #201 Phase B), so they
    // arrive via context now — read them from the scope the panel itself reads.
    const scope = useSectionScope()
    capturedContacts = scope.contacts
    capturedOnCreateContact = props.onCreateContact
    capturedOnBatchCreateContacts = props.onBatchCreateContacts
    capturedOnManualLithoUnitCreate = props.onManualLithoUnitCreate
    capturedAxisMode = scope.axisMode
    capturedCorrelateGestureState = props.correlateGestureState
    return null
  },
}))

vi.mock('../../../components/MapView', () => ({
  default: () => null,
}))

// api.section.list is used by useSections' auto-load effect (T4b).
// Default resolves to [] so T1â€“T3/T5 are unaffected by pending fetches.
const mockSectionList = vi.fn().mockResolvedValue([])
// api.geology.acceptLithoSuggestions is exercised by M1/M2.
const mockAcceptLithoSuggestions = vi.fn()
// api.geology.correlate is exercised by S5 (armed-source-persists-on-422).
const mockCorrelate = vi.fn().mockResolvedValue(undefined)

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client')
  return {
    ...actual,
    setBaseUrl: vi.fn(),
    api: {
      geology: {
        validateCrossings: vi.fn().mockResolvedValue({ model_id: '', issues: [] }),
        acceptLithoSuggestions: (...args: unknown[]) => mockAcceptLithoSuggestions(...args),
        // TODO Task 19: correlate/uncorrelate/listCorrelations removed;
        // replaced by contact-level methods in the full migration.
        createContactCorrelation: (...args: unknown[]) => mockCorrelate(...args),
        deleteContactCorrelation: vi.fn().mockResolvedValue(undefined),
        listContactCorrelations: vi.fn().mockResolvedValue([]),
      },
      virtueleBoring: {
        getModels: vi.fn().mockResolvedValue([]),
      },
      section: {
        list: (...args: unknown[]) => mockSectionList(...args),
        get: vi.fn(),
      },
    },
  }
})

// ---------------------------------------------------------------------------
// Helpers — the shared ShellContext stub lives in __fixtures__/shellStub so the
// other SectionsCanvas suites reuse ONE copy of it.
// ---------------------------------------------------------------------------

import {
  makeBorehole,
  makeContact,
  makeLithoModel,
  makeSection,
  makeStubContext,
} from './__fixtures__/shellStub'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let consoleErrorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  capturedContacts = undefined
  capturedOnManualLithoUnitCreate = undefined
  capturedAxisMode = undefined
  capturedCorrelateGestureState = undefined
  // Reset to [] so T1â€“T3/T5 (render-based, no section list needed) are clean.
  mockSectionList.mockResolvedValue([])
  mockAcceptLithoSuggestions.mockReset()
  mockCorrelate.mockReset()
  mockCorrelate.mockResolvedValue(undefined)
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  consoleErrorSpy.mockRestore()
  vi.restoreAllMocks()
})

describe('Section contact filtering â€” classification follows the test', () => {
  it('C1: in-corridor contacts render even with an EMPTY seeded set', () => {
    // The reversal: both contacts are anchored to bh-1, which projects into
    // the section corridor. The seeded set is empty, yet both render â€” a test
    // is classified once and appears on every section through it.
    const c1 = makeContact('contact-aaa') // anchor bh-1
    const c2 = makeContact('contact-bbb') // anchor bh-1
    const ctx = makeStubContext({
      section: makeSection({ seeded_formation_contact_ids: [] }),
      contacts: [c1, c2],
      visibleBoreholes: [makeBorehole('bh-1', 50, 0)], // in corridor
    })
    render(
      <ShellContext.Provider value={ctx}>
        <SectionsCanvas />
      </ShellContext.Provider>,
    )
    // Both contacts show despite zero seeded ids.
    expect(capturedContacts).toHaveLength(2)
    expect(new Set(capturedContacts?.map(c => c.id))).toEqual(
      new Set(['contact-aaa', 'contact-bbb']),
    )
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it('C2: a contact whose anchor projects OUTSIDE the corridor does NOT render', () => {
    // bh-1 sits 200 m off the line; the 50 m projection buffer excludes it,
    // so its contact is not on this section even though the model holds it.
    const c1 = makeContact('contact-aaa') // anchor bh-1
    const ctx = makeStubContext({
      section: makeSection({ seeded_formation_contact_ids: [] }),
      contacts: [c1],
      visibleBoreholes: [makeBorehole('bh-1', 50, 200)], // offset 200 > 50 buffer
    })
    render(
      <ShellContext.Provider value={ctx}>
        <SectionsCanvas />
      </ShellContext.Provider>,
    )
    expect(capturedContacts).toEqual([])
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it('C3: an excluded or unknown anchor is silently skipped (no crash)', () => {
    // c1's anchor bh-1 is explicitly excluded on the section; c2's anchor
    // bh-missing has no matching visible borehole. Both drop out, no crash.
    const c1 = makeContact('contact-aaa') // anchor bh-1 (excluded)
    const c2 = { ...makeContact('contact-bbb'), borehole_id: 'bh-missing' }
    const ctx = makeStubContext({
      section: makeSection({
        seeded_formation_contact_ids: ['contact-aaa'], // seeded, but excluded anchor wins
        excluded_borehole_ids: ['bh-1'],
      }),
      contacts: [c1, c2],
      visibleBoreholes: [makeBorehole('bh-1', 50, 0)], // in corridor but excluded
    })
    render(
      <ShellContext.Provider value={ctx}>
        <SectionsCanvas />
      </ShellContext.Provider>,
    )
    expect(capturedContacts).toEqual([])
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it('T4: applyUpdatedSection no-ops when section id is absent (defensive guard)', async () => {
    // Verify the defensive branch of applyUpdatedSection (P2-G/P2-H):
    // calling it when sections = [] must be a no-op and leave sections empty.
    const { useSections } = await import('../../../hooks/useSections')

    const updatedSection = makeSection({ seeded_formation_contact_ids: ['contact-aaa'] })

    const { result } = renderHook(() =>
      useSections({
        project: { id: 'proj-1', name: 'Test', default_horizontal_epsg: 31370 },
        ready: false, // don't auto-fetch â€” sections stays []
        toast: vi.fn(),
        pushUndo: vi.fn(),
        manifestSectionIds: new Set<string>(),
        addToManifest: vi.fn(),
        removeFromManifest: vi.fn(),
        setSessionImportSectionIds: vi.fn(),
        contacts: [],
        lithoContacts: [],
        hasLithoModel: true,
        hasGeotechModel: true,
        boreholes: [],
        cpts: [],
        setSelectedId: vi.fn(),
        setSelectedBoreholeId: vi.fn(),
      }),
    )

    act(() => {
      result.current.applyUpdatedSection(updatedSection)
    })
    // No match â†’ no-op; sections remains empty.
    expect(result.current.sections).toHaveLength(0)
  })

  it('T4b: applyUpdatedSection replaces the matching section by id and leaves others untouched', async () => {
    // The REPLACE-BY-ID path: `setSections(prev => prev.map(s => s.id === updated.id ? updated : s))`.
    // Drive the auto-load path (ready=true + manifestSectionIds contains both ids)
    // so `sections` is populated before calling applyUpdatedSection.
    // Then assert result.current.sections (real hook state) reflects the update â€”
    // this assertion fails if the map regresses to a no-op or replaces the wrong row.
    const { useSections } = await import('../../../hooks/useSections')

    const sec1Initial = makeSection({ id: 'sec-1', seeded_formation_contact_ids: [] })
    const sec2 = makeSection({ id: 'sec-2', seeded_formation_contact_ids: [] })

    // Inject via the module-level mockSectionList so the auto-load effect
    // resolves to [sec1Initial, sec2] when the hook mounts with ready=true.
    mockSectionList.mockResolvedValue([sec1Initial, sec2])

    const { result } = renderHook(() =>
      useSections({
        project: { id: 'proj-1', name: 'Test', default_horizontal_epsg: 31370 },
        ready: true, // triggers auto-load via api.section.list
        toast: vi.fn(),
        pushUndo: vi.fn(),
        manifestSectionIds: new Set(['sec-1', 'sec-2']),
        addToManifest: vi.fn(),
        removeFromManifest: vi.fn(),
        setSessionImportSectionIds: vi.fn(),
        contacts: [],
        lithoContacts: [],
        hasLithoModel: true,
        hasGeotechModel: true,
        boreholes: [],
        cpts: [],
        setSelectedId: vi.fn(),
        setSelectedBoreholeId: vi.fn(),
      }),
    )

    // Wait for the auto-load effect to resolve.
    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })

    // Precondition: both sections loaded with empty seeded sets.
    expect(result.current.sections).toHaveLength(2)
    expect(result.current.sections.find(s => s.id === 'sec-1')!.seeded_formation_contact_ids).toEqual([])
    expect(result.current.sections.find(s => s.id === 'sec-2')!.seeded_formation_contact_ids).toEqual([])

    // Apply the updated section â€” only sec-1's seeded set changes.
    const sec1Updated = makeSection({ id: 'sec-1', seeded_formation_contact_ids: ['contact-aaa'] })
    act(() => {
      result.current.applyUpdatedSection(sec1Updated)
    })

    // Assert real hook state â€” reads result.current.sections, NOT a hardcoded constant.
    // Fails if the replace-by-id map regressed to a no-op (sec-1 stays empty)
    // or replaced every row (sec-2 would also carry ['contact-aaa']).
    expect(result.current.sections.find(s => s.id === 'sec-1')!.seeded_formation_contact_ids).toEqual(['contact-aaa'])
    // sec-2 is left untouched â€” map only replaces the matching id.
    expect(result.current.sections.find(s => s.id === 'sec-2')!.seeded_formation_contact_ids).toEqual([])
  })

  it('T5: manual draw threads the section id and refreshes the seeded set', async () => {
    // Regression net for the "draw does nothing" dogfeed bug: the
    // section-aware wrapper MUST (a) pass selectedSection.id as the 6th
    // arg so the backend seeds seeded_formation_contact_ids, and (b) GET
    // the updated section + applyUpdatedSection so P2-F's filter shows it.
    // Before the fix the section id never reached the create body.
    const { api } = await import('../../../api/client')
    const sectionGetMock = api.section.get as Mock
    const updatedSection = makeSection({
      seeded_formation_contact_ids: ['contact-new'],
    })
    sectionGetMock.mockResolvedValue(updatedSection)

    const handleCreateContact = vi.fn().mockResolvedValue(undefined)
    const applyUpdatedSection = vi.fn()
    const ctx = makeStubContext({
      section: makeSection({ seeded_formation_contact_ids: [] }),
      contacts: [],
    })
    ctx.geoModel.handleCreateContact = handleCreateContact
    ;(ctx.sections as typeof ctx.sections).applyUpdatedSection = applyUpdatedSection

    render(
      <ShellContext.Provider value={ctx}>
        <SectionsCanvas />
      </ShellContext.Provider>,
    )

    // Not fired at mount â€” only on the user gesture.
    expect(sectionGetMock).not.toHaveBeenCalled()

    // Invoke the captured onCreateContact (the real manual-draw gesture).
    expect(capturedOnCreateContact).toBeDefined()
    await act(async () => {
      await capturedOnCreateContact!('cpt', 'cpt-9', 5.0, 'form-1', false)
    })

    // (a) section id threaded as the 6th arg.
    expect(handleCreateContact).toHaveBeenCalledWith(
      'cpt',
      'cpt-9',
      5.0,
      'form-1',
      false,
      'sec-1',
    )
    // (b) seeded set refreshed from the authoritative section row.
    expect(sectionGetMock).toHaveBeenCalledWith('proj-1', 'sec-1')
    expect(applyUpdatedSection).toHaveBeenCalledWith(updatedSection)
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it('T6: drag-copy (batch) threads the section id and refreshes the seeded set', async () => {
    // The actual reported bug: dragging contacts to the next test
    // (one-by-one / marquee / shift-drag all funnel through
    // onBatchCreateContacts). The section-aware batch wrapper must pass
    // selectedSection.id to handleBatchCreateContacts (so the backend
    // seeds every copied id) and then GET + applyUpdatedSection so the
    // P2-F filter renders them. Before the fix the copy created contacts
    // the filter immediately hid (no section id, no refresh).
    const { api } = await import('../../../api/client')
    const sectionGetMock = api.section.get as Mock
    const updatedSection = makeSection({
      seeded_formation_contact_ids: ['copied-1', 'copied-2'],
    })
    sectionGetMock.mockResolvedValue(updatedSection)

    const handleBatchCreateContacts = vi.fn().mockResolvedValue(undefined)
    const applyUpdatedSection = vi.fn()
    const ctx = makeStubContext({
      section: makeSection({ seeded_formation_contact_ids: [] }),
      contacts: [],
    })
    ctx.geoModel.handleBatchCreateContacts = handleBatchCreateContacts
    ;(ctx.sections as typeof ctx.sections).applyUpdatedSection = applyUpdatedSection

    render(
      <ShellContext.Provider value={ctx}>
        <SectionsCanvas />
      </ShellContext.Provider>,
    )

    expect(capturedOnBatchCreateContacts).toBeDefined()
    const creates = [
      {
        formation_id: 'form-1',
        depth_top_m: 3.2,
        borehole_id: null,
        cpt_id: 'cpt-9',
        source: 'manual_pick' as const,
        confidence: 'medium' as const,
      },
    ]
    await act(async () => {
      await capturedOnBatchCreateContacts!(creates)
    })

    // section id passed as the 2nd arg â†’ backend seeds every copied id.
    expect(handleBatchCreateContacts).toHaveBeenCalledWith(creates, 'sec-1')
    // one section refresh after the batch so P2-F shows the copies.
    expect(sectionGetMock).toHaveBeenCalledWith('proj-1', 'sec-1')
    expect(applyUpdatedSection).toHaveBeenCalledWith(updatedSection)
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// S3 â€” geological axis must NOT wire the litho picker (regression guard)
// ---------------------------------------------------------------------------

describe('Axis mode â€” geology axis keeps FormationPickerDialog', () => {
  it('S3: geological axis passes axisMode=geological and no onManualLithoUnitCreate', () => {
    const ctx = makeStubContext({
      section: makeSection({ seeded_formation_contact_ids: [] }),
      sectionModelAxis: 'geological',
    })

    render(
      <ShellContext.Provider value={ctx}>
        <SectionsCanvas />
      </ShellContext.Provider>,
    )

    // Geology axis must keep the unchanged FormationPickerDialog path:
    // the litho-only manual-create prop must be absent and axisMode
    // explicitly 'geological'.
    expect(capturedAxisMode).toBe('geological')
    expect(capturedOnManualLithoUnitCreate).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// M1 / M2 â€” manual litho unit DIRECT INSERT (debt #151 dogfeed refinement
// 2026-05-27 owner directive: "how about we don't wire it through the
// suggestion and it immediately becomes an accepted litho layer").
//
// New contract: handleManualLithoUnitCreate now creates a real accepted
// contact at depthM with the chosen lithology AND seeds the section.  No
// pending-ghost intermediate.  When a SURROUNDING litho contact exists
// above depthM with a different lithology, a SECOND acceptLithoSuggestions
// call fires to restore the original band below the inserted layer.
// ---------------------------------------------------------------------------

describe('Manual litho unit creation â€” handleManualLithoUnitCreate (direct insert)', () => {
  it('M1: new unit â†’ acceptLithoSuggestions seeds the section AND calls applyUpdatedSection', async () => {
    const updatedSection = makeSection({
      seeded_formation_contact_ids: ['contact-new-1'],
    })
    mockAcceptLithoSuggestions.mockResolvedValue({
      updated_section: updatedSection,
      created_formation_ids: ['form-new-1'],
      found_formation_ids: [],
      created_contact_ids: ['contact-new-1'],
      found_contact_ids: [],
    })

    const applyUpdatedSection = vi.fn()
    const ctx = makeStubContext({
      section: makeSection({ seeded_formation_contact_ids: [] }),
      lithoModel: makeLithoModel(),
      sectionModelAxis: 'lithostratigraphic',
    })
    ;(ctx.sections as typeof ctx.sections).applyUpdatedSection = applyUpdatedSection

    render(
      <ShellContext.Provider value={ctx}>
        <SectionsCanvas />
      </ShellContext.Provider>,
    )

    expect(capturedOnManualLithoUnitCreate).toBeDefined()

    const result = await act(async () =>
      capturedOnManualLithoUnitCreate!('ZAND', [], 'borehole', 'bh-1', 5.5),
    )

    // (a) acceptLithoSuggestions called with section_id (real seed) — the
    //     backend creates the contact. No surrounding litho contact exists
    //     in this stub context, so only ONE call fires (no restoration
    //     needed).
    expect(mockAcceptLithoSuggestions).toHaveBeenCalledTimes(1)
    const [, , payload] = mockAcceptLithoSuggestions.mock.calls[0]
    expect(payload.borehole_id).toBe('bh-1')
    expect(payload.section_id).toBe('sec-1')
    expect(payload.suggestions).toHaveLength(1)
    expect(payload.suggestions[0].suggested_lithology).toBe('ZAND')
    expect(payload.suggestions[0].source).toBe('manual_pick')
    // depth_base = depth_top + 0.20 (20 cm band).
    expect(payload.suggestions[0].depth_base_m).toBeCloseTo(5.7)

    // (b) applyUpdatedSection IS called now â€” the new contact seeded
    //     the section's seeded_formation_contact_ids.
    expect(applyUpdatedSection).toHaveBeenCalledTimes(1)
    expect(applyUpdatedSection).toHaveBeenCalledWith(updatedSection)

    // (c) formationId returned so the caller can react if needed.
    expect(result).toEqual({ formationId: 'form-new-1' })
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it('M2: idempotent re-create (formation already exists) â†’ returns found formationId, seeds section', async () => {
    const updatedSection = makeSection({
      seeded_formation_contact_ids: ['contact-existing-1', 'contact-new-2'],
    })
    mockAcceptLithoSuggestions.mockResolvedValue({
      updated_section: updatedSection,
      created_formation_ids: [],
      found_formation_ids: ['form-existing-x'],
      created_contact_ids: ['contact-new-2'],
      found_contact_ids: [],
    })

    const applyUpdatedSection = vi.fn()
    const ctx = makeStubContext({
      section: makeSection({ seeded_formation_contact_ids: ['contact-existing-1'] }),
      lithoModel: makeLithoModel(),
      sectionModelAxis: 'lithostratigraphic',
    })
    ;(ctx.sections as typeof ctx.sections).applyUpdatedSection = applyUpdatedSection

    render(
      <ShellContext.Provider value={ctx}>
        <SectionsCanvas />
      </ShellContext.Provider>,
    )

    expect(capturedOnManualLithoUnitCreate).toBeDefined()
    const result = await act(async () =>
      capturedOnManualLithoUnitCreate!('KLEI', [], 'cpt', 'cpt-7', 3.0),
    )

    expect(applyUpdatedSection).toHaveBeenCalledTimes(1)
    expect(applyUpdatedSection).toHaveBeenCalledWith(updatedSection)
    // formationId comes from found_formation_ids[0] when created_formation_ids is empty.
    expect(result).toEqual({ formationId: 'form-existing-x' })
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// S5 â€” a failed correlate keeps the armed source + surfaces the error
// TODO Task 19: handleCorrelate is stubbed (formation-level API removed).
// Re-enable this test when Task 19 wires createContactCorrelation.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// LX â€” litho-axis left-click must NOT open the picker dialog (Bug B fix,
// dogfeed 2026-05-26 + 2nd-pass fix 2026-05-26)
//
// Root cause: the picker (useContactPicker) opens in handlePickCpt /
// handlePickBorehole which are wired to ContactPickBar's onCommitDepth and
// BoreholeColumn's onCommitDepth.  Those callbacks fire BEFORE
// sectionAwareCreateContact runs â€” so the previous internal `if (isLitho) return`
// guard was too late in the chain.
//
// The correct fix: pass onCreateContact={undefined} on the litho axis.
// SectionPanel gates ContactPickBar's onCommitDepth on whether onCreateContact
// is present (line 1901: `onCommitDepth={onCreateContact ? handlePickCpt : undefined}`).
// So passing undefined disarms the pick-bar and BoreholeColumn overlays
// entirely, preventing the picker from opening.
//
// LX1 â€” the original test: callback is a no-op (still passes; the no-op is
//        now enforced at the prop boundary rather than inside the callback).
// LX2 â€” the real guard: onCreateContact is undefined on the litho axis so
//        the picker cannot open (ContactPickBar / BoreholeColumn are disarmed).
// ---------------------------------------------------------------------------

describe('Litho axis left-click is a no-op (Bug B â€” dogfeed 2026-05-26)', () => {
  it('LX2 â€” onCreateContact is undefined on the litho axis so the picker never opens', () => {
    const ctx = makeStubContext({
      section: makeSection({ seeded_formation_contact_ids: [] }),
      lithoModel: makeLithoModel(),
      sectionModelAxis: 'lithostratigraphic',
    })

    render(
      <ShellContext.Provider value={ctx}>
        <SectionsCanvas />
      </ShellContext.Provider>,
    )

    // The prop must be undefined â€” ContactPickBar/BoreholeColumn's onCommitDepth
    // are gated on onCreateContact, so undefined fully disarms the pick-bar and
    // prevents handlePickCpt/handlePickBorehole (and therefore the picker) from
    // firing on left-click.  This is the correct fix for the "picker still opens
    // on litho axis" dogfeed (previous guard was inside sectionAwareCreateContact
    // which is too late â€” the picker opens before that callback runs).
    expect(capturedOnCreateContact).toBeUndefined()
  })

  it('LX1 â€” geological axis still wires onCreateContact (regression guard)', () => {
    const ctx = makeStubContext({
      section: makeSection({ seeded_formation_contact_ids: [] }),
      sectionModelAxis: 'geological',
    })

    render(
      <ShellContext.Provider value={ctx}>
        <SectionsCanvas />
      </ShellContext.Provider>,
    )

    // On the geological axis the callback must be present so the pick-bar works.
    expect(capturedOnCreateContact).toBeDefined()
  })
})

describe('handleCorrelate â€” armed source persists on failure (review S5)', () => {
  it.skip('S5 â€” failed POST does NOT clear the armed source and toasts an error [Task 19]', async () => {
    mockCorrelate.mockRejectedValue(new Error('422 cross-group race'))
    const ctx = makeStubContext({
      lithoModel: makeLithoModel(),
      sectionModelAxis: 'lithostratigraphic',
    })

    render(
      <ShellContext.Provider value={ctx}>
        <SectionsCanvas />
      </ShellContext.Provider>,
    )

    // onCorrelate is wired on the litho axis regardless of correlate mode.
    expect(capturedCorrelateGestureState?.onCorrelate).toBeDefined()
    await act(async () => {
      await capturedCorrelateGestureState!.onCorrelate!('f-a', 'f-b')
    })

    // Contract (spec / #57-adjacent): the armed source stays armed so the
    // user can retry or pick a different target, and the failure is
    // surfaced rather than silently swallowed.
    expect(ctx.sections.clearCorrelationSource).not.toHaveBeenCalled()
    expect(ctx.toasts.toast).toHaveBeenCalledWith('error', expect.any(String))
  })
})

