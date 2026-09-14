// Bed-override surface (NL) — de "Bodempeil" tekentool op de Data-kaart, het
// formulier en de bodempeillijst in de Data-inspector (owner ruling
// 2026-09-06). Een bodempeil is een polygoon met een constant bodempeil;
// binnenin neemt het maaiveld dat peil in plaats van het DHM.
//
// Deel van de Nederlandse catalogus — zie 'locales/nl/index.ts'.

export const BED_OVERRIDE_NL = {
  // Tekentool in de werkbalk.
  'bedOverride.tool': 'Bodempeil',
  'bedOverride.toolHint': 'Teken een polygoon over water en stel het bodempeil in',
  'bedOverride.drawHint': 'Klik om punten toe te voegen, dubbelklik om af te ronden. Esc annuleert.',
  'bedOverride.drawTooFewPoints': 'Teken minstens drie punten voor je afrondt.',

  // Lijst in de inspector.
  'bedOverride.title': 'Bodempeilen',
  'bedOverride.empty': 'Nog geen bodempeilen. Gebruik de Bodempeil-tool op de kaart om er een over water te tekenen.',
  'bedOverride.levelSuffix': 'm TAW',
  'bedOverride.edit': 'Bewerken',
  'bedOverride.delete': 'Verwijderen',

  // Formulier voor toevoegen / bewerken.
  'bedOverride.formCreateTitle': 'Nieuw bodempeil',
  'bedOverride.formEditTitle': 'Bodempeil bewerken',
  'bedOverride.labelField': 'Naam',
  'bedOverride.labelPlaceholder': 'Kanaalbodem',
  'bedOverride.levelField': 'Bodempeil (m TAW)',
  'bedOverride.save': 'Opslaan',
  'bedOverride.cancel': 'Annuleren',

  // Meldingen.
  'bedOverride.savedRebuild':
    'Bodempeil opgeslagen. Bouw de modellen opnieuw om ze erop af te snijden; de profielweergave is meteen afgesneden.',
  'bedOverride.deleted': 'Bodempeil verwijderd',
  'bedOverride.saveFailed': 'Kon het bodempeil niet opslaan',

  // Bevestiging bij verwijderen (onomkeerbaar — Annuleren krijgt de focus).
  'bedOverride.deleteConfirmTitle': 'Bodempeil verwijderen?',
  'bedOverride.deleteConfirmBody':
    'Dit verwijdert het bodempeil "{label}". Het maaiveld valt daar terug op het DHM. Dit kan niet ongedaan worden gemaakt.',
  'bedOverride.deleteConfirmButton': 'Verwijderen',
} as const
