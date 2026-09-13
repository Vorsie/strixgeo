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
    // Main soil control shows the KLEI label ("Clay"). (Retargeted from the
    // native <select>.value pin — the control is now an in-app listbox trigger,
    // owner #35.)
    const main = screen.getByLabelText(/Main soil/i)
    expect(main.textContent).toContain('Clay')
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
    // Change main code to KLEI via the listbox (retargeted from fireEvent.change
    // on the native <select>, owner #35): open the control, pick "Clay".
    fireEvent.click(screen.getByLabelText(/Main soil/i))
    fireEvent.click(screen.getByRole('option', { name: 'Clay' }))
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
    // (Retargeted from native <select>.value, owner #35.)
    expect(screen.getByLabelText(/Main soil/i).textContent).toContain('Sand')
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
    expect(screen.getByLabelText(/Main soil/i).textContent).toContain('Clay')
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
    // User adds an admixture row + changes its soil code to ZN via the listbox
    // (retargeted from fireEvent.change on the native <select>, owner #35).
    fireEvent.click(screen.getByRole('button', { name: /add admixture/i }))
    fireEvent.click(screen.getByLabelText(/Admixture soil code/i))
    fireEvent.click(screen.getByRole('option', { name: /Sand \(ZN\)/ }))
    expect(
      screen.getByLabelText(/Admixture soil code/i).textContent,
    ).toContain('Sand (ZN)')
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
    expect(
      screen.getByLabelText(/Admixture soil code/i).textContent,
    ).toContain('Sand (ZN)')
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
    // User changes the seeded row's soil code to VE via the listbox
    // (retargeted from fireEvent.change on the native <select>, owner #35).
    fireEvent.click(screen.getByLabelText(/Admixture soil code/i))
    fireEvent.click(screen.getByRole('option', { name: /Peat \(VE\)/ }))
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
    expect(
      screen.getByLabelText(/Admixture soil code/i).textContent,
    ).toContain('Peat (VE)')
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
    // The disabled main-soil trigger (retargeted from native <select>, owner #35).
    const main = screen.getByLabelText(/Main soil/i) as HTMLButtonElement
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
    const main = screen.getByLabelText(/Main soil/i) as HTMLButtonElement
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
    const main = screen.getByLabelText(/Main soil/i)
    expect(document.activeElement).not.toBe(main)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /cancel|annuleren/i }))
  })
})

// Installer #35 (owner, verbatim): "I'm trying to change samenstelling through
// the right click menu on the litho axis, but the dropdown is not dropping, i
// managed to do it by using arrow keys though." Root cause (probed on the real
// app): nothing in JS prevents the pointer default and focus lands on the
// control, but the native Electron <select> popup itself does not open in this
// window. The soil pickers are now an in-app listbox. Tests are in his words.
describe('LithoGhostCompositionEditor — the samenstelling dropdown drops on click (owner #35)', () => {
  it('the dropdown drops when I click it', () => {
    render(
      <LithoGhostCompositionEditor
        open
        initialMainSoilCode="ZAND"
        initialAdmixtures={[]}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    // Closed to start: no listbox anywhere.
    expect(screen.queryByRole('listbox')).toBeNull()
    const trigger = screen.getByLabelText(/Main soil/i)
    fireEvent.click(trigger)
    // The click drops a listbox of the five base soils.
    expect(screen.getByRole('listbox')).toBeTruthy()
    expect(screen.getAllByRole('option')).toHaveLength(5)
  })

  it('arrow keys still change the soil', () => {
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
    fireEvent.click(screen.getByLabelText(/Main soil/i))
    const listbox = screen.getByRole('listbox')
    // The soils list is GRIND, ZAND, SILT, KLEI, VEEN; ZAND is current, so one
    // step down is SILT, and Enter commits it.
    fireEvent.keyDown(listbox, { key: 'ArrowDown' })
    fireEvent.keyDown(listbox, { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: /save composition/i }))
    const [mainSoilCode] = onSave.mock.calls[0]
    expect(mainSoilCode).toBe('SILT')
  })

  it('Cancel is focused on open, not the soil control', () => {
    render(
      <LithoGhostCompositionEditor
        open
        initialMainSoilCode="ZAND"
        initialAdmixtures={[]}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    const trigger = screen.getByLabelText(/Main soil/i)
    expect(document.activeElement).not.toBe(trigger)
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: /cancel|annuleren/i }),
    )
  })
})
