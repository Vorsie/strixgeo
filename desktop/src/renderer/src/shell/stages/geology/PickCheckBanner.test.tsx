// The banner names the pick, the guess, how far off it is and the nearest test;
// "Show" opens a section through BOTH tests.

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import PickCheckBanner from './PickCheckBanner'
import type { FormationPickCheckResponse } from '../../../api/client'
import { translate, type Translator } from '../../../i18n/translate'

// No translator factory exists; bind ``translate`` to English like ``useT`` does.
const t: Translator = (key, params) => translate('en', key, params)

const egem: FormationPickCheckResponse = {
  formation_id: 'f1',
  formation_name: 'Lid van Egem',
  status: 'checked',
  n_picks: 17,
  skipped_no_location: 0,
  fit: { range_m: 291, sill_sd_m: 4.2, nugget_sd_m: 0.61 },
  coverage_90: 0.82,
  refit_fallbacks: 0,
  reason: null,
  flags: [
    {
      contact_id: 'c-b16',
      investigation_id: 'b16',
      investigation_kind: 'borehole',
      investigation_name: 'GEO-02/146-B16',
      pick_elevation_m: -2.45,
      predicted_elevation_m: -4.14,
      sigma_m: 0.31,
      z: 5.4,
      nearest: { contact_id: 'c-s16', investigation_name: 'GEO-02/145-S16', distance_m: 0.4, pick_elevation_m: -4.15 },
    },
  ],
}

describe('PickCheckBanner', () => {
  it('lists a flagged pick in plain words', () => {
    render(<PickCheckBanner status="ready" formations={[egem]} onShow={vi.fn()} t={t} />)
    expect(screen.getByText('1 pick to check')).toBeTruthy()
    expect(screen.getByText(/GEO-02\/146-B16: -2.45 m TAW, expected -4.14 ± 0.31 m \(5.4× further off than normal\)/)).toBeTruthy()
    expect(screen.getByText(/Nearest test: GEO-02\/145-S16, 0.4 m away/)).toBeTruthy()
  })

  it('Show opens a section through both tests', () => {
    const onShow = vi.fn()
    render(<PickCheckBanner status="ready" formations={[egem]} onShow={onShow} t={t} />)
    fireEvent.click(screen.getByTestId('pick-check-show-c-b16'))
    expect(onShow).toHaveBeenCalledWith(['c-b16', 'c-s16'])
  })

  it('a clean model shows nothing', () => {
    const { container } = render(
      <PickCheckBanner status="ready" formations={[{ ...egem, flags: [] }]} onShow={vi.fn()} t={t} />,
    )
    expect(container.textContent).toBe('')
  })

  it('computing and failed are said out loud', () => {
    const { rerender } = render(<PickCheckBanner status="computing" formations={[]} onShow={vi.fn()} t={t} />)
    expect(screen.getByTestId('pick-check-computing')).toBeTruthy()
    rerender(<PickCheckBanner status="failed" formations={[]} onShow={vi.fn()} t={t} />)
    expect(screen.getByTestId('pick-check-failed')).toBeTruthy()
  })
})
