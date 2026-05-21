// useOnlineStatus — subscribe to the browser's online/offline events.
//
// Returns the current value of ``navigator.onLine`` and re-renders the
// caller when the network state flips. Used by Geology3DViewer to show
// an "Offline — basemap unavailable" banner (debt #26) so the engineer
// understands the black globe is a network issue, not a broken viewer.
//
// Caveats:
//
// * ``navigator.onLine`` is true when the network *interface* is up —
//   it doesn't guarantee the basemap CDN is reachable. A captive
//   portal, an unreachable upstream, or a blocked CDN all leave
//   navigator.onLine === true but no tiles arrive. The banner targets
//   the most common case ("no signal on site"); fancier tile-fetch
//   instrumentation is Phase-5-or-later work.
//
// * SSR-safe — ``navigator`` and ``window`` are guarded so a future
//   server-rendered shell doesn't crash on import.

import { useEffect, useState } from 'react'

/**
 * Returns ``true`` when the browser believes it has network connectivity,
 * ``false`` when offline. Re-renders the caller on every transition.
 *
 * Returns
 * -------
 * boolean
 *     The current ``navigator.onLine`` value. Defaults to ``true`` in
 *     non-browser environments (SSR / tests without window) so callers
 *     don't render an "offline" banner during build.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(() => {
    if (typeof navigator === 'undefined') return true
    return navigator.onLine
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onOnline = (): void => setOnline(true)
    const onOffline = (): void => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  return online
}
