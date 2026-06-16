import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import ErrorBoundary from './ErrorBoundary'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A child component that throws unconditionally on render. */
function AlwaysThrows(): never {
  throw new Error('render bomb')
}

/** A healthy child for the no-error path. */
function Healthy(): JSX.Element {
  return <div>app content</div>
}

// React prints the caught error + component stack to stderr. Suppress that
// output to keep the test log clean — this is expected behaviour.
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ErrorBoundary', () => {
  it('renders children normally when no error is thrown', () => {
    render(
      <ErrorBoundary>
        <Healthy />
      </ErrorBoundary>,
    )
    expect(screen.getByText('app content')).toBeInTheDocument()
  })

  it('shows the fallback UI when a child throws during render', () => {
    render(
      <ErrorBoundary>
        <AlwaysThrows />
      </ErrorBoundary>,
    )
    // Fallback headline
    expect(
      screen.getByRole('alert'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Strix encountered an unexpected error/i),
    ).toBeInTheDocument()
  })

  it('displays the thrown error message in the fallback', () => {
    render(
      <ErrorBoundary>
        <AlwaysThrows />
      </ErrorBoundary>,
    )
    expect(screen.getByText('render bomb')).toBeInTheDocument()
  })

  it('offers a Reload button in the fallback that is auto-focused', () => {
    render(
      <ErrorBoundary>
        <AlwaysThrows />
      </ErrorBoundary>,
    )
    const btn = screen.getByRole('button', { name: /Reload Strix/i })
    expect(btn).toBeInTheDocument()
    expect(btn).toHaveFocus()
  })

  it('shows the logs path hint when logsPath prop is provided', () => {
    render(
      <ErrorBoundary logsPath="/var/log/strix">
        <AlwaysThrows />
      </ErrorBoundary>,
    )
    expect(screen.getByText(/\/var\/log\/strix\/backend\.log/i)).toBeInTheDocument()
  })

  it('does not show the logs path hint when logsPath is not provided', () => {
    render(
      <ErrorBoundary>
        <AlwaysThrows />
      </ErrorBoundary>,
    )
    expect(screen.queryByText(/backend\.log/i)).not.toBeInTheDocument()
  })
})
