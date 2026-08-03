/**
 * What an "overwrite" Fill run would remove — the list the confirmation names.
 *
 * Rules pinned:
 *   S1  a formation left out of the selection is doomed
 *   S2  a selected formation is not, punctuation and case notwithstanding
 *   S3  a formation with no contact in this model is out of scope entirely
 *       (formations are a project-wide vocabulary shared with the litho /
 *       geotech sibling models — the server's delete cannot reach it)
 *   S4  a pure addition dooms nothing
 */

import { describe, expect, it } from 'vitest'

import { computeDoomedFormations } from './formationDeletionScope'

const QUARTAIR = { id: 'f-1', name: 'Quartair', regional_ref: null }
const BOOM = { id: 'f-2', name: 'Boom Klei', regional_ref: null }
const AALTER = {
  id: 'f-3',
  name: 'Zand',
  regional_ref: 'Paleogeen: Formatie van Aalter',
}

describe('computeDoomedFormations', () => {
  it('S1: names a formation the selection left out', () => {
    const doomed = computeDoomedFormations(
      [QUARTAIR, BOOM],
      [{ formation_id: 'f-1' }, { formation_id: 'f-2' }],
      new Set(['quartair']),
    )
    expect(doomed).toEqual([{ id: 'f-2', name: 'Boom Klei' }])
  })

  it('S2: a selected formation survives even when its ref carries punctuation', () => {
    // The server compares normalised keys; a raw lowercase comparison would
    // read "paleogeen: formatie van aalter" as a different unit and report a
    // deletion that is not going to happen.
    const doomed = computeDoomedFormations(
      [AALTER],
      [{ formation_id: 'f-3' }],
      new Set(['paleogeen formatie van aalter']),
    )
    expect(doomed).toEqual([])
  })

  it('S3: a formation with no contact in this model is out of scope', () => {
    const doomed = computeDoomedFormations(
      [QUARTAIR, BOOM],
      [{ formation_id: 'f-1' }], // Boom Klei lives only in a sibling model
      new Set(['quartair']),
    )
    expect(doomed).toEqual([])
  })

  it('S4: a pure addition dooms nothing', () => {
    const doomed = computeDoomedFormations(
      [QUARTAIR],
      [{ formation_id: 'f-1' }],
      new Set(['quartair', 'a brand new unit']),
    )
    expect(doomed).toEqual([])
  })
})
