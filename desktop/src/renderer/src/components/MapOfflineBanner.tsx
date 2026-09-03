// Offline notice for the 2D investigation map (audit L9).
//
// When the browser reports no connectivity the basemap tiles fail to load and
// the map goes grey with no explanation. The 3D viewer already shows a banner
// for the same situation (``Geology3DViewer``); this gives the 2D map the same
// signal. Kept in its own Leaflet-free module so it is unit-testable without
// mounting the map — MapView drives ``online`` from ``useOnlineStatus()``.

import { useT } from '../i18n/translate'

/**
 * Bottom-centre "offline" banner, shown only when offline.
 *
 * Mirrors the 3D viewer's banner styling. Pointer-events-none so it never
 * intercepts a map drag through it.
 *
 * Parameters
 * ----------
 * online : boolean
 *     ``navigator.onLine`` state from ``useOnlineStatus``.
 *
 * Returns
 * -------
 * JSX.Element | null
 *     The banner when offline, ``null`` when online.
 */
export function MapOfflineBanner({ online }: { online: boolean }): JSX.Element | null {
  const t = useT()
  if (online) return null
  return (
    <div
      className="absolute bottom-2 left-1/2 -translate-x-1/2 z-[1000] bg-amber-50/95 dark:bg-amber-950/80 border border-status-amber rounded shadow-lg px-3 py-1.5 text-[11px] text-text-primary pointer-events-none flex items-center gap-2"
      role="status"
      data-testid="map-offline-banner"
    >
      <span aria-hidden="true">⚠</span>
      <span>{t('data.map.offline')}</span>
    </div>
  )
}
