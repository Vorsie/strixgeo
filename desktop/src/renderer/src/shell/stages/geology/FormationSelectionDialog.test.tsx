/**
 * Tests for the FormationSelectionDialog per-row reassignment surface
 * (2026-05-17, #55 manual-lump slice — reworked from group-assembler to
 * per-row inline reassignment).
 *
 * Claims pinned here:
 *   G1  Candidates render in the list; checkboxes track checked state.
 *   G2  A row's "→ same as" dropdown options are ranked by partial-match
 *       similarity (most-similar peer listed first when the row name
 *       substantially matches another name).
 *   G3  Selecting a target on a row writes the correct manual_map keyed on
 *       candidate.key and fires onManualMapChange.
 *   G4  "Keep separate" clears the reassignment for a row and fires
 *       onManualMapChange with the updated (empty or reduced) map.
 *   G5  Confirm fires onConfirm with (selectedKeys, manualMap) — the same
 *       map used in the last preview, not re-computed from internal state.
 *   G6  All options remain reachable via typeahead
 *       (rank-reorders-never-filters invariant); the row's OWN name is
 *       absent from its dropdown (no self-reassignment invariant).
 *   G7  Collision warnings render when collisions are provided.
 *   B1  A reassigned row's checkbox reflects the ACTUAL target candidate's
 *       checked state, not the first match by display name — regression guard
 *       for the isChecked find()-on-name bug under duplicate display names.
 *   B2  Two candidates with identical display names but different keys both
 *       remain selectable with their own keys (regression guard for the
 *       earlier .find()-on-name bug that collapsed both to the first match).
 *   B3  Dropdown closes on pointerdown outside (outside-click dismissal).
 *   B4  Dropdown closes on Esc even when the typeahead is NOT focused.
 */

import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, expect, it, vi, afterEach } from 'vitest'

import FormationSelectionDialog from './FormationSelectionDialog'
import type { FormationSelectionDialogProps } from './FormationSelectionDialog'
import type { FormationCandidate, LumpingCollision } from '../../../hooks/useGeologicalModel'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const CANDIDATES: FormationCandidate[] = [
  { name: 'Boom Klei', key: 'boom klei', boreholeCount: 5 },
  { name: 'Formatie van Diest', key: 'formatie van diest', boreholeCount: 3 },
  { name: 'Lid van Orchies', key: 'lid van orchies', boreholeCount: 1 },
]

const COLLISIONS: LumpingCollision[] = [
  {
    boreholeId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    targetFormationKey: 'boom klei',
    targetFormationName: 'Boom Klei',
    collidingRawNames: ['Boom Klei', 'Klei van Boom'],
    keptTopM: 12.5,
    droppedCount: 1,
  },
]

