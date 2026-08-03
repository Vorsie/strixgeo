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

  // -------------------------------------------------------------------------
  // Audit 2026-08-02, Class 1: a whole failed sub-phase used to render the
  // IDENTICAL markup to a clean import that genuinely had no observations —
  // the engineer concluded DOV holds no descriptions for these boreholes and
  // never re-ran the import that would have brought in 40 driller's logs.
  //
  // The rule: an import whose sub-phase failed does not present itself as a
  // clean import — the failure count is on screen with what to do about it.
  // -------------------------------------------------------------------------

  const boreholeInterpretationsFailed: DovImportState = {
    ...boreholeDone,
    result: {
      ...(boreholeDone as { result: import('../hooks/useDovImportStream').BoreholeImportDonePayload }).result,
      imported: 40,
      interpretations_attached: 0,
      interpretations_failed: 40,
      samples_attached: 0,
      samples_failed: 40,
      grain_sizes_attached: 0,
    },
  } as DovImportState

  it('shows the observations-failed count when the interpretation phase failed', () => {
    render(<DovImportProgressPanel state={boreholeInterpretationsFailed} />)
    expect(screen.getByText(/observations failed/i)).toBeInTheDocument()
    expect(screen.getByText(/samples failed/i)).toBeInTheDocument()
  })

  it('tells the engineer to re-run the import when a sub-phase failed', () => {
    render(<DovImportProgressPanel state={boreholeInterpretationsFailed} />)
    expect(screen.getByText(/re-run the import/i)).toBeInTheDocument()
  })

  it('does not claim a plain "Import complete" when a sub-phase failed', () => {
    render(<DovImportProgressPanel state={boreholeInterpretationsFailed} />)
    expect(screen.queryByText(/^Import complete$/)).not.toBeInTheDocument()
  })

  it('keeps the clean import clean — no failure rows, no re-run hint', () => {
    render(<DovImportProgressPanel state={boreholeDone} />)
    expect(screen.queryByText(/observations failed/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/re-run the import/i)).not.toBeInTheDocument()
    expect(screen.getByText(/^Import complete$/)).toBeInTheDocument()
  })

  // The ninth signal: DOV's Boringen WFS flags a borehole as HAVING formal
  // stratigraphy and its own interpretaties layer returns nothing (confirmed
  // live with permkey 2024-216503). Nothing failed — and the import is still
  // not the clean one the old panel drew.
  const boreholeWfsGaps: DovImportState = {
    ...boreholeDone,
    result: {
      ...(boreholeDone as { result: import('../hooks/useDovImportStream').BoreholeImportDonePayload }).result,
      imported: 40,
      interpretations_attached: 0,
      interpretations_wfs_gaps: 12,
    },
  } as DovImportState

  it('gives the WFS gap its own row and does not call it a failure', () => {
    render(<DovImportProgressPanel state={boreholeWfsGaps} />)
    expect(screen.getByText(/DOV lists but did not return/i)).toBeInTheDocument()
    expect(screen.queryByText(/observations failed/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/^Import complete$/)).not.toBeInTheDocument()
  })

  it('does not send the engineer round a retry loop for a WFS gap', () => {
    render(<DovImportProgressPanel state={boreholeWfsGaps} />)
    expect(screen.queryByText(/re-run the import over the same area/i)).not.toBeInTheDocument()
    expect(screen.getByText(/dov\.vlaanderen\.be/i)).toBeInTheDocument()
  })
})
