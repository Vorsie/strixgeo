/**
 * What the geotech admixture prompt says and does (owner ruling 2026-09-04):
 * *"which NAD classes do you want, pure sand or sand with admixture."*
 *
 * AD1  one row per admixture-ambiguous unit, each with two NAD-family radios
 * AD2  picking a family reports it up
 * AD3  Divide is DISABLED until every listed unit has an answer (the owner asks
 *      the engineer to decide — no default class)
 * AD4  once every unit is answered, Divide is enabled and fires onConfirm
 * AD5  a unit's stored answer is shown pre-selected (the change-my-answer path)
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import GeotechAdmixtureChoiceDialog from './GeotechAdmixtureChoiceDialog'
import type { AdmixtureUnit } from '../../../utils/admixtureNadChoice'
import type { NadAdmixtureChoice } from '../../../api/clients/geology.types'

const SILTY_SAND: AdmixtureUnit = {
  formationId: 'f-sand',
  name: 'Antropogeen — Zand',
  soilCode: 'ZAND',
  choice: null,
}
const SANDY_CLAY: AdmixtureUnit = {
  formationId: 'f-clay',
  name: 'Boom — Klei',
  soilCode: 'KLEI',
  choice: null,
}

function renderDialog(
  overrides: Partial<Parameters<typeof GeotechAdmixtureChoiceDialog>[0]> = {},
) {
  const props = {
    open: true,
    units: [SILTY_SAND, SANDY_CLAY],
    selections: {} as Record<string, NadAdmixtureChoice | null>,
    onSelect: vi.fn(),
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  }
  render(<GeotechAdmixtureChoiceDialog {...props} />)
  return props
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('GeotechAdmixtureChoiceDialog', () => {
  it('AD1 — one row per admixture unit, each with a pure and a with-admixture radio', () => {
    renderDialog()
    expect(screen.getByTestId('geotech-admixture-unit-f-sand')).toBeTruthy()
    expect(screen.getByTestId('geotech-admixture-unit-f-clay')).toBeTruthy()
    // English labels interpolate the soil name.
    expect(screen.getByTestId('geotech-admixture-pure-f-sand').closest('label')?.textContent).toContain(
      'Pure Sand',
    )
    expect(
      screen.getByTestId('geotech-admixture-with_admixture-f-sand').closest('label')?.textContent,
    ).toContain('Sand with admixture')
  })

  it('AD2 — picking a family reports (formationId, choice) up', () => {
    const props = renderDialog()
    fireEvent.click(screen.getByTestId('geotech-admixture-with_admixture-f-sand'))
    expect(props.onSelect).toHaveBeenCalledWith('f-sand', 'with_admixture')
  })

  it('AD3 — Divide is disabled while any unit is unanswered', () => {
    // Only one of the two units answered.
    renderDialog({ selections: { 'f-sand': 'pure' } })
    expect(screen.getByTestId('geotech-admixture-choice-confirm')).toBeDisabled()
    expect(screen.getByTestId('geotech-admixture-choice-gate')).toBeTruthy()
  })

  it('AD4 — Divide enables once every unit is answered, and fires onConfirm', () => {
    const props = renderDialog({
      selections: { 'f-sand': 'pure', 'f-clay': 'with_admixture' },
    })
    const confirm = screen.getByTestId('geotech-admixture-choice-confirm')
    expect(confirm).not.toBeDisabled()
    // Gate hint is gone.
    expect(screen.queryByTestId('geotech-admixture-choice-gate')).toBeNull()
    fireEvent.click(confirm)
    expect(props.onConfirm).toHaveBeenCalledTimes(1)
  })

  it('AD5 — a stored answer is shown pre-selected (change-my-answer)', () => {
    renderDialog({
      units: [{ ...SILTY_SAND, choice: 'pure' }],
      selections: { 'f-sand': 'pure' },
    })
    expect(screen.getByTestId('geotech-admixture-pure-f-sand')).toBeChecked()
    expect(screen.getByTestId('geotech-admixture-with_admixture-f-sand')).not.toBeChecked()
  })
})
