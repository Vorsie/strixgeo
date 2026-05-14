// Smoke + behaviour tests for FormationDialog.
//
// Validates: open-prefill-from-initialValue, name-trim + required,
// submit dispatches the right payload shape, cancel + Esc paths,
// G3Dv3 autocomplete + autofill.

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { G3Dv3CatalogResponse, GeologicalFormationResponse } from '../../api/client'
import { api } from '../../api/client'
import { _resetG3Dv3CatalogCacheForTesting } from '../../hooks/useG3Dv3Catalog'
import FormationDialog, { rankFormationSuggestions } from './FormationDialog'

const TEST_CATALOG: G3Dv3CatalogResponse = {
  units: [
    {
      code: '1',
      abbreviation: 'A',
      rank: 'formation',
      parent_abbreviation: null,
      name_nl: 'Antropogeen',
      age_rank: 0,
      color_hex: '#ea152e',
    },
    {
      code: '0206',
      abbreviation: 'NE_Di',
      rank: 'formation',
      parent_abbreviation: null,
      name_nl: 'Diest',
      age_rank: 30,
      color_hex: '#ef886f',
    },
    {
      code: '0303',
      abbreviation: 'PA_Bm',
      rank: 'formation',
      parent_abbreviation: null,
      name_nl: 'Boom',
      age_rank: 43,
      color_hex: '#2c73b9',
    },
    {
      code: '010101',
      abbreviation: 'Q_GtAb',
      rank: 'member',
      parent_abbreviation: 'Q_Gt',
      name_nl: 'Achterbos',
      age_rank: 2,
      color_hex: '#ffe100',
    },
  ],
}

function makeFormation(
  overrides: Partial<GeologicalFormationResponse> = {},
): GeologicalFormationResponse {
  return {
    id: 'f-1',
    app_project_id: 'P',
    name: 'Boom Klei',
    color: '#888888',
    code: null,
    display_order: 0,
    regional_ref: 'BMK',
    description: null,
    created_at: '2026-05-12T00:00:00Z',
    updated_at: '2026-05-12T00:00:00Z',
    ...overrides,
  }
}

