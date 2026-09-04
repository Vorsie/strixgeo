// Pure view helpers for the Parameters unit tree — the expand/flatten/collect
// walks ``UnitListPane`` runs over ``ParameterTreeNode[]``. Extracted so the
// pane stays under the 500-line god-component cap (debt #201); every function
// here is pure (no React, no ``useShell``), so it is unit-testable on its own
// and the pane keeps only the state + listbox a11y.

import type { ParameterTreeNode } from './parameterBodyTree'
import { scopeKey } from './parameterBodyTree'

/** One visible tree row after the expand state is applied. */
export interface FlatRow {
  node: ParameterTreeNode
  depth: number
}

/**
 * The keys of every ancestor of the selected node (not the node itself), so a
 * jump-arrived selection expands its whole path (PU17 precedent).
 *
 * Parameters
 * ----------
 * nodes
 *     The tree roots.
 * selectedKey
 *     The selected node's ``scopeKey``, or ``null`` when nothing is selected.
 *
 * Returns
 * -------
 * ReadonlySet<string>
 *     The ancestor keys; empty when nothing is selected or found.
 */
export function ancestorsOfSelection(
  nodes: readonly ParameterTreeNode[],
  selectedKey: string | null,
): ReadonlySet<string> {
  const out = new Set<string>()
  if (selectedKey === null) return out
  const walk = (node: ParameterTreeNode, ancestors: string[]): boolean => {
    if (scopeKey(node.scope) === selectedKey) {
      for (const a of ancestors) out.add(a)
      return true
    }
    const nextAncestors = [...ancestors, scopeKey(node.scope)]
    return node.children.some(child => walk(child, nextAncestors))
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
