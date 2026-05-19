// Unit tests for LithoCompositionPickerDialog.
//
// Claims:
//   D1  Dialog renders both tab labels when open.
//   D2  "Existing units" tab shows a grouped list of litho formations.
//   D3  "Unassigned" group renders for formations with null parent.
//   D4  Clicking a row in the existing-units list fires onSelect.
//   D5  Tab 2 "New unit": ZAND + KL:M admixture → live preview shows
//       "matig kleiige Zand" (the key usability feature from the design).
//   D6  Neutral "resolved automatically" note renders when
//       parentFormationName is null (NOT an alarming warning — review S1).
//   D7  Cancel clears and calls onCancel.
//   D8  Tab 2 onCreateLithoUnit fired with the composed payload on confirm.
//   D9  Dialog renders nothing when open is false.
//   D10 Successful new-unit create closes WITHOUT chaining onSelect
//       (the accept endpoint already made the contact — review B1).

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { GeologicalFormationResponse } from '../../api/client'
import LithoCompositionPickerDialog from './LithoCompositionPickerDialog'

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeGeoFormation(
  id: string,
  name: string,
  display_order = 0,
): GeologicalFormationResponse {
  return {
    id,
    app_project_id: 'P',
    name,
    color: '#3b82f6',
    code: null,
    display_order,
    pinned_order: false,
    regional_ref: null,
    description: null,
    lithology: null,
    nad_class: null,
    parent_formation_id: null,
    litho_main_soil_code: null,
    litho_admixtures: null,
    instance_ordinal: null,
    instance_ordinal_locked: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

function makeLithoFormation(
  id: string,
  parentId: string | null,
  mainCode: string,
  admixtures: Array<{ soil_code: string; amount: string; locally: boolean }> = [],
): GeologicalFormationResponse {
  return {
    id,
    app_project_id: 'P',
    name: mainCode,
    color: '#fbbf24',
    code: null,
    display_order: 0,
    pinned_order: false,
    regional_ref: null,
    description: null,
    lithology: mainCode,
    nad_class: null,
    parent_formation_id: parentId,
    litho_main_soil_code: mainCode,
    litho_admixtures: admixtures,
    instance_ordinal: null,
    instance_ordinal_locked: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

// Default props helper — all callbacks are vi.fn() stubs.
function makeDefaultProps(
  overrides: Partial<React.ComponentProps<typeof LithoCompositionPickerDialog>> = {},
): React.ComponentProps<typeof LithoCompositionPickerDialog> {
  return {
    open: true,
    lithoFormations: [],
    geoFormations: [],
    anchor: { kind: 'borehole', name: 'BH-1', depth_m: 3.5, elevationM: 4.2 },
    parentFormationName: 'Boom Klei',
    onSelect: vi.fn().mockResolvedValue(undefined),
    onCreateLithoUnit: vi.fn().mockResolvedValue(null),
    onCancel: vi.fn(),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// D1 — Dialog renders both tab labels when open
// ---------------------------------------------------------------------------

describe('LithoCompositionPickerDialog — structure', () => {
  it('D1: renders both tab labels when open', () => {
    render(<LithoCompositionPickerDialog {...makeDefaultProps()} />)
    expect(screen.getByRole('button', { name: /existing units/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /new unit/i })).toBeInTheDocument()
  })

  it('D9: renders nothing when open is false', () => {
    const { container } = render(
      <LithoCompositionPickerDialog {...makeDefaultProps({ open: false })} />,
    )
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// D2, D3 — Existing units tab
// ---------------------------------------------------------------------------

describe('LithoCompositionPickerDialog — existing units tab', () => {
  it('D2: shows litho formations grouped by parent geological formation', () => {
    const geoA = makeGeoFormation('geo-a', 'Boom Klei', 0)
    const litho1 = makeLithoFormation('lt-1', 'geo-a', 'ZAND')
    const litho2 = makeLithoFormation('lt-2', 'geo-a', 'KLEI')

    render(
      <LithoCompositionPickerDialog
        {...makeDefaultProps({
          lithoFormations: [litho1, litho2],
          geoFormations: [geoA],
        })}
      />,
    )

    // Group heading — appears at least once (also appears in the "within:" subtitle,
    // so we use getAllByText and assert at least one match).
    expect(screen.getAllByText('Boom Klei').length).toBeGreaterThanOrEqual(1)
    // Both units listed
    expect(screen.getByText('Zand')).toBeInTheDocument()
    expect(screen.getByText('Klei')).toBeInTheDocument()
  })

  it('D3: null-parent formations appear under "Unassigned" group', () => {
    const unassigned = makeLithoFormation('lt-u', null, 'VEEN')

    render(
      <LithoCompositionPickerDialog
        {...makeDefaultProps({
          lithoFormations: [unassigned],
          geoFormations: [],
        })}
      />,
    )

    expect(screen.getByText(/Unassigned/i)).toBeInTheDocument()
    expect(screen.getByText('Veen')).toBeInTheDocument()
  })

  it('D4: clicking an existing-unit row fires onSelect with its id', async () => {
    const onSelect = vi.fn().mockResolvedValue(undefined)
    const geoA = makeGeoFormation('geo-a', 'Boom Klei')
    const litho1 = makeLithoFormation('lt-xyz', 'geo-a', 'ZAND')

    render(
      <LithoCompositionPickerDialog
        {...makeDefaultProps({
          lithoFormations: [litho1],
          geoFormations: [geoA],
          onSelect,
        })}
      />,
    )

    fireEvent.click(screen.getByText('Zand'))
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith('lt-xyz'))
  })
})

// ---------------------------------------------------------------------------
// D5 — Live preview in "New unit" tab
// ---------------------------------------------------------------------------

describe('LithoCompositionPickerDialog — new unit tab preview', () => {
  it('D5: ZAND + KL:M admixture shows "matig kleiige Zand" in the live preview', async () => {
    render(<LithoCompositionPickerDialog {...makeDefaultProps()} />)

    // Switch to "New unit" tab.
    fireEvent.click(screen.getByRole('button', { name: /new unit/i }))

    // Initial preview is just "Zand" (ZAND is the default, no admixtures).
    expect(screen.getByTestId('litho-preview')).toHaveTextContent('Zand')

    // Add an admixture row.
    fireEvent.click(screen.getByRole('button', { name: /add admixture/i }))

    // Set soil code to KL.  The first soil-code select that appears is for
    // this row.
    const soilCodeSelects = screen.getAllByRole('combobox', { name: /admixture soil code/i })
    fireEvent.change(soilCodeSelects[0], { target: { value: 'KL' } })

    // Set amount to M.
    const amountSelects = screen.getAllByRole('combobox', { name: /admixture amount/i })
    fireEvent.change(amountSelects[0], { target: { value: 'M' } })

    // Live preview must update to "matig kleiige Zand".
    await waitFor(() =>
      expect(screen.getByTestId('litho-preview')).toHaveTextContent('matig kleiige Zand'),
    )
  })
})

// ---------------------------------------------------------------------------
// D6 — No-geology-context warning
// ---------------------------------------------------------------------------

describe('LithoCompositionPickerDialog — no-context note', () => {
  it('D6: shows the neutral auto-resolve note when parentFormationName is null', () => {
    render(
      <LithoCompositionPickerDialog
        {...makeDefaultProps({ parentFormationName: null })}
      />,
    )
    expect(
      screen.getByText(/resolved automatically when the contact is committed/i),
    ).toBeInTheDocument()
  })

  it('omits the auto-resolve note when parentFormationName is provided', () => {
    render(
      <LithoCompositionPickerDialog
        {...makeDefaultProps({ parentFormationName: 'Boom Klei' })}
      />,
    )
    expect(
      screen.queryByText(/resolved automatically when the contact is committed/i),
    ).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// D7 — Cancel
// ---------------------------------------------------------------------------

describe('LithoCompositionPickerDialog — cancel', () => {
  it('D7: cancel button fires onCancel', () => {
    const onCancel = vi.fn()
    render(<LithoCompositionPickerDialog {...makeDefaultProps({ onCancel })} />)
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// D8 — Create unit confirm
// ---------------------------------------------------------------------------

describe('LithoCompositionPickerDialog — create unit confirm', () => {
  it('D8: confirm calls onCreateLithoUnit with composed payload', async () => {
    const onCreateLithoUnit = vi.fn().mockResolvedValue(null)

    render(
      <LithoCompositionPickerDialog
        {...makeDefaultProps({ onCreateLithoUnit })}
      />,
    )

    // Switch to "New unit" tab.
    fireEvent.click(screen.getByRole('button', { name: /new unit/i }))

    // Pick KLEI as main soil.
    const dialog = screen.getByRole('dialog')
    const kleiButton = within(dialog).getByRole('button', { name: /^Klei$/i })
    fireEvent.click(kleiButton)

    // Confirm.
    fireEvent.click(screen.getByRole('button', { name: /create unit/i }))

    await waitFor(() => expect(onCreateLithoUnit).toHaveBeenCalledWith('KLEI', []))
  })
})

// ---------------------------------------------------------------------------
// D10 — new-unit create must NOT double-create (review B1)
// ---------------------------------------------------------------------------

describe('LithoCompositionPickerDialog — new-unit does not double-create (B1)', () => {
  it('D10: successful create closes via onCancel and does NOT chain onSelect', async () => {
    const onCreateLithoUnit = vi.fn().mockResolvedValue({ formationId: 'lt-new' })
    const onSelect = vi.fn().mockResolvedValue(undefined)
    const onCancel = vi.fn()

    render(
      <LithoCompositionPickerDialog
        {...makeDefaultProps({ onCreateLithoUnit, onSelect, onCancel })}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /new unit/i }))
    fireEvent.click(screen.getByRole('button', { name: /create unit/i }))

    await waitFor(() => expect(onCreateLithoUnit).toHaveBeenCalled())
    // onCreateLithoUnit already created the formation + contact + seeded
    // the section. Chaining onSelect would re-POST the contact → 409 →
    // false error toast (B1). It must NOT be called; the dialog closes.
    expect(onSelect).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
