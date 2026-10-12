// "Check for updates at start" in the Settings dialog (owner ruling 2026-10-11,
// option a).
//
// The ruling, in his words: the update check is a setting, default ON, next to
// the other app-level switches. Off = no automatic check at all; Help > Check
// for updates keeps working. Main owns the value (the start check runs before
// any renderer exists); the row mirrors it and writes through the bridge.

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import SettingsDialog from './SettingsDialog'
import { DEFAULT_LANGUAGE } from '../i18n/i18n_constants'
import { setLanguage } from '../i18n/languageSelect'
import { GEOTECH_SUBDIVISION_DEFAULTS } from '../utils/geotechSubdivisionPrefs'
import { LITHO_SEGMENTER_DEFAULTS } from '../utils/lithoSegmenterPrefs'
import { SECTION_DEFAULTS } from '../utils/sectionDefaults'

/** A bridge whose main-process store holds ``stored``; set writes it back. */
function installBridge(stored: boolean): { set: ReturnType<typeof vi.fn> } {
  let value = stored
  const set = vi.fn(async (enabled: boolean) => {
    value = enabled
    return value
  })
  ;(window as unknown as { electron: unknown }).electron = {
    getUpdateCheckAtStart: vi.fn(async () => value),
    setUpdateCheckAtStart: set,
  }
  return { set }
}

async function openAppearance(): Promise<void> {
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
  fireEvent.click(screen.getByTestId('settings-section-appearance'))
  // Let the pulled value from main settle.
  await act(async () => {})
}

afterEach(() => {
  cleanup()
  delete (window as unknown as { electron?: unknown }).electron
  setLanguage(DEFAULT_LANGUAGE)
})

describe('Check for updates at start', () => {
  it('SU1 - the row shows what main stores: on by default', async () => {
    installBridge(true)
    await openAppearance()
    const box = screen.getByTestId('settings-update-check-at-start') as HTMLInputElement
    expect(box.checked).toBe(true)
    expect(screen.getByText('Check for updates at start')).toBeInTheDocument()
  })

  it('SU2 - a user who switched it off sees it off', async () => {
    installBridge(false)
    await openAppearance()
    expect((screen.getByTestId('settings-update-check-at-start') as HTMLInputElement).checked).toBe(false)
  })

  it('SU3 - unticking writes OFF to main at once, no Save click', async () => {
    const { set } = installBridge(true)
    await openAppearance()
    await act(async () => {
      fireEvent.click(screen.getByTestId('settings-update-check-at-start'))
    })
    expect(set).toHaveBeenCalledWith(false)
    expect((screen.getByTestId('settings-update-check-at-start') as HTMLInputElement).checked).toBe(false)
  })

  it('SU4 - the hint says the manual check keeps working (EN)', async () => {
    installBridge(true)
    await openAppearance()
    expect(
      screen.getByText('Off: no automatic check. Help > Check for updates keeps working.'),
    ).toBeInTheDocument()
  })

  it('SU5 - Dutch: the owner wording for the label and the hint', async () => {
    setLanguage('nl')
    installBridge(true)
    await openAppearance()
    expect(screen.getByText('Bij het starten controleren op updates')).toBeInTheDocument()
    expect(
      screen.getByText('Uit: geen automatische controle. Help > Controleren op updates blijft werken.'),
    ).toBeInTheDocument()
  })

  it('SU6 - an older preload without the bridge hides the row instead of throwing', async () => {
    await openAppearance()
    expect(screen.queryByTestId('settings-update-check-at-start')).toBeNull()
  })
})
