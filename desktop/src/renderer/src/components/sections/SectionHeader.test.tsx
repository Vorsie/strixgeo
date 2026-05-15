// Behaviour tests for the section header's Export DXF button
// (v1.0 MVP gate #5). The button is conditional on an
// ``onExportDxf`` prop — no prop → no button. When wired, clicking
// disables it during the request and renders an "Exporting…" label
// so the user has feedback during the network round-trip.

import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import SectionHeader from './SectionHeader'

function _section(overrides: Record<string, unknown> = {}) {
  return {
    id: 's-1',
    app_project_id: 'p-1',
    name: 'Section A-A',
    description: null,
    start_x: 0,
    start_y: 0,
    end_x: 100,
    end_y: 0,
    epsg: 31370,
    projection_buffer_m: 25,
    vertical_exaggeration: 1,
    excluded_borehole_ids: [],
    excluded_cpt_ids: [],
    min_depth_m: null,
    max_depth_m: null,
    display_order: 0,
    view_state: null,
    created_at: '2026-05-13T00:00:00Z',
    updated_at: '2026-05-13T00:00:00Z',
    ...overrides,
  } as never // skip the strict CrossSectionResponse shape — we only read .name + .id + buffer
}

function _baseProps(): Record<string, unknown> {
  return {
    section: _section(),
    lengthM: 100,
    onClose: undefined,
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    vex: 1,
    onVexChange: vi.fn(),
    onVexCommit: undefined,
    onBufferCommit: undefined,
    channels: { qc: true, fs: false, u2: false, rf: true, qTotal: false },
    onChannelsChange: vi.fn(),
    boreholeChannels: {
      geotech: true,
      formal_strat: false,
      informal_strat: false,
    },
    onBoreholeChannelsChange: vi.fn(),
    snapToStratigraphy: false,
    onSnapToStratigraphyChange: vi.fn(),
    columnSpacing: 1,
    onColumnSpacingChange: vi.fn(),
    onColumnSpacingCommit: undefined,
    scaleH: 1,
    scaleV: 1,
    onReset: vi.fn(),
  }
}

describe('SectionHeader Export DXF button', () => {
  it('is absent when onExportDxf is not provided', () => {
    render(<SectionHeader {...(_baseProps() as never)} />)
    expect(screen.queryByLabelText('Export DXF')).not.toBeInTheDocument()
  })

  it('renders when onExportDxf is wired', () => {
    render(
      <SectionHeader
        {...(_baseProps() as never)}
        onExportDxf={vi.fn().mockResolvedValue(undefined)}
      />,
    )
    expect(screen.getByLabelText('Export DXF')).toBeInTheDocument()
    expect(screen.getByText('DXF')).toBeInTheDocument()
  })

  it('calls onExportDxf when clicked', async () => {
    const onExportDxf = vi.fn().mockResolvedValue(undefined)
    render(
      <SectionHeader
        {...(_baseProps() as never)}
        onExportDxf={onExportDxf}
      />,
    )
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Export DXF'))
    })
    expect(onExportDxf).toHaveBeenCalledTimes(1)
  })

  it('disables itself while exporting and re-enables on success', async () => {
    // Build a controllable promise so the test can inspect the
    // mid-export state.
    let resolveExport: () => void = () => {}
    const pending = new Promise<void>(r => {
      resolveExport = r
    })
    const onExportDxf = vi.fn().mockReturnValue(pending)
    render(
      <SectionHeader
        {...(_baseProps() as never)}
        onExportDxf={onExportDxf}
      />,
    )
    const btn = screen.getByLabelText('Export DXF') as HTMLButtonElement
    expect(btn.disabled).toBe(false)
    fireEvent.click(btn)
    // After the click, the button shows the in-flight label.
    expect(btn.disabled).toBe(true)
    expect(btn.textContent).toContain('Exporting')
    // Resolve the promise and let the handler clean up state.
    await act(async () => {
      resolveExport()
      await pending
    })
    expect(btn.disabled).toBe(false)
    expect(btn.textContent).toContain('DXF')
  })

  it('re-enables itself after a rejected export so the user can retry', async () => {
    // The component re-throws (try / finally only), so the test
    // catches the rejection explicitly to keep vitest's unhandled-
    // promise reporter quiet. The behaviour under test is the
    // ``finally`` branch — button comes back to its idle state.
    const onExportDxf = vi.fn().mockImplementation(async () => {
      throw new Error('boom')
    })
    render(
      <SectionHeader
        {...(_baseProps() as never)}
        onExportDxf={onExportDxf}
      />,
    )
    const btn = screen.getByLabelText('Export DXF') as HTMLButtonElement
    await act(async () => {
      fireEvent.click(btn)
      // Wait one microtask for the handler's finally to run.
      await Promise.resolve()
    })
    expect(btn.disabled).toBe(false)
  })
})

describe('SectionHeader Seed from stratigraphy button', () => {
  // The button always renders (greyed/disabled when no prop, enabled when wired)
  // so users can see the affordance exists even before the Geology stage wires it.
  // See CLAUDE.md "Geology stage owns model definition" contract.

  it('renders in disabled state when onAutoPopulateFromStratigraphy is not provided', () => {
    render(<SectionHeader {...(_baseProps() as never)} />)
    const btn = screen.getByTestId(
      'auto-populate-stratigraphy-button',
    ) as HTMLButtonElement
    expect(btn).toBeInTheDocument()
    expect(btn.disabled).toBe(true)
  })

  it('shows Geology-stage-first tooltip when disabled (prop absent)', () => {
    render(<SectionHeader {...(_baseProps() as never)} />)
    const btn = screen.getByTestId('auto-populate-stratigraphy-button')
    expect(btn.title).toMatch(/Geology stage/i)
  })

  it('renders enabled when onAutoPopulateFromStratigraphy is wired', () => {
    render(
      <SectionHeader
        {...(_baseProps() as never)}
        onAutoPopulateFromStratigraphy={vi.fn().mockResolvedValue(undefined)}
      />,
    )
    const btn = screen.getByTestId(
      'auto-populate-stratigraphy-button',
    ) as HTMLButtonElement
    expect(btn).toBeInTheDocument()
    expect(btn.disabled).toBe(false)
  })

  it('calls the handler when clicked (wired path)', async () => {
    const onAuto = vi.fn().mockResolvedValue(undefined)
    render(
      <SectionHeader
        {...(_baseProps() as never)}
        onAutoPopulateFromStratigraphy={onAuto}
      />,
    )
    await act(async () => {
      fireEvent.click(screen.getByTestId('auto-populate-stratigraphy-button'))
    })
    expect(onAuto).toHaveBeenCalledTimes(1)
  })

  it('disables itself while seeding and re-enables on success', async () => {
    let resolveSeed: (() => void) | null = null
    const pending = new Promise<void>(resolve => {
      resolveSeed = resolve
    })
    const onAuto = vi.fn().mockReturnValue(pending)
    render(
      <SectionHeader
        {...(_baseProps() as never)}
        onAutoPopulateFromStratigraphy={onAuto}
      />,
    )
    const btn = screen.getByTestId(
      'auto-populate-stratigraphy-button',
    ) as HTMLButtonElement
    expect(btn.disabled).toBe(false)
    await act(async () => {
      fireEvent.click(btn)
    })
    expect(btn.disabled).toBe(true)
    await act(async () => {
      resolveSeed?.()
      await Promise.resolve()
    })
    expect(btn.disabled).toBe(false)
  })
})
