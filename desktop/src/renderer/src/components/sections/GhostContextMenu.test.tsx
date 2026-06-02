// Unit tests for GhostContextMenu (ghost pinch-out candidate right-click menu).
//
//   GCM1  kind='open'         → Accept item label is "Accept open end".
//   GCM2  kind='pinch_out_halfway' → Accept item label is "Accept pinch-out".
//   GCM3  clicking Accept fires onAccept with the exact candidate object.
//   GCM4  clicking Dismiss fires onDismiss with the exact candidate object.
//   GCM5  clicking Accept does NOT call onDismiss; clicking Dismiss does NOT call onAccept.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PinchOutCandidate } from '../../api/client'
import GhostContextMenu, { GHOST_CTX_TESTIDS } from './GhostContextMenu'

afterEach(() => cleanup())

function makeCandidate(overrides: Partial<PinchOutCandidate> = {}): PinchOutCandidate {
  return {
    body_id: null,
    source_investigation_id: 'inv-1',
    above_contact_id: 'c-top',
    below_contact_id: 'c-base',
    side: 'left',
    kind: 'pinch_out_halfway',
    suggested_neighbour_investigation_id: 'inv-2',
    ...overrides,
  }
}

describe('GhostContextMenu', () => {
  it('GCM1 — kind="open" renders Accept label "Accept open end"', () => {
    const candidate = makeCandidate({ kind: 'open', suggested_neighbour_investigation_id: null })
    render(
      <svg>
        <GhostContextMenu
          x={10}
          y={10}
          candidate={candidate}
          onAccept={vi.fn()}
          onDismiss={vi.fn()}
          onClose={vi.fn()}
        />
      </svg>,
    )
    const acceptBtn = screen.getByTestId(GHOST_CTX_TESTIDS.accept)
    expect(acceptBtn.textContent).toContain('Accept open end')
  })

  it('GCM2 — kind="pinch_out_halfway" renders Accept label "Accept pinch-out"', () => {
    const candidate = makeCandidate({ kind: 'pinch_out_halfway' })
    render(
      <svg>
        <GhostContextMenu
          x={10}
          y={10}
          candidate={candidate}
          onAccept={vi.fn()}
          onDismiss={vi.fn()}
          onClose={vi.fn()}
        />
      </svg>,
    )
    const acceptBtn = screen.getByTestId(GHOST_CTX_TESTIDS.accept)
    expect(acceptBtn.textContent).toContain('Accept pinch-out')
  })

  it('GCM3 — clicking Accept fires onAccept with the exact candidate', () => {
    const onAccept = vi.fn()
    const candidate = makeCandidate()
    render(
      <svg>
        <GhostContextMenu
          x={10}
          y={10}
          candidate={candidate}
          onAccept={onAccept}
          onDismiss={vi.fn()}
          onClose={vi.fn()}
        />
      </svg>,
    )
    fireEvent.click(screen.getByTestId(GHOST_CTX_TESTIDS.accept))
    expect(onAccept).toHaveBeenCalledTimes(1)
    expect(onAccept).toHaveBeenCalledWith(candidate)
  })

  it('GCM4 — clicking Dismiss fires onDismiss with the exact candidate', () => {
    const onDismiss = vi.fn()
    const candidate = makeCandidate()
    render(
      <svg>
        <GhostContextMenu
          x={10}
          y={10}
          candidate={candidate}
          onAccept={vi.fn()}
          onDismiss={onDismiss}
          onClose={vi.fn()}
        />
      </svg>,
    )
    fireEvent.click(screen.getByTestId(GHOST_CTX_TESTIDS.dismiss))
    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(onDismiss).toHaveBeenCalledWith(candidate)
  })

  it('GCM5 — Accept does not call onDismiss; Dismiss does not call onAccept', () => {
    const onAccept = vi.fn()
    const onDismiss = vi.fn()
    const candidate = makeCandidate()

    // Accept click — only onAccept fires.
    const { unmount } = render(
      <svg>
        <GhostContextMenu
          x={10}
          y={10}
          candidate={candidate}
          onAccept={onAccept}
          onDismiss={onDismiss}
          onClose={vi.fn()}
        />
      </svg>,
    )
    fireEvent.click(screen.getByTestId(GHOST_CTX_TESTIDS.accept))
    expect(onAccept).toHaveBeenCalledTimes(1)
    expect(onDismiss).toHaveBeenCalledTimes(0)
    unmount()

    onAccept.mockClear()
    onDismiss.mockClear()

    // Dismiss click — only onDismiss fires.
    render(
      <svg>
        <GhostContextMenu
          x={10}
          y={10}
          candidate={candidate}
          onAccept={onAccept}
          onDismiss={onDismiss}
          onClose={vi.fn()}
        />
      </svg>,
    )
    fireEvent.click(screen.getByTestId(GHOST_CTX_TESTIDS.dismiss))
    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(onAccept).toHaveBeenCalledTimes(0)
  })
})
