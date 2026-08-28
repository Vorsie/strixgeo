import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import GapRevealFlash from './GapRevealFlash'
import type { PlacedColumn } from './utils'

const COLUMNS = [
  { proj: { item: { id: 'S4' } }, nudgedX: 100 },
  { proj: { item: { id: 'B6' } }, nudgedX: 104 },
] as unknown as PlacedColumn[]

describe('GapRevealFlash', () => {
  it('keeps a narrow reported gap visible without marking either column', () => {
    // “Show me” must visibly mark the ground BETWEEN the two columns. A
    // screen span narrower than a pixel would fail that job, so the marker
    // holds the true midpoint while staying visibly wide.
    const { container } = render(
      <svg>
        <GapRevealFlash
          investigationIds={['S4', 'B6']}
          placedColumns={COLUMNS}
          plotTop={20}
          plotHeight={300}
        />
      </svg>,
    )

    const marker = container.querySelector('[data-testid="gap-reveal-flash"]')
    expect(marker).toHaveAttribute('x', '94')
    expect(marker).toHaveAttribute('width', '16')
    expect(marker).toHaveAttribute('y', '20')
    expect(marker).toHaveAttribute('height', '300')
  })
})
