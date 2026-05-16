// Contract for the shared empty/loading primitives (debt #45):
// EmptyState always renders an icon + title (never blank) and an
// optional hint + CTA; LoadingState always renders a spinner + label
// (motion, not a bare string) and is announced to AT.

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { EmptyState, LoadingState } from './EmptyState'

describe('EmptyState (debt #45)', () => {
  it('renders icon + title, never just blank text', () => {
    render(
      <EmptyState
        icon={<svg data-testid="icon" />}
        title="Nothing here yet"
      />,
    )
    expect(screen.getByTestId('icon')).toBeInTheDocument()
    expect(screen.getByText('Nothing here yet')).toBeInTheDocument()
  })

  it('renders the hint and CTA children when given', () => {
    render(
      <EmptyState icon={<svg />} title="Empty" hint="Do this next">
        <button type="button">Add one</button>
      </EmptyState>,
    )
    expect(screen.getByText('Do this next')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Add one' }),
    ).toBeInTheDocument()
  })

  it('compact variant still renders icon + title (in-list use)', () => {
    render(
      <EmptyState compact icon={<svg data-testid="ci" />} title="No matches" />,
    )
    expect(screen.getByTestId('ci')).toBeInTheDocument()
    expect(screen.getByText('No matches')).toBeInTheDocument()
  })

  it('omits the hint paragraph when not provided', () => {
    render(<EmptyState icon={<svg />} title="Only title" />)
    expect(screen.getByText('Only title')).toBeInTheDocument()
    // No second <p> beyond the title.
    expect(screen.getAllByText(/./, { selector: 'p' })).toHaveLength(1)
  })
})

describe('LoadingState (debt #45)', () => {
  it('renders a spinner + label and is announced as status', () => {
    const { container } = render(<LoadingState label="Loading chart…" />)
    expect(screen.getByText('Loading chart…')).toBeInTheDocument()
    expect(container.querySelector('svg.animate-spin')).not.toBeNull()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })
})
