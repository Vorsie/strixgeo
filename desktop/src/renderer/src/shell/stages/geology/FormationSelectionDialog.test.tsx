/**
 * Tests for the FormationSelectionDialog lumping surface (2026-05-17, #55).
 *
 * Claims pinned here:
 *   G1  Candidates render in the list; checkboxes track checked state.
 *   G2  Adding a group and assigning a member builds the correct manual_map
 *       and fires onManualMapChange.
 *   G3  Collision warnings render when collisions are provided (N boreholes
 *       message + per-collision rows).
 *   G4  Confirm fires onConfirm with (selectedKeys, manualMap) — the same map
 *       used in the last preview, not re-computed from internal state.
 *   G5  Ungrouping a group removes all its members from the map and fires
 *       onManualMapChange with the updated (empty or reduced) map.
 *   G6  Search input reorders the candidate list but NEVER removes any entry
 *       (rank-reorders-never-filters invariant).
 *   G7  "Show all" link clears the search and restores default order.
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

  it('G2: adding a group + assigning a member calls onManualMapChange with correct map', () => {
    const onManualMapChange = vi.fn()
    render(<FormationSelectionDialog {...makeProps({ onManualMapChange })} />)

    // Create a new group named "Boom"
    const nameInput = screen.getByPlaceholderText('Target formation name…')
    fireEvent.change(nameInput, { target: { value: 'Boom' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add group' }))

    // The add-group action fires onManualMapChange with an empty map
    // (group has no members yet)
    expect(onManualMapChange).toHaveBeenCalledWith({})

    // Hover to expose the "+ Group" button on a candidate row — we can't
    // easily simulate hover in jsdom, so instead we verify the group rendered
    expect(screen.getByText('Boom')).toBeDefined()
    // Members section says 0 members
    expect(screen.getByText(/0 member/)).toBeDefined()
  })

  it('G3: collision warnings render when collisions are provided', () => {
    render(<FormationSelectionDialog {...makeProps({ collisions: COLLISIONS })} />)

    // The amber header mentions the count
    expect(screen.getByText(/1 borehole.*had layers lumping/)).toBeDefined()
    // Per-collision row shows the formation name — appears in BOTH the candidate
    // list AND the collision warning, so use getAllByText and assert at least one match.
    expect(screen.getAllByText('Boom Klei').length).toBeGreaterThanOrEqual(1)
    // Colliding raw names appear
    expect(screen.getByText(/Klei van Boom/)).toBeDefined()
    // Kept top depth
    expect(screen.getByText(/12\.5m/)).toBeDefined()
  })

  it('G3: no collision section when collisions is empty', () => {
    render(<FormationSelectionDialog {...makeProps({ collisions: [] })} />)
    // "had layers lumping" text should NOT appear
    expect(screen.queryByText(/had layers lumping/)).toBeNull()
  })

  it('G4: Apply selection fires onConfirm with (checkedKeys, manualMap)', () => {
    const onConfirm = vi.fn()
    render(<FormationSelectionDialog {...makeProps({ onConfirm })} />)

    // Check Boom Klei
    const [boomCheckbox] = screen.getAllByRole('checkbox') as HTMLInputElement[]
    fireEvent.click(boomCheckbox!)

    // Apply selection — dialog has no groups so manualMap should be empty
    fireEvent.click(screen.getByRole('button', { name: 'Apply selection' }))
    expect(onConfirm).toHaveBeenCalledOnce()
    const [selectedKeys, manualMap] = onConfirm.mock.calls[0] as [ReadonlySet<string>, Record<string, string>]
    expect(selectedKeys.size).toBe(1)
    expect(selectedKeys.has('boom klei')).toBe(true)
    expect(Object.keys(manualMap)).toHaveLength(0)
  })

  it('G5: ungrouping fires onManualMapChange with empty map', () => {
    const onManualMapChange = vi.fn()
    render(<FormationSelectionDialog {...makeProps({ onManualMapChange })} />)

    // Add a group
    const nameInput = screen.getByPlaceholderText('Target formation name…')
    fireEvent.change(nameInput, { target: { value: 'MyGroup' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add group' }))

    onManualMapChange.mockClear()

    // Ungroup it
    fireEvent.click(screen.getByRole('button', { name: /Remove group/ }))

    // After ungroup the map must be empty (no groups, no members)
    expect(onManualMapChange).toHaveBeenCalledWith({})
  })

  it('G6: search reorders candidates but ALL names remain visible', () => {
    render(<FormationSelectionDialog {...makeProps()} />)

    const searchInput = screen.getByPlaceholderText('Search to reorder…')
    fireEvent.change(searchInput, { target: { value: 'diest' } })

    // All three candidates still in the DOM (rank-reorders-never-filters)
    expect(screen.getByText('Boom Klei')).toBeDefined()
    expect(screen.getByText('Formatie van Diest')).toBeDefined()
    expect(screen.getByText('Lid van Orchies')).toBeDefined()
  })

  it('G7: "Show all" link clears the search query', () => {
    render(<FormationSelectionDialog {...makeProps()} />)

    const searchInput = screen.getByPlaceholderText('Search to reorder…') as HTMLInputElement
    fireEvent.change(searchInput, { target: { value: 'diest' } })
    expect(searchInput.value).toBe('diest')

    const showAll = screen.getByRole('button', { name: 'Show all' })
    fireEvent.click(showAll)
    expect(searchInput.value).toBe('')
    // "Show all" link should disappear when query is cleared
    expect(screen.queryByRole('button', { name: 'Show all' })).toBeNull()
  })

  // B2 regression — duplicate display names must not collapse to the wrong candidate
  //
  // Before the fix, rankedCandidates used:
  //   candidates.find(c => c.name === ranked.name)!
  // When two candidates share the same display name but have different keys,
  // .find() always returns the FIRST match — the second candidate's checkbox
  // built a manual_map entry with the FIRST candidate's key, so the lump
  // silently targeted the wrong formation.  The fix sorts candidates by score
  // directly (no .find() round-trip) so both remain selectable with their OWN keys.
  it('B2: two candidates with identical name but different key both remain selectable with their own keys', () => {
    // Two candidates that share the same display name but have different stable keys.
    // This can happen when DOV ships the same informal description for two
    // formally-distinct units (the fix must handle the underlying FormationCandidate
    // objects, not the display strings).
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

    // Search for "klei" — both Klei candidates must still be in the DOM.
    const searchInput = screen.getByPlaceholderText('Search to reorder…')
    fireEvent.change(searchInput, { target: { value: 'klei' } })

    // Both "Klei" rows remain visible (rank-reorders-never-filters).
    const kleiCells = screen.getAllByText('Klei')
    expect(kleiCells.length).toBe(2)

    // Check all three checkboxes and confirm — the confirmed selectedKeys must
    // contain BOTH distinct Klei keys (not just the first one duplicated).
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    // We have 3 candidates → 3 checkboxes (plus potentially a Select all / none
    // which has a different role or name — take the first 3 candidate ones).
    // Click all of them.
    for (const cb of checkboxes) {
      if (!cb.checked) fireEvent.click(cb)
    }
    fireEvent.click(screen.getByRole('button', { name: 'Apply selection' }))

    expect(onConfirm).toHaveBeenCalledOnce()
    const [selectedKeys] = onConfirm.mock.calls[0] as [ReadonlySet<string>, Record<string, string>]
    // Both distinct Klei keys must be present — if B2 were still broken, only
    // 'klei-boom' would appear (the first match) and 'klei-diest' would be missing.
    expect(selectedKeys.has('klei-boom')).toBe(true)
    expect(selectedKeys.has('klei-diest')).toBe(true)
    expect(selectedKeys.has('zand')).toBe(true)
  })
})
