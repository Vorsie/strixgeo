// CPT data-channel toggles for the section panel.
//
// Each channel is a mini-plot rendered inside a column when its
// toggle is on. Defaults follow DOV PDF convention: qc + Rf on,
// fs / u2 off (specialists), q_total on for CPTM (mechanical
// cones report it as the primary signal).
//
// State persists in ``section.view_state.cpt_channels`` so closing
// and reopening keeps the user's last view. Read with sensible
// fallbacks via ``readCptChannels`` — never crashes on a hand-
// edited / migrated bundle.

export interface CptChannels {
  qc: boolean
  rf: boolean
  fs: boolean
  u2: boolean
  /** q_total only renders on CPTM kind; toggle is global but the
   * column code gates per-kind. Default-on for CPTM, off-by-coverage
   * for CPTU/CPTE (no q_total in those). */
  qTotal: boolean
}

export const DEFAULT_CPT_CHANNELS: CptChannels = {
  qc: true,
  rf: true,
  fs: false,
  u2: false,
  qTotal: true,
}

/** Per-channel pixel widths for the data tracks. Used by both the
 * width-aware nudge (to know how wide each column is) and the
 * renderer (to position the qc curve / Rf strip relative to the
 * column centerline). Tight defaults — geotech sections benefit
 * from compactness. */
export const CPT_CHANNEL_WIDTH_PX: Record<keyof CptChannels, number> = {
  qc: 18,
  rf: 8,
  fs: 6,
  u2: 6,
  qTotal: 8,
}

/**
 * Compute the visible pixel width of a CPT column based on the
 * enabled channels + the CPT's kind (CPTU / CPTE / CPTM). The
 * bare cap+tie width is added upstream; this returns just the
 * data-track contribution.
 */
export function cptDataTrackWidth(
  cptType: string | null | undefined,
  channels: CptChannels,
): number {
  let w = 0
  if (channels.qc) w += CPT_CHANNEL_WIDTH_PX.qc
  if (channels.rf) w += CPT_CHANNEL_WIDTH_PX.rf
  // fs / u2 only apply to CPTU / CPTE (mechanical CPTM doesn't
  // measure them). The toggle stays global; the rendered width
  // honours kind.
  if (channels.fs && (cptType === 'CPTU' || cptType === 'CPTE')) {
    w += CPT_CHANNEL_WIDTH_PX.fs
  }
  if (channels.u2 && cptType === 'CPTU') {
    w += CPT_CHANNEL_WIDTH_PX.u2
  }
  // q_total is CPTM-only.
  if (channels.qTotal && cptType === 'CPTM') {
    w += CPT_CHANNEL_WIDTH_PX.qTotal
  }
  return w
}

/** Parse the persisted channel toggles out of a section's
 * ``view_state`` JSONB bag. Out-of-range / missing values fall
 * back to the documented defaults so a hand-edited bundle can't
 * render an invisible or saturated panel. */
export function readCptChannels(
  viewState: Record<string, unknown> | null | undefined,
): CptChannels {
  if (!viewState || typeof viewState !== 'object') return { ...DEFAULT_CPT_CHANNELS }
  const raw = (viewState as Record<string, unknown>).cpt_channels
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_CPT_CHANNELS }
  const dict = raw as Record<string, unknown>
  function readBool(key: keyof CptChannels): boolean {
    const v = dict[key]
    return typeof v === 'boolean' ? v : DEFAULT_CPT_CHANNELS[key]
  }
  return {
    qc: readBool('qc'),
    rf: readBool('rf'),
    fs: readBool('fs'),
    u2: readBool('u2'),
    qTotal: readBool('qTotal'),
  }
}
