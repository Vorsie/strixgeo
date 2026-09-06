// Bed-override surface — the "Bed level" draw tool on the Data-stage map, its
// form, and the bed-override list in the Data inspector (owner ruling
// 2026-09-06). A bed override is a polygon drawn with one constant bed
// elevation; inside it the ground surface takes that level instead of the DEM.
//
// Part of the English message catalogue — see 'locales/en/index.ts' for the
// key-naming rules and the domain-canon carve-out.

export const BED_OVERRIDE = {
  // Toolbar draw tool.
  'bedOverride.tool': 'Bed level',
  'bedOverride.toolHint': 'Draw a polygon over water and set the bed elevation',
  'bedOverride.drawHint': 'Click to add points, double-click to finish. Esc cancels.',
  'bedOverride.drawTooFewPoints': 'Draw at least three points before finishing.',

  // Inspector list.
  'bedOverride.title': 'Bed levels',
  'bedOverride.empty': 'No bed levels yet. Use the Bed level tool on the map to draw one over water.',
  'bedOverride.levelSuffix': 'm TAW',
  'bedOverride.edit': 'Edit',
  'bedOverride.delete': 'Delete',

  // Create / edit form.
  'bedOverride.formCreateTitle': 'New bed level',
  'bedOverride.formEditTitle': 'Edit bed level',
  'bedOverride.labelField': 'Name',
  'bedOverride.labelPlaceholder': 'Canal bed',
  'bedOverride.levelField': 'Bed level (m TAW)',
  'bedOverride.save': 'Save',
  'bedOverride.cancel': 'Cancel',

  // Toasts.
  'bedOverride.created': 'Bed level added',
  'bedOverride.updated': 'Bed level updated',
  'bedOverride.deleted': 'Bed level deleted',
  'bedOverride.saveFailed': 'Could not save the bed level',

  // Delete confirmation (irreversible — Cancel default-focused).
  'bedOverride.deleteConfirmTitle': 'Delete bed level?',
  'bedOverride.deleteConfirmBody':
    'This removes the bed level "{label}". The ground surface returns to the DEM there. This cannot be undone.',
  'bedOverride.deleteConfirmButton': 'Delete',
} as const
