/**
 * The Build pre-flight, in the owner's own words.
 *
 * Owner ruling 2026-08-26: *"yes that suggestion is fine, these 2 tests… but
 * ofcourse make it so that user can go to those test through one click. Build
 * without them should produce the model that was there before the added tests,
 * so just plain ignore them."* — serving *"I can't have gaps or fallbacks in the
 * model unless users make mistakes."*
 *
 * Every case below is phrased against what the ENGINEER sees, not against an
 * internal variable: a test he imported and forgot to subdivide, a test he
 * banded by hand, a test that is nowhere near a section, and a tie-section that
 * loses its second column.
 */

import { describe, expect, it } from 'vitest'

import { geotechBuildPreflight } from './geotechBuildPreflight'
import type {
  PreflightInvestigation,
  PreflightLayer,
  PreflightSection,
} from './geotechBuildPreflight'

// --------------------------------------------------------------------------
// Scene: one long cross-section along the X axis carrying S1, S2 and B12, plus
// a short tie-section that carries only S2 and B12.
//
//   x=0        x=50        x=100
//   S1----------S2----------B12      CS1  (buffer 10)
//               S2----------B12      TIE4 (buffer 5)
// --------------------------------------------------------------------------

const CS1: PreflightSection = {
  id: 'cs1',
  name: 'Cross-section 1',
  start_x: 0,
  start_y: 0,
  end_x: 100,
  end_y: 0,
  projection_buffer_m: 10,
}

const TIE4: PreflightSection = {
  id: 'tie4',
  name: 'Tie-section 4',
  start_x: 50,
  start_y: 0,
  end_x: 100,
  end_y: 0,
  projection_buffer_m: 5,
}

function investigation(id: string, x: number): PreflightInvestigation {
  return { id, name: id, location_x: x, location_y: 0, elevation_m: 5 }
}

const S1 = investigation('S1', 0)
const S2 = investigation('S2', 50)
const B12 = investigation('B12', 100)

/** One accepted layer on ``investigationId`` — the whole column, 0–5 m. */
function layer(investigationId: string, suffix: string): PreflightLayer {
  return {
    id: `${investigationId}-${suffix}`,
    cpt_id: investigationId,
    borehole_id: null,
    formation_id: `f-${suffix}`,
    body_id: null,
    depth_top_m: 0,
    depth_base_m: 5,
    status: 'accepted',
  }
}

const LITHO_ALL = [layer('S1', 'litho'), layer('S2', 'litho'), layer('B12', 'litho')]

describe('geotechBuildPreflight — the tests the Build press has to ask about', () => {
  it('PF1 — a test that is in the model with accepted litho and no packing bands at all is flagged', () => {
    const result = geotechBuildPreflight({
      visibleSections: [CS1],
      investigations: [S1, S2, B12],
      lithoLayers: LITHO_ALL,
      // S1 and S2 were subdivided; B12 was imported afterwards and never was.
      geotechLayers: [layer('S1', 'nad'), layer('S2', 'nad')],
    })
    expect(result.unbandedTests.map(t => t.investigationId)).toEqual(['B12'])
    expect(result.unbandedTests[0].name).toBe('B12')
  })

  it('PF2 — a test the engineer already banded by hand is never flagged', () => {
    const result = geotechBuildPreflight({
      visibleSections: [CS1],
      investigations: [S1, S2, B12],
      lithoLayers: LITHO_ALL,
      geotechLayers: [layer('S1', 'nad'), layer('S2', 'nad'), layer('B12', 'nad')],
    })
    expect(result.unbandedTests).toEqual([])
  })

  it('PF3 — a test that reaches no section is not in the model, so it is never flagged', () => {
    // B99 sits 500 m off the line: outside every corridor, so the build never
    // saw it and never will. Flagging it would send the engineer to subdivide
    // something that changes nothing.
    const B99 = { ...investigation('B99', 50), location_y: 500 }
    const result = geotechBuildPreflight({
      visibleSections: [CS1],
      investigations: [S1, S2, B12, B99],
      lithoLayers: [...LITHO_ALL, layer('B99', 'litho')],
      geotechLayers: [layer('S1', 'nad'), layer('S2', 'nad'), layer('B12', 'nad')],
    })
    expect(result.unbandedTests).toEqual([])
  })

  it('PF4 — a test whose only section has no second column is not something the build draws between', () => {
    // LONE carries one column, so the litho frame drops that section outright —
    // there is no gap to fill, banded or not.
    const LONE: PreflightSection = { ...CS1, id: 'lone', name: 'Lone', projection_buffer_m: 1 }
    const OFFLINE = { ...investigation('OFF', 30), location_y: 40 }
    const result = geotechBuildPreflight({
      visibleSections: [{ ...LONE, start_x: 25, end_x: 35 }],
      investigations: [OFFLINE, investigation('ONLY', 30)],
      lithoLayers: [layer('OFF', 'litho'), layer('ONLY', 'litho')],
      geotechLayers: [],
    })
    expect(result.unbandedTests).toEqual([])
  })

  it('PF5 — a test with litho but zero bands is flagged even when nothing else is banded either', () => {
    const result = geotechBuildPreflight({
      visibleSections: [CS1],
      investigations: [S1, S2, B12],
      lithoLayers: LITHO_ALL,
      geotechLayers: [],
    })
    expect(result.unbandedTests.map(t => t.investigationId).sort()).toEqual(['B12', 'S1', 'S2'])
  })
})

