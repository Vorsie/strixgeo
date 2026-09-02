import { describe, expect, it } from 'vitest'
import { defaultSheetSettings, readSheetSettings, writeSheetSettings } from './sheetSettings'

const labels = { project: 'Project', profile: 'Profiel', client: 'Opdrachtgever', dateAuthor: 'Datum · Auteur' }

describe('sheet settings — seeded from the section, persisted in view_state.pdf_sheet', () => {
  it('defaults take the section vex and spacing, and pre-fill project, section and date', () => {
    const s = defaultSheetSettings({
      fill: 'litho', vex: 4, spacing: 0.7, projectName: 'Kaai 1712', sectionName: 'CS1', today: '2026-09-02', labels,
    })
    expect(s).toMatchObject({ fill: 'litho', scaleMode: 'fit', hScale: null, vScale: null, vex: 4, spacing: 0.7 })
    expect(s.fields.map(f => f.label)).toEqual(['Project', 'Profiel', 'Opdrachtgever', 'Datum · Auteur'])
    expect(s.fields.map(f => f.value)).toEqual(['Kaai 1712', 'CS1', '', '2026-09-02'])
  })
  it('round-trips through view_state and ignores junk', () => {
    const s = defaultSheetSettings({ fill: 'geotech', vex: 2, spacing: 1, projectName: 'P', sectionName: 'S', today: 'd', labels })
    const vs = writeSheetSettings({ column_spacing: 0.5 }, { ...s, scaleMode: 'explicit', hScale: 1000, vScale: 200 })
    expect(vs.column_spacing).toBe(0.5)
    expect(readSheetSettings(vs, s)).toMatchObject({ scaleMode: 'explicit', hScale: 1000, vScale: 200, fill: 'geotech' })
    expect(readSheetSettings({ pdf_sheet: 'garbage' }, s)).toEqual(s)
    expect(readSheetSettings({ pdf_sheet: { fill: 'model' } }, s)).toEqual(s)
  })
})
