// Unit tests for BodyContextMenu.
//
// Owner ruling 2026-09-01 ("way too complicated") — the body verbs are stripped
// to Join + Ontkoppelen. Separate / Rejoin are GONE. The geotech body menu shows
// Name, Unit statistics, "Voeg samen met…" (Join), "Ontkoppelen" (un-join, one
// per standing group), and Dissolve.
//
//   BCM5   Name body fires onNameBody.
//   BCM6   Dissolve body fires onDissolveBody.
//   BCM7/8 Unit statistics jump.
//   BCM9-11 header shows the crossed-formation list.
//   BCM16/17 Join with… arms.
//   BCM18-20 Ontkoppelen (un-join) lifts a standing group.
//   BCM21  the menu has NO Separate / Rejoin items (the simplification pin).

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import BodyContextMenu, { TESTIDS } from './BodyContextMenu'
import { makeBody } from './__tests__/bodyTestFixtures'
import { setLanguage } from '../../i18n/languageSelect'
import { DEFAULT_LANGUAGE } from '../../i18n/i18n_constants'

afterEach(() => {
  cleanup()
  setLanguage(DEFAULT_LANGUAGE)
})

describe('BodyContextMenu', () => {
  it('BCM5 — Name body fires onNameBody', () => {
    const onNameBody = vi.fn()
    render(
      <svg>
        <BodyContextMenu
          x={10}
          y={10}
          body={makeBody()}
          onNameBody={onNameBody}
          onDissolveBody={vi.fn()}
          onClose={vi.fn()}
        />
      </svg>,
    )
    fireEvent.click(screen.getByTestId(TESTIDS.nameBody))
    expect(onNameBody).toHaveBeenCalledOnce()
    expect(onNameBody).toHaveBeenCalledWith('B1')
  })

  it('BCM6 — Dissolve body fires onDissolveBody', () => {
    const onDissolveBody = vi.fn()
    render(
      <svg>
        <BodyContextMenu
          x={10}
          y={10}
          body={makeBody()}
          onNameBody={vi.fn()}
          onDissolveBody={onDissolveBody}
          onClose={vi.fn()}
        />
      </svg>,
    )
    fireEvent.click(screen.getByTestId(TESTIDS.dissolveBody))
    expect(onDissolveBody).toHaveBeenCalledOnce()
    expect(onDissolveBody).toHaveBeenCalledWith('B1')
  })

  // Owner ruling R1 (2026-08-27): a litho unit between columns is reachable
  // through its BODY's menu — the region carries the body, the body carries
  // the formation, and the statistics are the formation's.
  it('BCM7 — "Unit statistics…" reports the body FORMATION id as the unit, AND the clicked body', () => {
    const onShowUnitStatistics = vi.fn()
    render(
      <svg>
        <BodyContextMenu
          x={10}
          y={10}
          body={makeBody()}
          onNameBody={vi.fn()}
          onDissolveBody={vi.fn()}
          onShowUnitStatistics={onShowUnitStatistics}
          onClose={vi.fn()}
        />
      </svg>,
    )
    fireEvent.click(screen.getByTestId(TESTIDS.unitStatistics))
    expect(onShowUnitStatistics).toHaveBeenCalledOnce()
    expect(onShowUnitStatistics).toHaveBeenCalledWith(makeBody().formation_id, makeBody().id)
  })

  it('BCM8 — no statistics handler, no item (the no-affordance rule)', () => {
    render(
      <svg>
        <BodyContextMenu
          x={10}
          y={10}
          body={makeBody()}
          onNameBody={vi.fn()}
          onDissolveBody={vi.fn()}
          onClose={vi.fn()}
        />
      </svg>,
    )
    expect(screen.queryByTestId(TESTIDS.unitStatistics)).toBeNull()
  })

  // R2 (owner ruling 2026-08-31): a body crossing two geological formations
  // LISTS them both, joined with "+", shallowest first.
  it('BCM9 — the header lists every crossed geo formation, joined with "+"', () => {
    render(
      <svg>
        <BodyContextMenu
          x={10}
          y={10}
          body={makeBody({
            geo_formation_name: 'Holoceen',
            geo_formations: [
              { id: 'g1', name: 'Holoceen' },
              { id: 'g2', name: 'Pleistoceen' },
            ],
          })}
          onNameBody={vi.fn()}
          onDissolveBody={vi.fn()}
          onClose={vi.fn()}
        />
      </svg>,
    )
    expect(screen.getByText(/· Holoceen \+ Pleistoceen/)).toBeInTheDocument()
  })

  it('BCM10 — an old cached response with only the singular field still shows it', () => {
    render(
      <svg>
        <BodyContextMenu
          x={10}
          y={10}
          body={makeBody({ geo_formation_name: 'Pleistoceen' })}
          onNameBody={vi.fn()}
          onDissolveBody={vi.fn()}
          onClose={vi.fn()}
        />
      </svg>,
    )
    expect(screen.getByText(/· Pleistoceen$/)).toBeInTheDocument()
  })

  // Owner dogfeed 2026-09-01: the menu header drops the literal "Lens · " prefix.
  it('BCM11 — the header drops the literal "Lens · " prefix', () => {
    render(
      <svg>
        <BodyContextMenu
          x={10}
          y={10}
          body={makeBody({
            geo_formations: [
              { id: 'g1', name: 'Holoceen' },
              { id: 'g2', name: 'Pleistoceen' },
            ],
          })}
          displayLabel="SILT · SF #0"
          onNameBody={vi.fn()}
          onDissolveBody={vi.fn()}
          onClose={vi.fn()}
        />
      </svg>,
    )
    expect(screen.getByText(/^SILT · SF #0 · Holoceen \+ Pleistoceen$/)).toBeInTheDocument()
    expect(screen.queryByText(/Lens ·/)).not.toBeInTheDocument()
  })

  // Join (owner ruling 2026-09-01) — "these two ARE the same body", the additive
  // verb. Offered only when wired (keeps it geotech-only), NON-danger. Fires the
  // clicked body's id so SectionPanel arms the pick-the-other-body gesture.
  it('BCM16 — "Voeg samen met…" fires onJoinBody with the clicked body id', () => {
    const onJoinBody = vi.fn()
    render(
      <svg>
        <BodyContextMenu
          x={10}
          y={10}
          body={makeBody()}
          onNameBody={vi.fn()}
          onDissolveBody={vi.fn()}
          onJoinBody={onJoinBody}
          onClose={vi.fn()}
        />
      </svg>,
    )
    fireEvent.click(screen.getByTestId(TESTIDS.joinBody))
    expect(onJoinBody).toHaveBeenCalledOnce()
    expect(onJoinBody).toHaveBeenCalledWith('B1')
  })

  it('BCM17 — no join handler, no "Voeg samen met…" item (no-affordance rule)', () => {
    render(
      <svg>
        <BodyContextMenu
          x={10}
          y={10}
          body={makeBody()}
          onNameBody={vi.fn()}
          onDissolveBody={vi.fn()}
          onClose={vi.fn()}
        />
      </svg>,
    )
    expect(screen.queryByTestId(TESTIDS.joinBody)).toBeNull()
  })

  // Each standing group involving this body is offered back as an "Ontkoppelen"
  // item, labelled from the backend's server-resolved display info; clicking it
  // fires onDisjoinBody with the group (union) id to lift.
  it('BCM18 — an "Ontkoppelen" item fires onDisjoinBody with the group id', () => {
    const onDisjoinBody = vi.fn()
    render(
      <svg>
        <BodyContextMenu
          x={10}
          y={10}
          body={makeBody()}
          onNameBody={vi.fn()}
          onDissolveBody={vi.fn()}
          onDisjoinBody={onDisjoinBody}
          unions={[{ unionId: 'union-1', label: 'ZAND #5' }]}
          onClose={vi.fn()}
        />
      </svg>,
    )
    const item = screen.getByTestId(`${TESTIDS.unjoinBody}-union-1`)
    expect(item.textContent).toContain('ZAND #5')
    fireEvent.click(item)
    expect(onDisjoinBody).toHaveBeenCalledOnce()
    expect(onDisjoinBody).toHaveBeenCalledWith('union-1')
  })

  it('BCM19 — no groups, no Ontkoppelen items', () => {
    render(
      <svg>
        <BodyContextMenu
          x={10}
          y={10}
          body={makeBody()}
          onNameBody={vi.fn()}
          onDissolveBody={vi.fn()}
          onDisjoinBody={vi.fn()}
          onClose={vi.fn()}
        />
      </svg>,
    )
    expect(screen.queryByTestId(`${TESTIDS.unjoinBody}-union-1`)).toBeNull()
  })

  // The menu is genuinely wired to the i18n catalogue. Owner ruled 2026-08-31:
  // Join reads "Voeg samen met…". The un-join reads "Ontkoppelen" (owner's
  // approved word 2026-09-01); the "van {label}" suffix names which group.
  it('BCM20 — labels follow the language flip (Join / Ontkoppelen render in NL)', () => {
    setLanguage('nl')
    render(
      <svg>
        <BodyContextMenu
          x={10}
          y={10}
          body={makeBody()}
          onNameBody={vi.fn()}
          onDissolveBody={vi.fn()}
          onJoinBody={vi.fn()}
          onDisjoinBody={vi.fn()}
          unions={[{ unionId: 'union-1', label: 'ZAND #5' }]}
          onClose={vi.fn()}
        />
      </svg>,
    )
    expect(screen.getByTestId(TESTIDS.joinBody).textContent).toBe('Voeg samen met…')
    expect(screen.getByTestId(`${TESTIDS.unjoinBody}-union-1`).textContent).toBe(
      'Ontkoppelen van ZAND #5',
    )
  })

  // The simplification pin (owner 2026-09-01): Separate / Rejoin are GONE. No
  // handler prop for them exists, and no item can render — even the old testids
  // resolve to nothing.
  it('BCM21 — the menu has NO Separate or Rejoin items', () => {
    render(
      <svg>
        <BodyContextMenu
          x={10}
          y={10}
          body={makeBody()}
          onNameBody={vi.fn()}
          onDissolveBody={vi.fn()}
          onJoinBody={vi.fn()}
          onDisjoinBody={vi.fn()}
          unions={[{ unionId: 'union-1', label: 'ZAND #5' }]}
          onClose={vi.fn()}
        />
      </svg>,
    )
    expect(screen.queryByTestId('body-ctx-separate-body')).toBeNull()
    expect(screen.queryByTestId('body-ctx-rejoin-body-sep-1')).toBeNull()
    // The surviving verbs ARE present.
    expect(screen.getByTestId(TESTIDS.joinBody)).toBeInTheDocument()
    expect(screen.getByTestId(`${TESTIDS.unjoinBody}-union-1`)).toBeInTheDocument()
  })

  // D2 (owner 2026-09-01): hovering an "Ontkoppelen" item previews WHICH body it
  // refers to. Two options can share a label, so the hover reports the whole option
  // (its ``otherLayerId`` is the disambiguator) on enter, and null on leave.
  it('BCM22 — hovering an Ontkoppelen item reports its option; leaving clears it', () => {
    const onUnjoinHover = vi.fn()
    render(
      <svg>
        <BodyContextMenu
          x={10}
          y={10}
          body={makeBody()}
          onNameBody={vi.fn()}
          onDissolveBody={vi.fn()}
          onDisjoinBody={vi.fn()}
          unions={[
            { unionId: 'union-1', label: 'SILT vrij vast', otherBodyId: 'body-Y', otherLayerId: 'lay-Y' },
            { unionId: 'union-2', label: 'SILT vrij vast', otherBodyId: 'body-Z', otherLayerId: 'lay-Z' },
          ]}
          onUnjoinHover={onUnjoinHover}
          onClose={vi.fn()}
        />
      </svg>,
    )
    const first = screen.getByTestId(`${TESTIDS.unjoinBody}-union-1`)
    fireEvent.mouseEnter(first)
    // The two items are indistinguishable by label, so the reported option must
    // carry the disambiguating other-anchor layer.
    expect(onUnjoinHover).toHaveBeenLastCalledWith(
      expect.objectContaining({ unionId: 'union-1', otherLayerId: 'lay-Y' }),
    )
    fireEvent.mouseLeave(first)
    expect(onUnjoinHover).toHaveBeenLastCalledWith(null)
  })

  // Accepted-layer verbs (installer #21): the owner was blocked — an accepted
  // silt could only be deleted, not recomposed or split. These verbs appear on
  // the accepted-band menu only when wired (litho axis, a single accepted layer
  // resolved under the click); the caller already captured the layer + depth,
  // so the callbacks take no args.
  it('BCM23 — "Edit composition…" fires onEditComposition when wired', () => {
    const onEditComposition = vi.fn()
    render(
      <svg>
        <BodyContextMenu
          x={10}
          y={10}
          body={makeBody()}
          onNameBody={vi.fn()}
          onEditComposition={onEditComposition}
          onClose={vi.fn()}
        />
      </svg>,
    )
    fireEvent.click(screen.getByTestId(TESTIDS.editComposition))
    expect(onEditComposition).toHaveBeenCalledOnce()
  })

  it('BCM24 — "Split here" fires onSplitLayer when wired', () => {
    const onSplitLayer = vi.fn()
    render(
      <svg>
        <BodyContextMenu
          x={10}
          y={10}
          body={makeBody()}
          onNameBody={vi.fn()}
          onSplitLayer={onSplitLayer}
          onClose={vi.fn()}
        />
      </svg>,
    )
    fireEvent.click(screen.getByTestId(TESTIDS.splitLayer))
    expect(onSplitLayer).toHaveBeenCalledOnce()
  })

  it('BCM25 — neither verb renders when unwired (no-affordance rule)', () => {
    render(
      <svg>
        <BodyContextMenu
          x={10}
          y={10}
          body={makeBody()}
          onNameBody={vi.fn()}
          onDissolveBody={vi.fn()}
          onClose={vi.fn()}
        />
      </svg>,
    )
    expect(screen.queryByTestId(TESTIDS.editComposition)).toBeNull()
    expect(screen.queryByTestId(TESTIDS.splitLayer)).toBeNull()
  })
})
