// The one rule debt #279 asks for, in plain user words: a right-click on a fill
// region opens EXACTLY ONE menu, and the menu that opens is the one for what is
// under the cursor. A fill that is a single body's mass opens the body menu; a
// fill that belongs to no single body opens the unit-statistics menu; a fill
// with no menu at all opens nothing (and so shows no context-menu cursor).
//
// Before this resolver the overlay decided the menu with two coupled booleans
// (``interactive`` / ``statsInteractive``) that both stamped ``cursor:
// context-menu`` — the exact drift the debt entry documents: the cursor stopped
// telling the two apart, and which menu you got hung on load timing. Making the
// choice ONE pure function means the cursor and the menu always read the same
// answer, and the rule is testable off the god-component.

import { describe, expect, it } from 'vitest'

import { fillRegionMenuTargetAt } from './fillRegionMenuTargetAt'

/** Every input true — the common steady state: a wired axis whose fill is one loaded body. */
const ALL: Parameters<typeof fillRegionMenuTargetAt>[0] = {
  bodyMenuWired: true,
  bodyMenuEnabled: true,
  bodyResolved: true,
  rosterLoaded: true,
  statsMenuWired: true,
}

describe('fillRegionMenuTargetAt — one menu per right-click, the one under the cursor', () => {
  it('a fill region that is one body mass opens the body menu', () => {
    expect(fillRegionMenuTargetAt(ALL)).toBe('body')
  })

  it('a fill region that belongs to no single body opens the unit-statistics menu instead', () => {
    // The region spans several bodies or unstamped ground: no body verbs make
    // sense, so the unit-statistics menu is the right answer, not a blank one.
    expect(fillRegionMenuTargetAt({ ...ALL, bodyResolved: false })).toBe('stats')
  })

  it('while the body list is still loading a right-click opens the unit-statistics menu, never a half-loaded body menu', () => {
    // The roster gate (#278/#279): a region that WILL resolve to a body still
    // falls to the deliberate statistics menu until the list has landed.
    expect(fillRegionMenuTargetAt({ ...ALL, rosterLoaded: false })).toBe('stats')
  })

  // The stratigraphy axis is the body-less one (``bodyMenuEnabled`` false).
  // The geotech axis DOES have bodies, inherited from its litho parent, and
  // opens the body menu: see PartitionFillOverlay.geotechBodyMenu.test.tsx.
  it('the body menu never appears on an axis whose model has no bodies', () => {
    // The geological axis wires no body menu; the fill still offers statistics.
    expect(fillRegionMenuTargetAt({ ...ALL, bodyMenuEnabled: false })).toBe('stats')
  })

  it('the body menu never appears where no body context menu is wired', () => {
    expect(fillRegionMenuTargetAt({ ...ALL, bodyMenuWired: false })).toBe('stats')
  })

  it('a fill region opens exactly one menu: when a body resolves it is the body menu and the statistics fallback yields', () => {
    // Both a body AND a stats handler are available; only ONE menu is chosen,
    // and it is the body menu (which already carries the statistics item).
    const target = fillRegionMenuTargetAt(ALL)
    expect(target).toBe('body')
    expect(target).not.toBe('stats')
  })

  it('a fill region with no menu wired opens nothing, so it shows no context-menu cursor', () => {
    expect(
      fillRegionMenuTargetAt({
        bodyMenuWired: false,
        bodyMenuEnabled: false,
        bodyResolved: false,
        rosterLoaded: true,
        statsMenuWired: false,
      }),
    ).toBeNull()
  })

  it('a body that resolved but with no stats handler still opens the body menu', () => {
    expect(fillRegionMenuTargetAt({ ...ALL, statsMenuWired: false })).toBe('body')
  })
})
