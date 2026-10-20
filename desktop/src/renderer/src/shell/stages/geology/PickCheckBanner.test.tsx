// The banner names the pick, the guess, how far off it is and the nearest test;
// "Show" opens a section through BOTH tests.

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import PickCheckBanner, { PICK_CHECK_MIN_PICKS } from './PickCheckBanner'
import type { FormationPickCheckResponse } from '../../../api/client'
import { translate, type Translator } from '../../../i18n/translate'

// No translator factory exists; bind ``translate`` to English like ``useT`` does.
const t: Translator = (key, params) => translate('en', key, params)
const tNl: Translator = (key, params) => translate('nl', key, params)

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
  // Spec §2/§6: fewer than 6 picks -> too_few_picks, "too few picks to check";
  // fit_failed carries a reason. Neither may look like a clean, checked formation.
  const tooFew: FormationPickCheckResponse = {
    ...egem,
    formation_id: 'f2',
    formation_name: 'Lid van Merelbeke',
    status: 'too_few_picks',
    n_picks: 4,
    fit: null,
    coverage_90: null,
    flags: [],
  }
  const fitFailed: FormationPickCheckResponse = {
    ...egem,
    formation_id: 'f3',
    formation_name: 'Quartair',
    status: 'fit_failed',
    fit: null,
    coverage_90: null,
    flags: [],
    reason: 'variogram did not converge',
  }

  it('the minimum is six picks, as in the backend', () => {
    expect(PICK_CHECK_MIN_PICKS).toBe(6)
  })

  it('a formation with too few picks says so, even when nothing is flagged', () => {
    render(<PickCheckBanner status="ready" formations={[{ ...egem, flags: [] }, tooFew]} onShow={vi.fn()} t={t} />)
    expect(screen.getByTestId('pick-check-unchecked')).toBeTruthy()
    expect(screen.getByText('Lid van Merelbeke: 4 picks, too few to check (6 needed)')).toBeTruthy()
    expect(screen.queryByTestId('pick-check-banner')).toBeNull()
  })

  it('a formation whose fit failed says it was not checked and why', () => {
    render(<PickCheckBanner status="ready" formations={[fitFailed]} onShow={vi.fn()} t={t} />)
    expect(screen.getByText('Quartair: not checked (variogram did not converge)')).toBeTruthy()
  })

  it('unchecked formations show next to the flags, and in Dutch', () => {
    render(<PickCheckBanner status="ready" formations={[egem, tooFew, fitFailed]} onShow={vi.fn()} t={tNl} />)
    expect(screen.getByTestId('pick-check-banner')).toBeTruthy()
    expect(screen.getByText('Lid van Merelbeke: 4 grenzen, te weinig om te controleren (6 nodig)')).toBeTruthy()
    expect(screen.getByText('Quartair: niet gecontroleerd (variogram did not converge)')).toBeTruthy()
  })

  it('unchecked formations still show while the check is computing', () => {
    render(<PickCheckBanner status="computing" formations={[tooFew]} onShow={vi.fn()} t={t} />)
    expect(screen.getByTestId('pick-check-computing')).toBeTruthy()
    expect(screen.getByText('Lid van Merelbeke: 4 picks, too few to check (6 needed)')).toBeTruthy()
  })

  it('picks judged by the full model are named on the flagged formation', () => {
    render(<PickCheckBanner status="ready" formations={[{ ...egem, refit_fallbacks: 2 }]} onShow={vi.fn()} t={t} />)
    const block = screen.getByTestId('pick-check-formation-f1')
    expect(block.textContent).toContain('2 picks judged by the full model (refit failed)')
  })

  it('picks judged by the full model are named on a clean formation too', () => {
    render(
      <PickCheckBanner status="ready" formations={[{ ...egem, flags: [], refit_fallbacks: 1 }]} onShow={vi.fn()} t={tNl} />,
    )
    expect(screen.getByTestId('pick-check-unchecked').textContent).toContain(
      'Lid van Egem: 1 grenzen beoordeeld met het volledige model (herfit mislukt)',
    )
  })
})
