/**
 * Which menu a right-click on a fill region between columns opens — the ONE
 * deterministic answer, decided once and read by both the cursor and the
 * contextmenu handler.
 *
 * WHY THIS EXISTS — debt #279 ("two menus share one cursor, so you cannot tell
 * which you will get"). The overlay used to decide the menu with two coupled
 * booleans (``interactive`` for the body menu, ``statsInteractive`` for the
 * unit-statistics fallback) that BOTH stamped ``cursor: context-menu``. When the
 * statistics jump landed it started wearing the body menu's cursor, so the
 * cursor stopped distinguishing them and which menu you got hung on load timing
 * (an e2e guard that waited on that cursor silently stopped proving anything —
 * see the debt entry). Collapsing the choice into one pure function means the
 * cursor and the handler always read the same target, and the rule is testable
 * off the god-component — the exact analogue of ``lithoMenuTargetAt`` /
 * ``geotechMenuTargetAt`` for the fill BETWEEN columns.
 *
 * The rule, in the owner's terms: a right-click on a fill opens EXACTLY ONE
 * menu, and it is the one for what is under the cursor. A fill that is one
 * body's mass opens the body menu (which already carries the statistics item);
 * a fill that belongs to no single body opens the unit-statistics menu; a fill
 * with no menu wired opens nothing (so it shows no context-menu cursor).
 *
 * Pure: booleans only, no React and no DOM — see ``fillRegionMenuTargetAt.test.ts``.
 *
 * @module components/sections/fillRegionMenuTargetAt
 */

/** The single menu a fill-region right-click resolves to, or ``null`` for none. */
export type FillRegionMenu = 'body' | 'stats' | null

/** The facts about one fill region that decide its menu. */
export interface FillRegionMenuInputs {
  /** A body context menu is wired for this axis (``onBodyContextMenu`` present). */
  bodyMenuWired: boolean
  /** This axis offers body menus at all (every axis except the geological one). */
  bodyMenuEnabled: boolean
  /**
   * The region's OWN layers resolve to exactly one body that the loaded roster
   * carries (``regionBodyId.ts`` → a ``BodyListItem``). ``false`` for a pooled /
   * multi-body / unstamped region, which has no body verbs to offer.
   */
  bodyResolved: boolean
  /**
   * The body roster has landed (#278/#279 gate). Until it has, a region that
   * WILL resolve to a body still falls to the statistics menu rather than racing
   * a half-loaded roster.
   */
  rosterLoaded: boolean
  /** A unit-statistics jump is wired for this axis (the fallback, and the only
   *  menu on a pooled region). */
  statsMenuWired: boolean
}

/**
 * Resolve the one menu a fill-region right-click opens.
 *
 * The body menu wins whenever it is genuinely available — wired, enabled, a
 * single body resolved, and the roster loaded — because it carries every
 * statistics the fallback would, plus the body verbs. Otherwise the
 * unit-statistics menu answers where its handler is wired. When neither is
 * available the region opens nothing.
 *
 * Parameters
 * ----------
 * inputs : FillRegionMenuInputs
 *     The region's menu facts.
 *
 * Returns
 * -------
 * FillRegionMenu
 *     ``'body'`` | ``'stats'`` | ``null``.
 */
export function fillRegionMenuTargetAt(inputs: FillRegionMenuInputs): FillRegionMenu {
  const bodyAvailable =
    inputs.bodyMenuWired && inputs.bodyMenuEnabled && inputs.bodyResolved && inputs.rosterLoaded
  if (bodyAvailable) return 'body'
  if (inputs.statsMenuWired) return 'stats'
  return null
}
