// Behavioural pins for the litho→geological snap prompt (debt #134).
//
// The dialog opens after a litho-contact drag commits within tolerance
// of one or more geological contacts on the same investigation.  The
// user picks the direction of the snap:
//   1. Snap litho to geological — the cheaper / safer path (default
//      focus per owner directive 2026-05-26)
//   2. Move geological to litho — heavier; triggers a surface rebuild +
//      a litho re-sync cascade
//   3. Cancel — keep them separate (commit the litho at the raw drag
//      depth, do not snap)
//
// With two candidates the dialog renders a radio group; the nearer one
// is default-checked.  If equidistant, the deeper one wins (geological
// superposition convention).

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FormationContactResponse } from '../api/client'

import LithoGeoSnapDialog from './LithoGeoSnapDialog'

function makeCandidate(
  overrides: Partial<FormationContactResponse> & { id: string; depth_top_m: number },
): FormationContactResponse {
  return {
    app_project_id: 'P',
    model_id: 'geo-model-1',
    formation_id: 'f-geo-1',
    borehole_id: 'bh-1',
    cpt_id: null,
    source: 'manual_pick',
    confidence: 'high',
    pinch_out_target_contact_id: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  } as unknown as FormationContactResponse
}

describe('LithoGeoSnapDialog (debt #134)', () => {
  afterEach(() => cleanup())

  it('SD1: renders nothing when open is false', () => {
    render(
      <LithoGeoSnapDialog
        open={false}
        candidates={[makeCandidate({ id: 'g-1', depth_top_m: 7.05 })]}
        lithoDepthM={7.0}
        onSnapToGeo={vi.fn()}
        onMoveGeoToLitho={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('litho-geo-snap-dialog')).toBeNull()
  })

  it('SD2: shows the candidate depth and the litho drag depth in the body', () => {
    render(
      <LithoGeoSnapDialog
        open
        candidates={[makeCandidate({ id: 'g-1', depth_top_m: 7.05 })]}
        lithoDepthM={7.0}
        onSnapToGeo={vi.fn()}
        onMoveGeoToLitho={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    // The numeric depths surface so the engineer sees what they're
    // about to commit.  Owner directive: "Snap this litho contact to
    // the geological contact at <depth> m".
    expect(screen.getByTestId('litho-geo-snap-dialog')).toBeInTheDocument()
    expect(screen.getByText(/7\.05/)).toBeInTheDocument()
    expect(screen.getByText(/7\.00/)).toBeInTheDocument()
  })

  it('SD3: default focus lands on Snap-litho (cheaper / safer)', () => {
    render(
      <LithoGeoSnapDialog
        open
        candidates={[makeCandidate({ id: 'g-1', depth_top_m: 7.05 })]}
        lithoDepthM={7.0}
        onSnapToGeo={vi.fn()}
        onMoveGeoToLitho={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(document.activeElement).toBe(screen.getByTestId('snap-litho-to-geo'))
  })

  it('SD4: clicking Snap-litho calls onSnapToGeo with the selected candidate id', () => {
    const onSnapToGeo = vi.fn()
    render(
      <LithoGeoSnapDialog
        open
        candidates={[makeCandidate({ id: 'g-only', depth_top_m: 7.05 })]}
        lithoDepthM={7.0}
        onSnapToGeo={onSnapToGeo}
        onMoveGeoToLitho={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByTestId('snap-litho-to-geo'))
    expect(onSnapToGeo).toHaveBeenCalledWith('g-only')
  })

  it('SD5: clicking Move-geo calls onMoveGeoToLitho with the selected candidate id', () => {
    const onMoveGeoToLitho = vi.fn()
    render(
      <LithoGeoSnapDialog
        open
        candidates={[makeCandidate({ id: 'g-only', depth_top_m: 7.05 })]}
        lithoDepthM={7.0}
        onSnapToGeo={vi.fn()}
        onMoveGeoToLitho={onMoveGeoToLitho}
        onCancel={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByTestId('move-geo-to-litho'))
    expect(onMoveGeoToLitho).toHaveBeenCalledWith('g-only')
  })

  it('SD6: clicking Cancel calls onCancel', () => {
    const onCancel = vi.fn()
    render(
      <LithoGeoSnapDialog
        open
        candidates={[makeCandidate({ id: 'g-1', depth_top_m: 7.05 })]}
        lithoDepthM={7.0}
        onSnapToGeo={vi.fn()}
        onMoveGeoToLitho={vi.fn()}
        onCancel={onCancel}
      />,
    )
    fireEvent.click(screen.getByTestId('snap-cancel'))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('SD7: two candidates → renders a radio group, nearer is default-checked', () => {
    render(
      <LithoGeoSnapDialog
        open
        candidates={[
          makeCandidate({ id: 'g-near', depth_top_m: 7.05 }), // 0.05 m
          makeCandidate({ id: 'g-far', depth_top_m: 7.18 }), // 0.18 m
        ]}
        lithoDepthM={7.0}
        onSnapToGeo={vi.fn()}
        onMoveGeoToLitho={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    const near = screen.getByTestId('snap-candidate-g-near') as HTMLInputElement
    const far = screen.getByTestId('snap-candidate-g-far') as HTMLInputElement
    expect(near.checked).toBe(true)
    expect(far.checked).toBe(false)
  })

  it('SD8: actions act on the SELECTED candidate when the user changes radios', () => {
    const onSnapToGeo = vi.fn()
    render(
      <LithoGeoSnapDialog
        open
        candidates={[
          makeCandidate({ id: 'g-near', depth_top_m: 7.05 }),
          makeCandidate({ id: 'g-far', depth_top_m: 7.18 }),
        ]}
        lithoDepthM={7.0}
        onSnapToGeo={onSnapToGeo}
        onMoveGeoToLitho={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByTestId('snap-candidate-g-far'))
    fireEvent.click(screen.getByTestId('snap-litho-to-geo'))
    expect(onSnapToGeo).toHaveBeenCalledWith('g-far')
  })

  it('SD9: busy disables all three action buttons (async cascade in flight)', () => {
    render(
      <LithoGeoSnapDialog
        open
        busy
        candidates={[makeCandidate({ id: 'g-1', depth_top_m: 7.05 })]}
        lithoDepthM={7.0}
        onSnapToGeo={vi.fn()}
        onMoveGeoToLitho={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByTestId('snap-litho-to-geo')).toBeDisabled()
    expect(screen.getByTestId('move-geo-to-litho')).toBeDisabled()
    expect(screen.getByTestId('snap-cancel')).toBeDisabled()
  })
})
