// Deterministic numbering of the manual body groups (debt #278 D4).
//
// A "group" is a connected component of the manual body-UNION pairs — the
// "Join with…" verb, by which the engineer declares two geometrically-separate
// bodies to be the SAME mass. The server stores each union in layer space and
// reports each anchor's CURRENT body, but it issues NO group id or ordinal, so
// the pane derives one here: union-find over the pairs' body ids, then the
// resulting components numbered in a stable order.
//
// Why derived, not stored: a union is a fact about a PAIR; "these three are one
// group" is the transitive closure of several pairs, recomputed every time a
// union is added or lifted. Numbering it in the client keeps the pane honest
// without a second server round-trip and without a schema field that would have
// to be kept in sync with the union set.
//
// Lives under ``utils/`` because BOTH the Geotechnical units roster and the
// Parameters body tree read it (owner ruling 2026-09-02: the "(group N)" tag
// rides both right panes). One copy, no duplication — see ``geotechRosterRows``
// and ``parameterBodyTree`` / ``UnitStatisticsCanvas``.
//
// Deliberately NOT here: the group SUGGESTION heuristic (PSD / proximity) — a
// Phase-5 follow-up. This module only reflects unions the engineer already made.

import type { BodyUnionListItem } from '../api/client'

/** One anchor of a union pair — the current body it resolves to. */
export interface GeotechGroupAnchor {
  /** The body the anchor currently belongs to; ``null`` when unstamped. */
  bodyId: string | null
  /** The body's ordinal within its naming group; ``null`` when unstamped. */
  bodyOrdinal: number | null
}

/** One manual body-union pair (a ``BodyUnionListItem``'s two anchors). */
export interface GeotechGroupPair {
  a: GeotechGroupAnchor
  b: GeotechGroupAnchor
}

/** Ordinals are optional on an unstamped anchor; treat a missing one as "sorts
 *  last" so a real ordinal always wins the min-ordinal comparison. */
const NO_ORDINAL = Number.MAX_SAFE_INTEGER

/**
 * Adapt the API's ``BodyUnionListItem`` rows to the pure ``GeotechGroupPair``
 * input — the ONE place the anchor→pair shape is read, so all three consumers
 * (the geotech roster, the Parameters unit list, the Parameters canvas) agree.
 *
 * @param unions  The model's unions (``GET .../body-unions``), or undefined.
 * @returns  One pair per union, each carrying both anchors' current body.
 */
export function bodyUnionsToGroupPairs(
  unions: readonly BodyUnionListItem[] | undefined,
): GeotechGroupPair[] {
  return (unions ?? []).map(u => ({
    a: { bodyId: u.anchor_a.body_id, bodyOrdinal: u.anchor_a.body_ordinal },
    b: { bodyId: u.anchor_b.body_id, bodyOrdinal: u.anchor_b.body_ordinal },
  }))
}

/**
 * Number the manual body groups: ``body id → group number`` (1-based).
 *
 * Only bodies in a MULTI-member component appear in the map — a body joined to
 * nothing (or joined only to an unstamped anchor) is a singleton and carries no
 * tag. Every union pair connects two DISTINCT stamped bodies, so any body that
 * appears in one is by definition in a component of size ≥ 2; a null-anchored or
 * self-paired body never unions and stays absent.
 *
 * Numbering order (so the same project always reads "group 1" for the same set):
 * components are sorted by their lowest ``bodyOrdinal``, ties broken by their
 * lowest ``bodyId``, then numbered 1, 2, ….
 *
 * Parameters
 * ----------
 * pairs
 *     The model's union pairs (each carries both anchors' current body).
 *
 * Returns
 * -------
 * Map<string, number>
 *     ``body id → group number`` for every body in a multi-member group; empty
 *     when there are no groups.
 */
