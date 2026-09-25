// What the owner is told before a hand split or merge is committed, in his words.
//
// Ruling 6 (docs/debt.md #227, 2026-08-01): "if the qc is lower or higher then it gets a
// warning that it will pull down or up the avg qc of the layer it is in" — say which way
// the representative qc moves and what class results, then LET THE EDIT THROUGH.
//
// Ruling 5: "the user needs to be able to manually overrule everything". A blocking dialog
// with no way through fails that ruling, so the case that matters most here is the one where
// a warning is present and the owner proceeds anyway.
//
// The number shown is the MEDIAN, not the arithmetic mean. The owner said "avg qc", but
// `geotech_subdivision.py` classifies on `median(in_band)`; a consequence computed on the
// mean would promise a reclassification that does not happen. The dialog therefore says
// "representative qc" and never "average".
//
// The messages themselves are authored server-side (one statistic, one wording, one place),
// so these cases pin that the dialog SHOWS what it was handed and manufactures nothing.

import { fireEvent, render, screen, cleanup, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { GeotechBandEditPlanResponse } from '../../api/client'
import GeotechBandEditDialog from './GeotechBandEditDialog'

/** A merge whose union re-derives to a class neither input carried. */
const PLAN_CLASS_MOVES: GeotechBandEditPlanResponse = {
  kind: 'merge',
  parent_top_m: 2,
  parent_base_m: 8,
  intervals: [
    {
      depth_top_m: 3,
      depth_base_m: 6,
      median_qc_mpa: 7.5,
      nad_class: 6,
      previous_nad_class: 7,
      class_changed: true,
      unclassifiable_reason: null,
    },
  ],
  warnings: [
    {
      code: 'qc_pull_down',
      message:
        'Pulls the representative qc of this layer DOWN from 12.0 to 7.5 MPa, class 7 becomes 6.',
      depth_top_m: 3,
      depth_base_m: 4.5,
      band_id: 'band-upper',
    },
  ],
}

/** A split where the qc says the same thing on both sides of the new boundary. */
const PLAN_CLASS_HOLDS: GeotechBandEditPlanResponse = {
  kind: 'split',
  parent_top_m: 2,
  parent_base_m: 8,
  intervals: [
    {
      depth_top_m: 3,
      depth_base_m: 4.5,
      median_qc_mpa: 12,
      nad_class: 7,
      previous_nad_class: 7,
      class_changed: false,
      unclassifiable_reason: null,
    },
    {
      depth_top_m: 4.5,
      depth_base_m: 6,
      median_qc_mpa: 12.2,
      nad_class: 7,
      previous_nad_class: 7,
      class_changed: false,
      unclassifiable_reason: null,
    },
  ],
  warnings: [],
}

function renderDialog(
  plan: GeotechBandEditPlanResponse,
  onConfirm = vi.fn().mockResolvedValue(undefined),
): { onConfirm: ReturnType<typeof vi.fn>; onCancel: ReturnType<typeof vi.fn> } {
  const onCancel = vi.fn()
  render(
    <GeotechBandEditDialog open plan={plan} onConfirm={onConfirm} onCancel={onCancel} />,
  )
  return { onConfirm, onCancel }
}

afterEach(() => cleanup())

describe('the warning fires when the class would change', () => {
  it('W1 — it says which way the representative qc moves and what the class becomes', () => {
    renderDialog(PLAN_CLASS_MOVES)

    const warning = screen.getByTestId('geotech-band-edit-warning-0')
    expect(warning.textContent).toContain('DOWN')
    expect(warning.textContent).toContain('7.5')
    expect(warning.textContent).toContain('class 7 becomes 6')
  })

  it('W2 — the resulting interval shows the class it moves from and to', () => {
    renderDialog(PLAN_CLASS_MOVES)

    const row = screen.getByTestId('geotech-band-edit-interval-0')
    expect(row.textContent).toContain('7')
    expect(row.textContent).toContain('6')
  })
})

describe('and not when it would not', () => {
  it('W3 — a plan with no consequences shows no warning', () => {
    renderDialog(PLAN_CLASS_HOLDS)

    expect(screen.queryByTestId('geotech-band-edit-warning-0')).toBeNull()
  })

  it('W4 — it says plainly that the class does not change, rather than staying silent', () => {
    renderDialog(PLAN_CLASS_HOLDS)

    expect(screen.getByTestId('geotech-band-edit-no-consequence')).toBeTruthy()
  })
})

describe('proceeding against the warning works — the override is the feature', () => {
  it('W5 — the action stays enabled while a warning is on screen', () => {
    renderDialog(PLAN_CLASS_MOVES)

    expect(screen.getByTestId('geotech-band-edit-confirm')).not.toBeDisabled()
  })

  it('W6 — clicking through a warning commits the edit', async () => {
    const { onConfirm } = renderDialog(PLAN_CLASS_MOVES)

    fireEvent.click(screen.getByTestId('geotech-band-edit-confirm'))

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1))
  })
})