describe('geotechBuildPreflight — the section-drop consequence', () => {
  it('SD1 — a tie-section left with one banded column drops out of the build, named under the test', () => {
    const result = geotechBuildPreflight({
      visibleSections: [CS1, TIE4],
      investigations: [S1, S2, B12],
      lithoLayers: LITHO_ALL,
      geotechLayers: [layer('S1', 'nad'), layer('S2', 'nad')],
    })
    const [b12] = result.unbandedTests
    expect(b12.investigationId).toBe('B12')
    // CS1 still has S1 + S2 between which to fill, so it survives; TIE4 has
    // only S2 left and contributes nothing between columns.
    expect(b12.droppedSections.map(s => s.sectionName)).toEqual(['Tie-section 4'])
    expect(b12.droppedSections.map(s => s.sectionId)).toEqual(['tie4'])
  })

  it('SD2 — a section that keeps two banded columns is not reported as dropped', () => {
    const result = geotechBuildPreflight({
      visibleSections: [CS1],
      investigations: [S1, S2, B12],
      lithoLayers: LITHO_ALL,
      geotechLayers: [layer('S1', 'nad'), layer('S2', 'nad')],
    })
    expect(result.unbandedTests[0].droppedSections).toEqual([])
  })

  it('SD3 — a complete model asks nothing: no flagged tests, so no dialog', () => {
    const result = geotechBuildPreflight({
      visibleSections: [CS1, TIE4],
      investigations: [S1, S2, B12],
      lithoLayers: LITHO_ALL,
      geotechLayers: [layer('S1', 'nad'), layer('S2', 'nad'), layer('B12', 'nad')],
    })
    expect(result.unbandedTests).toEqual([])
  })
})

describe('geotechBuildPreflight — where one click sends the engineer', () => {
  it('NV1 — the visit lands on the first section that carries the test, in the order he sees them', () => {
    const result = geotechBuildPreflight({
      visibleSections: [CS1, TIE4],
      investigations: [S1, S2, B12],
      lithoLayers: LITHO_ALL,
      geotechLayers: [layer('S1', 'nad'), layer('S2', 'nad')],
    })
    const [b12] = result.unbandedTests
    expect(b12.sectionIds).toEqual(['cs1', 'tie4'])
    expect(b12.revealSectionId).toBe('cs1')
  })

  it('NV2 — with the tie-section listed first, the visit lands there instead', () => {
    const result = geotechBuildPreflight({
      visibleSections: [TIE4, CS1],
      investigations: [S1, S2, B12],
      lithoLayers: LITHO_ALL,
      geotechLayers: [layer('S1', 'nad'), layer('S2', 'nad')],
    })
    expect(result.unbandedTests[0].revealSectionId).toBe('tie4')
  })
})
