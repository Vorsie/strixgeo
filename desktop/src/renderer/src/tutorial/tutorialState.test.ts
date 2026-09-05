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
    sections: { sections: [] },
    geoModel: {
      activeGeologicalModel: null,
      contacts: [],
      lithoLayers: [],
      hasLithoSolids: false,
      activeGeotechModel: null,
    },
    lifecycle: { currentLumping: null },
    coordinator: { selectedId: null, selectedBoreholeId: null },
  }
}

describe('deriveTutorialState', () => {
  it('reads projectOpen false when no project is open, true once one is', () => {
    expect(deriveTutorialState(emptyFacts()).projectOpen).toBe(false)
    expect(deriveTutorialState({ ...emptyFacts(), project: { id: 'p1' } }).projectOpen).toBe(true)
  })

  it('counts the visible CPTs and boreholes ("done: CPT count > 0")', () => {
    const facts: TutorialShellFacts = {
      ...emptyFacts(),
      project: { id: 'p1' },
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
      sections: { sections: [{ id: 's1' }, { id: 's2' }, { id: 's3' }] },
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
      lifecycle: { currentLumping: { map: { a: 'Sand', b: 'Sand' } } },
    }
    const state = deriveTutorialState(withLumping)
    expect(state.contactCount).toBe(2)
    expect(state.lumpingCount).toBe(2)
    // An empty (or absent) lumping is not "a lumping exists".
    expect(deriveTutorialState(emptyFacts()).lumpingCount).toBe(0)
    expect(
      deriveTutorialState({ ...emptyFacts(), lifecycle: { currentLumping: { map: {} } } })
        .lumpingCount,
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
})