function makeProps(overrides?: Partial<FormationSelectionDialogProps>): FormationSelectionDialogProps {
  return {
    open: true,
    candidates: CANDIDATES,
    collisions: [],
    currentFormations: [],
    currentContacts: [],
    onManualMapChange: vi.fn(),
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FormationSelectionDialog', () => {
  it('G1: renders all candidates in the list', () => {
    render(<FormationSelectionDialog {...makeProps()} />)
    expect(screen.getByText('Boom Klei')).toBeDefined()
    expect(screen.getByText('Formatie van Diest')).toBeDefined()
    expect(screen.getByText('Lid van Orchies')).toBeDefined()
  })

  it('G1: checkboxes start unchecked when no current formations', () => {
    render(<FormationSelectionDialog {...makeProps()} />)
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    // All candidate checkboxes start unchecked (no currentFormations → nothing pre-checked)
    expect(checkboxes.every(cb => !cb.checked)).toBe(true)
  })

  it('G2: row dropdown options are partial-match-ranked (similar names appear first)', () => {
    // "Boom Klei" and "Klei van Boom" share tokens — they should rank
    // above an unrelated name when the query is the row's own name.
    const RANKED_CANDIDATES: FormationCandidate[] = [
      { name: 'Boom Klei', key: 'boom klei', boreholeCount: 5 },
      { name: 'Klei van Boom', key: 'klei van boom', boreholeCount: 2 },
      { name: 'Quartair Zand', key: 'quartair zand', boreholeCount: 1 },
    ]

    render(
      <FormationSelectionDialog
        {...makeProps({ candidates: RANKED_CANDIDATES })}
      />,
    )

    // Open the "→ same as" dropdown on the Boom Klei row
    const boomBtn = screen.getByRole('button', {
      name: /Reassign "Boom Klei"/,
    })
    fireEvent.click(boomBtn)

    // The dropdown should be open — "Keep separate" must be visible
    expect(screen.getByRole('option', { name: 'Keep separate' })).toBeDefined()

    // Both other options should be listed (rank-reorders-never-filters)
    expect(screen.getByRole('option', { name: 'Klei van Boom' })).toBeDefined()
    expect(screen.getByRole('option', { name: 'Quartair Zand' })).toBeDefined()

    // Verify ordering: "Klei van Boom" (shares tokens) should appear BEFORE
    // "Quartair Zand" (no overlap).  Query the listbox items to check order.
    const options = screen.getAllByRole('option')
    const kleiIdx = options.findIndex(o => o.textContent === 'Klei van Boom')
    const quartairIdx = options.findIndex(o => o.textContent === 'Quartair Zand')
    expect(kleiIdx).toBeGreaterThan(0) // not -1
    expect(kleiIdx).toBeLessThan(quartairIdx)
  })

  it('G3: selecting a target writes correct manual_map keyed on candidate.key', () => {
    const onManualMapChange = vi.fn()
    render(
      <FormationSelectionDialog
        {...makeProps({ onManualMapChange })}
      />,
    )

    // Open dropdown on "Boom Klei" row
    const boomBtn = screen.getByRole('button', {
      name: /Reassign "Boom Klei"/,
    })
    fireEvent.click(boomBtn)

    // Pick "Formatie van Diest" as target
    fireEvent.click(screen.getByRole('option', { name: 'Formatie van Diest' }))

    // onManualMapChange must be called with the key (not display name) → target name.
    // The effect fires after state commit; the last call carries the settled map.
    expect(onManualMapChange).toHaveBeenCalledWith({
      'boom klei': 'Formatie van Diest',
    })
  })

  it('G4: "Keep separate" clears the reassignment for a row', () => {
    const onManualMapChange = vi.fn()
    render(
      <FormationSelectionDialog
        {...makeProps({ onManualMapChange })}
      />,
    )

    // Assign "Boom Klei" → "Formatie van Diest"
    fireEvent.click(
      screen.getByRole('button', { name: /Reassign "Boom Klei"/ }),
    )
    fireEvent.click(screen.getByRole('option', { name: 'Formatie van Diest' }))
    expect(onManualMapChange).toHaveBeenLastCalledWith({
      'boom klei': 'Formatie van Diest',
    })

    onManualMapChange.mockClear()

    // Re-open and pick "Keep separate"
    // The button label now changes to "→ Formatie van Diest — click to change"
    fireEvent.click(
      screen.getByRole('button', { name: /Reassigned to "Formatie van Diest"/ }),
    )
    fireEvent.click(screen.getByRole('option', { name: 'Keep separate' }))

    // Reassignment cleared → empty manual_map
    expect(onManualMapChange).toHaveBeenCalledWith({})
  })

  it('G5: Apply selection fires onConfirm with (checkedKeys, manualMap)', () => {
    const onConfirm = vi.fn()
    render(<FormationSelectionDialog {...makeProps({ onConfirm })} />)

    // S4 fix: query checkbox by accessible name (candidate name label)
    // rather than positional index so a fixture reorder can't silently pass.
    const boomCheckbox = screen.getByRole('checkbox', { name: 'Boom Klei' }) as HTMLInputElement
    fireEvent.click(boomCheckbox)

    // Apply selection — no reassignments, manualMap should be empty
    fireEvent.click(screen.getByRole('button', { name: 'Apply selection' }))
    expect(onConfirm).toHaveBeenCalledOnce()
    const [selectedKeys, manualMap] = onConfirm.mock.calls[0] as [ReadonlySet<string>, Record<string, string>]
    expect(selectedKeys.size).toBe(1)
    expect(selectedKeys.has('boom klei')).toBe(true)
    expect(Object.keys(manualMap)).toHaveLength(0)
  })

  it('G5: Apply includes reassignments in the manualMap', () => {
    const onConfirm = vi.fn()
    render(<FormationSelectionDialog {...makeProps({ onConfirm })} />)

    // S4 fix: query by accessible name, not positional index.
    const diestCheckbox = screen.getByRole('checkbox', {
      name: 'Formatie van Diest',
    }) as HTMLInputElement
    fireEvent.click(diestCheckbox)

    // Reassign "Boom Klei" → "Formatie van Diest"
    fireEvent.click(
      screen.getByRole('button', { name: /Reassign "Boom Klei"/ }),
    )
    fireEvent.click(screen.getByRole('option', { name: 'Formatie van Diest' }))

    // Apply — button is enabled because Formatie van Diest is checked.
    fireEvent.click(screen.getByRole('button', { name: 'Apply selection' }))
    expect(onConfirm).toHaveBeenCalledOnce()
    const [, manualMap] = onConfirm.mock.calls[0] as [ReadonlySet<string>, Record<string, string>]
    // manual_map must be keyed on candidate.key not display name
    expect(manualMap['boom klei']).toBe('Formatie van Diest')
  })

  it('G6: typeahead re-ranks but ALL options remain visible (rank-reorders-never-filters)', () => {
    render(<FormationSelectionDialog {...makeProps()} />)

    // Open dropdown on "Boom Klei"
    fireEvent.click(
      screen.getByRole('button', { name: /Reassign "Boom Klei"/ }),
    )

    // Type a query — all OTHER candidates must still appear
    const typeahead = screen.getByPlaceholderText('Type to re-rank or enter name…')
    fireEvent.change(typeahead, { target: { value: 'diest' } })

    expect(screen.getByRole('option', { name: 'Formatie van Diest' })).toBeDefined()
    expect(screen.getByRole('option', { name: 'Lid van Orchies' })).toBeDefined()
    expect(screen.getByRole('option', { name: 'Keep separate' })).toBeDefined()

    // S5 fix: the row's OWN name ("Boom Klei") must NOT appear as an option —
    // self-reassignment is not permitted (peer list excludes the row itself).
    expect(screen.queryByRole('option', { name: 'Boom Klei' })).toBeNull()
  })

  it('G7: collision warnings render when collisions are provided', () => {
    render(<FormationSelectionDialog {...makeProps({ collisions: COLLISIONS })} />)

    expect(screen.getByText(/1 borehole.*had layers lumping/)).toBeDefined()
    expect(screen.getAllByText('Boom Klei').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/Klei van Boom/)).toBeDefined()
    expect(screen.getByText(/12\.5m/)).toBeDefined()
  })

  it('G7: no collision section when collisions is empty', () => {
    render(<FormationSelectionDialog {...makeProps({ collisions: [] })} />)
    expect(screen.queryByText(/had layers lumping/)).toBeNull()
  })

  // B1 regression — isChecked resolves by candidate KEY not display name.
  //
  // Before the discriminated-union fix, isChecked used:
  //   candidates.find(c => c.name === reassignedTo)
  // When two candidates share the same display name but have different keys,
  // .find() always returns the FIRST — the reassigned row's checkbox read the
  // FIRST candidate's checked state even if the target was the SECOND.  The
  // new model stores a { kind: 'candidate', key } and resolves by key.
  it('B1: isChecked resolves by target key — correct even under duplicate display names', () => {
    const DUP: FormationCandidate[] = [
      { name: 'Klei', key: 'klei-a', boreholeCount: 3 },
      { name: 'Klei', key: 'klei-b', boreholeCount: 2 },
      { name: 'Zand', key: 'zand', boreholeCount: 1 },
    ]

    render(<FormationSelectionDialog {...makeProps({ candidates: DUP })} />)

    // Check ONLY the second Klei row (klei-b) by accessible name.
    // Both share the display name "Klei" — we use getAllByRole and pick the
    // second checkbox (index 1, which corresponds to klei-b by render order).
    const kleiCheckboxes = screen.getAllByRole('checkbox', { name: 'Klei' }) as HTMLInputElement[]
    expect(kleiCheckboxes).toHaveLength(2)
    // Check only the second one (klei-b).
    fireEvent.click(kleiCheckboxes[1]!)
    expect(kleiCheckboxes[1]!.checked).toBe(true)
    expect(kleiCheckboxes[0]!.checked).toBe(false)

    // Reassign Zand → klei-b (the SECOND Klei, which IS checked).
    // Open the Zand row's dropdown and pick the second "Klei" option.
    fireEvent.click(screen.getByRole('button', { name: /Reassign "Zand"/ }))
    // The listbox shows both "Klei" entries.  Pick the second one — the
    // dropdown options for "Zand" exclude "Zand" itself so we get exactly two
    // "Klei" options.
    const kleiOptions = screen.getAllByRole('option', { name: 'Klei' })
    expect(kleiOptions).toHaveLength(2)
    fireEvent.click(kleiOptions[1]!)   // pick the second Klei (klei-b)

    // Zand's checkbox must now reflect klei-b's checked state (true).
    // If the bug were present it would incorrectly read klei-a's state (false).
    const zandCheckbox = screen.getByRole('checkbox', { name: 'Zand' }) as HTMLInputElement
    expect(zandCheckbox.checked).toBe(true)
  })

  // B2 regression — duplicate display names must not collapse to the wrong candidate.
  //
  // Before the fix, rankedCandidates used:
  //   candidates.find(c => c.name === ranked.name)!
  // When two candidates share the same display name but have different keys,
  // .find() always returns the FIRST match — the second candidate's checkbox
  // built a manual_map entry with the FIRST candidate's key, so the lump
  // silently targeted the wrong formation.  The new per-row model stores state
  // by candidate.key directly, so this class of bug cannot recur.
  it('B2: two candidates with identical name but different key both remain selectable with their own keys', () => {
    const DUPLICATE_NAME_CANDIDATES: FormationCandidate[] = [
      { name: 'Klei', key: 'klei-boom', boreholeCount: 3 },
      { name: 'Klei', key: 'klei-diest', boreholeCount: 2 },
      { name: 'Zand', key: 'zand', boreholeCount: 1 },
    ]

    const onConfirm = vi.fn()
    render(
      <FormationSelectionDialog
        {...makeProps({ candidates: DUPLICATE_NAME_CANDIDATES, onConfirm })}
      />,
    )

    // Both "Klei" rows must be in the DOM.
    const kleiCells = screen.getAllByText('Klei')
    expect(kleiCells.length).toBe(2)

    // Check all three checkboxes and confirm — the confirmed selectedKeys must
    // contain BOTH distinct Klei keys (not just the first one duplicated).
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    for (const cb of checkboxes) {
      if (!cb.checked) fireEvent.click(cb)
    }
    fireEvent.click(screen.getByRole('button', { name: 'Apply selection' }))

    expect(onConfirm).toHaveBeenCalledOnce()
    const [selectedKeys] = onConfirm.mock.calls[0] as [ReadonlySet<string>, Record<string, string>]
    // Both distinct Klei keys must be present.
    expect(selectedKeys.has('klei-boom')).toBe(true)
    expect(selectedKeys.has('klei-diest')).toBe(true)
    expect(selectedKeys.has('zand')).toBe(true)
  })

  // B3 — dropdown closes on pointerdown outside.
  it('B3: dropdown closes on pointerdown outside the container', () => {
    render(
      <div>
        <div data-testid="outside">Outside area</div>
        <FormationSelectionDialog {...makeProps()} />
      </div>,
    )

    // Open dropdown
    fireEvent.click(screen.getByRole('button', { name: /Reassign "Boom Klei"/ }))
    expect(screen.getByRole('listbox')).toBeDefined()

    // Pointerdown on the outside element
    fireEvent.pointerDown(screen.getByTestId('outside'))

    // Dropdown must be closed
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  // B4 — Esc closes the dropdown even when focus is NOT in the typeahead.
  it('B4: Esc closes dropdown when focus is not in the typeahead input', () => {
    render(<FormationSelectionDialog {...makeProps()} />)

    // Open dropdown
    fireEvent.click(screen.getByRole('button', { name: /Reassign "Boom Klei"/ }))
    expect(screen.getByRole('listbox')).toBeDefined()

    // Fire Esc on the document — simulates focus being elsewhere
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('listbox')).toBeNull()
  })
})
