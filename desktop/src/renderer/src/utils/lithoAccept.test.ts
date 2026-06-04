// Tests for the litho-accept builders (#167).
//
//   LA1  tuning params reads the couple knob from view-state.
//   LA2  body carries cpt_id (not borehole_id) for a cpt anchor + tuning.
//   LA3  body carries borehole_id for a borehole anchor; null section passes through.
//   LA4  recordCreatedRows adds each kind only when non-empty.

import { describe, expect, it, vi } from 'vitest'

import {
  buildLithoAcceptBody,
  lithoAcceptTuningParams,
  recordCreatedRows,
} from './lithoAccept'

// A view-state with the couple knob set away from the default so we can see
// it flow through verbatim.
const viewState = {
  litho_segmenter: {
    litho_snap_tolerance_m: 0.5,
  },
}

describe('lithoAccept builders (#167)', () => {
  it('LA1 — tuning params reads the couple knob from view-state', () => {
    expect(lithoAcceptTuningParams(viewState)).toEqual({
      couple_tolerance_m: 0.5,
    })
  })

  it('LA2 — cpt anchor body has cpt_id + suggestions + tuning, no borehole_id', () => {
    const body = buildLithoAcceptBody({
      anchorKind: 'cpt',
      anchorId: 'c1',
      sectionId: 's1',
      suggestions: [],
      viewState,
    })
    expect(body.cpt_id).toBe('c1')
    expect(body.borehole_id).toBeUndefined()
    expect(body.section_id).toBe('s1')
    expect(body.couple_tolerance_m).toBe(0.5)
  })

  it('LA3 — borehole anchor body has borehole_id; undefined section → null', () => {
    const body = buildLithoAcceptBody({
      anchorKind: 'borehole',
      anchorId: 'b1',
      sectionId: undefined,
      suggestions: [],
      viewState,
    })
    expect(body.borehole_id).toBe('b1')
    expect(body.cpt_id).toBeUndefined()
    expect(body.section_id).toBeNull()
  })

  it('LA4 — recordCreatedRows adds each kind only when non-empty', () => {
    const add = vi.fn()
    recordCreatedRows(add, { created_formation_ids: ['f1'], created_contact_ids: [] })
    expect(add).toHaveBeenCalledTimes(1)
    expect(add).toHaveBeenCalledWith('formation', ['f1'])

    add.mockClear()
    recordCreatedRows(add, { created_formation_ids: [], created_contact_ids: ['c1', 'c2'] })
    expect(add).toHaveBeenCalledTimes(1)
    expect(add).toHaveBeenCalledWith('contact', ['c1', 'c2'])

    add.mockClear()
    recordCreatedRows(add, { created_formation_ids: [], created_contact_ids: [] })
    expect(add).not.toHaveBeenCalled()
  })
})
