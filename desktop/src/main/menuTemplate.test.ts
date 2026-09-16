// Pure — no Electron. Builds the menu template as plain data and asserts the
// labels follow the app language while the accelerators do not.

import { describe, expect, it } from 'vitest'

import { buildMenuTemplate, type MenuRecentEntry, type MenuTemplateDeps } from './menuTemplate'
import type { MenuLanguage } from './menuLabels'

/** Minimal deps for a packaged build; the click handlers are never invoked in
 *  these structural tests. */
function deps(language: MenuLanguage, recent: MenuRecentEntry[] = []): MenuTemplateDeps {
  return {
    language,
    isPackaged: true,
    rawBackendLogAffordance: false,
    recent,
    send: () => {},
    onShowLogFile: () => {},
    onSaveLogsForSupport: () => {},
    onAbout: () => {},
  }
}

interface FlatItem {
  label?: string
  accelerator?: string
}

/** Depth-first list of every item's label + accelerator, in template order. */
function flatten(template: readonly Electron.MenuItemConstructorOptions[]): FlatItem[] {
  const out: FlatItem[] = []
  for (const item of template) {
    out.push({ label: item.label, accelerator: item.accelerator })
    if (Array.isArray(item.submenu)) out.push(...flatten(item.submenu))
  }
  return out
}

/** The label of every leaf item, ignoring separators. */
function labels(template: readonly Electron.MenuItemConstructorOptions[]): string[] {
  return flatten(template)
    .map(i => i.label)
    .filter((l): l is string => typeof l === 'string')
}

describe('native menu template follows the app language', () => {
  it('in a Dutch app the Help menu says Logs opslaan voor support', () => {
    const template = buildMenuTemplate(deps('nl'))
    expect(labels(template)).toContain('Logs opslaan voor support…')
  })

  it('in an English app it says Save logs for support', () => {
    const template = buildMenuTemplate(deps('en'))
    expect(labels(template)).toContain('Save logs for support…')
  })

  it('in a Dutch app the top-level menus read Bestand, Bewerken, Beeld, Help', () => {
    const template = buildMenuTemplate(deps('nl'))
    const topLevel = template.map(m => m.label)
    expect(topLevel).toEqual(['Bestand', 'Bewerken', 'Beeld', 'Help'])
  })

  it('accelerators do not change with the language', () => {
    const en = flatten(buildMenuTemplate(deps('en')))
    const nl = flatten(buildMenuTemplate(deps('nl')))
    expect(en.length).toBe(nl.length)
    for (let i = 0; i < en.length; i++) {
      expect(nl[i].accelerator, `accelerator at position ${i}`).toBe(en[i].accelerator)
    }
    // Sanity: the labels really did change, so the accelerator match is meaningful.
    expect(labels(buildMenuTemplate(deps('en')))).not.toEqual(labels(buildMenuTemplate(deps('nl'))))
  })
})
