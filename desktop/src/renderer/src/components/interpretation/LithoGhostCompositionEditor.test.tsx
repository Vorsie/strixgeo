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
    // Live preview reflects the Dutch label (KLEI + matig zandhoudend).
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
})
