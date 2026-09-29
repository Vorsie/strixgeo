// The borehole's Tracks panel (owner 2026-09-29: "can i manually add tracks?"
// -> "i want to add columns on the borehole itself" -> "i want to be able to
// add or change any track" + "coded lithology for example also" / "with the
// dov codelist ofc").
//
// Pinned here, in the session main's words:
// * the list shows each track's kind, a source badge (DOV / manual / edited)
//   and its interval count, and which track the sections draw;
// * "Add track" (kind picker) opens the interval editor; "Edit" opens the same
//   editor on an existing track, imported ones included;
// * a new row starts at the last base; Enter in the last row adds one;
// * coded fields are DOV codelist pickers, the label shown next to the code; a
//   coded track cannot be saved with a token outside the list;
// * deleting a whole track is a confirm dialog, Cancel default-focused, the
//   button reads "Delete track".
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { BoreholeDetailResponse, BoreholeTrackResponse } from '../../../api/client'
import type { BoreholeTrackEditing } from '../../../hooks/useBoreholeTrackEdits'
import { makeFixtureBorehole } from '../../../test/fixtures/borehole'
import BoreholeTracksDialog from './BoreholeTracksDialog'

vi.mock('../../../hooks/useFormalStratigraphyCatalog', () => ({
  useFormalStratigraphyCatalog: () => ({
    units: [
      { code: 'Bm', name_nl: 'Formatie van Boom', age_rank: null, color_hex: null },
      { code: 'Q', name_nl: 'Quartair', age_rank: null, color_hex: null },
    ],
    loading: false,
    error: null,
  }),
}))

function saved(trackId: string): BoreholeTrackResponse {
  return {
    track_id: trackId,
    kind: 'moisture',
    family: 'field_log',
    source: 'manual',
    edited_manually_at: '2026-09-29T12:00:00Z',
    dov_permkey: null,
    intervals: [],
    warnings: [],
  }
}

function borehole(): BoreholeDetailResponse {
  const bh = makeFixtureBorehole()
  const coded = { ...bh.observations[0], source: 'dov', edited_manually_at: null }
  const manualStrat = {
    ...bh.observations[0],
    id: 'obs-manual',
    observation_type: 'formal_stratigraphy',
    source: 'manual',
    edited_manually_at: '2026-09-29T10:00:00Z',
    layers: [
      {
        id: 'l-q',
        top_m: 0,
        base_m: 5,
        color: null,
        main_soil_codes: [],
        description: 'Q',
        layer_index: 0,
        admixtures: [],
      },
    ],
  }
  return { ...bh, observations: [coded, manualStrat] }
}

function setup(detail: BoreholeDetailResponse = borehole()) {
  const editing: BoreholeTrackEditing = {
    saveTrack: vi.fn(async () => saved('field_log:moisture')),
    deleteTrack: vi.fn(async () => undefined),
  }
  const onClose = vi.fn()
  render(<BoreholeTracksDialog open borehole={detail} editing={editing} onClose={onClose} />)
  return { editing, onClose, detail }
}

function trackRow(label: RegExp): HTMLElement {
  return screen.getByRole('row', { name: label })
}

describe('BoreholeTracksDialog — the track list', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lists each track with its kind, source badge and interval count', () => {
    setup()
    const coded = trackRow(/Coded lithology/)
    expect(within(coded).getByText('DOV')).toBeTruthy()
    expect(within(coded).getByText('3')).toBeTruthy()
    const strat = trackRow(/Formal stratigraphy/)
    expect(within(strat).getByText('Manual')).toBeTruthy()
    // The fixture's field log is grouped into one track per kind.
    expect(screen.getAllByRole('row', { name: /Field log:/ }).length).toBeGreaterThan(0)
  })

  it('a field-log kind the borehole already has cannot be added twice', () => {
    setup()
    const picker = screen.getByLabelText('Kind of the new track') as HTMLSelectElement
    const present = makeFixtureBorehole().field_log_intervals[0].kind
    const option = within(picker).getByRole('option', {
      name: new RegExp(`Field log: ${present === 'color' ? 'colour' : present}`),
    }) as HTMLOptionElement
    expect(option.disabled).toBe(true)
  })
})

