// The canvas group-expansion (debt #278 D2, owner ruling 2026-09-02): selecting
// a grouped geotech body pools the whole group. This is the pure hinge — given
// the selected scope and the group map, produce the EFFECTIVE scope the
// statistics / header / fence all read.
//
// EG1 — a geotech-body in a multi-member group expands to a geotech-group scope.
// EG2 — a geotech-body in NO group is unchanged (pools only itself).
// EG3 — a non-geotech-body scope is never touched.

import { describe, expect, it } from 'vitest'

import type { ParameterUnitScope } from '../../ShellContext'
import { effectiveGroupScope } from './groupScope'

describe('effectiveGroupScope — expand a selected grouped body to its group (D2)', () => {
  it('EG1 — a grouped geotech-body becomes a geotech-group scope pooling all members', () => {
    const ordinals = new Map([
      ['gA', 1],
      ['gB', 1],
    ])
    const scope: ParameterUnitScope = { kind: 'geotech-body', unitId: 'u', bodyId: 'gA' }
    const eff = effectiveGroupScope(scope, ordinals)
    expect(eff).toEqual({
      kind: 'geotech-group',
      unitId: 'u',
      groupNumber: 1,
      memberBodyIds: ['gA', 'gB'],
    })
  })

  it('EG2 — an ungrouped geotech-body is returned unchanged', () => {
    const ordinals = new Map([['gA', 1], ['gB', 1]])
    const scope: ParameterUnitScope = { kind: 'geotech-body', unitId: 'u', bodyId: 'solo' }
    expect(effectiveGroupScope(scope, ordinals)).toBe(scope)
  })

  it('EG3 — a non-geotech-body scope is never expanded', () => {
    const ordinals = new Map([['gA', 1], ['gB', 1]])
    const litho: ParameterUnitScope = { kind: 'litho-body', unitId: 'u', bodyId: 'gA' }
    expect(effectiveGroupScope(litho, ordinals)).toBe(litho)
    const classScope: ParameterUnitScope = {
      kind: 'geotech-class',
      lithoUnitId: 'u',
      lithoBodyId: 'lb',
      nadClass: 13,
    }
    expect(effectiveGroupScope(classScope, ordinals)).toBe(classScope)
  })
})
