// Renaming a cross-section from its header strip, the name at the top left of
// the section view (owner 2026-09-22: "if I click on top left of the
// right-hand screen ... I want to be able to change it too").
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CrossSectionResponse } from '../../api/client'
import SectionHeader from './SectionHeader'
import { DEFAULT_BOREHOLE_CHANNELS, DEFAULT_CPT_CHANNELS } from './cptChannels'

function makeSection(): CrossSectionResponse {
  return {
    id: 'sec-1',
    app_project_id: 'proj-1',
    name: 'Section A-A',
    description: null,
    display_order: 0,
    start_x: 0,
    start_y: 0,
    end_x: 100,
    end_y: 0,
    epsg: 31370,
    projection_buffer_m: 50,
    vertical_exaggeration: 2,
    excluded_cpt_ids: [],
    excluded_borehole_ids: [],
    min_depth_m: null,
    max_depth_m: null,
    view_state: null,
    seeded_formation_contact_ids: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  } as CrossSectionResponse
}

function renderHeader(onRename: ((name: string) => void) | undefined): void {
  render(
    <SectionHeader
      section={makeSection()}
      lengthM={100}
      onClose={undefined}
      onZoomIn={() => {}}
      onZoomOut={() => {}}
      vex={2}
      onVexChange={() => {}}
      onVexCommit={undefined}
      onBufferCommit={undefined}
      channels={DEFAULT_CPT_CHANNELS}
      onChannelsChange={() => {}}
      boreholeChannels={DEFAULT_BOREHOLE_CHANNELS}
      onBoreholeChannelsChange={() => {}}
      snapToStratigraphy={false}
      onSnapToStratigraphyChange={() => {}}
      columnSpacing={0}
      onColumnSpacingChange={() => {}}
      onColumnSpacingCommit={undefined}
      scaleH={1}
      scaleV={1}
      onReset={() => {}}
      onRename={onRename}
    />,
  )
}

afterEach(cleanup)

describe('SectionHeader - the coded lithology stream toggle (issue #17)', () => {
  it('toggles alongside geotech / formal / informal and hands the new bag to the persist callback', () => {
    // Persisting rides onBoreholeChannelsChange -> view_state.borehole_channels,
    // the same path the other three streams use.
    const onBoreholeChannelsChange = vi.fn()
    render(
      <SectionHeader
        section={makeSection()}
        lengthM={100}
        onClose={undefined}
        onZoomIn={() => {}}
        onZoomOut={() => {}}
        vex={2}
        onVexChange={() => {}}
        onVexCommit={undefined}
        onBufferCommit={undefined}
        channels={DEFAULT_CPT_CHANNELS}
        onChannelsChange={() => {}}
        boreholeChannels={DEFAULT_BOREHOLE_CHANNELS}
        onBoreholeChannelsChange={onBoreholeChannelsChange}
        snapToStratigraphy={false}
        onSnapToStratigraphyChange={() => {}}
        columnSpacing={0}
        onColumnSpacingChange={() => {}}
        onColumnSpacingCommit={undefined}
        scaleH={1}
        scaleV={1}
        onReset={() => {}}
        onRename={undefined}
      />,
    )
    for (const key of ['lithology', 'geotech', 'formal_strat', 'informal_strat']) {
      expect(screen.getByTestId(`section-control-borehole-${key}`)).toBeTruthy()
    }
    fireEvent.click(screen.getByTestId('section-control-borehole-lithology'))
    expect(onBoreholeChannelsChange).toHaveBeenCalledWith({
      ...DEFAULT_BOREHOLE_CHANNELS,
      lithology: true,
    })
  })
})

describe('SectionHeader — rename from the header strip', () => {
  it('H1 — clicking the name opens a field with that name; Enter saves the new one', () => {
    const onRename = vi.fn()
    renderHeader(onRename)
    fireEvent.click(screen.getByRole('button', { name: /Section A-A/ }))
    const input = screen.getByRole('textbox', { name: /name|naam/i }) as HTMLInputElement
    expect(input.value).toBe('Section A-A')
    fireEvent.change(input, { target: { value: 'Zuidwand' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.blur(input)
    expect(onRename).toHaveBeenCalledWith('Zuidwand')
  })

  it('H2 — without a rename handler the name stays plain text', () => {
    renderHeader(undefined)
    expect(screen.queryByRole('button', { name: /Section A-A/ })).toBeNull()
    expect(screen.getByText('Section A-A')).toBeInTheDocument()
  })
})
