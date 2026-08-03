// The dialog that stands between a re-import and an irreversible overwrite.
//
// The rules it has to satisfy (docs/ux.md "Reversible vs irreversible"):
// the engineer sees the OLD and NEW numbers, Cancel has focus so a stray Enter
// cannot replace anything, and the destructive button names the action instead
// of saying "OK".

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import CptRefreshConfirmDialog from './CptRefreshConfirmDialog'

const DIFF = {
  cptId: 'C1',
  name: 'CPT-REFRESH-01',
  oldMaxDepthM: 18.4,
  newMaxDepthM: 12.1,
  oldNRows: 920,
  newNRows: 605,
  nErrors: 0,
  nWarnings: 1,
}

function renderDialog() {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  render(
    <CptRefreshConfirmDialog
      open
      fileName="CPT-REFRESH-01.gef"
      diff={DIFF}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  )
  return { onConfirm, onCancel }
}

describe('CptRefreshConfirmDialog', () => {
  it('names the stored CPT and shows the old-vs-new numbers', () => {
    renderDialog()
    expect(screen.getByTestId('cpt-refresh-confirm-dialog')).toBeInTheDocument()
    const diff = screen.getByTestId('cpt-refresh-diff')
    // Both sides of the decision are on screen.
    expect(diff.textContent).toContain('18.40 m')
    expect(diff.textContent).toContain('12.10 m')
    expect(diff.textContent).toContain('920')
    expect(diff.textContent).toContain('605')
  })

  it('names the action on the destructive button — never "OK"', () => {
    renderDialog()
    const confirm = screen.getByTestId('cpt-refresh-confirm')
    expect(confirm.textContent).toBe('Replace data')
  })

  it('puts focus on Cancel so a stray Enter cannot overwrite anything', () => {
    renderDialog()
    expect(screen.getByTestId('cpt-refresh-cancel')).toHaveFocus()
  })

  it('renders nothing without a diff — there would be nothing to decide on', () => {
    render(
      <CptRefreshConfirmDialog
        open
        fileName="x.gef"
        diff={null}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('cpt-refresh-confirm-dialog')).not.toBeInTheDocument()
  })
})
