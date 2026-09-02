/** The whole sheet at paper size. ``map`` is a slot so tests render without Leaflet. */
import type { ReactNode } from 'react'
import type { MessageKey } from '../i18n/locales/en'
import { translate, type MessageParams } from '../i18n/translate'
import { ProfileDrawing } from './ProfileDrawing'
import { NO_PROJECT_KEY, projectColour } from './projectPalette'
import {
  MAP_HEIGHT_MM, MAP_LEGEND_GAP_MM, MARGIN_MM, RIGHT_COLUMN_MM, SCALE_LINE_MM,
  TITLE_BLOCK_MM, UNIT_LEGEND_MM,
} from './sheetConstants'
import { computeSheetGeometry, type SheetGeometry } from './sheetGeometry'
import type { SheetPayload } from './sheetPayload'
import { TitleBlock } from './TitleBlock'

export function sheetGeometryOf(payload: SheetPayload): SheetGeometry {
  const s = payload.settings
  return computeSheetGeometry({
    levelMaxM: payload.levelMaxM, levelMinM: payload.levelMinM,
    columns: payload.columns.map(c => ({ id: c.investigationId, alongM: c.alongM })),
    scaleMode: s.scaleMode, hScale: s.hScale, vScale: s.vScale, vex: s.vex, spacing: s.spacing,
  })
}

function distanceKey(spacing: number): MessageKey {
  if (spacing >= 0.999) return 'sheet.distance.true'
  if (spacing <= 0.001) return 'sheet.distance.packed'
  return 'sheet.distance.between'
}

export function SectionSheet({ payload, map }: { payload: SheetPayload; map: ReactNode }): JSX.Element {
  const lang = payload.language
  const t = (key: MessageKey, params?: MessageParams): string => translate(lang, key, params)
  const g = sheetGeometryOf(payload)
  const units = [...payload.units].filter(u => payload.regions.some(r => r.formation_id === u.formationId)).sort((a, b) => a.displayOrder - b.displayOrder)
  const ink = '#1f2933'
  return (
    <div
      data-testid="sheet-page"
      style={{ position: 'relative', width: `${g.paperWidthMm}mm`, height: `${g.paperHeightMm}mm`, background: '#ffffff', color: ink, overflow: 'hidden', fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif' }}
    >
      <div style={{ position: 'absolute', inset: `${MARGIN_MM}mm`, border: '0.3pt solid #8a9098', pointerEvents: 'none' }} />
      {/* profile */}
      <div style={{ position: 'absolute', left: 0, top: `${MARGIN_MM}mm` }}>
        <ProfileDrawing payload={payload} geometry={g} mTawLabel={t('sheet.mTaw')} />
      </div>
      {/* unit legend */}
      <div data-testid="sheet-unit-legend" style={{ position: 'absolute', left: `${g.drawingLeftMm}mm`, width: `${g.drawingWidthMm}mm`, bottom: `${MARGIN_MM}mm`, height: `${UNIT_LEGEND_MM}mm`, display: 'flex', flexWrap: 'wrap', gap: '1mm 4mm', alignContent: 'center', fontSize: '8pt' }}>
        {units.map(u => (
          <span key={u.formationId} style={{ display: 'inline-flex', alignItems: 'center', gap: '1.5mm' }}>
            <i style={{ width: '5mm', height: '3mm', background: u.colour, border: `0.3pt solid ${ink}` }} />{u.name}
          </span>
        ))}
      </div>
      {/* right column */}
      <div style={{ position: 'absolute', left: `${g.rightColumnLeftMm}mm`, top: `${MARGIN_MM}mm`, width: `${RIGHT_COLUMN_MM}mm`, height: `${g.paperHeightMm - 2 * MARGIN_MM}mm` }}>
        <div data-testid="sheet-map-box" style={{ height: `${MAP_HEIGHT_MM}mm`, border: `0.3pt solid ${ink}`, overflow: 'hidden', position: 'relative', background: '#f1efe8' }}>{map}</div>
        <div data-testid="sheet-project-legend" style={{ marginTop: `${MAP_LEGEND_GAP_MM}mm`, fontSize: '7.5pt', lineHeight: 1.35 }}>
          {payload.map.legend.map(row => (
            <div key={row.projectKey} style={{ display: 'flex', gap: '1.5mm', alignItems: 'baseline' }}>
              <i style={{ width: '2.5mm', height: '2.5mm', borderRadius: '50%', background: projectColour(row.colourIndex), border: `0.3pt solid ${ink}`, flex: 'none', transform: 'translateY(0.2mm)' }} />
              <span><b>{row.projectKey === NO_PROJECT_KEY ? t('sheet.legend.noProject') : row.projectKey}</b> <span style={{ color: '#5b6673', fontFamily: 'ui-monospace, monospace', fontSize: '7pt' }}>{row.codes.join(' · ')}</span></span>
            </div>
          ))}
          <div style={{ color: '#5b6673', fontSize: '6.5pt', marginTop: '1mm' }}>{t('sheet.legend.projects')}</div>
        </div>
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: `${SCALE_LINE_MM}mm` }}>
          <TitleBlock fields={payload.settings.fields} heightMm={TITLE_BLOCK_MM} />
        </div>
        <div data-testid="sheet-scale-line" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, fontSize: '8pt', fontFamily: 'ui-monospace, monospace', whiteSpace: 'pre' }}>
          {t('sheet.scaleLine', { h: g.printedH, v: g.printedV, vex: Math.round(g.vexEffective * 10) / 10 })}
        </div>
      </div>
      <div style={{ position: 'absolute', left: `${MARGIN_MM + 1}mm`, bottom: `${MARGIN_MM - 3.5}mm`, fontSize: '6.5pt', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#8a9098' }}>
        StrixGeo · {t(distanceKey(payload.settings.spacing))}
      </div>
    </div>
  )
}
