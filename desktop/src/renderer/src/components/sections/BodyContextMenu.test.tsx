// Unit tests for BodyContextMenu.
//
// The claim + clear submenus were retired with the body-extent system
// (body-extent retirement, 2026-06-06). Only Name body and Dissolve body remain.
//
//   BCM5  Name body fires onNameBody.
//   BCM6  Dissolve body fires onDissolveBody.

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
  // the formation, and the statistics are the formation's. Body-scope ruling
  // (2026-08-27, verbatim: "a body is only a body if it is geometrically
  // connected or if the users says, this body is the same as that body"):
  // this menu HAS the body, so the jump reports it alongside the unit.
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

  // R2 (owner ruling 2026-08-31): a body crossing two geological formations
  // LISTS them both. The header field separator stays "·"; inside the geo field
  // the crossed formations join with "+", shallowest first.
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

  // Debt #278 R5 (owner ruling 2026-08-31): a "Separate" verb, the counterpart
  // to Dissolve — "these two are NOT the same body". Offered only when wired
  // (the no-affordance rule), and NON-danger (it is reversible via Rejoin,
  // unlike Dissolve). Fires the clicked body's id so SectionPanel can arm.
  it('BCM11 — "Separate from…" fires onSeparateBody with the clicked body id', () => {
    const onSeparateBody = vi.fn()
    render(
      <svg>
        <BodyContextMenu
          x={10}
          y={10}
          body={makeBody()}
          onNameBody={vi.fn()}
          onDissolveBody={vi.fn()}
          onSeparateBody={onSeparateBody}
          onClose={vi.fn()}
        />
      </svg>,
    )
    fireEvent.click(screen.getByTestId(TESTIDS.separateBody))
    expect(onSeparateBody).toHaveBeenCalledOnce()
    expect(onSeparateBody).toHaveBeenCalledWith('B1')
  })

  it('BCM12 — no separate handler, no "Separate from…" item (no-affordance rule)', () => {
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
    expect(screen.queryByTestId(TESTIDS.separateBody)).toBeNull()
  })

  // Each existing separation involving this body is offered back as a "Rejoin
  // with <label>" item, labelled from the backend's server-resolved display
  // info; clicking it fires onRejoinBody with the separation id to lift.
  it('BCM13 — a "Rejoin with <label>" item fires onRejoinBody with the separation id', () => {
    const onRejoinBody = vi.fn()
    render(
      <svg>
        <BodyContextMenu
          x={10}
          y={10}
          body={makeBody()}
          onNameBody={vi.fn()}
          onDissolveBody={vi.fn()}
          onRejoinBody={onRejoinBody}
          separations={[{ separationId: 'sep-1', label: 'ZAND #2' }]}
          onClose={vi.fn()}
        />
      </svg>,
    )
    const item = screen.getByTestId(`${TESTIDS.rejoinBody}-sep-1`)
    expect(item.textContent).toContain('ZAND #2')
    fireEvent.click(item)
    expect(onRejoinBody).toHaveBeenCalledOnce()
    expect(onRejoinBody).toHaveBeenCalledWith('sep-1')
  })

  // The menu is genuinely wired to the i18n catalogue (the keys existed but
  // nothing read them before). This is the "toggle exists AND something moved"
  // pin — a locale file alone cannot prove the component reads it. NL wording
  // is provisional (flagged for the ux/owner pass), so this asserts the FLIP,
  // not the exact phrasing being final.
  it('BCM15 — labels follow the language flip (Separate/Rejoin render in NL)', () => {
    setLanguage('nl')
    render(
      <svg>
        <BodyContextMenu
          x={10}
          y={10}
          body={makeBody()}
          onNameBody={vi.fn()}
          onDissolveBody={vi.fn()}
          onSeparateBody={vi.fn()}
          onRejoinBody={vi.fn()}
          separations={[{ separationId: 'sep-1', label: 'ZAND #2' }]}
          onClose={vi.fn()}
        />
      </svg>,
    )
    expect(screen.getByTestId(TESTIDS.separateBody).textContent).toBe('Scheiden van…')
    expect(screen.getByTestId(TESTIDS.dissolveBody).textContent).toBe('Lichaam ontbinden')
    // The {label} placeholder interpolates in NL too. Owner ruled 2026-09-01:
    // Rejoin reads "Herenig met …" ("Voeg samen met…" is reserved for Join).
    expect(screen.getByTestId(`${TESTIDS.rejoinBody}-sep-1`).textContent).toBe(
      'Herenig met ZAND #2',
    )
  })

  it('BCM14 — no separations, no Rejoin items', () => {
    render(
      <svg>
        <BodyContextMenu
          x={10}
          y={10}
          body={makeBody()}
          onNameBody={vi.fn()}
          onDissolveBody={vi.fn()}
          onRejoinBody={vi.fn()}
          onClose={vi.fn()}
        />
      </svg>,
    )
    expect(screen.queryByTestId(`${TESTIDS.rejoinBody}-sep-1`)).toBeNull()
  })

  // Debt #278 (owner ruling 2026-08-31): a "Join with…" verb — "these two ARE
  // the same body" — the additive counterpart to Separate. Offered only when
  // wired (the no-affordance rule keeps it geotech-only, where the owner said he
  // would use it), and NON-danger (it is reversible via Disjoin). Fires the
  // clicked body's id so SectionPanel can arm the pick-the-other-body gesture.
  it('BCM16 — "Join with…" fires onJoinBody with the clicked body id', () => {
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

  it('BCM17 — no join handler, no "Join with…" item (no-affordance rule)', () => {
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

  // Each existing union involving this body is offered back as a "Disjoin
  // <label>" item, labelled from the backend's server-resolved display info;
  // clicking it fires onDisjoinBody with the union id to lift.
  it('BCM18 — a "Disjoin <label>" item fires onDisjoinBody with the union id', () => {
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
    const item = screen.getByTestId(`${TESTIDS.disjoinBody}-union-1`)
    expect(item.textContent).toContain('ZAND #5')
    fireEvent.click(item)
    expect(onDisjoinBody).toHaveBeenCalledOnce()
    expect(onDisjoinBody).toHaveBeenCalledWith('union-1')
  })

  it('BCM19 — no unions, no Disjoin items', () => {
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
    expect(screen.queryByTestId(`${TESTIDS.disjoinBody}-union-1`)).toBeNull()
  })

  // The Join/Disjoin labels follow the language flip. Owner ruled 2026-08-31:
  // Join reads "Voeg samen met…" in NL. Disjoin's NL is FLAGGED-not-ruled
  // (proposed "Ontkoppel van {label}"), so this pins the FLIP + interpolation,
  // not the phrasing being final.
  it('BCM20 — labels follow the language flip (Join/Disjoin render in NL)', () => {
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
    expect(screen.getByTestId(`${TESTIDS.disjoinBody}-union-1`).textContent).toBe(
      'Ontkoppel van ZAND #5',
    )
  })
})