export function geotechGroupOrdinals(pairs: readonly GeotechGroupPair[]): Map<string, number> {
  // --- Union-find over stamped body ids ---
  const parent = new Map<string, string>()
  const ordinalOf = new Map<string, number>()

  const ensure = (id: string, ordinal: number | null): void => {
    if (!parent.has(id)) parent.set(id, id)
    // Keep the smallest ordinal ever seen for a body (anchors report the same
    // body's ordinal identically, but a defensive min costs nothing).
    const seen = ordinalOf.get(id)
    const next = ordinal ?? NO_ORDINAL
    if (seen === undefined || next < seen) ordinalOf.set(id, next)
  }

  const find = (id: string): string => {
    let root = id
    while (parent.get(root) !== root) root = parent.get(root) as string
    // Path-compress so repeated finds stay flat.
    let cur = id
    while (parent.get(cur) !== root) {
      const nextNode = parent.get(cur) as string
      parent.set(cur, root)
      cur = nextNode
    }
    return root
  }

  const union = (x: string, y: string): void => {
    const rx = find(x)
    const ry = find(y)
    if (rx === ry) return
    // Attach the greater-id root under the lesser, for a stable shape.
    if (rx < ry) parent.set(ry, rx)
    else parent.set(rx, ry)
  }

  for (const p of pairs) {
    const aId = p.a.bodyId
    const bId = p.b.bodyId
    if (aId !== null) ensure(aId, p.a.bodyOrdinal)
    if (bId !== null) ensure(bId, p.b.bodyOrdinal)
    // A union only forms between two DISTINCT stamped bodies.
    if (aId !== null && bId !== null && aId !== bId) union(aId, bId)
  }

  // --- Gather components ---
  const members = new Map<string, string[]>()
  for (const id of parent.keys()) {
    const root = find(id)
    const arr = members.get(root)
    if (arr === undefined) members.set(root, [id])
    else arr.push(id)
  }

  // --- Keep only multi-member components, sorted deterministically ---
  interface Component {
    ids: string[]
    minOrdinal: number
    minId: string
  }
  const components: Component[] = []
  for (const ids of members.values()) {
    if (ids.length < 2) continue
    let minOrdinal = NO_ORDINAL
    let minId = ids[0]
    for (const id of ids) {
      const ord = ordinalOf.get(id) ?? NO_ORDINAL
      if (ord < minOrdinal) minOrdinal = ord
      if (id < minId) minId = id
    }
    components.push({ ids, minOrdinal, minId })
  }
  components.sort(
    (a, b) =>
      a.minOrdinal - b.minOrdinal || (a.minId < b.minId ? -1 : a.minId > b.minId ? 1 : 0),
  )

  // --- Number them 1, 2, … ---
  const result = new Map<string, number>()
  components.forEach((component, index) => {
    for (const id of component.ids) result.set(id, index + 1)
  })
  return result
}

/**
 * The member body ids of the group one body belongs to — the pooling set (D2).
 *
 * When a grouped geotech body is selected in the Parameters stage its
 * statistics pool ALL member bodies' bands (owner ruling 2026-09-02: "grouping
 * is just for lumping things that are similar together, so we have more data").
 * This resolves that member set from the same ``body id → group number`` map the
 * "(group N)" tag reads, so the tag and the pool never disagree on who is in a
 * group.
 *
 * Members are returned sorted by body id — a stable, locale-independent order so
 * the provenance list reads the same every render.
 *
 * Parameters
 * ----------
 * ordinals
 *     The ``geotechGroupOrdinals`` map (``body id → group number``).
 * bodyId
 *     The selected body.
 *
 * Returns
 * -------
 * { groupNumber, memberBodyIds } | null
 *     The group's number and every member's body id (including ``bodyId``
 *     itself), or ``null`` when the body is in no multi-member group.
 */
export function geotechGroupMembers(
  ordinals: ReadonlyMap<string, number>,
  bodyId: string,
): { groupNumber: number; memberBodyIds: string[] } | null {
  const groupNumber = ordinals.get(bodyId)
  if (groupNumber === undefined) return null
  const memberBodyIds: string[] = []
  for (const [id, group] of ordinals) if (group === groupNumber) memberBodyIds.push(id)
  memberBodyIds.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  return { groupNumber, memberBodyIds }
}
