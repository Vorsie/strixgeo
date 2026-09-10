// Behaviour tests for LithoGhostCompositionEditor (debt #72).
//
// The editor is a small modal that lets the engineer change a ghost
// suggestion's main soil code / admixture list before accepting. It
// returns the composition via onSave; the caller stashes it on the
// suggestion's edits Map. The editor never talks to the server.
//
// E1 — opens with the supplied initial composition.
// E2 — Save returns the (mainSoilCode, admixtures) currently in state.
// E3 — Cancel never fires onSave.
// E4 — re-opening with a different suggestion resets internal state.
// E5 — Add / Remove admixture row mutations are reflected in Save payload.

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import LithoGhostCompositionEditor from './LithoGhostCompositionEditor'

describe('LithoGhostCompositionEditor', () => {
  it('E1 — opens with the supplied initial main soil code + admixtures', () => {
    render(
      <LithoGhostCompositionEditor
        open
        initialMainSoilCode="KLEI"
        initialAdmixtures={[{ soil_code: 'ZN', amount: 'M', locally: false }]}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    // Main soil select shows KLEI.
    const main = screen.getByLabelText(/Main soil/i) as HTMLSelectElement
    expect(main.value).toBe('KLEI')
    // Live preview reflects the English label (KLEI + moderately sandy).
    const preview = screen.getByTestId('ghost-edit-preview')
    expect(preview.textContent ?? '').not.toBe('')
  })

  it('E2 — Save returns the current main soil code + admixture list', () => {
    const onSave = vi.fn()
    render(
      <LithoGhostCompositionEditor
        open
        initialMainSoilCode="ZAND"
        initialAdmixtures={[]}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    )
    // Change main code to KLEI.
    const main = screen.getByLabelText(/Main soil/i) as HTMLSelectElement
    fireEvent.change(main, { target: { value: 'KLEI' } })
    fireEvent.click(screen.getByRole('button', { name: /save composition/i }))
    expect(onSave).toHaveBeenCalledTimes(1)
    const [mainSoilCode, admixtures] = onSave.mock.calls[0]
    expect(mainSoilCode).toBe('KLEI')
    expect(admixtures).toEqual([])
  })

  it('E3 — Cancel does not fire onSave', () => {
    const onSave = vi.fn()
    const onCancel = vi.fn()
    render(
      <LithoGhostCompositionEditor
        open
        initialMainSoilCode="ZAND"
        initialAdmixtures={[]}
        onSave={onSave}
        onCancel={onCancel}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onSave).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('E4 — re-opening with a new initial composition resets state', () => {
    const { rerender } = render(
      <LithoGhostCompositionEditor
        open
        initialMainSoilCode="ZAND"
        initialAdmixtures={[]}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    const main = screen.getByLabelText(/Main soil/i) as HTMLSelectElement
    expect(main.value).toBe('ZAND')
    // Close + reopen with KLEI.
    rerender(
      <LithoGhostCompositionEditor
        open={false}
        initialMainSoilCode="KLEI"
        initialAdmixtures={[]}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    rerender(
      <LithoGhostCompositionEditor
        open
        initialMainSoilCode="KLEI"
        initialAdmixtures={[]}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    const main2 = screen.getByLabelText(/Main soil/i) as HTMLSelectElement
    expect(main2.value).toBe('KLEI')
  })

  it('E5 — Add → Remove admixture row mutations flow into Save payload', () => {
    const onSave = vi.fn()
    render(
      <LithoGhostCompositionEditor
        open
        initialMainSoilCode="ZAND"
        initialAdmixtures={[]}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    )
    // Add one admixture row.
    fireEvent.click(screen.getByRole('button', { name: /add admixture/i }))
    fireEvent.click(screen.getByRole('button', { name: /save composition/i }))
    const [, admixtures] = onSave.mock.calls[0]
    expect(admixtures).toHaveLength(1)
    // Default new row: first soil option (GL = Grind), empty amount.
    expect(admixtures[0].soil_code).toBe('GL')
    expect(admixtures[0].amount).toBe('')
    expect(admixtures[0].locally).toBe(false)
  })

  // E6 — dogfeed regression (2026-05-20). The parent passes
  // initialAdmixtures via an inline .map(...) so the array reference
  // changes on every parent re-render. A parent re-render WHILE the
  // editor is open must NOT clobber in-progress edits (added rows,
  // changed dropdown selections). The pre-fix bug: "the box clears
  // and I can't select from the admixture menu anymore."
  it('E6 — parent re-render mid-edit does not reset added rows', () => {
    const { rerender } = render(
      <LithoGhostCompositionEditor
        open
        initialMainSoilCode="ZAND"
        initialAdmixtures={[]}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    // User adds an admixture row + changes its soil code to ZN.
    fireEvent.click(screen.getByRole('button', { name: /add admixture/i }))
    const soilSelect = screen.getByLabelText(
      /Admixture soil code/i,
    ) as HTMLSelectElement
    fireEvent.change(soilSelect, { target: { value: 'ZN' } })
    expect(soilSelect.value).toBe('ZN')
    // Parent re-renders with a fresh-identity initialAdmixtures
    // (same content, new reference — the dogfeed bug trigger).
    rerender(
      <LithoGhostCompositionEditor
        open
        initialMainSoilCode="ZAND"
        initialAdmixtures={[]}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    // The added row must still be present + the user's selection
    // preserved. Pre-fix: the row was wiped (no soil-code select
    // visible) and the dropdown reverted to its default.
    const soilSelectAfter = screen.getByLabelText(
      /Admixture soil code/i,
    ) as HTMLSelectElement
    expect(soilSelectAfter.value).toBe('ZN')
  })

  // E7 — variant of E6: the parent passes a non-empty initialAdmixtures
  // and re-renders mid-edit. The user's CHANGES to the seeded rows
  // must survive.
  it('E7 — parent re-render does not undo edits to seeded rows', () => {
    const initial = [{ soil_code: 'GL', amount: 'M', locally: false }]
    const { rerender } = render(
      <LithoGhostCompositionEditor
        open
        initialMainSoilCode="ZAND"
        initialAdmixtures={initial}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    // User changes the seeded row's soil code to VE.
    const soilSelect = screen.getByLabelText(
      /Admixture soil code/i,
    ) as HTMLSelectElement
    fireEvent.change(soilSelect, { target: { value: 'VE' } })
    // Parent re-renders, passing a FRESH array with the original
    // content (the inline .map(...) pattern).
    rerender(
      <LithoGhostCompositionEditor
        open
        initialMainSoilCode="ZAND"
        initialAdmixtures={[{ soil_code: 'GL', amount: 'M', locally: false }]}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    const soilSelectAfter = screen.getByLabelText(
      /Admixture soil code/i,
    ) as HTMLSelectElement
    expect(soilSelectAfter.value).toBe('VE')
  })

  // E8 — mainSoilLocked=true: the main-soil select is disabled and the
  // title reflects the body-edit context ("Edit admixtures for this body").
  it('E8 — mainSoilLocked disables the main-soil select and changes the title', () => {
    render(
      <LithoGhostCompositionEditor
        open
        initialMainSoilCode="KLEI"
        initialAdmixtures={[]}
        mainSoilLocked
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    const main = screen.getByLabelText(/Main soil/i) as HTMLSelectElement
    expect(main.disabled).toBe(true)
    expect(screen.getByText(/edit admixtures for this body/i)).toBeTruthy()
  })

  // E9 — mainSoilLocked=true: Save still returns the main soil code even
  // though the select is disabled (the component must not drop the value).
  it('E9 — mainSoilLocked: Save returns the locked main soil code unchanged', () => {
    const onSave = vi.fn()
    render(
      <LithoGhostCompositionEditor
        open
        initialMainSoilCode="KLEI"
        initialAdmixtures={[{ soil_code: 'ZN', amount: 'M', locally: false }]}
        mainSoilLocked
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /save composition/i }))
    expect(onSave).toHaveBeenCalledTimes(1)
    const [mainSoilCode, admixtures] = onSave.mock.calls[0]
    expect(mainSoilCode).toBe('KLEI')
    expect(admixtures).toHaveLength(1)
    expect(admixtures[0].soil_code).toBe('ZN')
  })

  // E10 — mainSoilLocked absent (default): the main-soil select is enabled
  // and the title shows the ghost-suggestion wording.
  it('E10 — mainSoilLocked omitted: select is enabled and title shows ghost wording', () => {
    render(
      <LithoGhostCompositionEditor
        open
        initialMainSoilCode="ZAND"
        initialAdmixtures={[]}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    const main = screen.getByLabelText(/Main soil/i) as HTMLSelectElement
    expect(main.disabled).toBe(false)
    expect(screen.getByText(/edit suggestion composition/i)).toBeTruthy()
  })
})

describe('LithoGhostCompositionEditor — a stray key cannot change the soil (owner 2026-09-10)', () => {
  // On the packaged build a sand piece on 1411-GEO-23/126-B4 became GRIND
  // through Edit composition without the owner ever choosing gravel: the
  // dialog handed keyboard focus to the main-soil dropdown on open, and on a
  // focused dropdown one ArrowUp moves from Sand to Gravel, the option right
  // above it. Opening must not focus the soil field; Cancel takes the focus,
  // as every destructive-capable dialog in the app does.
  it('E6 — opening focuses Cancel, never the main-soil field', () => {
    render(
      <LithoGhostCompositionEditor
        open
        initialMainSoilCode="ZAND"
        initialAdmixtures={[]}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    const main = screen.getByLabelText(/Main soil/i) as HTMLSelectElement
    expect(document.activeElement).not.toBe(main)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /cancel|annuleren/i }))
  })
})
