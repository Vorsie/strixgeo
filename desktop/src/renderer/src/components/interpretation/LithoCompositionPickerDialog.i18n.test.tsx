// Language pins for the manual litho composition picker.
//
// Owner walk of installer #20/#21 (2026-09-06): "the manual litho composition
// picker is partly English in the Dutch UI". The New-unit tab's admixture
// soil / amount dropdowns kept their own local English option lists. They now
// reuse the shared ``admixtureSoilOptions(language)`` /
// ``admixtureAmountOptions(language)`` helpers (same fix the ghost editor got
// in b5ce44a03): the raw DOV code stays the option VALUE, the label follows
// the active language, and the raw token is repeated as the option tooltip.
//
// These pins render the DIALOG (not just the helpers) so the wiring is
// covered: under 'nl' the dropdowns read Dutch, under 'en' they are byte-
// identical to the English list.

import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { GeologicalFormationResponse } from '../../api/client'
import { t } from '../../i18n/translate'
import { setLanguage } from '../../i18n/languageSelect'
import LithoCompositionPickerDialog from './LithoCompositionPickerDialog'

function makeDefaultProps(
  overrides: Partial<React.ComponentProps<typeof LithoCompositionPickerDialog>> = {},
): React.ComponentProps<typeof LithoCompositionPickerDialog> {
  return {
    open: true,
    lithoFormations: [] as readonly GeologicalFormationResponse[],
    geoFormations: [] as readonly GeologicalFormationResponse[],
    anchor: { kind: 'borehole', name: 'BH-1', depth_m: 3.5, elevationM: 4.2 },
    parentFormationName: 'Boom Klei',
    onSelect: vi.fn().mockResolvedValue(undefined),
    onCreateLithoUnit: vi.fn().mockResolvedValue(null),
    onCancel: vi.fn(),
    ...overrides,
  }
}

/** Open the New-unit tab and reveal one admixture row, returning the two selects. */
function openNewUnitWithAdmixtureRow(): { soilSelect: HTMLElement; amountSelect: HTMLElement } {
  fireEvent.click(screen.getByRole('button', { name: t('composition.tabNew') }))
  fireEvent.click(screen.getByRole('button', { name: t('composition.addAdmixture') }))
  const soilSelect = screen.getAllByRole('combobox', {
    name: t('composition.admixtureSoilCode'),
  })[0]
  const amountSelect = screen.getAllByRole('combobox', {
    name: t('composition.admixtureAmount'),
  })[0]
  return { soilSelect, amountSelect }
}

describe('LithoCompositionPickerDialog — admixture dropdowns follow the UI language', () => {
  afterEach(() => {
    // Reset the device-local language so the default-English pins elsewhere in
    // the suite are unaffected by whatever this file set.
    setLanguage('en')
  })

  describe('under nl', () => {
    beforeEach(() => setLanguage('nl'))

    it('P-NL1 — the admixture soil options read in Dutch, raw code in the label AND as the tooltip', () => {
      render(<LithoCompositionPickerDialog {...makeDefaultProps()} />)
      const { soilSelect } = openNewUnitWithAdmixtureRow()

      const kleiig = within(soilSelect).getByRole('option', { name: 'Kleiig (KL)' })
      expect(kleiig).toHaveAttribute('title', 'KL')
      expect(within(soilSelect).getByRole('option', { name: 'Zandig (ZN)' })).toBeInTheDocument()
    })

    it('P-NL2 — the amount scale reads in Dutch ("Very (V)" becomes "Veel (V)")', () => {
      render(<LithoCompositionPickerDialog {...makeDefaultProps()} />)
      const { amountSelect } = openNewUnitWithAdmixtureRow()

      const veel = within(amountSelect).getByRole('option', { name: 'Veel (V)' })
      expect(veel).toHaveAttribute('title', 'V')
      expect(within(amountSelect).getByRole('option', { name: 'Onbepaald' })).toBeInTheDocument()
    })

    it('P-NL3 — no dropdown keeps the English "Clay (KL)" / "Very (V)" the owner flagged', () => {
      render(<LithoCompositionPickerDialog {...makeDefaultProps()} />)
      const { soilSelect, amountSelect } = openNewUnitWithAdmixtureRow()

      expect(within(soilSelect).queryByRole('option', { name: 'Clay (KL)' })).toBeNull()
      expect(within(amountSelect).queryByRole('option', { name: 'Very (V)' })).toBeNull()
    })
  })

  describe('under en', () => {
    beforeEach(() => setLanguage('en'))

    it('P-EN1 — the labels are byte-identical to the English option list (parity)', () => {
      render(<LithoCompositionPickerDialog {...makeDefaultProps()} />)
      const { soilSelect, amountSelect } = openNewUnitWithAdmixtureRow()

      expect(within(soilSelect).getByRole('option', { name: 'Clay (KL)' })).toBeInTheDocument()
      expect(within(amountSelect).getByRole('option', { name: 'Very (V)' })).toBeInTheDocument()
    })
  })
})
