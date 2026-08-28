/**
 * Per-user hidden-track set for the BoreholeLog detail view.
 *
 * Persisted to ``localStorage`` under a global (not project-scoped) key
 * because track visibility is a personal UI preference — the same
 * engineer always wants to see the same columns regardless of which
 * project they're working on. This matches how ``groundmodel.sidebar.sort``
 * is handled.
 *
 * The depth axis (mTAW / depth column) is never included in this set;
 * the spine is structurally mandatory and the toggle UI never offers it.
 *
 * On corrupt or unknown storage entries: unknown track ids are silently
 * ignored so future builds can rename ids without crashing on old data.
 * Non-array values are treated as empty (no hidden tracks).
 */

import { usePersistedJSON } from './usePersistedJSON'
import type { Translator } from '../i18n/translate'

// ---------------------------------------------------------------------------
// Canonical track id vocabulary
// ---------------------------------------------------------------------------

/**
 * Every data track that CAN be hidden by the user.
 *
 * Observation tracks use their ``observation_type`` token as the id.
 * The three fixed tracks use a short descriptive slug.
 */
export const TOGGLEABLE_TRACK_IDS = [
  // Observation tracks — match ``observation_type`` tokens exactly.
  'coded_lithology',
  'geotechnical_coding',
  'lithological_description',
  'formal_stratigraphy',
  'informal_stratigraphy',
  'quaternary_stratigraphy',
  'hydrogeological_stratigraphy',
  'informal_hydrogeological_stratigraphy',
  // Fixed borelog tracks.
  'drill_method',
  'field_log',
  'samples_lab',
] as const

export type ToggleableTrackId = (typeof TOGGLEABLE_TRACK_IDS)[number]

// ---------------------------------------------------------------------------
// Human labels for the Columns dropdown
// ---------------------------------------------------------------------------

/**
 * Translated display label shown in the Columns dropdown for each track id.
 *
 * The track id is a stored/matched token (observation_type or a fixed slug) and
 * is never altered — only the rendered label is translated. The three fixed
 * tracks reuse the same ``borelog.*`` keys the track headers use, so the
 * dropdown and the header never disagree.
 *
 * @param t - Active-language translator.
 * @param id - The track id whose label to render.
 */
export function trackLabel(t: Translator, id: ToggleableTrackId): string {
  switch (id) {
    case 'drill_method':
      return t('borelog.drillMethod')
    case 'field_log':
      return t('borelog.fieldLog')
    case 'samples_lab':
      return t('borelog.samplesAndLabTests')
    case 'coded_lithology':
      return t('borelog.obs.coded_lithology')
    case 'geotechnical_coding':
      return t('borelog.obs.geotechnical_coding')
    case 'lithological_description':
      return t('borelog.obs.lithological_description')
    case 'formal_stratigraphy':
      return t('borelog.obs.formal_stratigraphy')
    case 'informal_stratigraphy':
      return t('borelog.obs.informal_stratigraphy')
    case 'quaternary_stratigraphy':
      return t('borelog.obs.quaternary_stratigraphy')
    case 'hydrogeological_stratigraphy':
      return t('borelog.obs.hydrogeological_stratigraphy')
    case 'informal_hydrogeological_stratigraphy':
      return t('borelog.obs.informal_hydrogeological_stratigraphy')
  }
}

// ---------------------------------------------------------------------------
// Storage key + parse guard
// ---------------------------------------------------------------------------

/** Global (not project-scoped) localStorage key for the hidden-track set. */
export const BORELOG_HIDDEN_TRACKS_KEY = 'groundmodel.borelog.hidden_tracks'

const VALID_IDS = new Set<string>(TOGGLEABLE_TRACK_IDS)

/**
 * Parse raw JSON from localStorage into a validated ``Set<ToggleableTrackId>``.
 *
 * Unknown track ids are silently ignored (forward-compat: a future build
 * may rename or remove a track; old stored ids simply evaporate). Non-
 * array values (corrupt storage, manual edits) fall back to empty set.
 *
 * Parameters
 * ----------
 * raw : unknown
 *     Parsed JSON value from localStorage.
 *
 * Returns
 * -------
 * Set<ToggleableTrackId>
 *     Validated set; never contains ids outside TOGGLEABLE_TRACK_IDS.
 */
export function parseHiddenTracks(raw: unknown): Set<ToggleableTrackId> {
  if (!Array.isArray(raw)) return new Set()
  const valid = raw.filter(
    (v): v is ToggleableTrackId => typeof v === 'string' && VALID_IDS.has(v),
  )
  return new Set(valid)
}

const serializeHiddenTracks = (set: Set<ToggleableTrackId>): unknown => [...set]

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * React hook — global localStorage-backed set of hidden borelog track ids.
 *
 * Returns the current hidden set and a stable setter. The set is
 * initialised from localStorage on mount; every change is immediately
 * persisted. Corrupt or unknown entries are silently discarded on load
 * (see ``parseHiddenTracks``).
 *
 * The setter accepts either a new ``Set<ToggleableTrackId>`` directly, or
 * an updater function ``(prev: Set<ToggleableTrackId>) => Set<ToggleableTrackId>``
 * — matching the ``Dispatch<SetStateAction<T>>`` contract from
 * ``usePersistedJSON``.
 *
 * Returns
 * -------
 * readonly [Set<ToggleableTrackId>, Dispatch<SetStateAction<Set<ToggleableTrackId>>>]
 *     Tuple of (hiddenTracks, setHiddenTracks).
 */
export function useHiddenBoreholeLogTracks(): readonly [
  Set<ToggleableTrackId>,
  import('react').Dispatch<import('react').SetStateAction<Set<ToggleableTrackId>>>,
] {
  const [hidden, setHidden] = usePersistedJSON<Set<ToggleableTrackId>>(
    BORELOG_HIDDEN_TRACKS_KEY,
    new Set<ToggleableTrackId>(),
    parseHiddenTracks,
    serializeHiddenTracks,
  )
  return [hidden, setHidden]
}
