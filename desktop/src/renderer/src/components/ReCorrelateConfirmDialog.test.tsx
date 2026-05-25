// Tests for ReCorrelateConfirmDialog (Slice 4 Half-A — re-correlate dialog).
//
// AC1 — open shows the dialog with the edge count in the body.
// AC2 — Cancel button has default focus on open (irreversible-action rule:
//        an accidental Enter must NOT modify the model).
// AC3 — Cancel fires onCancel, never onSkip or onReCorrelate.
// AC4 — Esc key fires onCancel.
// AC5 — Skip fires onSkip, never onCancel or onReCorrelate.
// AC6 — Re-correlate fires onReCorrelate, never onCancel or onSkip.
// AC7 — open=false renders nothing.
// AC8 — Cancel button has a focus ring (WCAG keyboard visibility).

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ReCorrelateConfirmDialog from './ReCorrelateConfirmDialog'

afterEach(() => cleanup())

describe('ReCorrelateConfirmDialog', () => {
  it('AC1 — open shows dialog with the edge count', () => {
    render(
      <ReCorrelateConfirmDialog
        open
        existingAutoEdgeCount={7}
        onCancel={vi.fn()}
        onSkip={vi.fn()}
        onReCorrelate={vi.fn()}
      />,
    )
    // Title present.
    expect(screen.getByText(/auto-correlate found existing edges/i)).not.toBeNull()
    // Edge count visible in the body.
    expect(screen.getByText('7')).not.toBeNull()
  })

  it('AC1b — singular "edge" copy for count=1', () => {
    render(
      <ReCorrelateConfirmDialog
        open
        existingAutoEdgeCount={1}
        onCancel={vi.fn()}
        onSkip={vi.fn()}
        onReCorrelate={vi.fn()}
      />,
    )
    // "1 auto-correlation edge" (singular, not "edges").
    // The count lives in a <span> so text nodes are split — test the
    // containing dialog's textContent instead of queryByText which only
    // matches within a single text node.  Modal portals to document.body
    // so query against the testid rendered there.
    expect(screen.getByText('1')).not.toBeNull()
    const dialog = document.body.querySelector('[data-testid="re-correlate-confirm-dialog"]')
    expect(dialog?.textContent).toContain('auto-correlation edge')
    // "auto-correlation edge " appears once (singular); "auto-correlation edges"
    // (plural) must not appear. Index check: indexOf("auto-correlation edges")
    // should be -1.
    expect(dialog?.textContent?.includes('auto-correlation edges')).toBe(false)
  })

  it('AC2 — Cancel button has default focus on open', () => {
    render(
      <ReCorrelateConfirmDialog
        open
        existingAutoEdgeCount={3}
        onCancel={vi.fn()}
        onSkip={vi.fn()}
        onReCorrelate={vi.fn()}
      />,
    )
    const cancel = screen.getByRole('button', { name: /^cancel$/i })
    // Irreversible-action rule (docs/ux.md): accidental Enter must not
    // fire either the Skip or Re-correlate path.
    expect(document.activeElement).toBe(cancel)
  })

  it('AC3 — Cancel fires onCancel, never onSkip or onReCorrelate', () => {
    const onCancel = vi.fn()
    const onSkip = vi.fn()
    const onReCorrelate = vi.fn()
    render(
      <ReCorrelateConfirmDialog
        open
        existingAutoEdgeCount={3}
        onCancel={onCancel}
        onSkip={onSkip}
        onReCorrelate={onReCorrelate}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onSkip).not.toHaveBeenCalled()
    expect(onReCorrelate).not.toHaveBeenCalled()
  })

  it('AC4 — Esc key fires onCancel', () => {
    const onCancel = vi.fn()
    render(
      <ReCorrelateConfirmDialog
        open
        existingAutoEdgeCount={3}
        onCancel={onCancel}
        onSkip={vi.fn()}
        onReCorrelate={vi.fn()}
      />,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('AC5 — Skip fires onSkip, never onCancel or onReCorrelate', () => {
    const onCancel = vi.fn()
    const onSkip = vi.fn()
    const onReCorrelate = vi.fn()
    render(
      <ReCorrelateConfirmDialog
        open
        existingAutoEdgeCount={3}
        onCancel={onCancel}
        onSkip={onSkip}
        onReCorrelate={onReCorrelate}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /skip/i }))
    expect(onSkip).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
    expect(onReCorrelate).not.toHaveBeenCalled()
  })

  it('AC6 — Re-correlate fires onReCorrelate, never onCancel or onSkip', () => {
    const onCancel = vi.fn()
    const onSkip = vi.fn()
    const onReCorrelate = vi.fn()
    render(
      <ReCorrelateConfirmDialog
        open
        existingAutoEdgeCount={3}
        onCancel={onCancel}
        onSkip={onSkip}
        onReCorrelate={onReCorrelate}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /re-correlate/i }))
    expect(onReCorrelate).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
    expect(onSkip).not.toHaveBeenCalled()
  })

  it('AC7 — open=false renders nothing', () => {
    const { container } = render(
      <ReCorrelateConfirmDialog
        open={false}
        existingAutoEdgeCount={3}
        onCancel={vi.fn()}
        onSkip={vi.fn()}
        onReCorrelate={vi.fn()}
      />,
    )
    expect(container.querySelector('button')).toBeNull()
  })

  it('AC8 — Cancel button has a focus ring (WCAG keyboard visibility)', () => {
    render(
      <ReCorrelateConfirmDialog
        open
        existingAutoEdgeCount={3}
        onCancel={vi.fn()}
        onSkip={vi.fn()}
        onReCorrelate={vi.fn()}
      />,
    )
    const cancel = screen.getByRole('button', { name: /^cancel$/i })
    expect(cancel.className).toContain('focus-visible:ring-')
  })
})
