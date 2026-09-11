// Red-first pins for the unit-tree SELECTION helpers — owner dogfeed
// 2026-09-11, verbatim: "if i click a unit from that group, it should highlight
// the whole group in the right hand pane and show the whole group together in
// the parameter pane."
//
// Two pure hinges carry that rule:
//   * ``selectionScopeForNode`` — what a click on a row SELECTS. A grouped row
//     selects the GROUP (so the parameter pane pools every member); every other
//     row keeps selecting its own scope, exactly as before.
//   * ``isRowSelected`` — which rows render in the selected style. A group
//     selection marks EVERY member row, not just the one that was clicked.
//
// ``ancestorsOfSelection`` then reveals the members that sit under a collapsed
// parent — a row that is not rendered cannot be highlighted.

import { describe, expect, it } from 'vitest'

import type { ParameterUnitScope } from '../../ShellContext'
import type { ParameterTreeNode } from './parameterBodyTree'
import {
  ancestorsOfSelection,
  flattenVisible,
  isRowSelected,
  selectionScopeForNode,
} from './unitTreeView'

/** A tree node with only the fields these helpers read. */
function node(over: Partial<ParameterTreeNode> & { scope: ParameterUnitScope }): ParameterTreeNode {
  return {
    label: 'row',
    bandCount: 1,
    coneBandCount: 1,
    children: [],
    ...over,
  }
}

/**
 * The owner's shape: ZAND ▸ two litho bodies, each with ONE loose-sand geotech
 * body, so both class rows are leaves that stand for their own body. The two
 * bodies (gLos0 under Zand #0, gLos2 under Zand #2) are joined into group 1.
 */
function twoParentScene(): ParameterTreeNode[] {
  const loose = (lithoBodyId: string, bodyId: string, groupNumber: number | null) =>
    node({
      scope: { kind: 'geotech-class', lithoUnitId: 'zand', lithoBodyId, nadClass: 5 },
      label: 'SAND, loose',
      groupableBodyId: bodyId,
      groupableBodyUnitId: 'zand-los',
      groupNumber,
    })
  return [
    node({
      scope: { kind: 'litho-unit', unitId: 'zand' },
      label: 'ZAND',
      children: [
        node({
          scope: { kind: 'litho-body', unitId: 'zand', bodyId: 'zb0' },
          label: 'ZAND · #0',
          children: [loose('zb0', 'gLos0', 1)],
        }),
        node({
          scope: { kind: 'litho-body', unitId: 'zand', bodyId: 'zb2' },
          label: 'ZAND · #2',
          children: [loose('zb2', 'gLos2', 1)],
        }),
      ],
    }),
  ]
}

const GROUP_1: ReadonlyMap<string, number> = new Map([
  ['gLos0', 1],
  ['gLos2', 1],
])

describe('unitTreeView — clicking a unit from a group (owner dogfeed 2026-09-11)', () => {
  it('UT-S1 — clicking a unit from that group shows the whole group together in the parameter pane', () => {
    const clicked = twoParentScene()[0].children[0].children[0]
    const scope = selectionScopeForNode(clicked, GROUP_1)
    // The selection is the GROUP, carrying both members — what the canvas pools.
    expect(scope).toEqual({
      kind: 'geotech-group',
      unitId: 'zand-los',
      groupNumber: 1,
      memberBodyIds: ['gLos0', 'gLos2'],
    })
  })

  it('UT-S2 — a row that is in no group still selects its own scope (nothing else changes)', () => {
    const ungrouped = node({
      scope: { kind: 'geotech-class', lithoUnitId: 'zand', lithoBodyId: 'zb5', nadClass: 6 },
      groupableBodyId: 'gMd5',
      groupableBodyUnitId: 'zand-md',
      groupNumber: null,
    })
    expect(selectionScopeForNode(ungrouped, GROUP_1)).toBe(ungrouped.scope)

    // A litho body has no groupable body at all — untouched.
    const lithoBody = twoParentScene()[0].children[0]
    expect(selectionScopeForNode(lithoBody, GROUP_1)).toBe(lithoBody.scope)
  })

  it('UT-S3 — it highlights the whole group in the right hand pane: every member row reads selected', () => {
    const tree = twoParentScene()
    const selected = selectionScopeForNode(tree[0].children[0].children[0], GROUP_1)
    const memberA = tree[0].children[0].children[0]
    const memberB = tree[0].children[1].children[0]
    expect(isRowSelected(memberA, selected)).toBe(true)
    // The member under the OTHER litho parent — the one the user did not click.
    expect(isRowSelected(memberB, selected)).toBe(true)
    // Ancestors and unrelated rows stay unselected.
    expect(isRowSelected(tree[0], selected)).toBe(false)
    expect(isRowSelected(tree[0].children[1], selected)).toBe(false)
  })

  it('UT-S4 — a plain (ungrouped) selection still highlights exactly the clicked row', () => {
    const tree = twoParentScene()
    const lithoBody = tree[0].children[0]
    expect(isRowSelected(lithoBody, lithoBody.scope)).toBe(true)
    expect(isRowSelected(tree[0].children[1], lithoBody.scope)).toBe(false)
    expect(isRowSelected(lithoBody, null)).toBe(false)
  })

  it('UT-S5 — the path to every member opens, so a member under another parent is on screen to be highlighted', () => {
    const tree = twoParentScene()
    const selected = selectionScopeForNode(tree[0].children[0].children[0], GROUP_1)
    const open = ancestorsOfSelection(tree, n => isRowSelected(n, selected))
    // Both litho parents (and the unit above them) open — not only the clicked one.
    expect(open.has('litho-body:zand:zb0')).toBe(true)
    expect(open.has('litho-body:zand:zb2')).toBe(true)
    expect(open.has('litho-unit:zand')).toBe(true)

    // ...so both member rows are actually rendered.
    const rows = flattenVisible(tree, key => open.has(key), 0)
    const selectedRows = rows.filter(r => isRowSelected(r.node, selected))
    expect(selectedRows).toHaveLength(2)
  })
})
