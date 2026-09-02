/** Defaults + ``view_state.pdf_sheet`` read/write (spec "Settings and persistence"). Additive: absent until first use. */
import type { SheetField, SheetFill, SheetScaleMode, SheetSettings } from './sheetPayload'

export interface FieldLabels { project: string; profile: string; client: string; dateAuthor: string }

export function defaultSheetSettings(seed: {
  fill: SheetFill; vex: number; spacing: number
  projectName: string; sectionName: string; today: string; labels: FieldLabels
}): SheetSettings {
  return {
    fill: seed.fill, scaleMode: 'fit', hScale: null, vScale: null, vex: seed.vex, spacing: seed.spacing,
    fields: [
      { label: seed.labels.project, value: seed.projectName },
      { label: seed.labels.profile, value: seed.sectionName },
      { label: seed.labels.client, value: '' },
      { label: seed.labels.dateAuthor, value: seed.today },
    ],
  }
}

const FILLS: readonly SheetFill[] = ['litho', 'geotech']
const MODES: readonly SheetScaleMode[] = ['fit', 'explicit']

function isField(v: unknown): v is SheetField {
  return !!v && typeof v === 'object' && typeof (v as SheetField).label === 'string' && typeof (v as SheetField).value === 'string'
}

/** Returns ``fallback`` untouched when the stored block is missing or malformed. */
export function readSheetSettings(
  viewState: Record<string, unknown> | null | undefined,
  fallback: SheetSettings,
): SheetSettings {
  const raw = viewState?.pdf_sheet
  if (!raw || typeof raw !== 'object') return fallback
  const d = raw as Record<string, unknown>
  const fields = Array.isArray(d.fields) && d.fields.length === 4 && d.fields.every(isField)
    ? (d.fields as SheetSettings['fields'])
    : fallback.fields
  const num = (v: unknown, fb: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fb)
  const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null)
  if (!FILLS.includes(d.fill as SheetFill)) return fallback
  return {
    fill: d.fill as SheetFill,
    scaleMode: MODES.includes(d.scaleMode as SheetScaleMode) ? (d.scaleMode as SheetScaleMode) : 'fit',
    hScale: numOrNull(d.hScale),
    vScale: numOrNull(d.vScale),
    vex: num(d.vex, fallback.vex),
    spacing: Math.min(1, Math.max(0, num(d.spacing, fallback.spacing))),
    fields,
  }
}

/** Shallow-merges the block into a copy of the view state (the PATCH body the section client takes). */
export function writeSheetSettings(
  viewState: Record<string, unknown> | null | undefined,
  settings: SheetSettings,
): Record<string, unknown> {
  return { ...(viewState ?? {}), pdf_sheet: settings }
}
