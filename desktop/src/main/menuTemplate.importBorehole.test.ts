// File -> Import boreholes (DOV XML)... is live: the entry that sat disabled
// since Phase 3 now opens the local DOV borehole XML import.

import { describe, expect, it, vi } from 'vitest'

import { buildMenuTemplate } from './menuTemplate'

function fileMenu(language: 'en' | 'nl', send = vi.fn()) {
  const template = buildMenuTemplate({
    language,
    isPackaged: true,
    rawBackendLogAffordance: false,
    recent: [],
    send,
    onOpenLogFolder: () => {},
    onSaveLogsForSupport: () => {},
    onAbout: () => {},
  })
  return template[0].submenu as Electron.MenuItemConstructorOptions[]
}

describe('File -> Import boreholes (DOV XML)', () => {
  it('is enabled and sends menu:import-borehole', () => {
    const send = vi.fn()
    const item = fileMenu('en', send).find(i => i.label === 'Import boreholes (DOV XML)…')
    expect(item).toBeDefined()
    expect(item?.enabled).not.toBe(false)
    ;(item?.click as () => void)()
    expect(send).toHaveBeenCalledWith('menu:import-borehole')
  })

  it('reads Boringen importeren (DOV-XML)… in a Dutch app', () => {
    expect(fileMenu('nl').some(i => i.label === 'Boringen importeren (DOV-XML)…')).toBe(true)
  })
})
