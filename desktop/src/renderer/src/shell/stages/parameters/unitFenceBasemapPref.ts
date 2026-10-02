// The fence cutout's basemap on/off, remembered per viewer (owner ruling C(a),
// 2026-10-02). UI chrome only, so localStorage — and every access is guarded:
// a private window / blocked site data must never break the cutout.

import { log } from '../../../utils/log'
import { UNIT_FENCE_BASEMAP_STORAGE_KEY } from './unitFenceSceneConstants'

/**
 * Read the remembered basemap state.
 *
 * Returns
 * -------
 * bool
 *     ``false`` only when the viewer last switched it off; ``true`` otherwise
 *     (the default, and the fallback when storage is unavailable).
 */
export function readUnitFenceBasemapOn(): boolean {
  try {
    return window.localStorage.getItem(UNIT_FENCE_BASEMAP_STORAGE_KEY) !== '0'
  } catch (err) {
    log.debug('params', 'fence cutout: basemap preference unreadable, default on', err)
    return true
  }
}

/**
 * Remember the basemap state for the next cutout.
 *
 * Parameters
 * ----------
 * on
 *     The new state.
 */
export function writeUnitFenceBasemapOn(on: boolean): void {
  try {
    window.localStorage.setItem(UNIT_FENCE_BASEMAP_STORAGE_KEY, on ? '1' : '0')
  } catch (err) {
    // Not remembered — the toggle still works for this session.
    log.debug('params', 'fence cutout: basemap preference not stored', err)
  }
}
