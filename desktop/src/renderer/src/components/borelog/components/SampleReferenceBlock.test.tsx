// The "Samples (DOV)" block of the track editor's reference pane.
//
// Owner 2026-10-01, on a real DOV borehole: "this is too verbose, also make a
// combined sieve + hydrometer graph". In the session main's words:
//
//   SRB1  one sample = ONE chart, drawn from the combined curve of its
//         grain-size tests, titled with the methods joined ("Zeving +
//         Hydrometer"), the raw method tokens as tooltip.
//   SRB2  under the chart at most three short lines: the shares, the
//         classification, the scalars; no label printed twice, no raw token
//         in parentheses inline.
//   SRB3  the shares come from the combined curve: no "?" where the merged
//         curve reaches the boundary.
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { makeOwnerDovLabSample } from '../../../test/fixtures/dovLabSample'
import SampleReferenceBlock from './SampleReferenceBlock'

afterEach(cleanup)

function renderOwnerSample(): HTMLElement {
  render(<SampleReferenceBlock samples={[makeOwnerDovLabSample()]} active={undefined} />)
  return screen.getByText('Sample 2024-401424').closest('li') as HTMLElement
}

describe('SampleReferenceBlock — compact sample card', () => {
  it('SRB1: a sieve + hydrometer sample draws ONE chart with ONE curve, titled with both methods', () => {
    const li = renderOwnerSample()
    expect(within(li).getAllByTestId('psd-chart')).toHaveLength(1)
    expect(li.querySelectorAll('polyline')).toHaveLength(1)
    const title = within(li).getByText('Zeving + Hydrometer')
    expect(title.getAttribute('title')).toBe('Zeving + Hydrometer')
  })

  it("SRB2+SRB3: the owner's 11 rows print as three lines, no parentheses, no doubled label", () => {
    const li = renderOwnerSample()
    const lines = within(li).getAllByTestId('sample-lab-line')
    expect(lines.map(l => l.textContent)).toEqual([
      'clay 3 % · silt 9 % · sand 83 % · gravel 5 %',
      'ASTM SW-SM, Well-graded sand with silt · BGGG grofzand',
      'w 16.8 % · CaCO₃ 1.8 % · org. 0.1 % · ρ 2.1 t/m³ · ρs 2.65 t/m³',
    ])
    for (const line of lines) {
      expect(line.textContent).not.toMatch(/[()?]/)
    }
    // The raw DOV token is still one hover away.
    expect(within(li).getByText('ρs 2.65 t/m³').getAttribute('title')).toContain(
      'Korrelvolumemassa (korrelvolumemassa)',
    )
  })
})
