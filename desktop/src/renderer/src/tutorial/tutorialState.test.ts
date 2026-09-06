// Red-first pins for the tutorial's observable-state derivation (spec §Architecture,
// tutorialState.ts). The rule the spec fixes: every step's `done` condition reads
// a fact derived from the shell bus — nothing is faked or scripted (assumption A4).
// These pins phrase each fact in the spec's own words ("done: CPT count > 0",
// "done: a project is open", "done: a lumping exists").

import { describe, expect, it } from 'vitest'

import { deriveTutorialState, type TutorialShellFacts } from './tutorialState'

/** A shell with no project open and nothing imported — the first-launch state. */
function emptyFacts(): TutorialShellFacts {
  return {
    project: null,
    visibleCpts: [],
    visibleBoreholes: [],
    sections: { sections: [], selectedSectionId: null, sectionModelAxis: 'geological' },
    geoModel: {
      activeGeologicalModel: null,
      activeLithoModel: null,
      contacts: [],
      lithoLayers: [],
      hasLithoSolids: false,
      hasGeotechSolids: false,
      surfacesByFormationId: new Map(),
      activeGeotechModel: null,
    },
    lifecycle: { currentLumping: null, metadataEditorOpen: false },
    coordinator: { selectedId: null, selectedBoreholeId: null, importMenuOpen: false },
  }
}

/** A project open with no CRS / datum chosen yet. */
function openProject(): TutorialShellFacts['project'] {
  return { default_horizontal_epsg: null, default_vertical_epsg: null }
}