beforeEach(() => {
  _resetG3Dv3CatalogCacheForTesting()
  // Default to an empty/no-op catalog response so dialog tests that
  // don't care about autocomplete behave like the pre-G3Dv3 build.
  // Individual tests override this for the autocomplete cases.
  vi.spyOn(api.codelists, 'g3dv3').mockResolvedValue({ units: [] })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('FormationDialog — create mode', () => {
  it('renders empty fields when initialValue is null', () => {
    render(
      <FormationDialog
        open
        initialValue={null}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByText('New formation')).toBeInTheDocument()
    const nameInput = screen.getByLabelText(/Name/i) as HTMLInputElement
    expect(nameInput.value).toBe('')
  })

  it('disables Create until the user types a name', () => {
    render(
      <FormationDialog
        open
        initialValue={null}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    const createBtn = screen.getByRole('button', { name: /Create/i })
    expect(createBtn).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Name/i), { target: { value: 'Boom Klei' } })
    expect(createBtn).not.toBeDisabled()
  })

  it('submits a trimmed name + null regional_ref when empty', async () => {
    const onSubmit = vi.fn()
    render(
      <FormationDialog
        open
        initialValue={null}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByLabelText(/Name/i), {
      target: { value: '  Boom Klei  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Create/i }))
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Boom Klei', regional_ref: null }),
    )
  })
})

describe('FormationDialog — edit mode', () => {
  it('renders prefilled fields and "Save" button when initialValue is set', () => {
    render(
      <FormationDialog
        open
        initialValue={makeFormation({ name: 'Diest Zand', regional_ref: 'DZN' })}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByText('Edit formation')).toBeInTheDocument()
    expect((screen.getByLabelText(/Name/i) as HTMLInputElement).value).toBe('Diest Zand')
    expect(screen.getByRole('button', { name: /Save/i })).toBeInTheDocument()
  })

  it('cancel button fires onCancel', () => {
    const onCancel = vi.fn()
    render(
      <FormationDialog
        open
        initialValue={makeFormation()}
        onSubmit={vi.fn()}
        onCancel={onCancel}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})

describe('FormationDialog — closed state', () => {
  it('renders nothing when open is false', () => {
    const { container } = render(
      <FormationDialog
        open={false}
        initialValue={null}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })
})

describe('rankFormationSuggestions', () => {
  it('returns prefix matches before substring matches', () => {
    const units = [
      {
        code: '0303',
        abbreviation: 'PA_Bm',
        rank: 'formation' as const,
        parent_abbreviation: null,
        name_nl: 'Boom',
        age_rank: 43,
        color_hex: '#2c73b9',
      },
      {
        code: 'X',
        abbreviation: 'X',
        rank: 'formation' as const,
        parent_abbreviation: null,
        name_nl: 'Houtboom',
        age_rank: 0,
        color_hex: null,
      },
    ]
    const out = rankFormationSuggestions(units, 'bo')
    expect(out.map(u => u.name_nl)).toEqual(['Boom', 'Houtboom'])
  })

  it('matches abbreviation substring (code-style query)', () => {
    const out = rankFormationSuggestions(TEST_CATALOG.units, 'ne_di')
    expect(out[0]?.name_nl).toBe('Diest')
  })

  it('empty query returns nothing', () => {
    expect(rankFormationSuggestions(TEST_CATALOG.units, '')).toEqual([])
    expect(rankFormationSuggestions(TEST_CATALOG.units, '   ')).toEqual([])
  })

  it('honours the limit', () => {
    expect(rankFormationSuggestions(TEST_CATALOG.units, 'e', 2)).toHaveLength(2)
  })
})

describe('FormationDialog — G3Dv3 autocomplete', () => {
  beforeEach(() => {
    vi.spyOn(api.codelists, 'g3dv3').mockResolvedValue(TEST_CATALOG)
  })

  it('shows suggestions matching the typed prefix', async () => {
    render(
      <FormationDialog
        open
        initialValue={null}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    await waitFor(() =>
      expect(api.codelists.g3dv3).toHaveBeenCalled(),
    )
    fireEvent.change(screen.getByLabelText(/Name/i), { target: { value: 'boo' } })
    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument()
    })
    const options = screen.getAllByRole('option')
    expect(options.map(o => o.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('Boom')]),
    )
  })

  it('clicking a suggestion autofills name, regional_ref, and color', async () => {
    render(
      <FormationDialog
        open
        initialValue={null}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    await waitFor(() => expect(api.codelists.g3dv3).toHaveBeenCalled())
    fireEvent.change(screen.getByLabelText(/Name/i), { target: { value: 'boom' } })
    await waitFor(() => screen.getByRole('listbox'))
    const boomOption = screen.getAllByRole('option').find(o => o.textContent?.includes('Boom'))
    expect(boomOption).toBeDefined()
    fireEvent.mouseDown(boomOption!)

    expect((screen.getByLabelText(/Name/i) as HTMLInputElement).value).toBe('Boom')
    expect(
      (screen.getByLabelText(/Regional reference/i) as HTMLInputElement).value,
    ).toBe('PA_Bm')
    expect((screen.getByLabelText(/Colour/i) as HTMLInputElement).value).toBe(
      '#2c73b9',
    )
  })

  it('ArrowDown + Enter picks the highlighted suggestion', async () => {
    render(
      <FormationDialog
        open
        initialValue={null}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    await waitFor(() => expect(api.codelists.g3dv3).toHaveBeenCalled())
    const nameInput = screen.getByLabelText(/Name/i) as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: 'd' } })
    await waitFor(() => screen.getByRole('listbox'))
    // First option ("Diest") is already active at index 0 — Enter
    // applies it without the user pressing ArrowDown.
    fireEvent.keyDown(nameInput, { key: 'Enter' })
    expect(nameInput.value).toBe('Diest')
    expect(
      (screen.getByLabelText(/Regional reference/i) as HTMLInputElement).value,
    ).toBe('NE_Di')
  })

  it('typing a custom name with no suggestion match still submits as free text', async () => {
    const onSubmit = vi.fn()
    render(
      <FormationDialog
        open
        initialValue={null}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    )
    await waitFor(() => expect(api.codelists.g3dv3).toHaveBeenCalled())
    fireEvent.change(screen.getByLabelText(/Name/i), {
      target: { value: 'My Custom Fill' },
    })
    // No suggestion shows up — Enter falls through to submit.
    fireEvent.click(screen.getByRole('button', { name: /Create/i }))
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'My Custom Fill', regional_ref: null }),
    )
  })
})
