// File -> Import boreholes -> DOV XML files... is live: the entry that sat
// disabled since Phase 3 now opens the local DOV borehole XML import. Since
// 2026-10-04 it sits in the Import boreholes submenu.

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
  const file = template[0].submenu as Electron.MenuItemConstructorOptions[]
  // The XML item lives one level down, in the Import boreholes submenu.
  return file.flatMap(i => (Array.isArray(i.submenu) ? i.submenu : [i]))
}

describe('File -> Import boreholes -> DOV XML files', () => {
  it('is enabled and sends menu:import-borehole', () => {
    const send = vi.fn()
    const item = fileMenu('en', send).find(i => i.label === 'DOV XML files…')
    expect(item).toBeDefined()
    expect(item?.enabled).not.toBe(false)
    ;(item?.click as () => void)()
    expect(send).toHaveBeenCalledWith('menu:import-borehole')
  })

  it('reads DOV-XML-bestanden… in a Dutch app', () => {
    expect(fileMenu('nl').some(i => i.label === 'DOV-XML-bestanden…')).toBe(true)
  })
})
