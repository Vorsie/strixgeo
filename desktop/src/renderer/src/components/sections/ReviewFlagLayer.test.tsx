import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import ReviewFlagLayer, { type ReviewFlagMarker } from './ReviewFlagLayer'

function renderLayer(markers: ReviewFlagMarker[], onCorrelate = vi.fn(), onDismiss = vi.fn()) {
  const utils = render(
    <svg>
      <ReviewFlagLayer markers={markers} onCorrelate={onCorrelate} onDismiss={onDismiss} interactivePtr="auto" />
    </svg>,
  )
  return { ...utils, onCorrelate, onDismiss }
}

const marker = (over: Partial<ReviewFlagMarker> = {}): ReviewFlagMarker => ({
  id: 'L1|0|left',
  x: 100,
  y: 200,
  flagLayerId: 'L1',
  facingLayerId: 'R1',
  ...over,
})

describe('ReviewFlagLayer', () => {
  it('renders nothing when there are no markers', () => {
    const { container } = renderLayer([])
    expect(container.querySelector('[data-testid="review-flag-layer"]')).toBeNull()
  })

  it('renders one amber marker per flag, popover closed by default', () => {
    renderLayer([marker(), marker({ id: 'L2|0|right', flagLayerId: 'L2' })])
    // Two "!" glyph markers, no popover until clicked.
    expect(screen.getAllByText('!')).toHaveLength(2)
    expect(screen.queryByTestId('review-flag-popover')).toBeNull()
  })

  it('opens the popover on marker click', () => {
    renderLayer([marker()])
    fireEvent.click(screen.getByText('!').parentElement!.querySelector('circle')!)
    expect(screen.getByTestId('review-flag-popover')).toBeTruthy()
    expect(screen.getByText('Correlate → one band')).toBeTruthy()
    expect(screen.getByText('Keep separate')).toBeTruthy()
  })

  it('Correlate calls onCorrelate with the pair and closes the popover', () => {
    const { onCorrelate } = renderLayer([marker()])
    fireEvent.click(screen.getByText('!').parentElement!.querySelector('circle')!)
    fireEvent.click(screen.getByText('Correlate → one band'))
    expect(onCorrelate).toHaveBeenCalledWith('L1', 'R1')
    expect(screen.queryByTestId('review-flag-popover')).toBeNull()
  })

  it('Keep separate calls onDismiss with the flag id and closes', () => {
    const { onDismiss } = renderLayer([marker()])
    fireEvent.click(screen.getByText('!').parentElement!.querySelector('circle')!)
    fireEvent.click(screen.getByText('Keep separate'))
    expect(onDismiss).toHaveBeenCalledWith('L1|0|left')
    expect(screen.queryByTestId('review-flag-popover')).toBeNull()
  })

  it('Correlate is inert when there is no facing neighbour', () => {
    const { onCorrelate } = renderLayer([marker({ facingLayerId: null })])
    fireEvent.click(screen.getByText('!').parentElement!.querySelector('circle')!)
    fireEvent.click(screen.getByText('Correlate → one band'))
    expect(onCorrelate).not.toHaveBeenCalled()
  })
})
