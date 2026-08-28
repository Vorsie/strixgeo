import type { ReactElement } from 'react'

import type { BoreholeDetailResponse } from '../../../api/client'
import { verticalDatumShort } from '../../../utils/verticalDatum'
import { useT } from '../../../i18n/translate'
import ElevationEditor from '../../ElevationEditor'
import { Field } from './Field'

/**
 * HTML header strip above the SVG canvas — boring name, X/Y, elevation,
 * depth, date, executor, water table, drill method.
 *
 * The Z field is the only branchy field: when ``onElevationChange`` is
 * wired, render the inline ``ElevationEditor`` so users can fix
 * missing values in place; otherwise fall back to a static read-only
 * ``Field`` with amber-italic warning when the elevation is missing.
 *
 * Z-field label tracks the row's stored vertical CRS — defaults to
 * plain "Z" when no datum is set so we never claim a datum the row
 * doesn't actually have.
 */
export function BoreholeHeader({
  borehole,
  onElevationChange,
}: {
  borehole: BoreholeDetailResponse
  onElevationChange?: (elevationM: number | null, zEpsg: number | null) => Promise<void>
}): ReactElement {
  const t = useT()
  const zDatumShort = verticalDatumShort(borehole.z_epsg)
  const zLabel = zDatumShort ? `Z (${zDatumShort})` : 'Z'
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-1 px-4 py-2 border-b border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 text-[11px] shrink-0">
      {/* "Boring" is the DOV header field name kept verbatim in NL too. */}
      <Field label={t('borelog.boring')} value={borehole.name} bold />
      <Field
        label="X / Y"
        value={
          borehole.epsg
            ? `${borehole.location_x.toFixed(1)} / ${borehole.location_y.toFixed(1)} (EPSG:${borehole.epsg})`
            : `${borehole.location_x.toFixed(1)} / ${borehole.location_y.toFixed(1)}`
        }
      />
      {onElevationChange ? (
        <div className="flex flex-col leading-tight">
          <span className="text-[9px] uppercase tracking-wide text-gray-400">{zLabel}</span>
          <ElevationEditor
            elevationM={borehole.elevation_m}
            zEpsg={borehole.z_epsg}
            elevationSource={borehole.elevation_source}
            onSave={onElevationChange}
          />
        </div>
      ) : (
        <Field
          label={zLabel}
          value={
            borehole.elevation_m != null
              ? borehole.elevation_m.toFixed(2)
              : t('borelog.missingValue')
          }
          warn={borehole.elevation_m == null}
        />
      )}
      <Field
        label={t('common.depth')}
        value={borehole.total_depth_m != null ? `0 – ${borehole.total_depth_m.toFixed(2)} m` : '—'}
      />
      <Field label={t('borelog.date')} value={borehole.start_date ?? '—'} />
      <Field label={t('borelog.executor')} value={borehole.executor ?? '—'} />
      {borehole.water_table_depth_m != null && (
        <Field label={t('borelog.waterAt')} value={`${borehole.water_table_depth_m.toFixed(2)} m`} />
      )}
      {borehole.drill_method && <Field label={t('borelog.method')} value={borehole.drill_method} />}
    </div>
  )
}
