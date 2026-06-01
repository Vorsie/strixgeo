// Unit tests for BodyContextMenu (#body-with-extent Slice 7.1).
//
//   BCM1  unclaimed body shows all three claim items for each side.
//   BCM2  claimed left side shows Clear item.
//   BCM3  each claim item fires onClaimExtent with correct args.
//   BCM4  Clear fires onClearExtent with correct body id + side.
//   BCM5  Name body fires onNameBody.
//   BCM6  Dissolve body fires onDissolveBody.
//   BCM7  body with both sides claimed shows two Clear items.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { BodyListItem } from '../../api/client'
import BodyContextMenu, { TESTIDS } from './BodyContextMenu'

afterEach(() => cleanup())

function makeBody(overrides: Partial<BodyListItem> = {}): BodyListItem {
  return {
    id: 'B1',
    app_project_id: 'p1',
    model_id: 'm1',
    formation_id: 'f1',
    body_ordinal: 0,
    source_investigation_id: 'inv-src',
    name: null,
    primary_section_id: null,
    content_key: null,
    extent_left_kind: null,
    extent_left_target_contact_id: null,
    extent_left_neighbour_inv_id: null,
    extent_right_kind: null,
    extent_right_target_contact_id: null,
    extent_right_neighbour_inv_id: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

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
    // Three claim kinds for left
    expect(screen.getByTestId(TESTIDS.claimLeft('pinch_out_halfway'))).toBeDefined()
    expect(screen.getByTestId(TESTIDS.claimLeft('extrapolated'))).toBeDefined()
    expect(screen.getByTestId(TESTIDS.claimLeft('open'))).toBeDefined()
    // Three claim kinds for right
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
    expect(screen.getByTestId(TESTIDS.clearLeft)).toBeDefined()
    // Right is not claimed, so no clearRight
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
    expect(screen.getByTestId(TESTIDS.clearLeft)).toBeDefined()
    expect(screen.getByTestId(TESTIDS.clearRight)).toBeDefined()
  })
})
