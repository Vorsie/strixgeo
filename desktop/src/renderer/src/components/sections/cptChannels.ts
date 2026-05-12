// CPT data-channel toggles + zoom-responsive band geometry for the
// cross-section panel.
//
// Each CPT renders into ONE shared horizontal band centered on its
// column axis (= the column's nudged X). qc and Rf are the primary
// curves (qc reads right of axis, Rf mirrored left of axis); fs / u2
// overlay with their own scales when enabled. The DOV "lengteprofiel"
// PDF page 3 is the visual reference.
//
// Band width scales with the horizontal pixel-per-metre ratio so the
// curves stay readable across the zoom range — compact when the whole
// section is in view, wider when zoomed into a 30 m window. The
// width-aware column nudge (``utils/columnLayout.ts``) consumes the
// band width so adjacent CPTs respect each other's data footprints.

export interface CptChannels {
  qc: boolean
  rf: boolean
  /** fs (sleeve friction) — CPTU/CPTE specialist track. Off by
   * default; the DOV PDF doesn't show it, so neither do we until
   * the user asks. Overlays the same band as qc with its own
   * smaller full scale. */
  fs: boolean
  /** u2 (pore-water pressure) — CPTU-only. Off by default. Overlays
   * the mirrored (left-of-axis) side of the band with its own scale. */
  u2: boolean
  /** q_total (CPTM totaalweerstand). When enabled on a CPTM cone,
   * overlays the qc track as a dashed line on the qc scale. */
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
// markers + curve mappings drawn in ``CptDataColumn``.
//
//   * qc: 0..10 MPa (rightward from axis), gridlines at 2 + 10 MPa.
//   * Rf: 0..10% (leftward from axis, mirrored), gridlines at 2 + 4 %.
//
// Auto-scale per CPT is intentionally NOT done — DOV's whole point
// is that every column reads on the SAME scale so the eye can compare
// CPTs at a glance. Auto-scaling breaks that contract.
export const QC_FULL_SCALE_MPA = 10
export const RF_FULL_SCALE_PCT = 10
export const QT_FULL_SCALE_MPA = 10

/**
 * Half-width of the shared CPT band in px at the current horizontal
 * zoom. The band extends ±halfWidth from the column axis (so total
 * pixel width is ``2 * halfWidth``).
 *
 * ``scaleH`` is px-per-metre on the horizontal axis. At a typical
 * Strix layout (300 m section in a 1500 px canvas) the resting zoom
 * is ~5 px/m → factor 1.0 → halfWidth = 24 px (48 px total band).
 * Below ~3 px/m the floor (factor 0.6) keeps columns legible; above
 * ~15 px/m the cap (factor 3.0) prevents runaway widths at high zoom.
 */
export function cptBandHalfWidth(scaleH: number): number {
  const factor = Math.max(0.6, Math.min(3.0, scaleH / 5))
  return Math.round(24 * factor)
}

/**
 * Pixel width of the full shared band for a given CPT kind +
 * channel selection. The nudge layout consumes this so adjacent CPTs
 * respect each other's data footprints.
 *
 * Returns 0 when NO effectively-applicable channel is enabled (e.g.
 * only u2 is on but the cone is CPTE — pore-pressure doesn't apply,
 * so the CPT contributes only its bare column glyph width to the
 * layout). Otherwise returns ``2 * halfWidth`` — the band is the
 * same size regardless of which channels are inside it.
 */
export function cptBandFullWidth(
  cptType: string | null | undefined,
  channels: CptChannels,
  halfWidth: number,
): number {
  const anyApplicable =
    channels.qc ||
    channels.rf ||
    (channels.fs && (cptType === 'CPTU' || cptType === 'CPTE')) ||
    (channels.u2 && cptType === 'CPTU') ||
    (channels.qTotal && cptType === 'CPTM')
  return anyApplicable ? 2 * halfWidth : 0
}

// ---------------------------------------------------------------------------
// Column spacing — horizontal adjacency knob for crowded sections.
// ---------------------------------------------------------------------------
//
// Multiplier on the column width that is fed to the nudge layout
// (``nudgeColumns``). The VISUAL width of each column band stays the
// same regardless of this knob; only the layout's idea of "how much
// space each column claims" shrinks. At 0.0 the nudge thinks every
// column is zero-width, so adjacent tests render at their true
// projected X with overlapping bands. At 1.0 the nudge sees the full
// width and adjacent columns sit edge-to-edge with the standard
// edge gap — the current default behaviour.
//
// Why scale nudge-input width rather than visual width: the user
// wants control over WHERE columns sit on the section, not how wide
// they are. A narrower visual would hide qc/Rf and lithology; a
// narrower nudge-input lets dense tests pack closer (with visual
// overlap) while keeping each individual strip legible.
//
// Lives in ``section.view_state.column_spacing`` so the choice rides
// in the .gmproj bundle and survives reopens on another PC.

export const COLUMN_SPACING_MIN = 0.0
export const COLUMN_SPACING_MAX = 1.0
export const COLUMN_SPACING_DEFAULT = 1.0

export function readColumnSpacing(
  viewState: Record<string, unknown> | null | undefined,
): number {
  if (!viewState || typeof viewState !== 'object') return COLUMN_SPACING_DEFAULT
  const raw = (viewState as Record<string, unknown>).column_spacing
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return COLUMN_SPACING_DEFAULT
  return Math.max(COLUMN_SPACING_MIN, Math.min(COLUMN_SPACING_MAX, raw))
}

// ---------------------------------------------------------------------------
// Borehole interpretation toggles — which observation streams to show
// inside each borehole's column band on the cross-section.
// ---------------------------------------------------------------------------
//
// Maps DOV's observation_type values into 4 toggle slots. DOV records
// up to five streams per borehole (lithology, geotechnical coding,
// formal / quaternary / informal stratigraphy); the section view
// exposes the four engineers most often want to cross-reference, in
// the DOV "lengteprofiel" PDF page-3 reading order.
//
// Default: only ``geotech`` is on. Engineers reach for geotechnical
// coding first when building a ground model — it's the
// engineering-relevant ISO 14688 stream.
//
// User-requested behaviour: each enabled stream renders as its OWN
// strip side by side inside the band. The band auto-widens with N
// enabled, so the nudge layout pushes neighbours further out. See
// BoreholeColumn for the strip layout pass.

export interface BoreholeChannels {
  /** ``coded_lithology`` observation — granular ISO 14688 stream. */
  lithology: boolean
  /** ``geotechnical_coding`` observation — what most engineers cite. */
  geotech: boolean
  /** ``formal_stratigraphy`` observation. */
  formal_strat: boolean
  /** ``quaternary_stratigraphy`` observation. */
  quaternary: boolean
}

export const DEFAULT_BOREHOLE_CHANNELS: BoreholeChannels = {
  lithology: false,
  geotech: true,
  formal_strat: false,
  quaternary: false,
}

/** Mapping from channel key to the DOV ``observation_type`` value the
 * backend ships. Iteration order = display order in the band, so
 * lithology sits leftmost, geotech next, etc. */
export const BOREHOLE_CHANNEL_OBSERVATION_TYPES: ReadonlyArray<
  [keyof BoreholeChannels, string]
> = [
  ['lithology', 'coded_lithology'],
  ['geotech', 'geotechnical_coding'],
  ['formal_strat', 'formal_stratigraphy'],
  ['quaternary', 'quaternary_stratigraphy'],
]

export function readBoreholeChannels(
  viewState: Record<string, unknown> | null | undefined,
): BoreholeChannels {
  if (!viewState || typeof viewState !== 'object') return { ...DEFAULT_BOREHOLE_CHANNELS }
  const raw = (viewState as Record<string, unknown>).borehole_channels
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_BOREHOLE_CHANNELS }
  const dict = raw as Record<string, unknown>
  function readBool(key: keyof BoreholeChannels): boolean {
    const v = dict[key]
    return typeof v === 'boolean' ? v : DEFAULT_BOREHOLE_CHANNELS[key]
  }
  return {
    lithology: readBool('lithology'),
    geotech: readBool('geotech'),
    formal_strat: readBool('formal_strat'),
    quaternary: readBool('quaternary'),
  }
}

/** Count of enabled borehole channels. The width-aware nudge layout
 * uses this to compute how many strip-widths a borehole column
 * occupies, so adjacent columns get pushed apart proportionally. */
export function enabledBoreholeChannelCount(channels: BoreholeChannels): number {
  let n = 0
  if (channels.lithology) n += 1
  if (channels.geotech) n += 1
  if (channels.formal_strat) n += 1
  if (channels.quaternary) n += 1
  return n
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
