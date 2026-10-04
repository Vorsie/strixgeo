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
import { ApiError } from '../../../api/clients/shared'
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
    resetToDov: vi.fn(async () => ({ tracks: [], discarded_edits: 1, kept_manual: 1 })),
  }
  const onClose = vi.fn()
  const view = render(<BoreholeTracksDialog open borehole={detail} editing={editing} onClose={onClose} />)
  return { editing, onClose, detail, rerender: view.rerender }
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

  // Owner dogfeed 2026-10-01: "after editing a DOV track and pressing Ctrl+Z the
  // values come back but the track still reads Edited by hand". The backend
  // decides (the undo's PUT answers edited_manually_at: null when the track
  // holds exactly DOV's content again); the list only shows what the refetched
  // borehole says - an undo back to DOV reads DOV, one that leaves a
  // difference keeps "Edited by hand".
  it('the badge follows the refetched borehole after an undo: back to DOV reads DOV', () => {
    const edited = borehole()
    edited.observations[0] = { ...edited.observations[0], edited_manually_at: '2026-10-01T09:00:00Z' }
    const { editing, onClose, rerender } = setup(edited)
    expect(within(trackRow(/Coded lithology/)).getByText('Edited by hand')).toBeTruthy()

    // The undo's refetch: the PUT answered edited_manually_at null.
    rerender(<BoreholeTracksDialog open borehole={borehole()} editing={editing} onClose={onClose} />)
    const coded = trackRow(/Coded lithology/)
    expect(within(coded).getByText('DOV')).toBeTruthy()
    expect(within(coded).queryByText('Edited by hand')).toBeNull()

    // An undo that leaves a difference: the refetch still carries the stamp.
    rerender(<BoreholeTracksDialog open borehole={edited} editing={editing} onClose={onClose} />)
    expect(within(trackRow(/Coded lithology/)).getByText('Edited by hand')).toBeTruthy()
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

// Owner dogfeed 2026-09-30, one block per ask.

/** The fixture with its DOV coded track edited by hand. */
function editedBorehole(): BoreholeDetailResponse {
  const bh = borehole()
  bh.observations[0] = { ...bh.observations[0], edited_manually_at: '2026-09-30T08:00:00Z' }
  return bh
}

describe('BoreholeTracksDialog — Reset to DOV ("a per borehole button to reset to dov defaults")', () => {
  beforeEach(() => vi.clearAllMocks())

  it('asks first, Cancel focused, naming how many edited tracks lose their edits', async () => {
    const s = setup(editedBorehole())
    fireEvent.click(screen.getByRole('button', { name: 'Reset to DOV' }))
    const dialog = await screen.findByRole('dialog', { name: 'Reset to DOV?' })
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(within(dialog).getByText(/1 track edited by hand loses its edits/)).toBeTruthy()
    expect(s.editing.resetToDov).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset to DOV' }))
    await waitFor(() => expect(s.editing.resetToDov).toHaveBeenCalledWith(s.detail.id, null))
  })

  it('Cancel resets nothing', async () => {
    const s = setup(editedBorehole())
    fireEvent.click(screen.getByRole('button', { name: 'Reset to DOV' }))
    const dialog = await screen.findByRole('dialog', { name: 'Reset to DOV?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(s.editing.resetToDov).not.toHaveBeenCalled()
  })

  it('a DOV track has its own Reset; a manual track has none', async () => {
    const s = setup(editedBorehole())
    expect(within(trackRow(/Formal stratigraphy/)).queryByRole('button', { name: 'Reset' })).toBeNull()
    fireEvent.click(within(trackRow(/Coded lithology/)).getByRole('button', { name: 'Reset' }))
    const dialog = await screen.findByRole('dialog', { name: 'Reset to DOV?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset to DOV' }))
    await waitFor(() => expect(s.editing.resetToDov).toHaveBeenCalledWith(s.detail.id, 'obs-litho'))
  })

  it('no DOV XML in the cache is a notice, not an error', async () => {
    const s = setup(editedBorehole())
    ;(s.editing.resetToDov as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new ApiError('nothing was reset', 409, {
        detail: { code: 'borehole_reset_no_dov_source', message: 'nothing was reset', missing: [] },
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Reset to DOV' }))
    const dialog = await screen.findByRole('dialog', { name: 'Reset to DOV?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset to DOV' }))
    const notice = await screen.findByRole('status')
    expect(notice.textContent).toMatch(/no DOV data to reset to/)
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('BoreholeTracksDialog — the reference pane ("see the info that is already there in other tracks")', () => {
  it('lists the other tracks beside the rows and highlights what overlaps the row being typed', () => {
    setup()
    fireEvent.click(within(trackRow(/Coded lithology/)).getByRole('button', { name: 'Edit' }))
    const pane = screen.getByRole('complementary', { name: 'Other tracks of this borehole' })
    // The edited track itself is not a reference; the field logs are.
    expect(within(pane).queryByText(/Coded lithology/)).toBeNull()
    const grijs = within(pane).getByText('grijs').closest('li') as HTMLElement
    const bruin = within(pane).getByText('bruin').closest('li') as HTMLElement
    fireEvent.focus(screen.getByLabelText('Top (m), row 2'))
    // Row 2 is 1.5-3.2 m: the grey colour interval (1.5-3.2) overlaps, the brown one (0-1.5) does not.
    expect(grijs.getAttribute('data-overlaps')).toBe('true')
    expect(bruin.getAttribute('data-overlaps')).toBe('false')
  })
})

describe('BoreholeTracksDialog — "Start from" a track ("copy another track as template")', () => {
  it('a new coded track started from the coded track copies its depths and codes, and stays manual', async () => {
    const s = setup()
    fireEvent.change(screen.getByLabelText('Kind of the new track'), { target: { value: 'geotechnical_coding' } })
    fireEvent.change(screen.getByLabelText('Start from'), { target: { value: 'obs-litho' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add track' }))
    expect((screen.getByLabelText('Base (m), row 3') as HTMLInputElement).value).toBe('5')
    expect((screen.getByLabelText('Main soil, row 2') as HTMLSelectElement).value).toBe('KL')
    fireEvent.click(screen.getByRole('button', { name: 'Save track' }))
    await waitFor(() => expect(s.editing.saveTrack).toHaveBeenCalledTimes(1))
    const [, draft] = (s.editing.saveTrack as ReturnType<typeof vi.fn>).mock.calls[0]
    // trackId null = a create, which the backend stores as source = manual.
    expect(draft.trackId).toBeNull()
    expect(draft.intervals.map((i: { base_m: number }) => i.base_m)).toEqual([1.5, 3.2, 5])
  })

  it('a description started from the coded track copies only the depths', () => {
    setup()
    fireEvent.change(screen.getByLabelText('Kind of the new track'), {
      target: { value: 'lithological_description' },
    })
    fireEvent.change(screen.getByLabelText('Start from'), { target: { value: 'obs-litho' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add track' }))
    expect((screen.getByLabelText('Top (m), row 2') as HTMLInputElement).value).toBe('1.5')
    expect((screen.getByLabelText('Description, row 2') as HTMLInputElement).value).toBe('')
  })
})

describe('BoreholeTracksDialog — max 3 admixtures ("i want max 3 admixtures in coded lithology")', () => {
  it('never offers a fourth admixture row and says 3 at most', () => {
    setup()
    fireEvent.change(screen.getByLabelText('Kind of the new track'), { target: { value: 'coded_lithology' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add track' }))
    for (let i = 0; i < 3; i++) {
      fireEvent.click(screen.getByRole('button', { name: '+ Add admixture' }))
    }
    expect(screen.queryByRole('button', { name: '+ Add admixture' })).toBeNull()
    expect(screen.getByText('3 at most')).toBeTruthy()
  })
})

// Owner 2026-10-01 (dogfeed of the coded-lithology editor): "it is way too
// small, i also want the psd's of monster to be visible in the right hand
// pane". Pinned in the session main's words:
// * the reference pane carries a block "Samples (DOV)" listing the borehole's
//   samples by depth interval and sample number;
// * a sample with a grain-size result shows its fractions with their %, the
//   raw fraction name as tooltip; Atterberg / water / organic / CaCO3 / other
//   scalar results on the same sample share ONE compact line under short
//   labels (owner, same day: "this is too verbose");
// * a sample whose depth interval overlaps the focused row is marked, like the
//   other reference intervals;
// * no sample -> "No samples on this borehole".
describe('BoreholeTracksDialog — samples in the reference pane ("the psd\'s of monster")', () => {
  function openCoded(detail?: BoreholeDetailResponse): HTMLElement {
    setup(detail)
    fireEvent.click(within(trackRow(/Coded lithology/)).getByRole('button', { name: 'Edit' }))
    return screen.getByRole('complementary', { name: 'Other tracks of this borehole' })
  }

  it('lists the samples by depth interval and number, with the grain-size fractions of the curve', () => {
    const pane = openCoded()
    const block = within(pane).getByRole('region', { name: 'Samples (DOV)' })
    const m1 = within(block).getByText('Sample M1').closest('li') as HTMLElement
    expect(m1.textContent).toMatch(/0\.5–1/)
    // Fixture M1 is a sieve curve 63 um..2 mm: 2 % fines, 96 % sand, 2 % gravel;
    // clay and silt are not reached, so the fines are given as one share.
    const sand = within(m1).getByText(/sand 96 %/)
    expect(sand.getAttribute('title')).toMatch(/sand/)
    expect(within(m1).getByText(/fines < 63 µm 2 %/)).toBeTruthy()
    expect(within(m1).getByText(/gravel 2 %/)).toBeTruthy()
    expect(within(m1).queryByText(/clay \d/)).toBeNull()
    // The method is the raw DOV token.
    expect(within(m1).getByText(/Zeving/)).toBeTruthy()
    // Atterberg on the same sample, in the compact scalar line.
    const lines = within(m1).getAllByTestId('sample-lab-line').map(l => l.textContent)
    expect(lines).toContain('wL 35 % · wP 20 % · IP 15 %')
    // M2 has no grain size, only the ASTM catch-all row: the classification
    // line, the raw DOV parameter as tooltip only.
    const m2 = within(block).getByText('Sample M2').closest('li') as HTMLElement
    const astm = within(m2).getByText('ASTM CL')
    expect(astm.getAttribute('title')).toBe('Grondsoort volgens ASTM, de code')
  })

  it('marks the sample whose depth interval overlaps the focused row', () => {
    const pane = openCoded()
    const block = within(pane).getByRole('region', { name: 'Samples (DOV)' })
    const m1 = within(block).getByText('Sample M1').closest('li') as HTMLElement
    const m2 = within(block).getByText('Sample M2').closest('li') as HTMLElement
    // Row 2 is 1.5-3.2 m: M2 (2.0-2.5) overlaps, M1 (0.5-1.0) does not.
    fireEvent.focus(screen.getByLabelText('Top (m), row 2'))
    expect(m2.getAttribute('data-overlaps')).toBe('true')
    expect(m1.getAttribute('data-overlaps')).toBe('false')
    // Row 1 is 0-1.5 m: now M1 is the one.
    fireEvent.focus(screen.getByLabelText('Top (m), row 1'))
    expect(m1.getAttribute('data-overlaps')).toBe('true')
    expect(m2.getAttribute('data-overlaps')).toBe('false')
  })

  it('says so when the borehole has no sample', () => {
    const pane = openCoded({ ...borehole(), samples: [] })
    const block = within(pane).getByRole('region', { name: 'Samples (DOV)' })
    expect(within(block).getByText('No samples on this borehole')).toBeTruthy()
  })
})

// Owner 2026-10-01: "Start from" a DOV DESCRIPTION into a coded lithology
// fills the codes from the text, and "make sure the person using it checks
// everything, like when you hover an interval you see the source in one way or
// another". Pinned in the ruling's words:
// * every parsed row shows an amber "From description, check" marker; hovering
//   the row or the marker shows the verbatim description and the clauses that
//   were not matched;
// * a per-row "Checked" clears the marker; editing any field of the row clears
//   it too;
// * Save stays disabled while a row still needs a check, its title saying how
//   many; "Mark all as checked" exists but is not the default focus;
// * the unmatched clauses are listed once under the grid, nothing silently
//   dropped;
// * starting from a CODED track carries no marker (unchanged).
describe('BoreholeTracksDialog — "Start from" a description ("check everything")', () => {
  const SILT =
    'silt, zeer sterk zeer fijn zandhoudend, steenfragmenten (tot 20mm), kalkhoudend, plastisch, bruin, vochtig'
  const SAND = 'zeer fijn tot fijn zand, sterk silthoudend, kleilenzen, kalkhoudend, groengrijs, zeer vochtig'

  function withDescription(texts: readonly string[] = [SILT, SAND]): BoreholeDetailResponse {
    const detail = borehole()
    const description = {
      ...detail.observations[0],
      id: 'obs-desc',
      observation_type: 'lithological_description',
      source: 'dov',
      edited_manually_at: null,
      layers: texts.map((text, i) => ({
        id: `d-${i}`,
        top_m: [0, 1.2, 2.5][i],
        base_m: [1.2, 2.5, 3.1][i],
        color: null,
        main_soil_codes: [],
        description: text,
        layer_index: i,
        admixtures: [],
      })),
    }
    return { ...detail, observations: [...detail.observations, description] }
  }

  function startFrom(templateId: string, texts?: readonly string[]): ReturnType<typeof setup> {
    const s = setup(withDescription(texts))
    fireEvent.change(screen.getByLabelText('Kind of the new track'), { target: { value: 'coded_lithology' } })
    fireEvent.change(screen.getByLabelText('Start from'), { target: { value: templateId } })
    fireEvent.click(screen.getByRole('button', { name: 'Add track' }))
    return s
  }

  const markers = () => screen.queryAllByText('From description, check')
  const save = () => screen.getByRole('button', { name: 'Save track' }) as HTMLButtonElement

  it('fills the codes from the description; each row carries the marker, the source on hover', () => {
    startFrom('obs-desc')
    expect((screen.getByLabelText('Main soil, row 1') as HTMLSelectElement).value).toBe('SI')
    expect((screen.getByLabelText('Main soil, row 2') as HTMLSelectElement).value).toBe('FZ')
    expect((screen.getByLabelText('Colour, row 2') as HTMLSelectElement).value).toBe('groengrijs')
    expect(markers()).toHaveLength(2)
    const marker = markers()[0]
    expect(marker.getAttribute('title')).toContain(SILT)
    expect(marker.getAttribute('title')).toContain('(tot 20mm)')
    const row = marker.closest('tr') as HTMLElement
    expect(row.getAttribute('title')).toContain(SILT)
  })

  it('lists the unmatched clauses once under the grid', () => {
    startFrom('obs-desc')
    expect(screen.getByText('Not matched: (tot 20mm)')).toBeTruthy()
  })

  it('the hover text lists what was read but not coded (a denial is never an admixture)', () => {
    startFrom('obs-desc', ['grijze klei, niet kalkhoudend', SILT])
    expect(markers()[0].getAttribute('title')).toContain('Read, not coded: niet kalkhoudend')
  })

  // Owner 2026-10-02: "if i'm getting 0 matches then it is better not to do it".
  it('fewer than half read: depths only, one "could not read" line, no check markers', () => {
    startFrom('obs-desc', ['opgevuld gat', 'idem', SILT])
    expect(screen.getByText('Could not read these descriptions (2 of 3); fill the codes by hand')).toBeTruthy()
    expect(markers()).toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'Mark all as checked' })).toBeNull()
    expect((screen.getByLabelText('Main soil, row 3') as HTMLSelectElement).value).toBe('')
  })

  it('Save stays disabled until each row is checked, its title saying how many', () => {
    startFrom('obs-desc')
    expect(save().disabled).toBe(true)
    expect(save().getAttribute('title')).toBe('2 rows still to check')
    fireEvent.click(screen.getByRole('button', { name: 'Mark row 1 as checked' }))
    expect(markers()).toHaveLength(1)
    expect(save().getAttribute('title')).toBe('1 row still to check')
    fireEvent.click(screen.getByRole('button', { name: 'Mark row 2 as checked' }))
    expect(markers()).toHaveLength(0)
    expect(save().disabled).toBe(false)
  })

  it('editing a field of a row clears its marker', () => {
    startFrom('obs-desc')
    fireEvent.change(screen.getByLabelText('Colour, row 1'), { target: { value: 'grijsbruin' } })
    expect(markers()).toHaveLength(1)
    // The row still says where it came from on hover.
    const row = (screen.getByLabelText('Colour, row 1') as HTMLElement).closest('tr') as HTMLElement
    expect(row.getAttribute('title')).toContain(SILT)
  })

  it('"Mark all as checked" enables Save, and is not the default focus', async () => {
    const s = startFrom('obs-desc')
    const all = screen.getByRole('button', { name: 'Mark all as checked' })
    expect(document.activeElement).not.toBe(all)
    fireEvent.click(all)
    expect(markers()).toHaveLength(0)
    expect(save().disabled).toBe(false)
    fireEvent.click(save())
    await waitFor(() => expect(s.editing.saveTrack).toHaveBeenCalledTimes(1))
    const [, draft] = (s.editing.saveTrack as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(draft.intervals[0]).toEqual({
      top_m: 0,
      base_m: 1.2,
      color: 'bruin',
      main_soil_codes: ['SI'],
      admixtures: [
        { soil_code: 'FZ', amount: 'S', locally: false },
        { soil_code: 'SN', amount: 'N', locally: false },
        { soil_code: 'KA', amount: 'N', locally: false },
      ],
    })
  })

  it('starting from a coded track carries no marker', () => {
    startFrom('obs-litho')
    expect(markers()).toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'Mark all as checked' })).toBeNull()
  })
})
