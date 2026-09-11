// Pure view helpers for the Parameters unit tree — the expand/flatten/collect
// walks ``UnitListPane`` runs over ``ParameterTreeNode[]``. Extracted so the
// pane stays under the 500-line god-component cap (debt #201); every function
// here is pure (no React, no ``useShell``), so it is unit-testable on its own
// and the pane keeps only the state + listbox a11y.

import type { ParameterUnitScope } from '../../ShellContext'
import type { ParameterTreeNode } from './parameterBodyTree'
import { scopeKey } from './parameterBodyTree'
import { effectiveGroupScope } from './groupScope'

/** One visible tree row after the expand state is applied. */
export interface FlatRow {
  node: ParameterTreeNode
  depth: number
}

/**
 * The scope a CLICK on a row selects.
 *
 * Owner dogfeed 2026-09-11, verbatim: "if i click a unit from that group, it
 * should highlight the whole group in the right hand pane and show the whole
 * group together in the parameter pane." So a row that stands for a body in a
 * multi-member group selects the GROUP — the aggregate the canvas pools through
 * ``bandsForScope`` — while every other row keeps selecting its own scope, which
 * is what the counts on that row already state.
 *
 * The body → group hinge is ``effectiveGroupScope``, the SAME one the canvas
 * used to apply on its own, so the tree and the canvas can never disagree on who
 * is in a group.
 *
 * Parameters
 * ----------
 * node
 *     The clicked row.
 * groupOrdinals
 *     ``geotechGroupOrdinals`` map (``body id → group number``); empty when
 *     nothing is grouped.
 *
 * Returns
 * -------
 * ParameterUnitScope
 *     The group scope for a grouped row, else the node's own ``scope``
 *     (the same reference, so a memo keyed on it does not recompute).
 */
export function selectionScopeForNode(
  node: ParameterTreeNode,
  groupOrdinals: ReadonlyMap<string, number>,
): ParameterUnitScope {
  const bodyId = node.groupableBodyId
  const unitId = node.groupableBodyUnitId
  if (bodyId === undefined || unitId === undefined) return node.scope
  const expanded = effectiveGroupScope({ kind: 'geotech-body', unitId, bodyId }, groupOrdinals)
  return expanded.kind === 'geotech-group' ? expanded : node.scope
}

/**
 * Whether a row renders in the SELECTED style.
 *
 * Normally that is scope identity. The exception is a group selection: "it
 * should highlight the whole group in the right hand pane" (owner 2026-09-11),
 * so EVERY member row reads selected, not only the one that was clicked — the
 * members sit under different litho parents, which is exactly why the group
 * exists.
 *
 * Parameters
 * ----------
 * node
 *     The row to judge.
 * selected
 *     The stage's selected scope, or ``null`` when nothing is selected.
 *
 * Returns
 * -------
 * boolean
 *     True when the row is the selection or a member of the selected group.
 */
export function isRowSelected(
  node: ParameterTreeNode,
  selected: ParameterUnitScope | null,
): boolean {
  if (selected === null) return false
  if (scopeKey(node.scope) === scopeKey(selected)) return true
  if (selected.kind !== 'geotech-group') return false
  const bodyId = node.groupableBodyId
  return bodyId !== undefined && selected.memberBodyIds.includes(bodyId)
}

/**
 * The keys of every ancestor of a selected row (never the row itself), so a
 * jump-arrived selection expands its whole path (PU17 precedent) — and so a
 * GROUP selection opens the path to every member, since a row that is not
 * rendered cannot be highlighted (owner 2026-09-11).
 *
 * Parameters
 * ----------
 * nodes
 *     The tree roots.
 * isSelectedRow
 *     Whether a node renders as selected — ``isRowSelected`` bound to the
 *     current selection. A predicate rather than one key because a group
 *     selection marks SEVERAL rows, each needing its own path opened.
 *
 * Returns
 * -------
 * ReadonlySet<string>
 *     The ancestor keys; empty when no row is selected.
 */
