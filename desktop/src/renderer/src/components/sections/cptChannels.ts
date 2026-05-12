// CPT data-channel toggles + zoom-responsive track widths for the
// cross-section panel.
//
// Channels match DOV's "lengteprofiel" PDF: qc curve (0-10 MPa) and
// Rf curve (0-10%) are the primary tracks; fs / u2 / q_total are
// off by default and surface via a toggle when the user needs them.
//
// Track widths scale with the horizontal pixel-per-metre ratio so
// the curves stay readable across the zoom range — narrow when the
// whole section is in view, wider when zoomed into a 30 m window.
// The width-aware column nudge (``utils/columnLayout.ts``) consumes
// the per-column width so adjacent CPTs respect each other's data
// footprints.

export interface CptChannels {
  qc: boolean
  rf: boolean
  /** fs (sleeve friction) — CPTU/CPTE specialist track. Off by
   * default; the DOV PDF doesn't show it, so neither do we until
   * the user asks. */
  fs: boolean
  /** u2 (pore-water pressure) — CPTU-only. Off by default. */
  u2: boolean
  /** q_total (CPTM totaalweerstand). When both qc and qTotal are on
   * for a CPTM, q_total overlays the qc track as a dashed line. When
   * qc is OFF, q_total gets a standalone line slot. */
  qTotal: boolean
}

export const DEFAULT_CPT_CHANNELS: CptChannels = {
  qc: true,
  rf: true,
  fs: false,
  u2: false,
  qTotal: true,
}

// DOV PDF scale conventions — keep these in sync with the gridline
// markers drawn in ``CptDataColumn``.
//
//   * qc: 0..10 MPa, dashed gridline at 2 MPa (DOV's reference).
//   * Rf: 0..10%, dashed gridlines at 2% and 4% (DOV convention).
//
// Auto-scale per CPT is intentionally NOT done — DOV's whole point
// is that every column reads on the SAME scale so the eye can
// compare CPTs at a glance. Auto-scaling breaks that contract.
export const QC_FULL_SCALE_MPA = 10
export const RF_FULL_SCALE_PCT = 10
export const QT_FULL_SCALE_MPA = 10

/**
 * Compute zoom-responsive pixel widths for each track.
 *
 * ``scaleH`` is px-per-metre on the horizontal axis. At a typical
 * Strix layout (300 m section in a 1500 px canvas) the resting zoom
 * is ~5 px/m; at 1.5× zoom it's ~7.5 px/m; at 3× zoom ~15 px/m. The
 * widths are clamped so a fully-zoomed-out section keeps columns
 * compact enough to coexist, and a fully-zoomed-in section gives
 * the curves enough horizontal space that the user can read peaks.
 *
 * Returns widths in px for every channel. The enabled-subset sum
 * for a specific CPT kind is in ``cptDataTrackWidth``.
 */
export function cptTrackWidths(
  scaleH: number,
): Record<keyof CptChannels, number> {
  // Anchor at scaleH = 5 px/m → factor 1.0. Below ~3 px/m we
  // collapse to a floor; above ~15 px/m we cap.
  const factor = Math.max(0.6, Math.min(3.0, scaleH / 5))
  return {
    qc: Math.round(28 * factor),
    rf: Math.round(18 * factor),
    fs: Math.round(14 * factor),
    u2: Math.round(14 * factor),
    qTotal: Math.round(18 * factor),
  }
}

/**
 * Sum of the enabled-channel widths for a given CPT kind. The
 * width-aware nudge consumes this so adjacent CPTs respect each
 * other's data footprints.
 */
export function cptDataTrackWidth(
  cptType: string | null | undefined,
  channels: CptChannels,
  widths: Record<keyof CptChannels, number>,
): number {
  let w = 0
  if (channels.qc) w += widths.qc
  if (channels.rf) w += widths.rf
  if (channels.fs && (cptType === 'CPTU' || cptType === 'CPTE')) {
    w += widths.fs
  }
  if (channels.u2 && cptType === 'CPTU') {
    w += widths.u2
  }
  // q_total only adds a separate slot when qc is OFF. When both are
  // on, q_total overlays the qc track and contributes no new width.
  if (channels.qTotal && cptType === 'CPTM' && !channels.qc) {
    w += widths.qTotal
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