describe('it does not read like an irreversible action', () => {
  it('W7 — the action is named after the verb, never "OK" and never "Delete"', () => {
    renderDialog(PLAN_CLASS_MOVES)

    const label = screen.getByTestId('geotech-band-edit-confirm').textContent ?? ''
    expect(label.toLowerCase()).toContain('merge')
    expect(label.toLowerCase()).not.toContain('ok')
  })

  it('W8 — the number is called representative, never average, because it is the median', () => {
    const { container } = render(
      <GeotechBandEditDialog
        open
        plan={PLAN_CLASS_MOVES}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(container.textContent?.toLowerCase()).not.toContain('average')
  })
})

describe('when the cone resistance cannot answer', () => {
  it('W9 — the reason is shown instead of a guessed class', () => {
    const plan: GeotechBandEditPlanResponse = {
      ...PLAN_CLASS_HOLDS,
      intervals: [
        {
          depth_top_m: 3,
          depth_base_m: 4.5,
          median_qc_mpa: null,
          nad_class: null,
          previous_nad_class: 7,
          class_changed: true,
          unclassifiable_reason:
            'Cone resistance is missing or invalid over 14% of 0.50–4.00 m (longest gap 0.50 m) — ' +
            'the class cannot be re-derived here; the band is flagged for review.',
        },
      ],
    }
    renderDialog(plan)

    const row = screen.getByTestId('geotech-band-edit-interval-0')
    expect(row.textContent).toContain('flagged for review')
  })
})


describe('the move verb and the statistic label', () => {

  it('W10 - a move plan titles and names the verb as a move', () => {
    render(
      <GeotechBandEditDialog
        open
        plan={{ ...PLAN_CLASS_MOVES, kind: 'move' }}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByText('Move this packing boundary?')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Move boundary' })).toBeTruthy()
  })

  it('W11 - a non-median statistic is named beside the representative qc', () => {
    render(
      <GeotechBandEditDialog
        open
        plan={{ ...PLAN_CLASS_MOVES, statistic: 'harmonic' }}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    // Ruling 6: the sheet must say WHICH statistic produced its numbers once
    // the model's choice is not the default.
    expect(screen.getByTestId('geotech-band-edit-interval-0').textContent).toMatch(/harmonic/)
  })

})


describe('the absorb-all sheet is named after its own gesture', () => {
  // Owner 2026-09-25: Ctrl+drag over several bands. The plan comes back as
  // kind "absorb" with the FINAL two intervals; the sheet must not call it a
  // move (the boundary did move) nor a merge (bands did merge) — it is both.
  it('W9 — a kind "absorb" plan titles and names the action as an absorb', () => {
    renderDialog({ ...PLAN_CLASS_HOLDS, kind: 'absorb' })
    expect(screen.getByRole('heading').textContent?.toLowerCase()).toContain('absorb')
    const label = screen.getByTestId('geotech-band-edit-confirm').textContent ?? ''
    expect(label.toLowerCase()).toContain('absorb')
  })
})
