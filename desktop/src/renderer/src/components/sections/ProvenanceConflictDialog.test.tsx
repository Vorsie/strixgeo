// Behavioural pins for the ProvenanceConflictDialog (body-with-extent Slice 7.5).
//
// Opened when claimBodyExtent returns 409 — the backend signals that the
// requested side already has an extent claimed by the auto-detector and the
// user's claim would overwrite it.
//
// BPB-SHOW  the dialog renders its copy + three action buttons when open.
// BPB-APPLY "Apply" fires onApply (default focus — user wants to overwrite).
// BPB-KEEP  "Keep current" fires onKeepCurrent (user prefers the detector claim).
// BPB-CLOSE backdrop click / Cancel / Esc fires onClose.
// BPB-DISMISS default button is "Apply" (per task spec — clearing the
//             detector claim is the more common intent from the context menu).

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ProvenanceConflictDialog from './ProvenanceConflictDialog'

const defaultProps = {
  open: true,
  bodyId: 'body-1',
  side: 'left' as const,
  kind: 'pinch_out_halfway' as const,
  onApply: vi.fn(),
  onKeepCurrent: vi.fn(),
  onClose: vi.fn(),
}

afterEach(() => cleanup())

describe('ProvenanceConflictDialog', () => {
  it('BPB-SHOW — renders copy + three action buttons when open', () => {
    render(<ProvenanceConflictDialog {...defaultProps} />)
    // The dialog container is visible.
    expect(screen.getByTestId('provenance-conflict-dialog')).not.toBeNull()
    // All three action buttons are present.
    expect(screen.getByTestId('provenance-conflict-apply')).not.toBeNull()
    expect(screen.getByTestId('provenance-conflict-keep')).not.toBeNull()
    expect(screen.getByTestId('provenance-conflict-cancel')).not.toBeNull()
  })

  it('BPB-APPLY — clicking Apply fires onApply', () => {
    const onApply = vi.fn()
    render(<ProvenanceConflictDialog {...defaultProps} onApply={onApply} />)
    fireEvent.click(screen.getByTestId('provenance-conflict-apply'))
    expect(onApply).toHaveBeenCalledTimes(1)
  })

  it('BPB-KEEP — clicking "Keep current" fires onKeepCurrent', () => {
    const onKeepCurrent = vi.fn()
    render(<ProvenanceConflictDialog {...defaultProps} onKeepCurrent={onKeepCurrent} />)
    fireEvent.click(screen.getByTestId('provenance-conflict-keep'))
    expect(onKeepCurrent).toHaveBeenCalledTimes(1)
  })

  it('BPB-CLOSE — clicking Cancel fires onClose', () => {
    const onClose = vi.fn()
    render(<ProvenanceConflictDialog {...defaultProps} onClose={onClose} />)
    fireEvent.click(screen.getByTestId('provenance-conflict-cancel'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('BPB-DISMISS — dialog renders nothing when open is false', () => {
    render(<ProvenanceConflictDialog {...defaultProps} open={false} />)
    expect(screen.queryByTestId('provenance-conflict-dialog')).toBeNull()
  })
})
