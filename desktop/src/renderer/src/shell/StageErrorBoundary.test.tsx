// M5 — a render crash in ONE stage must stay contained to that stage's slot.
//
// The rule (production-readiness audit M5): the shell has one root
// ErrorBoundary, so a throw inside a 4k-line stage canvas blanks the whole app
// and the only way out is a full reload that drops renderer-only state. A
// per-stage boundary shows a "this stage failed — reset stage" card in the
// stage slot, keeps the spine / inspector / other stages alive, captures a
// diagnostic, and its Reset remounts just that stage.

import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../utils/diagnostics', () => ({ captureDiagnostic: vi.fn() }))

import { captureDiagnostic } from '../utils/diagnostics'
import StageErrorBoundary from './StageErrorBoundary'

// A child whose throwing is controlled by a module flag so a test can make it
// crash once and then recover after a reset.
let bomb = true
function MaybeThrows(): JSX.Element {
  if (bomb) throw new Error('stage bomb')
  return <div>stage content</div>
}

function Healthy(): JSX.Element {
  return <div>healthy stage</div>
}

beforeEach(() => {
  bomb = true
  // React prints the caught error + component stack to stderr — expected.
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('StageErrorBoundary', () => {
  it('renders children normally when nothing throws', () => {
    bomb = false
    render(
      <StageErrorBoundary resetKey="data">
        <MaybeThrows />
      </StageErrorBoundary>,
    )
    expect(screen.getByText('stage content')).toBeInTheDocument()
    expect(screen.queryByTestId('stage-error')).not.toBeInTheDocument()
  })

  it('shows a reset card in the stage slot when a child throws', () => {
    render(
      <StageErrorBoundary resetKey="data">
        <MaybeThrows />
      </StageErrorBoundary>,
    )
    expect(screen.getByTestId('stage-error')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reset/i })).toBeInTheDocument()
  })

  it('captures a diagnostic through the bridge when a stage crashes', () => {
    render(
      <StageErrorBoundary resetKey="sections">
        <MaybeThrows />
      </StageErrorBoundary>,
    )
    expect(captureDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'renderer-error', scope: 'stage' }),
    )
    const arg = (captureDiagnostic as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]
    // The crashing stage is named so a support bundle points at it.
    expect(arg.message).toContain('sections')
  })

  it('remounts the stage when Reset is clicked', () => {
    render(
      <StageErrorBoundary resetKey="data">
        <MaybeThrows />
      </StageErrorBoundary>,
    )
    expect(screen.getByTestId('stage-error')).toBeInTheDocument()
    // The stage is fixed before the remount.
    bomb = false
    fireEvent.click(screen.getByRole('button', { name: /reset/i }))
    expect(screen.getByText('stage content')).toBeInTheDocument()
    expect(screen.queryByTestId('stage-error')).not.toBeInTheDocument()
  })

  it('clears a stage crash when the user navigates to a different stage', () => {
    const { rerender } = render(
      <StageErrorBoundary resetKey="data">
        <MaybeThrows />
      </StageErrorBoundary>,
    )
    expect(screen.getByTestId('stage-error')).toBeInTheDocument()
    // Switching stages (resetKey changes) must not keep showing the crashed
    // stage's card — the new stage renders.
    rerender(
      <StageErrorBoundary resetKey="geology">
        <Healthy />
      </StageErrorBoundary>,
    )
    expect(screen.queryByTestId('stage-error')).not.toBeInTheDocument()
    expect(screen.getByText('healthy stage')).toBeInTheDocument()
  })
})
