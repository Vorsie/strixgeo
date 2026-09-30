/**
 * Display names of borehole tracks, shared by the Tracks panel, its reset
 * confirmation and the interval editor's reference pane.
 */
import type { Translator } from '../../../i18n/translate'
import type { MessageKey } from '../../../i18n/locales/en'
import { FIELD_LOG_TRACK_KINDS, type BoreholeTrackSummary } from '../../../utils/boreholeTracks'

/** Translated name of a track kind (observation kinds reuse ``borelog.obs.*``). */
export function trackKindLabel(t: Translator, kind: string): string {
  if ((FIELD_LOG_TRACK_KINDS as readonly string[]).includes(kind)) {
    return t(`tracks.kind.${kind}` as MessageKey)
  }
  return t(`borelog.obs.${kind}` as MessageKey)
}

/** Translated provenance badge of a track ("DOV" / "Manual" / "Edited by hand"). */
export function trackBadgeLabel(t: Translator, track: BoreholeTrackSummary): string {
  return t(`tracks.badge.${track.badge}` as MessageKey)
}

/** A track's kind with its provenance, e.g. "Field log: colour (DOV)". */
export function trackLabel(t: Translator, track: BoreholeTrackSummary): string {
  return `${trackKindLabel(t, track.kind)} (${trackBadgeLabel(t, track)})`
}
