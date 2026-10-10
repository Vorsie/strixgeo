// The two questions a triaged borehole can ask before it is imported (owner
// rulings 2026-10-08, 3 and 4): the coordinate system of X/Y printed without
// one, and the unit of a water level printed as a bare number. Shown under the
// row only when its finding is there; presentational, the dialog owns the
// answers.

import type { BoreholePdfRow } from '../../api/clients/boreholePdf'
import { useT } from '../../i18n/translate'
import { FIELD_CLASS } from '../ui/fieldClasses'
import { CRS_OPTIONS, type CrsChoice, type RowDecision } from './boreholePdfConfirmations'

interface Props {
  row: BoreholePdfRow
  decision: RowDecision | undefined
  onCrs: (key: string, choice: CrsChoice) => void
  onWater: (key: string, confirmed: boolean) => void
}

/** The first system of the list that is not the assumed one ("another CRS"). */
const OTHER_DEFAULT = CRS_OPTIONS.find(o => o.epsg !== 31370)?.epsg ?? CRS_OPTIONS[0].epsg

/**
 * The CRS radios and the water-unit tick of one row.
 *
 * @returns The questions, or nothing when the row asks none.
 */
export default function BoreholePdfQuestions({ row, decision, onCrs, onWater }: Props): JSX.Element | null {
  const t = useT()
  if (!row.crs_assumed && !row.water_unit_assumed) return null
  const crs = decision?.crs ?? null
  const name = `borehole-pdf-crs-${row.key}`
  return (
    <div className="mt-1 flex flex-col gap-1 rounded border border-status-amber px-2 py-1" data-testid="borehole-pdf-questions">
      {row.crs_assumed && (
        <fieldset className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <legend className="float-left mr-2 font-semibold">{t('boreholePdf.crs.question')}</legend>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name={name}
              data-testid="borehole-pdf-crs-this"
              checked={crs?.kind === 'this'}
              onChange={() => onCrs(row.key, { kind: 'this' })}
            />
            {t('boreholePdf.crs.this')}
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name={name}
              data-testid="borehole-pdf-crs-report"
              checked={crs?.kind === 'report'}
              onChange={() => onCrs(row.key, { kind: 'report' })}
            />
            {t('boreholePdf.crs.report')}
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name={name}
              data-testid="borehole-pdf-crs-other"
              checked={crs?.kind === 'other'}
              onChange={() => onCrs(row.key, { kind: 'other', epsg: OTHER_DEFAULT })}
            />
            {t('boreholePdf.crs.other')}
          </label>
          {crs?.kind === 'other' && (
            <select
              aria-label={t('boreholePdf.crs.otherLabel')}
              data-testid="borehole-pdf-crs-epsg"
              className={`${FIELD_CLASS} px-1 py-0.5 text-xs`}
              value={crs.epsg}
              onChange={e => onCrs(row.key, { kind: 'other', epsg: Number(e.target.value) })}
            >
              {CRS_OPTIONS.map(o => (
                <option key={o.epsg} value={o.epsg}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
        </fieldset>
      )}
      {row.water_unit_assumed && (
        <label className="flex flex-wrap items-center gap-x-2">
          <span className="font-semibold">
            {t('boreholePdf.water.question', { value: rawWater(row) })}
          </span>
          <span className="flex items-center gap-1">
            <input
              type="checkbox"
              data-testid="borehole-pdf-water-confirm"
              checked={decision?.waterConfirmed ?? false}
              onChange={e => onWater(row.key, e.target.checked)}
            />
            {t('boreholePdf.water.confirm', { depth: row.water_level_m?.toFixed(2) ?? '?' })}
          </span>
        </label>
      )}
    </div>
  )
}

/** The water level as printed ("380"), from the finding's params. */
function rawWater(row: BoreholePdfRow): string {
  const finding = row.findings.find(f => f.code === 'WATER_UNIT_ASSUMED')
  const value = finding?.params?.value
  return typeof value === 'string' ? value : ''
}
