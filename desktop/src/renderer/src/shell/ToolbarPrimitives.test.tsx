// Contract for the shared toolbar primitives (debt #46): the busy
// prop must swap the caller's icon for a spinning indicator and mark
// the button aria-busy, without disabling it on its own (callers own
// disabled). Pins the in-button spinner docs/ux.md requires.

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ToolbarButton, PrimaryToolbarButton } from './ToolbarPrimitives'

describe('ToolbarPrimitives busy spinner (debt #46)', () => {
  it('ToolbarButton shows the caller icon when idle', () => {
    render(
      <ToolbarButton
        icon={<svg data-testid="caller-icon" />}
        label="Dedupe"
        onClick={vi.fn()}
      />,
    )
    expect(screen.getByTestId('caller-icon')).toBeInTheDocument()
    expect(screen.getByRole('button')).not.toHaveAttribute('aria-busy', 'true')
  })

  it('ToolbarButton swaps to a spinner + aria-busy when busy', () => {
    const { container } = render(
      <ToolbarButton
        icon={<svg data-testid="caller-icon" />}
        label="Cleaning…"
        onClick={vi.fn()}
        busy
      />,
    )
    expect(screen.queryByTestId('caller-icon')).not.toBeInTheDocument()
    // lucide RefreshCw renders an <svg class="... animate-spin">.
    expect(container.querySelector('svg.animate-spin')).not.toBeNull()
    expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true')
  })

  it('busy does not by itself disable the button (caller owns disabled)', () => {
    render(
      <ToolbarButton
        icon={<svg />}
        label="Working…"
        onClick={vi.fn()}
        busy
      />,
    )
    expect(screen.getByRole('button')).toBeEnabled()
  })

  it('PrimaryToolbarButton also honours busy', () => {
    const { container } = render(
      <PrimaryToolbarButton
        icon={<svg data-testid="primary-icon" />}
        label="Scanning…"
        onClick={vi.fn()}
        busy
      />,
    )
    expect(screen.queryByTestId('primary-icon')).not.toBeInTheDocument()
    expect(container.querySelector('svg.animate-spin')).not.toBeNull()
  })
})
