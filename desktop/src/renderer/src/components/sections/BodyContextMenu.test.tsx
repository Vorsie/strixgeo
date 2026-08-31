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

afterEach(() => cleanup())

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
})
