// Anchor-chain resolution for the guided tutorial (owner ruling 2, 2026-09-05).
//
// A step can declare a CHAIN of anchors, ordered from the outermost trigger to
// the final control, e.g. ['import-menu-button', 'import-verb-cpt-dov']. The
// overlay highlights "the first anchor that exists in the DOM whose successor
// does not yet exist" (owner's words):
//
//   menu closed → the menu button exists, its successor (the item) does not
//                 → highlight the menu button;
//   menu open   → the menu button exists AND the item exists, so the menu
//                 button's successor exists → skip it; the item exists and has
//                 no successor → highlight the item.
//
// This linearises progressive disclosure: each successor only appears after the
// user acts on its predecessor. A single-anchor step is just a one-element
// chain, so every step routes through the same resolver.
//
// The module is pure — `tutorialAnchorChain.test.ts` pins the resolution rule
// in the owner's words against a stubbed existence predicate, no DOM needed.

/**
 * Resolve which anchor in a chain the spotlight should target.
 *
 * Walks the chain in order and returns the first anchor that exists whose
 * successor does NOT exist (or which is the last element). Anchors that do not
 * exist are skipped. Returns `null` when no anchor in the chain exists — the
 * caller then falls back to the owning stage tab or docks the card.
 *
 * @param anchors  The ordered anchor chain (outermost trigger first, final
 *     control last). A single-element chain is the plain single-anchor case.
 * @param exists  Predicate telling whether an anchor is present in the DOM.
 * @returns  The anchor testid to spotlight, or `null` when none are present.
 */
export function resolveChainTestid(
  anchors: readonly string[],
  exists: (testid: string) => boolean,
): string | null {
  for (let i = 0; i < anchors.length; i++) {
    if (!exists(anchors[i])) continue
    const successor = anchors[i + 1]
    if (successor === undefined || !exists(successor)) return anchors[i]
  }
  return null
}
