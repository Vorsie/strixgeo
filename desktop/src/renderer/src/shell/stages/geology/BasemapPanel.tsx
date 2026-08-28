/**
 * Basemap picker panel for ``Geology3DViewer`` (extracted, debt #201 round 2).
 */
import * as Cesium from 'cesium'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BasemapSource, BasemapId } from '../../../utils/basemapSources'
import { BASEMAP_SOURCES, readBasemapId, writeBasemapId } from '../../../utils/basemapSources'
import { useT } from '../../../i18n/translate'

// Basemap picker panel
// ---------------------------------------------------------------------------

export interface BasemapPanelProps {
  activeBasemapId: BasemapId
  onSelect: (id: BasemapId) => void
}

/**
 * Small basemap picker overlay rendered in the top-right corner of a
 * Cesium widget container.
 *
 * Mirrors the visual style of MapView's basemap selector so switching
 * between the 2D and 3D views does not change the UI chrome.
 *
 * Parameters
 * ----------
 * activeBasemapId
 *     Currently active basemap id.
 * onSelect
 *     Called when the user picks a different basemap.
 *
 * Returns
 * -------
 * JSX.Element
 *     The basemap picker panel.
 */
export function BasemapPanel({ activeBasemapId, onSelect }: BasemapPanelProps): JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(false)

  return (
    <div className="absolute top-2 right-2 z-10">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={[
          'flex items-center gap-1 px-2 py-1 rounded text-xs font-medium',
          'bg-surface-overlay/80 backdrop-blur-sm text-text-secondary border border-border-default shadow-sm',
          'hover:bg-surface-overlay transition-colors',
        ].join(' ')}
        title={t('geology.switchBasemap')}
      >
        {BASEMAP_SOURCES.find(b => b.id === activeBasemapId)?.label ?? t('geology.basemap')}
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1 bg-surface-overlay border border-border-default rounded shadow-lg min-w-40 py-1 z-20">
          {BASEMAP_SOURCES.map(b => (
            <button
              key={b.id}
              type="button"
              onClick={() => {
                onSelect(b.id)
                setOpen(false)
              }}
              className={[
                'w-full text-left px-3 py-1.5 text-xs',
                b.id === activeBasemapId
                  ? 'font-semibold text-accent bg-surface-card'
                  : 'text-text-secondary hover:bg-surface-card',
              ].join(' ')}
            >
              {b.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