describe('deriveTutorialState', () => {
  it('reads projectOpen false when no project is open, true once one is', () => {
    expect(deriveTutorialState(emptyFacts()).projectOpen).toBe(false)
    expect(deriveTutorialState({ ...emptyFacts(), project: openProject() }).projectOpen).toBe(true)
  })

  it('counts the visible CPTs and boreholes ("done: CPT count > 0")', () => {
    const facts: TutorialShellFacts = {
      ...emptyFacts(),
      project: openProject(),
      visibleCpts: [{ id: 'c1' }, { id: 'c2' }],
      visibleBoreholes: [{ id: 'b1' }],
    }
    const state = deriveTutorialState(facts)
    expect(state.cptCount).toBe(2)
    expect(state.boreholeCount).toBe(1)
  })

  it('counts the cross-sections from sections.sections', () => {
    const facts: TutorialShellFacts = {
      ...emptyFacts(),
      sections: {
        ...emptyFacts().sections,
        sections: [{ id: 's1' }, { id: 's2' }, { id: 's3' }],
      },
    }
    expect(deriveTutorialState(facts).sectionCount).toBe(3)
  })

  it('flags the geological and geotechnical models by their active-model handles', () => {
    const facts: TutorialShellFacts = {
      ...emptyFacts(),
      geoModel: {
        ...emptyFacts().geoModel,
        activeGeologicalModel: { id: 'g1' },
        activeGeotechModel: { id: 'gt1' },
      },
    }
    const state = deriveTutorialState(facts)
    expect(state.geoModelExists).toBe(true)
    expect(state.geotechModelExists).toBe(true)
  })

  it('counts contacts and counts a lumping only when it lumps at least one unit', () => {
    const withLumping: TutorialShellFacts = {
      ...emptyFacts(),
      geoModel: { ...emptyFacts().geoModel, contacts: [{ id: 'ct1' }, { id: 'ct2' }] },
      lifecycle: { currentLumping: { map: { a: 'Sand', b: 'Sand' } }, metadataEditorOpen: false },
    }
    const state = deriveTutorialState(withLumping)
    expect(state.contactCount).toBe(2)
    expect(state.lumpingCount).toBe(2)
    // An empty (or absent) lumping is not "a lumping exists".
    expect(deriveTutorialState(emptyFacts()).lumpingCount).toBe(0)
    expect(
      deriveTutorialState({
        ...emptyFacts(),
        lifecycle: { currentLumping: { map: {} }, metadataEditorOpen: false },
      }).lumpingCount,
    ).toBe(0)
  })

  it('flags a CPT chart open and a borehole log open from the selection (owner ruling 7)', () => {
    // "click a CPT row, the chart opens" → selectedId is set; likewise a
    // borehole's log via selectedBoreholeId. Both false when nothing is open.
    expect(deriveTutorialState(emptyFacts()).cptOpen).toBe(false)
    expect(deriveTutorialState(emptyFacts()).boreholeOpen).toBe(false)
    expect(
      deriveTutorialState({ ...emptyFacts(), coordinator: { selectedId: 'c1', selectedBoreholeId: null } })
        .cptOpen,
    ).toBe(true)
    expect(
      deriveTutorialState({ ...emptyFacts(), coordinator: { selectedId: null, selectedBoreholeId: 'b1' } })
        .boreholeOpen,
    ).toBe(true)
  })

  it('counts only ACCEPTED litho layers and reads the built-solids flag', () => {
    const facts: TutorialShellFacts = {
      ...emptyFacts(),
      geoModel: {
        ...emptyFacts().geoModel,
        lithoLayers: [
          { status: 'accepted' },
          { status: 'pending' },
          { status: 'accepted' },
          { status: 'rejected' },
        ],
        hasLithoSolids: true,
      },
    }
    const state = deriveTutorialState(facts)
    expect(state.lithoAcceptedCount).toBe(2)
    expect(state.lithoSolidsBuilt).toBe(true)
  })

  // --- owner ruling 1 (2026-09-06): facts for the newly auto-advancing do-it
  // steps. Each is derived from real shell state so the step it backs "moves on
  // by itself when the user does what it says". ------------------------------

  it('flags projectSettingsOpen from the metadata dialog being open', () => {
    expect(deriveTutorialState(emptyFacts()).projectSettingsOpen).toBe(false)
    expect(
      deriveTutorialState({
        ...emptyFacts(),
        lifecycle: { currentLumping: null, metadataEditorOpen: true },
      }).projectSettingsOpen,
    ).toBe(true)
  })

  it('flags crsSet / datumSet when the project has a horizontal CRS / vertical datum chosen', () => {
    // No project → neither is set.
    expect(deriveTutorialState(emptyFacts()).crsSet).toBe(false)
    expect(deriveTutorialState(emptyFacts()).datumSet).toBe(false)
    // Project open but no CRS/datum picked → still unset.
    const open = deriveTutorialState({ ...emptyFacts(), project: openProject() })
    expect(open.crsSet).toBe(false)
    expect(open.datumSet).toBe(false)
    // A horizontal CRS chosen → crsSet true, datum still false.
    const crs = deriveTutorialState({
      ...emptyFacts(),
      project: { default_horizontal_epsg: 31370, default_vertical_epsg: null },
    })
    expect(crs.crsSet).toBe(true)
    expect(crs.datumSet).toBe(false)
    // A vertical datum chosen → datumSet true.
    const datum = deriveTutorialState({
      ...emptyFacts(),
      project: { default_horizontal_epsg: 31370, default_vertical_epsg: 5710 },
    })
    expect(datum.datumSet).toBe(true)
  })

  it('crsSet / datumSet move on as soon as a value is SELECTED in the dialog, before Save (owner ruling 1, 2026-09-06)', () => {
    // Owner's words: "the CRS step moves on as soon as a CRS is selected in the
    // dialog, before Save." The saved project still carries no horizontal CRS;
    // the dialog's DRAFT holds the chosen value, and that is enough.
    const crsDraft = deriveTutorialState({
      ...emptyFacts(),
      project: openProject(),
      lifecycle: { currentLumping: null, metadataEditorOpen: true },
      coordinator: {
        selectedId: null,
        selectedBoreholeId: null,
        metadataDraftHorizontalEpsg: 31370,
        metadataDraftVerticalEpsg: null,
      },
    })
    expect(crsDraft.crsSet).toBe(true)
    // The datum step has NOT been touched yet — its draft is still empty.
    expect(crsDraft.datumSet).toBe(false)
    // Selecting a vertical datum in the dialog advances the datum step the same
    // way, before Save.
    const datumDraft = deriveTutorialState({
      ...emptyFacts(),
      project: openProject(),
      lifecycle: { currentLumping: null, metadataEditorOpen: true },
      coordinator: {
        selectedId: null,
        selectedBoreholeId: null,
        metadataDraftHorizontalEpsg: null,
        metadataDraftVerticalEpsg: 5710,
      },
    })
    expect(datumDraft.datumSet).toBe(true)
  })

  it('flags twoSectionsExist only once a SECOND cross-section exists (owner ruling 3, 2026-09-06)', () => {
    // Owner ruling 3: the second-profile steps "must not ask for a second
    // profile that already exists". twoSectionsExist gates them — false at 0 or
    // 1 section, true at 2+, so the step completes instantly when two exist.
    expect(deriveTutorialState(emptyFacts()).twoSectionsExist).toBe(false)
    const one = deriveTutorialState({
      ...emptyFacts(),
      sections: { sections: [{ id: 's1' }], selectedSectionId: null, sectionModelAxis: 'geological' },
    })
    expect(one.twoSectionsExist).toBe(false)
    const two = deriveTutorialState({
      ...emptyFacts(),
      sections: {
        sections: [{ id: 's1' }, { id: 's2' }],
        selectedSectionId: null,
        sectionModelAxis: 'geological',
      },
    })
    expect(two.twoSectionsExist).toBe(true)
  })

  it('flags importMenuOpen from the coordinator', () => {
    expect(deriveTutorialState(emptyFacts()).importMenuOpen).toBe(false)
    expect(
      deriveTutorialState({
        ...emptyFacts(),
        coordinator: { selectedId: null, selectedBoreholeId: null, importMenuOpen: true },
      }).importMenuOpen,
    ).toBe(true)
  })

  it('flags lithoModelExists by the active litho-model handle (distinct from geo / geotech)', () => {
    expect(deriveTutorialState(emptyFacts()).lithoModelExists).toBe(false)
    expect(
      deriveTutorialState({
        ...emptyFacts(),
        geoModel: { ...emptyFacts().geoModel, activeLithoModel: { id: 'l1' } },
      }).lithoModelExists,
    ).toBe(true)
  })

  it('flags lithoAxisActive / geotechAxisActive from the sections toolbar axis', () => {
    expect(deriveTutorialState(emptyFacts()).lithoAxisActive).toBe(false)
    expect(deriveTutorialState(emptyFacts()).geotechAxisActive).toBe(false)
    const litho = deriveTutorialState({
      ...emptyFacts(),
      sections: { sections: [], selectedSectionId: null, sectionModelAxis: 'lithostratigraphic' },
    })
    expect(litho.lithoAxisActive).toBe(true)
    expect(litho.geotechAxisActive).toBe(false)
    const geotech = deriveTutorialState({
      ...emptyFacts(),
      sections: { sections: [], selectedSectionId: null, sectionModelAxis: 'geotechnical' },
    })
    expect(geotech.geotechAxisActive).toBe(true)
    expect(geotech.lithoAxisActive).toBe(false)
  })

  it('flags sectionOpen when a cross-section is selected', () => {
    expect(deriveTutorialState(emptyFacts()).sectionOpen).toBe(false)
    expect(
      deriveTutorialState({
        ...emptyFacts(),
        sections: { sections: [], selectedSectionId: 's1', sectionModelAxis: 'geological' },
      }).sectionOpen,
    ).toBe(true)
  })

  it('flags geoSurfacesBuilt when formation surfaces exist, geotechSolidsBuilt from the flag', () => {
    expect(deriveTutorialState(emptyFacts()).geoSurfacesBuilt).toBe(false)
    expect(deriveTutorialState(emptyFacts()).geotechSolidsBuilt).toBe(false)
    const built = deriveTutorialState({
      ...emptyFacts(),
      geoModel: {
        ...emptyFacts().geoModel,
        surfacesByFormationId: new Map([['f1', {}]]),
        hasGeotechSolids: true,
      },
    })
    expect(built.geoSurfacesBuilt).toBe(true)
    expect(built.geotechSolidsBuilt).toBe(true)
  })
})
