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
import type { GeologicalFormationResponse } from '../../../api/client'

/** Minimal GeologicalFormationResponse for currentFormations fixtures. */
function makeFormation(
  id: string,
  name: string,
  regionalRef: string | null = null,
): GeologicalFormationResponse {
  return {
    id,
    app_project_id: 'proj-1',
    name,
    color: '#000',
    code: null,
    display_order: 0,
    pinned_order: false,
    regional_ref: regionalRef,
    description: null,
    lithology: null,
    nad_class: null,
    parent_formation_id: null,
    litho_main_soil_code: null,
    litho_admixtures: null,
    instance_ordinal: null,
    instance_ordinal_locked: false,
    parent_formation_name: null,
    parent_extrapolated: false,
    source_litho_formation_id: null,
    source_geo_formation_id: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  } as GeologicalFormationResponse
}

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

  // -------------------------------------------------------------------------
  // Bug 1 — effective selected keys on confirm (lumping-coherence gap fix)
  //
  // Root cause: a row pre-checked from currentFormations (source key in
  // ``checked``) that the user reassigns (source → target) remains in
  // ``checked`` because the checkbox becomes disabled.  The old handleConfirm
  // forwarded ``checked`` verbatim: the source key reached selected_keys →
  // backend kept the source formation instead of deleting it.
  //
  // Fix: at confirm time, compute effectiveSelectedKeys by substituting
  // source key → target key for 'candidate' reassignments and omitting the
  // source key for 'custom' reassignments.
  // -------------------------------------------------------------------------

  it('Bug1a: reassigned source→target candidate: onConfirm emits target key, NOT source key', () => {
    const onConfirm = vi.fn()
    // Pre-check "Formatie van Diest" as an existing model formation.
    const existingDiest = {
      id: 'f-diest',
      app_project_id: 'proj-1',
      name: 'Formatie van Diest',
      color: '#000',
      code: null,
      display_order: 0,
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
      parent_formation_name: null,
      parent_extrapolated: false,
      source_litho_formation_id: null,
      source_geo_formation_id: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    }
    render(
      <FormationSelectionDialog
        {...makeProps({ onConfirm, currentFormations: [existingDiest] })}
      />,
    )

    // "Formatie van Diest" should be pre-checked (it is in currentFormations).
    const diestCb = screen.getByRole('checkbox', { name: 'Formatie van Diest' }) as HTMLInputElement
    expect(diestCb.checked).toBe(true)

    // Reassign "Boom Klei" → "Formatie van Diest".
    fireEvent.click(screen.getByRole('button', { name: /Reassign "Boom Klei"/ }))
    fireEvent.click(screen.getByRole('option', { name: 'Formatie van Diest' }))

    // "Boom Klei" is NOT in checked (never clicked), so it won't appear in
    // checked at all.  But "Formatie van Diest" IS in checked (pre-checked).
    // Apply selection — effectiveSelectedKeys must contain 'formatie van diest'
    // (the target key) and NOT 'boom klei' (the source key, which was never
    // directly checked).
    fireEvent.click(screen.getByRole('button', { name: 'Apply selection' }))
    expect(onConfirm).toHaveBeenCalledOnce()
    const [selectedKeys] = onConfirm.mock.calls[0] as [ReadonlySet<string>, Record<string, string>]
    // Target key must be present.
    expect(selectedKeys.has('formatie van diest')).toBe(true)
    // Source key must NOT appear in effective keys.
    expect(selectedKeys.has('boom klei')).toBe(false)
  })

  it('Bug1b: pre-checked source key reassigned to candidate → target key replaces source in onConfirm', () => {
    // This is the exact Bug 1 scenario: user had "Boom Klei" in the model
    // (so it is pre-checked), then reassigns it to "Formatie van Diest".
    // The RAW checked set still contains 'boom klei' (disabled checkbox).
    // effectiveSelectedKeys must substitute 'boom klei' → 'formatie van diest'.
    const onConfirm = vi.fn()
    const existingBoom = {
      id: 'f-boom',
      app_project_id: 'proj-1',
      name: 'Boom Klei',
      color: '#000',
      code: null,
      display_order: 0,
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
      parent_formation_name: null,
      parent_extrapolated: false,
      source_litho_formation_id: null,
      source_geo_formation_id: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    }
    render(
      <FormationSelectionDialog
        {...makeProps({ onConfirm, currentFormations: [existingBoom] })}
      />,
    )

    // "Boom Klei" is pre-checked (it is in currentFormations).
    const boomCb = screen.getByRole('checkbox', { name: 'Boom Klei' }) as HTMLInputElement
    expect(boomCb.checked).toBe(true)

    // Reassign "Boom Klei" → "Formatie van Diest".
    fireEvent.click(screen.getByRole('button', { name: /Reassign "Boom Klei"/ }))
    fireEvent.click(screen.getByRole('option', { name: 'Formatie van Diest' }))

    // Also check "Formatie van Diest" to include the target in the selection.
    const diestCb = screen.getByRole('checkbox', { name: 'Formatie van Diest' }) as HTMLInputElement
    // diestCb may be enabled; click to check it.
    if (!diestCb.checked) fireEvent.click(diestCb)

    fireEvent.click(screen.getByRole('button', { name: 'Apply selection' }))
    expect(onConfirm).toHaveBeenCalledOnce()
    const [selectedKeys] = onConfirm.mock.calls[0] as [ReadonlySet<string>, Record<string, string>]

    // Target key appears (either from 'boom klei' substitution or from the
    // direct 'formatie van diest' check — both paths converge to this key).
    expect(selectedKeys.has('formatie van diest')).toBe(true)
    // The RAW source key from the pre-checked formation must NOT survive in
    // the effective set (it was substituted by the target key).
    // NOTE: if 'boom klei' is still in effective keys, the backend would
    // keep the source formation — the bug this test guards against.
    expect(selectedKeys.has('boom klei')).toBe(false)
  })

  // -------------------------------------------------------------------------
  // Bug 3 — dialog prefill from initialReassignments (lumping-coherence gap)
  //
  // Root cause: reassignments state always initialized as new Map() → user's
  // previously applied aliases are never shown on reopen.
  // Fix: accept initialReassignments prop and reconstruct RowReassignments.
  // -------------------------------------------------------------------------

  it('Bug3a: initialReassignments prefills row dropdowns from persisted map', () => {
    // The persisted map says 'boom klei' was reassigned to 'Formatie van Diest'.
    const initialReassignments: Record<string, string> = {
      'boom klei': 'Formatie van Diest',
    }

    const onManualMapChange = vi.fn()
    render(
      <FormationSelectionDialog
        {...makeProps({ initialReassignments, onManualMapChange })}
      />,
    )

    // On mount, onManualMapChange should be called with the restored map
    // (the useEffect fires once after the initial render).
    expect(onManualMapChange).toHaveBeenCalledWith({
      'boom klei': 'Formatie van Diest',
    })
  })

  // REVERSED 2026-08-03. This test used to assert that an entry whose source
  // key is absent from the candidate list is DROPPED — and that assertion was
  // the data-loss bug, pinned. The discover scan returns EFFECTIVE keys, so a
  // raw key the user has lumped away is absent from `candidates` by
  // construction and is indistinguishable from a leftover key. The filter
  // deleted the user's groupings on every reopen. Carrying an unknown key
  // through is a no-op server-side (manual_map is applied only to raw keys the
  // scan actually meets); losing a real grouping is not. Full mechanism in
  // FormationSelectionDialog.lumpingSurvival.test.tsx.
  it('Bug3b: initialReassignments carries every persisted entry through, known key or not', () => {
    const initialReassignments: Record<string, string> = {
      'boom klei': 'Formatie van Diest',
      'key not in this discover run': 'Some Formation',
    }

    const onManualMapChange = vi.fn()
    render(
      <FormationSelectionDialog
        {...makeProps({ initialReassignments, onManualMapChange })}
      />,
    )

    expect(onManualMapChange).toHaveBeenCalledWith({
      'boom klei': 'Formatie van Diest',
      'key not in this discover run': 'Some Formation',
    })
  })

  it('Bug3c: initialReassignments with unknown targetName → restored as custom target', () => {
    // 'Bespoke Canonical Name' is not in CANDIDATES → restored as custom.
    const initialReassignments: Record<string, string> = {
      'boom klei': 'Bespoke Canonical Name',
    }

    const onManualMapChange = vi.fn()
    render(
      <FormationSelectionDialog
        {...makeProps({ initialReassignments, onManualMapChange })}
      />,
    )

    // The custom name propagates verbatim to the manual_map wire format.
    expect(onManualMapChange).toHaveBeenCalledWith({
      'boom klei': 'Bespoke Canonical Name',
    })
  })

  // -------------------------------------------------------------------------
  // DOV formal-code surface (owner dogfeed 2026-09-05)
  //
  //   G8   The DOV formal code behind an informal candidate name is shown
  //        next to it, so the engineer can lump on the code, not on a guess.
  //   G9   When a candidate maps to more than one formal code, every code is
  //        listed so the formal↔informal disagreement is visible.
  //   G10  Where the DOV lexicon knows the code, the dialog offers the DOV
  //        code's own formation as a one-click lumping target.
  //   G11  Old and new codes for the same member (TtEg / HyEg are both the
  //        Egem member) offer the SAME one-click target — recognised as one
  //        unit.
  // -------------------------------------------------------------------------

  const DOV_CANDIDATES: FormationCandidate[] = [
    {
      name: 'Ieperiaan - Paniseliaan (P1)',
      key: 'ieperiaan paniseliaan p1',
      boreholeCount: 4,
      formalCodes: [
        { code: 'GeVl', count: 4, catalogName: 'Lid van Vlierzele (Formatie van Gentbrugge)' },
      ],
    },
    {
      name: 'Zandige laag',
      key: 'zandige laag',
      boreholeCount: 2,
      formalCodes: [
        { code: 'GeVl', count: 1, catalogName: 'Lid van Vlierzele (Formatie van Gentbrugge)' },
        { code: 'TtEg', count: 1, catalogName: 'Lid van Egem (Formatie van Tielt)' },
      ],
    },
  ]

  it('G8: shows the DOV formal code and its borehole count next to a candidate', () => {
    render(<FormationSelectionDialog {...makeProps({ candidates: DOV_CANDIDATES })} />)
    expect(screen.getByText('DOV: GeVl (4)')).toBeDefined()
  })

  it('G9: lists every formal code with its count when a candidate maps to more than one', () => {
    render(<FormationSelectionDialog {...makeProps({ candidates: DOV_CANDIDATES })} />)
    // Both codes on one candidate, sorted by count then code → "GeVl (1), TtEg (1)".
    expect(screen.getByText('DOV: GeVl (1), TtEg (1)')).toBeDefined()
  })

  it('G10: offers the DOV code catalogue name as a one-click lumping target', () => {
    const onManualMapChange = vi.fn()
    const SINGLE: FormationCandidate[] = [
      {
        name: 'Ieperiaan - Paniseliaan (P1)',
        key: 'ieperiaan paniseliaan p1',
        boreholeCount: 4,
        formalCodes: [
          { code: 'GeVl', count: 4, catalogName: 'Lid van Vlierzele (Formatie van Gentbrugge)' },
        ],
      },
    ]
    render(
      <FormationSelectionDialog {...makeProps({ candidates: SINGLE, onManualMapChange })} />,
    )
    // The offered target is the member name ("Lid van Vlierzele"), stripped of
    // the "(Formatie van …)" so old/new codes of the same member converge.
    const useBtn = screen.getByRole('button', { name: 'Use DOV name: Lid van Vlierzele' })
    fireEvent.click(useBtn)
    const lastCall = onManualMapChange.mock.calls.at(-1)?.[0] as Record<string, string>
    expect(lastCall['ieperiaan paniseliaan p1']).toBe('Lid van Vlierzele')
  })

  it('G11: old and new codes for the same member offer the same target (TtEg / HyEg = Egem)', () => {
    const EGEM: FormationCandidate[] = [
      {
        name: 'Ieperiaan',
        key: 'ieperiaan',
        boreholeCount: 1,
        formalCodes: [
          { code: 'TtEg', count: 1, catalogName: 'Lid van Egem (Formatie van Tielt)' },
        ],
      },
      {
        name: 'Paleogeen: Formatie van Hyon - Lid van Egem',
        key: 'paleogeen formatie van hyon lid van egem',
        boreholeCount: 1,
        formalCodes: [
          { code: 'HyEg', count: 1, catalogName: 'Lid van Egem (Formatie van Hyon)' },
        ],
      },
    ]
    render(<FormationSelectionDialog {...makeProps({ candidates: EGEM })} />)
    // Both candidates offer the SAME member as the one-click target.
    const btns = screen.getAllByRole('button', { name: 'Use DOV name: Lid van Egem' })
    expect(btns).toHaveLength(2)
  })

  // -------------------------------------------------------------------------
  // DOV-member custom targets are applicable + existing model formations are
  // offered as lumping targets (owner dogfeed 2026-09-06).
  //
  //   R1a  A candidate mapped to a DOV member name can be applied; applying
  //        creates that member as a formation and lumps the candidate into it.
  //   R1b  The apply button is enabled when every row is mapped to a target.
  //   R2   A formation that already exists in the model is offered as a
  //        lumping target.
  // -------------------------------------------------------------------------

  const MERELBEKE_CANDIDATE: FormationCandidate = {
    name: 'Ieperiaan - Paniseliaan (P1m)',
    key: 'ieperiaan paniseliaan p1m',
    boreholeCount: 4,
    formalCodes: [
      { code: 'GeMe', count: 4, catalogName: 'Lid van Merelbeke (Formatie van Gentbrugge)' },
    ],
  }

  it('R1a: a candidate mapped to a DOV member name can be applied — onConfirm carries the member key + lump', () => {
    const onConfirm = vi.fn()
    render(
      <FormationSelectionDialog
        {...makeProps({ candidates: [MERELBEKE_CANDIDATE], onConfirm })}
      />,
    )

    // Map the candidate to the DOV member name via the one-click button.
    fireEvent.click(screen.getByRole('button', { name: 'Use DOV name: Lid van Merelbeke' }))

    // Applying is allowed (the row is mapped to a target).
    const applyBtn = screen.getByRole('button', { name: 'Apply selection' }) as HTMLButtonElement
    expect(applyBtn.disabled).toBe(false)
    fireEvent.click(applyBtn)

    expect(onConfirm).toHaveBeenCalledOnce()
    const [selectedKeys, manualMap] = onConfirm.mock.calls[0] as [
      ReadonlySet<string>,
      Record<string, string>,
    ]
    // Applying creates that member as a formation: its normalised key is in the
    // selection so the backend's selected-key filter creates it.
    expect(selectedKeys.has('lid van merelbeke')).toBe(true)
    // ...and lumps the candidate into it (manual_map keyed on candidate.key).
    expect(manualMap['ieperiaan paniseliaan p1m']).toBe('Lid van Merelbeke')
  })

  it('R1b: the apply button is enabled when every row is mapped to a target', () => {
    const TWO: FormationCandidate[] = [
      MERELBEKE_CANDIDATE,
      {
        name: 'Paleogeen: Formatie van Tielt - Lid van Egem',
        key: 'paleogeen formatie van tielt lid van egem',
        boreholeCount: 2,
        formalCodes: [
          { code: 'TtEg', count: 2, catalogName: 'Lid van Egem (Formatie van Tielt)' },
        ],
      },
    ]
    render(<FormationSelectionDialog {...makeProps({ candidates: TWO })} />)

    // No current formations, nothing checked → Apply starts disabled.
    expect(
      (screen.getByRole('button', { name: 'Apply selection' }) as HTMLButtonElement).disabled,
    ).toBe(true)

    // Map BOTH rows to their DOV member names.
    fireEvent.click(screen.getByRole('button', { name: 'Use DOV name: Lid van Merelbeke' }))
    fireEvent.click(screen.getByRole('button', { name: 'Use DOV name: Lid van Egem' }))

    // Every row is now mapped to a target → Apply is enabled.
    expect(
      (screen.getByRole('button', { name: 'Apply selection' }) as HTMLButtonElement).disabled,
    ).toBe(false)
  })

  it('R2: a formation that already exists in the model is offered as a lumping target', () => {
    // "Merelbeke" was added by hand via "+ Add formation" — it is in the model
    // but not a discovered candidate, so today the dropdown never offers it.
    const onManualMapChange = vi.fn()
    render(
      <FormationSelectionDialog
        {...makeProps({
          currentFormations: [makeFormation('f-mb', 'Merelbeke')],
          onManualMapChange,
        })}
      />,
    )

    // Open the "→ same as" dropdown on the Boom Klei row.
    fireEvent.click(screen.getByRole('button', { name: /Reassign "Boom Klei"/ }))

    // The hand-added model formation is offered as a lumping target.
    const option = screen.getByRole('option', { name: 'Merelbeke' })
    fireEvent.click(option)

    // Picking it lumps the candidate into the existing formation by name.
    expect(onManualMapChange).toHaveBeenLastCalledWith({ 'boom klei': 'Merelbeke' })
  })
})
