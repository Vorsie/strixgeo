// The "Tracks" button on the borelog toolbar (owner 2026-09-29: "i want to add
// columns on the borehole itself"). It opens the borehole's Tracks panel; a
// read-only mount (no track editing wired) shows no button.
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { BoreholeTrackEditing } from '../hooks/useBoreholeTrackEdits'
import { makeFixtureBorehole } from '../test/fixtures/borehole'
import BoreholeLog from './BoreholeLog'

describe('BoreholeLog — Tracks button', () => {
  beforeEach(() => localStorage.clear())

  it('is absent on a read-only borelog', () => {
    render(<BoreholeLog borehole={makeFixtureBorehole()} />)
    expect(screen.queryByTestId('borelog-tracks-button')).toBeNull()
  })

  it('opens the Tracks panel of this borehole', () => {
    const editing: BoreholeTrackEditing = {
      saveTrack: vi.fn(),
      deleteTrack: vi.fn(),
    }
    render(<BoreholeLog borehole={makeFixtureBorehole()} trackEditing={editing} />)
    fireEvent.click(screen.getByTestId('borelog-tracks-button'))
    expect(screen.getByRole('dialog', { name: 'Tracks of BH-FIXTURE-1' })).toBeTruthy()
  })
})
