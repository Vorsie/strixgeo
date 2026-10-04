// Red-first pins for the anchor-chain resolver (owner ruling 2, 2026-09-05):
// "the overlay highlights the first anchor that exists in the DOM whose
// successor does not yet exist (menu closed → highlight the menu button; menu
// open → highlight the item; item's target pane open → highlight the control)".
// Each case is phrased in the owner's own words, against a stubbed predicate.

import { describe, expect, it } from 'vitest'

import { resolveChainTestid } from './tutorialAnchorChain'

/** Build an existence predicate from the set of present testids. */
const present =
  (...ids: string[]) =>
  (testid: string): boolean =>
    ids.includes(testid)

describe('resolveChainTestid (owner ruling 2)', () => {
  const CHAIN = ['import-menu-button', 'import-verb-cpt-dov'] as const

  it('menu closed → highlights the menu button (its successor does not yet exist)', () => {
    expect(resolveChainTestid(CHAIN, present('import-menu-button'))).toBe('import-menu-button')
  })

  it('menu open → highlights the item (the menu button’s successor now exists)', () => {
    expect(resolveChainTestid(CHAIN, present('import-menu-button', 'import-verb-cpt-dov'))).toBe(
      'import-verb-cpt-dov',
    )
  })

  it('a three-link chain steps to the deepest revealed link', () => {
    const three = ['stage-tab-geology', 'project-metadata-open', 'project-crs-horizontal'] as const
    // Only the tab is present → highlight the tab.
    expect(resolveChainTestid(three, present('stage-tab-geology'))).toBe('stage-tab-geology')
    // Tab + button present, field not → highlight the button.
    expect(resolveChainTestid(three, present('stage-tab-geology', 'project-metadata-open'))).toBe(
      'project-metadata-open',
    )
    // All present → highlight the final field.
    expect(resolveChainTestid(three, present(...three))).toBe('project-crs-horizontal')
  })

  it('a chain through a submenu group row: button, then group row, then the route', () => {
    // Owner 2026-10-04: the routes sit behind a group row. Menu closed ->
    // the button; menu open, group closed -> the group row; group open ->
    // the route itself.
    const chain = ['stage-tab-data', 'import-menu-button', 'import-group-cpt', 'import-verb-cpt-dov']
    expect(resolveChainTestid(chain, present('stage-tab-data', 'import-menu-button'))).toBe(
      'import-menu-button',
    )
    expect(
      resolveChainTestid(chain, present('stage-tab-data', 'import-menu-button', 'import-group-cpt')),
    ).toBe('import-group-cpt')
    expect(resolveChainTestid(chain, present(...chain))).toBe('import-verb-cpt-dov')
  })

  it('skips a missing outer link and still resolves a present inner one', () => {
    // The menu button is gone but the item is somehow present → highlight it.
    expect(resolveChainTestid(CHAIN, present('import-verb-cpt-dov'))).toBe('import-verb-cpt-dov')
  })

  it('returns null when no anchor in the chain is present (card docks / tab-fallback)', () => {
    expect(resolveChainTestid(CHAIN, present())).toBeNull()
  })

  it('a single-anchor chain resolves to that anchor when present, null when absent', () => {
    expect(resolveChainTestid(['axis-litho'], present('axis-litho'))).toBe('axis-litho')
    expect(resolveChainTestid(['axis-litho'], present())).toBeNull()
  })
})
