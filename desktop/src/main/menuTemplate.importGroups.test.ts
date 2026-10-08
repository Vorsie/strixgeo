// Owner 2026-10-04: "one button for cpt's with suboptions, same for drillings."
// The File menu carries one "Import CPT" and one "Import boreholes" submenu
// with every import route inside, instead of a flat list of import items.
// DMT stays a disabled top-level item until it ships.

import { describe, expect, it, vi } from 'vitest'

import { buildMenuTemplate } from './menuTemplate'

type Item = Electron.MenuItemConstructorOptions

function fileMenu(language: 'en' | 'nl', send = vi.fn()): Item[] {
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
  return template[0].submenu as Item[]
}

function byLabel(items: Item[], label: string): Item {
  const found = items.find(i => i.label === label)
  if (!found) throw new Error(`no item "${label}" in [${items.map(i => i.label).join(' | ')}]`)
  return found
}

describe('File menu: one import submenu per kind of investigation', () => {
  it('Import CPT holds .gef files (Ctrl+Shift+C), From DOV and From a PDF report', () => {
    const send = vi.fn()
    const cpt = byLabel(fileMenu('en', send), 'Import CPT')
    const sub = cpt.submenu as Item[]
    expect(sub.map(i => i.label)).toEqual([
      '.gef files…',
      'From DOV (draw box)…',
      'From a PDF report…',
    ])
    expect(sub[0].accelerator).toBe('CmdOrCtrl+Shift+C')
    ;(sub[0].click as () => void)()
    ;(sub[1].click as () => void)()
    ;(sub[2].click as () => void)()
    expect(send.mock.calls.map(c => c[0])).toEqual([
      'menu:import-cpt',
      'menu:import-cpt-dov',
      'menu:import-cpt-pdf',
    ])
  })

  it('Import boreholes holds From DOV and DOV XML files (Ctrl+Shift+B)', () => {
    const send = vi.fn()
    const bh = byLabel(fileMenu('en', send), 'Import boreholes')
    const sub = bh.submenu as Item[]
    expect(sub.map(i => i.label)).toEqual(['From DOV (draw box)…', 'DOV XML files…'])
    expect(sub[1].accelerator).toBe('CmdOrCtrl+Shift+B')
    ;(sub[0].click as () => void)()
    ;(sub[1].click as () => void)()
    expect(send.mock.calls.map(c => c[0])).toEqual([
      'menu:import-borehole-dov',
      'menu:import-borehole',
    ])
  })

  it('the flat import items are gone; DMT stays a disabled top-level item', () => {
    const labels = fileMenu('en').map(i => i.label)
    expect(labels).not.toContain('Import CPT…')
    expect(labels).not.toContain('Import CPTs from a PDF Report…')
    expect(labels).not.toContain('Import boreholes (DOV XML)…')
    expect(byLabel(fileMenu('en'), 'Import DMT…').enabled).toBe(false)
  })

  it('reads Sondering (CPT) importeren and Boringen importeren in a Dutch app', () => {
    const items = fileMenu('nl')
    expect((byLabel(items, 'Sondering (CPT) importeren').submenu as Item[]).map(i => i.label)).toEqual([
      '.gef-bestanden…',
      'Uit DOV (kader tekenen)…',
      'Uit een pdf-rapport…',
    ])
    expect((byLabel(items, 'Boringen importeren').submenu as Item[]).map(i => i.label)).toEqual([
      'Uit DOV (kader tekenen)…',
      'DOV-XML-bestanden…',
    ])
  })
})
