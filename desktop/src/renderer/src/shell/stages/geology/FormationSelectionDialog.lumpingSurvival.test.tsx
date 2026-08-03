/**
 * Regression tests for the 2026-08-03 lumping-map loss inside
 * "Fill from boreholes".
 *
 * The incident, from the owner's log: the FIRST discover of a session carried
 * ``manual_map=13`` and returned 5 candidates; EVERY discover after that
 * carried ``manual_map=0`` and returned 18.  Apply then ran with one selected
 * key, four saved geological units were deleted, and the 13-entry lumping map
 * was staged back as empty.
 *
 * Mechanism (two faults, both pinned below):
 *
 *   M1  ``FormationSelectionDialog`` is mounted by ``GeologyToolbar`` for the
 *       whole session — ``Modal`` returns null while closed, but the component
 *       body still runs.  Both ``useState`` LAZY INITIALISERS therefore run
 *       once, at toolbar mount, when ``open`` is false and ``candidates`` is
 *       ``[]``.  The reassignment initialiser dropped every persisted entry
 *       (nothing matched the empty candidate list) and the checked initialiser
 *       pre-checked nothing.  Neither ever re-ran when the discover results
 *       arrived.
 *
 *   M2  The parent's ``onManualMapChange`` is a plain function declared in the
 *       toolbar body, so it has a NEW IDENTITY on every parent render.  The
 *       notify effect listed it as a dependency, so every unrelated re-render
 *       re-published the (empty) map to the parent — which is what made the
 *       empty map authoritative for every later discover.
 *
 *   M3  A raw key that HAS been lumped away is, by construction, absent from
 *       the candidate list: the discover scan returns EFFECTIVE keys.  So the
 *       old "skip entries not in candidates" filter could not tell a lumped
 *       key from a stale one, and destroyed the user's grouping either way.
 *
 * These live in their own file — the sibling ``FormationSelectionDialog.test``
 * is already over the 500-line god-file threshold (debt #201).
 */

import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, expect, it, vi, afterEach } from 'vitest'

import FormationSelectionDialog from './FormationSelectionDialog'
import type { FormationSelectionDialogProps } from './FormationSelectionDialog'
import type { GeologicalFormationResponse } from '../../../api/client'
import type { FormationCandidate } from '../../../hooks/useGeologicalModel'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * The candidate list as it comes back from a discover run that ALREADY had
 * the persisted lumping map applied: the lumped raw key ("boom klei") is gone,
 * only the surviving target ("Formatie van Diest") and the untouched peers
 * are listed.
 */
const LUMPED_CANDIDATES: FormationCandidate[] = [
  { name: 'Formatie van Diest', key: 'formatie van diest', boreholeCount: 5 },
  { name: 'Lid van Orchies', key: 'lid van orchies', boreholeCount: 2 },
]

/** Minimal ``GeologicalFormationResponse`` — only the fields the dialog reads. */
function formation(name: string, regionalRef: string | null = null): GeologicalFormationResponse {
  return {
    id: `f-${name}`,
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

function makeProps(
  overrides?: Partial<FormationSelectionDialogProps>,
): FormationSelectionDialogProps {
  return {
    open: false,
    candidates: [],
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

describe('FormationSelectionDialog — saved groupings survive a dialog refresh', () => {
  it('M1: groupings saved in a previous session are still there when the dialog opens', () => {
    // The real mount order: the toolbar mounts the dialog CLOSED with no
    // candidates, discovers, and only then opens it with results.
    const onConfirm = vi.fn()
    const initialReassignments = { 'boom klei': 'Formatie van Diest' }
    const { rerender } = render(
      <FormationSelectionDialog {...makeProps({ initialReassignments, onConfirm })} />,
    )

    rerender(
      <FormationSelectionDialog
        {...makeProps({
          initialReassignments,
          onConfirm,
          open: true,
          candidates: LUMPED_CANDIDATES,
        })}
      />,
    )

    fireEvent.click(screen.getByRole('checkbox', { name: 'Formatie van Diest' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply selection' }))

    const [, manualMap] = onConfirm.mock.calls[0] as [ReadonlySet<string>, Record<string, string>]
    expect(manualMap).toEqual({ 'boom klei': 'Formatie van Diest' })
  })

  it('M1: formations already in the model are pre-checked when the dialog opens', () => {
    // The other half of the incident: with nothing pre-checked, Apply went out
    // with a single selected key while four saved units sat unselected.
    const props = {
      currentFormations: [formation('Formatie van Diest'), formation('Lid van Orchies')],
    }
    const { rerender } = render(<FormationSelectionDialog {...makeProps(props)} />)

    rerender(
      <FormationSelectionDialog
        {...makeProps({ ...props, open: true, candidates: LUMPED_CANDIDATES })}
      />,
    )

    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(boxes.every(cb => cb.checked)).toBe(true)
  })

  it('M2: an unrelated parent re-render does not republish an empty map', () => {
    // The parent's handler is re-created on every render. That must not be
    // read as "the user cleared their groupings".
    const initialReassignments = { 'boom klei': 'Formatie van Diest' }
    const firstHandler = vi.fn()
    const props = { initialReassignments, open: true, candidates: LUMPED_CANDIDATES }
    const { rerender } = render(
      <FormationSelectionDialog {...makeProps({ ...props, onManualMapChange: firstHandler })} />,
    )

    const secondHandler = vi.fn()
    rerender(
      <FormationSelectionDialog {...makeProps({ ...props, onManualMapChange: secondHandler })} />,
    )

    expect(secondHandler).not.toHaveBeenCalled()
  })

  it('M3: a grouping whose raw name was lumped away is kept, not discarded', () => {
    // A lumped raw key is ABSENT from the candidate list by construction — the
    // scan returns effective keys. Dropping absent keys therefore deletes the
    // very grouping the user is trying to preserve.
    const onManualMapChange = vi.fn()
    render(
      <FormationSelectionDialog
        {...makeProps({
          open: true,
          candidates: LUMPED_CANDIDATES,
          initialReassignments: { 'boom klei': 'Formatie van Diest' },
          onManualMapChange,
        })}
      />,
    )

    expect(onManualMapChange).toHaveBeenCalledWith({ 'boom klei': 'Formatie van Diest' })
  })

  it('M3: the user clearing a row is still an explicit clear', () => {
    // The rule is "survives unless the user clears it" — the clear must work.
    const onManualMapChange = vi.fn()
    render(
      <FormationSelectionDialog
        {...makeProps({
          open: true,
          candidates: [
            { name: 'Boom Klei', key: 'boom klei', boreholeCount: 5 },
            ...LUMPED_CANDIDATES,
          ],
          initialReassignments: { 'boom klei': 'Formatie van Diest' },
          onManualMapChange,
        })}
      />,
    )
    onManualMapChange.mockClear()

    fireEvent.click(screen.getByRole('button', { name: /Reassigned to "Formatie van Diest"/ }))
    fireEvent.click(screen.getByRole('option', { name: 'Keep separate' }))

    expect(onManualMapChange).toHaveBeenLastCalledWith({})
  })
})