describe('BoreholeTracksDialog — delete confirmation', () => {
  it('asks first, with Cancel focused and a "Delete track" button', async () => {
    const s = setup()
    fireEvent.click(within(trackRow(/Formal stratigraphy/)).getByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog', { name: 'Delete this track?' })
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' })
    expect(document.activeElement).toBe(cancel)
    expect(s.editing.deleteTrack).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete track' }))
    await waitFor(() =>
      expect(s.editing.deleteTrack).toHaveBeenCalledWith(s.detail.id, 'obs-manual'),
    )
  })

  it('Cancel deletes nothing', async () => {
    const s = setup()
    fireEvent.click(within(trackRow(/Coded lithology/)).getByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog', { name: 'Delete this track?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(s.editing.deleteTrack).not.toHaveBeenCalled()
  })
})

describe('BoreholeTracksDialog — the interval editor', () => {
  function addTrack(kind: string): void {
    fireEvent.change(screen.getByLabelText('Kind of the new track'), { target: { value: kind } })
    fireEvent.click(screen.getByRole('button', { name: 'Add track' }))
  }

  it('adds a moisture track from the DOV list and saves the payload', async () => {
    const detail = borehole()
    detail.field_log_intervals = detail.field_log_intervals.filter(r => r.kind !== 'moisture')
    const s = setup(detail)
    addTrack('moisture')
    expect(screen.getByRole('heading', { name: 'New track: Field log: moisture' })).toBeTruthy()
    const value = screen.getByLabelText('Value, row 1') as HTMLSelectElement
    expect(within(value).getByRole('option', { name: 'zeer vochtig — very moist' })).toBeTruthy()
    fireEvent.change(value, { target: { value: 'vochtig' } })
    fireEvent.change(screen.getByLabelText('Base (m), row 1'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save track' }))
    await waitFor(() =>
      expect(s.editing.saveTrack).toHaveBeenCalledWith(detail.id, {
        trackId: null,
        kind: 'moisture',
        intervals: [{ top_m: 0, base_m: 2, value: 'vochtig' }],
        before: null,
      }),
    )
  })

  it('a new row starts at the last base; Enter in the last row adds one', () => {
    setup()
    addTrack('lithological_description')
    fireEvent.change(screen.getByLabelText('Base (m), row 1'), { target: { value: '1.5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add interval' }))
    expect((screen.getByLabelText('Top (m), row 2') as HTMLInputElement).value).toBe('1.5')
    fireEvent.change(screen.getByLabelText('Base (m), row 2'), { target: { value: '3' } })
    fireEvent.keyDown(screen.getByLabelText('Base (m), row 2'), { key: 'Enter' })
    expect((screen.getByLabelText('Top (m), row 3') as HTMLInputElement).value).toBe('3')
  })

  it('edits an imported coded track with DOV pickers, the label next to the code', async () => {
    const s = setup()
    fireEvent.click(within(trackRow(/Coded lithology/)).getByRole('button', { name: 'Edit' }))
    const soil = screen.getByLabelText('Main soil, row 2') as HTMLSelectElement
    expect(within(soil).getByRole('option', { name: 'FZ — fine sand' })).toBeTruthy()
    // The fixture's first row carries ZF, which is not a DOV hoofdnaam code:
    // it stays selectable (the import round-trips) and says so.
    const first = screen.getByLabelText('Main soil, row 1') as HTMLSelectElement
    expect(first.value).toBe('ZF')
    expect(
      within(first).getByRole('option', { name: 'ZF (not in the DOV codelist)' }),
    ).toBeTruthy()
    fireEvent.change(soil, { target: { value: 'FZ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save track' }))
    await waitFor(() => expect(s.editing.saveTrack).toHaveBeenCalledTimes(1))
    const [, draft] = (s.editing.saveTrack as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(draft.trackId).toBe('obs-litho')
    expect(draft.intervals[1].main_soil_codes).toEqual(['FZ'])
    expect(draft.before[1].main_soil_codes).toEqual(['KL'])
  })

  it('a coded track cannot be saved with a token outside the DOV list', () => {
    setup()
    addTrack('coded_lithology')
    fireEvent.change(screen.getByLabelText('Base (m), row 1'), { target: { value: '1' } })
    const soil = screen.getByLabelText('Main soil, row 1') as HTMLSelectElement
    // A picker cannot produce an outside token; force one to prove the gate.
    const rogue = document.createElement('option')
    rogue.value = 'QQ'
    soil.appendChild(rogue)
    fireEvent.change(soil, { target: { value: 'QQ' } })
    expect(screen.getByText('Row 1: QQ is not in the DOV codelist.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Save track' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })

  it('overlapping rows block the save; a gap only warns', () => {
    setup()
    addTrack('lithological_description')
    fireEvent.change(screen.getByLabelText('Base (m), row 1'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('Description, row 1'), { target: { value: 'zand' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add interval' }))
    fireEvent.change(screen.getByLabelText('Top (m), row 2'), { target: { value: '1.5' } })
    fireEvent.change(screen.getByLabelText('Base (m), row 2'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('Description, row 2'), { target: { value: 'klei' } })
    expect(screen.getByText('Row 2 overlaps the interval above it.')).toBeTruthy()
    const save = screen.getByRole('button', { name: 'Save track' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Top (m), row 2'), { target: { value: '2.5' } })
    expect(screen.getByText('Gap above row 2.')).toBeTruthy()
    expect(save.disabled).toBe(false)
  })

  it('offers the DOV formal-stratigraphy units for a formal track', () => {
    setup()
    addTrack('formal_stratigraphy')
    const unit = screen.getByLabelText('Unit, row 1') as HTMLSelectElement
    expect(within(unit).getByRole('option', { name: 'Bm — Formatie van Boom' })).toBeTruthy()
  })
})