export function ancestorsOfSelection(
  nodes: readonly ParameterTreeNode[],
  isSelectedRow: (node: ParameterTreeNode) => boolean,
): ReadonlySet<string> {
  const out = new Set<string>()
  const walk = (node: ParameterTreeNode, ancestors: string[]): void => {
    if (isSelectedRow(node)) for (const a of ancestors) out.add(a)
    const nextAncestors = [...ancestors, scopeKey(node.scope)]
    node.children.forEach(child => walk(child, nextAncestors))
  }
  nodes.forEach(node => walk(node, []))
  return out
}

/**
 * The keys of litho-body nodes that open by DEFAULT — a litho body whose only
 * child is its single packing class.
 *
 * Owner ruling 2026-09-02 (verbatim: "i see some litho bodies whose submenus i
 * cannot open ... only one packing class ... don't collapse because the
 * pakkingsdichtheid label disappears"): a single-class litho body must show
 * that class row — the pakkingsdichtheid label — without an extra click. Each
 * such key is SEEDED open once, into the real expand state (see the effect in
 * ``UnitListPane``), so the row stays a normal, fully collapsible tree node
 * rather than a force-open one with an inert chevron.
 *
 * Parameters
 * ----------
 * nodes
 *     The tree roots.
 *
 * Returns
 * -------
 * ReadonlySet<string>
 *     The keys of single-class litho-body nodes.
 */
export function defaultOpenLithoBodyKeys(
  nodes: readonly ParameterTreeNode[],
): ReadonlySet<string> {
  const out = new Set<string>()
  const walk = (node: ParameterTreeNode): void => {
    if (
      node.scope.kind === 'litho-body' &&
      node.children.length === 1 &&
      node.children[0].scope.kind === 'geotech-class'
    ) {
      out.add(scopeKey(node.scope))
    }
    node.children.forEach(walk)
  }
  nodes.forEach(walk)
  return out
}

/**
 * Flatten the tree to the rows currently visible, in display order.
 *
 * Parameters
 * ----------
 * nodes
 *     The tree roots (or a subtree, on recursion).
 * isOpen
 *     Whether a node key is currently expanded.
 * depth
 *     The current indentation depth.
 *
 * Returns
 * -------
 * FlatRow[]
 *     The visible rows, parents before their open children.
 */
export function flattenVisible(
  nodes: readonly ParameterTreeNode[],
  isOpen: (key: string) => boolean,
  depth: number,
): FlatRow[] {
  const rows: FlatRow[] = []
  for (const node of nodes) {
    rows.push({ node, depth })
    if (node.children.length > 0 && isOpen(scopeKey(node.scope))) {
      rows.push(...flattenVisible(node.children, isOpen, depth + 1))
    }
  }
  return rows
}

/**
 * How many groupable bodies in a node's SUBTREE are currently checked
 * (ux-reviewer 2026-09-04). A collapsed ancestor renders this count so a tick
 * hidden inside it is not invisible — the only selection UI otherwise is the
 * top-of-list total, which does not say WHERE the checked bodies are.
 *
 * The node's OWN ``groupableBodyId`` is excluded — a collapsed litho unit/body
 * has none, and this is called only for expandable-but-collapsed rows, whose own
 * row is never itself a checkbox.
 *
 * Parameters
 * ----------
 * node
 *     The (collapsed) ancestor row whose descendants to count.
 * isChecked
 *     Whether a geotech body id is currently checked.
 *
 * Returns
 * -------
 * number
 *     The count of checked groupable bodies strictly below ``node``.
 */
export function checkedDescendantCount(
  node: ParameterTreeNode,
  isChecked: (bodyId: string) => boolean,
): number {
  let count = 0
  const walk = (n: ParameterTreeNode): void => {
    const id = n.groupableBodyId
    if (id !== undefined && isChecked(id)) count += 1
    n.children.forEach(walk)
  }
  node.children.forEach(walk)
  return count
}
