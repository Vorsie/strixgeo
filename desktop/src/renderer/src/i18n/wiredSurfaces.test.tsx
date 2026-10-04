// End-to-end pins for the two surfaces wired to the i18n layer.
//
// These are the tests that would catch "the toggle exists but nothing moved" —
// the failure mode a locale file + a store cannot catch on their own.
//
// WS1 — Settings renders English by default (an unreviewed translation must not
//        be what a fresh install shows).
// WS2 — flipping the language picker re-renders Settings in Dutch, with no
//        remount and no Save click.
// WS3 — the choice persists to localStorage, so the next launch keeps it.
// WS4 — DataToolbar's import verbs follow the same flip, proving the store
//        reaches a component that never sees a language prop.
// WS5 — a surface NOT yet wired is untouched by the flip. This is the blast-
//        radius pin: tonight's change must be additive.

import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import SettingsDialog from '../components/SettingsDialog'
import DataToolbar from '../shell/stages/data/DataToolbar'
import { ShellContext } from '../shell/ShellContext'
import { DEFAULT_LANGUAGE, LANGUAGE_STORAGE_KEY } from './i18n_constants'
import { setLanguage } from './languageSelect'
import { GEOTECH_SUBDIVISION_DEFAULTS } from '../utils/geotechSubdivisionPrefs'
import { LITHO_SEGMENTER_DEFAULTS } from '../utils/lithoSegmenterPrefs'
import { SECTION_DEFAULTS } from '../utils/sectionDefaults'

afterEach(() => {
  localStorage.clear()
  setLanguage(DEFAULT_LANGUAGE)
})

function renderSettings(): void {
  render(
    <SettingsDialog
      open
      hasProject
      initialLithoSegmenter={{ ...LITHO_SEGMENTER_DEFAULTS }}
      initialGeotechSubdivision={{ ...GEOTECH_SUBDIVISION_DEFAULTS }}
      initialSectionDefaults={{ ...SECTION_DEFAULTS }}
      themeChoice="system"
      onCancel={() => {}}
      onSubmitLithoSegmenter={() => {}}
      onSubmitGeotechSubdivision={() => {}}
      onSubmitSectionDefaults={() => {}}
      onSetThemeChoice={() => {}}
    />,
  )
}

/** Minimal shell context — DataToolbar only reads the investigations slice. */
function renderDataToolbar(): void {
  const value = {
    investigations: {
      importing: false,
      dovImporting: false,
      bboxImportType: null,
      handleImportCpt: () => {},
      handleImportDov: () => {},
      handleImportBoreholeDov: () => {},
    },
  }
  render(
    <ShellContext.Provider value={value as never}>
      <DataToolbar />
    </ShellContext.Provider>,
  )
}

describe('wired surfaces', () => {
  it('WS1 — Settings renders English by default', () => {
    renderSettings()
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByTestId('settings-section-appearance')).toHaveTextContent('Appearance')
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })

  it('WS2 — flipping the language picker re-renders Settings in Dutch', () => {
    renderSettings()
    fireEvent.click(screen.getByTestId('settings-section-appearance'))

    const picker = screen.getByTestId('settings-language')
    expect(picker).toHaveValue('en')
    fireEvent.change(picker, { target: { value: 'nl' } })

    // Title, rail and footer all follow, in the same render — no Save click.
    expect(screen.getByRole('heading', { name: 'Instellingen' })).toBeInTheDocument()
    expect(screen.getByTestId('settings-section-appearance')).toHaveTextContent('Weergave')
    expect(screen.getByTestId('settings-section-sections')).toHaveTextContent('Dwarsprofielen')
    expect(screen.getByRole('button', { name: 'Sluiten' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Settings' })).not.toBeInTheDocument()
  })

  it('WS2b — a project-scoped section translates its hints, defaults intact', () => {
    setLanguage('nl')
    renderSettings()
    // The litho section is the default tab; its min-thickness hint interpolates
    // the numeric default, which must survive translation unchanged.
    expect(
      screen.getByText(new RegExp(`Standaard ${LITHO_SEGMENTER_DEFAULTS.minimumLayerThicknessM} m`)),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Standaardwaarden herstellen' })).toBeInTheDocument()
  })

  it('WS3 — the language choice persists to localStorage', () => {
    renderSettings()
    fireEvent.click(screen.getByTestId('settings-section-appearance'))
    fireEvent.change(screen.getByTestId('settings-language'), { target: { value: 'nl' } })
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('nl')
  })

  it('WS4 — DataToolbar import verbs follow the language, with no language prop', () => {
    renderDataToolbar()
    fireEvent.click(screen.getByRole('button', { name: /Import/ }))
    // The CPT routes sit in the CPT group's submenu (owner 2026-10-04).
    fireEvent.click(within(screen.getByRole('menu')).getByText('CPT'))
    expect(within(screen.getAllByRole('menu')[1]).getByText('.gef files')).toBeInTheDocument()

    // act() because the flip arrives through useSyncExternalStore, not through
    // an event React already owns — without it the re-render is queued past the
    // assertion and the test reads the pre-flip DOM.
    act(() => setLanguage('nl'))

    expect(screen.getByRole('button', { name: /Importeren/ })).toBeInTheDocument()
    const [menu, submenu] = screen.getAllByRole('menu')
    expect(within(menu).getByText('Sondering (CPT)')).toBeInTheDocument()
    expect(within(menu).getByText('Boring')).toBeInTheDocument()
    expect(within(submenu).getByText('.gef-bestanden')).toBeInTheDocument()
    // "kader tekenen" — the owner's bbox ruling, decisions batch 2026-08-27.
    expect(within(submenu).getByText('Uit DOV (kader tekenen)')).toBeInTheDocument()
    // One tag per not-yet-available verb (DMT, monitoring); the lab-test verb
    // went live with the raw lab import (2026-09-29).
    expect(within(menu).getAllByText('Fase 4')).toHaveLength(2)
    // Owner 2026-09-30: a generic lab importer, no program name in the label.
    expect(within(menu).getByText('Laboproeven')).toBeInTheDocument()
  })

  it('WS5 — strings from a NON-i18n source are untouched by the flip', () => {
    setLanguage('nl')
    renderSettings()
    fireEvent.click(screen.getByTestId('settings-section-appearance'))
    // The language endonyms come from LANGUAGE_LABELS, not from a catalogue:
    // a language is always offered in its OWN language, so the flip must leave
    // both option labels exactly as they were.
    const picker = screen.getByTestId('settings-language')
    expect(within(picker).getByText('English')).toBeInTheDocument()
    expect(within(picker).getByText('Nederlands')).toBeInTheDocument()
  })
})
