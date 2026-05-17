import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import DovImportProgressPanel from './DovImportProgressPanel'
import type { DovImportState } from '../hooks/useDovImportStream'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const idle: DovImportState = { status: 'idle' }

const running = (
  phase = 'download',
  done = 5,
  total = 20,
): DovImportState => ({
  status: 'running',
  kind: 'cpt',
  latest: { phase: phase as import('../hooks/useDovImportStream').ImportPhase, done, total },
  highestPhaseIndex: 1,
  pendingPins: [],
})

const done: DovImportState = {
  status: 'done',
  kind: 'cpt',
  result: { imported: 12, duplicates: 3, failed: 1, cpt_ids: ['a', 'b'] },
}

const boreholeDone: DovImportState = {
  status: 'done',
  kind: 'borehole',
  result: {
    imported: 5,
    duplicates: 0,
    failed: 0,
    borehole_ids: ['x', 'y', 'z', 'w', 'v'],
    interpretations_attached: 8,
    interpretations_failed: 0,
    samples_attached: 4,
    samples_failed: 0,
    grain_sizes_attached: 2,
    grain_sizes_failed: 0,
    atterberg_attached: 0,
    atterberg_failed: 0,
    caco3_attached: 0,
    caco3_failed: 0,
    organic_attached: 0,
    organic_failed: 0,
    water_content_attached: 0,
    water_content_failed: 0,
    scalar_lab_tests_attached: 0,
    scalar_lab_tests_failed: 0,
  },
}

const error: DovImportState = {
  status: 'error',
  message: 'DOV did not respond in time',
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DovImportProgressPanel', () => {
  it('renders nothing in idle state', () => {
    const { container } = render(<DovImportProgressPanel state={idle} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows phase label while running', () => {
    render(<DovImportProgressPanel state={running()} />)
    // "Downloading XMLs…" is the label for the "download" phase.
    // getAllByText because the text also appears in the sr-only live span.
    const matches = screen.getAllByText(/downloading xmls/i)
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it('shows done/total count while running with a measurable total', () => {
    render(<DovImportProgressPanel state={running('download', 5, 20)} />)
    expect(screen.getByText('5 / 20')).toBeInTheDocument()
  })

  it('does not show count when total is 0 (indeterminate)', () => {
    render(<DovImportProgressPanel state={running('dedup', 0, 0)} />)
    expect(screen.queryByText(/\/ 0/)).not.toBeInTheDocument()
  })

  it('has a progressbar role while running', () => {
    render(<DovImportProgressPanel state={running()} />)
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
  })

  it('progressbar aria-valuenow matches the percentage', () => {
    render(<DovImportProgressPanel state={running('download', 10, 20)} />)
    const bar = screen.getByRole('progressbar')
    // 10/20 = 50%
    expect(bar).toHaveAttribute('aria-valuenow', '50')
  })

  it('has a polite aria-live region while running', () => {
    render(<DovImportProgressPanel state={running()} />)
    // The outer container carries aria-live="polite"
    const region = screen.getByRole('progressbar').closest('[aria-live]')
    expect(region).toHaveAttribute('aria-live', 'polite')
  })

  it('shows commit phase label as indeterminate (no count)', () => {
    render(
      <DovImportProgressPanel
        state={running('commit', 0, 0)}
      />,
    )
    // Commit phase label from PHASE_LABELS — appears in the visible span
    // and also in the sr-only span; use getAllByText.
    const matches = screen.getAllByText(/committing/i)
    expect(matches.length).toBeGreaterThanOrEqual(1)
    // No "N / M" counter for the commit phase
    expect(screen.queryByText(/\//)).not.toBeInTheDocument()
  })

  it('shows "Import complete" heading on done state', () => {
    render(<DovImportProgressPanel state={done} />)
    expect(screen.getByText(/import complete/i)).toBeInTheDocument()
  })

  it('shows imported count on done state', () => {
    render(<DovImportProgressPanel state={done} />)
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText(/imported/i)).toBeInTheDocument()
  })

  it('shows duplicates count on done state', () => {
    render(<DovImportProgressPanel state={done} />)
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText(/already existed/i)).toBeInTheDocument()
  })

  it('shows failed count only when > 0', () => {
    render(<DovImportProgressPanel state={done} />)
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText(/failed/i)).toBeInTheDocument()
  })

  it('hides failed row when failed is 0', () => {
    const noFail: DovImportState = {
      status: 'done',
      kind: 'cpt',
      result: { imported: 5, duplicates: 0, failed: 0, cpt_ids: [] },
    }
    render(<DovImportProgressPanel state={noFail} />)
    expect(screen.queryByText(/failed/i)).not.toBeInTheDocument()
  })

  it('shows borehole-specific counts on borehole done', () => {
    render(<DovImportProgressPanel state={boreholeDone} />)
    expect(screen.getByText(/observations attached/i)).toBeInTheDocument()
    expect(screen.getByText('8')).toBeInTheDocument()
  })

  it('shows error message on error state', () => {
    render(<DovImportProgressPanel state={error} />)
    expect(screen.getByText(/DOV did not respond in time/i)).toBeInTheDocument()
  })

  it('uses role="alert" for error state', () => {
    render(<DovImportProgressPanel state={error} />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('uses aria-live="assertive" for error state', () => {
    render(<DovImportProgressPanel state={error} />)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveAttribute('aria-live', 'assertive')
  })
})
