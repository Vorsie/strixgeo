// Ruling 11 — "translate the whole undo vocabulary".
//
// Every UndoCommand carries an i18n KEY, not rendered text, and is resolved at
// display time so a mid-session language switch re-renders the label. These
// gates pin that the whole vocabulary is actually translated:
//
//   UV1 — every command key the app pushes resolves to a real, non-empty
//         string in BOTH locales (not the key-name fallback).
//   UV2 — the two failure toasts translate, and name the action.
//   UV3 — every ``undo.*`` key defined in EN has an NL sibling.

import { describe, expect, it } from 'vitest'

import { EN, type MessageKey } from './locales/en'
import { NL } from './locales/nl'
import { translate } from './translate'

/**
 * The full undo vocabulary — one key per distinct UndoCommand the app can
 * push. Kept as an explicit list (not derived from ``undo.*``) so a command
 * added without its key trips a review: add the key here AND at its push site.
 */
const COMMAND_KEYS: readonly MessageKey[] = [
  // Contacts + cross-sections.
  'undo.createContact',
  'undo.deleteContact',
  'undo.moveContact',
  'undo.moveBoundary',
  'undo.mergeContactUp',
  'undo.mergeContactDown',
  'undo.updateContacts',
  'undo.copyContacts',
  'undo.copyMoveContacts',
  'undo.correlateContacts',
  'undo.uncorrelateContacts',
  'undo.removeFromSection',
  'undo.seedFromStratigraphy',
  'undo.createSection',
  'undo.deleteSection',
  // Formations.
  'undo.createFormation',
  'undo.editFormation',
  'undo.recolorFormation',
  'undo.deleteFormation',
  'undo.reorderFormations',
  // Litho ghost gestures.
  'undo.moveLithoBoundary',
  'undo.editLithoComposition',
  'undo.insertLithoLayer',
  'undo.splitLithoLayer',
  'undo.mergeLithoLayers',
  'undo.absorbLithoLayer',
  'undo.rejectSuggestion',
  'undo.unrejectSuggestion',
  'undo.createManualGhost',
  'undo.acceptLithoLayer',
  'undo.acceptAllLithoLayers',
  'undo.acceptAllLithoLayersAcrossInvestigations',
  // Committed litho + geotech packing.
  'undo.splitLayer',
  'undo.setPackingClass',
  'undo.movePackingBoundary',
  'undo.splitPackingBand',
  'undo.absorbPackingLens',
  'undo.mergePackingBands',
  'undo.disconnectPackingBands',
  // Borehole membership + elevation.
  'undo.includeBoreholeGeo',
  'undo.excludeBoreholeGeo',
  'undo.includeBoreholeLitho',
  'undo.excludeBoreholeLitho',
  'undo.editCptElevation',
  'undo.editBoreholeElevation',
  // Borehole tracks (2026-09-29).
  'undo.addBoreholeTrack',
  'undo.editBoreholeTrack',
]

describe('the undo vocabulary is fully translated', () => {
  it('UV1 — every command key resolves to a real string in en AND nl', () => {
    const unresolved: string[] = []
    for (const key of COMMAND_KEYS) {
      for (const locale of ['en', 'nl'] as const) {
        const value = translate(locale, key)
        // ``translate`` returns the key itself when neither catalogue has it.
        if (value === key || value.trim() === '') unresolved.push(`${locale}:${key}`)
      }
    }
    expect(unresolved).toEqual([])
  })

  it('UV2 — the failure toasts translate and name the action', () => {
    for (const locale of ['en', 'nl'] as const) {
      const undo = translate(locale, 'undo.undoFailed', { action: 'Move contact' })
      const redo = translate(locale, 'undo.redoFailed', { action: 'Move contact' })
      expect(undo).not.toBe('undo.undoFailed')
      expect(redo).not.toBe('undo.redoFailed')
      expect(undo).toContain('Move contact')
      expect(redo).toContain('Move contact')
    }
  })

  it('UV3 — every undo.* key in EN has an NL sibling', () => {
    const enUndoKeys = Object.keys(EN).filter(k => k.startsWith('undo.'))
    const missing = enUndoKeys.filter(k => !Object.prototype.hasOwnProperty.call(NL, k))
    expect(missing).toEqual([])
  })
})
