// Unit tests for BodyContextMenu (#body-with-extent Slice 7.1).
//
// The claim + clear rows live in per-side SUBMENUS (decluttered 2026-06-01):
// the top level shows "Left extent" / "Right extent" parent rows; opening one
// (click) reveals its three claim kinds + a Clear row when that side is
// claimed. Tests open the relevant submenu before asserting its rows.
//
//   BCM1  unclaimed body shows all three claim items for each side (in submenu).
//   BCM2  claimed left side shows Clear item.
//   BCM3  each claim item fires onClaimExtent with correct args.
//   BCM4  Clear fires onClearExtent with correct body id + side.
//   BCM5  Name body fires onNameBody.
//   BCM6  Dissolve body fires onDissolveBody.
//   BCM7  body with both sides claimed shows two Clear items.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import BodyContextMenu, { TESTIDS } from './BodyContextMenu'
import { makeBody } from './__tests__/bodyTestFixtures'

afterEach(() => cleanup())

describe('BodyContextMenu', () => {
  it('BCM1 — unclaimed body shows all three claim items for each side', () => {
    render(
      <svg>
        <BodyContextMenu
          x={10}
          y={10}
          body={makeBody()}
          onClaimExtent={vi.fn()}
          onClearExtent={vi.fn()}
          onNameBody={vi.fn()}
          onDissolveBody={vi.fn()}
          onClose={vi.fn()}
        />
      </svg>,
    )
    // Open the left submenu → its three claim kinds appear.
    fireEvent.click(screen.getByTestId(TESTIDS.sideLeft))
    expect(screen.getByTestId(TESTIDS.claimLeft('pinch_out_halfway'))).toBeDefined()
    expect(screen.getByTestId(TESTIDS.claimLeft('extrapolated'))).toBeDefined()
    expect(screen.getByTestId(TESTIDS.claimLeft('open'))).toBeDefined()
    // Open the right submenu → its three claim kinds appear.
    fireEvent.click(screen.getByTestId(TESTIDS.sideRight))
    expect(screen.getByTestId(TESTIDS.claimRight('pinch_out_halfway'))).toBeDefined()
    expect(screen.getByTestId(TESTIDS.claimRight('extrapolated'))).toBeDefined()
    expect(screen.getByTestId(TESTIDS.claimRight('open'))).toBeDefined()
  })

  it('BCM2 — claimed left side shows Clear item', () => {
    render(
      <svg>
        <BodyContextMenu
          x={10}
          y={10}
          body={makeBody({ extent_left_kind: 'pinch_out_halfway' })}
          onClaimExtent={vi.fn()}
          onClearExtent={vi.fn()}
          onNameBody={vi.fn()}
          onDissolveBody={vi.fn()}
          onClose={vi.fn()}
        />
      </svg>,
    )
    fireEvent.click(screen.getByTestId(TESTIDS.sideLeft))
    expect(screen.getByTestId(TESTIDS.clearLeft)).toBeDefined()
    // Right is not claimed → no clearRight even after opening its submenu.
    fireEvent.click(screen.getByTestId(TESTIDS.sideRight))
    expect(screen.queryByTestId(TESTIDS.clearRight)).toBeNull()
  })

  it('BCM3 — clicking a claim item fires onClaimExtent with correct args', () => {
    const onClaimExtent = vi.fn()
    render(
      <svg>
        <BodyContextMenu
          x={10}
          y={10}
          body={makeBody()}
          onClaimExtent={onClaimExtent}
          onClearExtent={vi.fn()}
          onNameBody={vi.fn()}
          onDissolveBody={vi.fn()}
          onClose={vi.fn()}
        />
      </svg>,
    )
    fireEvent.click(screen.getByTestId(TESTIDS.sideRight))
    fireEvent.click(screen.getByTestId(TESTIDS.claimRight('extrapolated')))
    expect(onClaimExtent).toHaveBeenCalledOnce()
    expect(onClaimExtent).toHaveBeenCalledWith('B1', 'right', 'extrapolated')
  })

  it('BCM4 — Clear fires onClearExtent with correct body id + side', () => {
    const onClearExtent = vi.fn()
    render(
      <svg>
        <BodyContextMenu
          x={10}
          y={10}
          body={makeBody({ extent_left_kind: 'open' })}
          onClaimExtent={vi.fn()}
          onClearExtent={onClearExtent}
          onNameBody={vi.fn()}
          onDissolveBody={vi.fn()}
          onClose={vi.fn()}
        />
      </svg>,
    )
    fireEvent.click(screen.getByTestId(TESTIDS.sideLeft))
    fireEvent.click(screen.getByTestId(TESTIDS.clearLeft))
    expect(onClearExtent).toHaveBeenCalledOnce()
    expect(onClearExtent).toHaveBeenCalledWith('B1', 'left')
  })

  it('BCM5 — Name body fires onNameBody', () => {
    const onNameBody = vi.fn()
    render(
      <svg>
        <BodyContextMenu
          x={10}
          y={10}
          body={makeBody()}
          onClaimExtent={vi.fn()}
          onClearExtent={vi.fn()}
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
          onClaimExtent={vi.fn()}
          onClearExtent={vi.fn()}
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

  it('BCM7 — body with both sides claimed shows two Clear items', () => {
    render(
      <svg>
        <BodyContextMenu
          x={10}
          y={10}
          body={makeBody({
            extent_left_kind: 'to_target',
            extent_right_kind: 'extrapolated',
          })}
          onClaimExtent={vi.fn()}
          onClearExtent={vi.fn()}
          onNameBody={vi.fn()}
          onDissolveBody={vi.fn()}
          onClose={vi.fn()}
        />
      </svg>,
    )
    fireEvent.click(screen.getByTestId(TESTIDS.sideLeft))
    expect(screen.getByTestId(TESTIDS.clearLeft)).toBeDefined()
    fireEvent.click(screen.getByTestId(TESTIDS.sideRight))
    expect(screen.getByTestId(TESTIDS.clearRight)).toBeDefined()
  })
})
