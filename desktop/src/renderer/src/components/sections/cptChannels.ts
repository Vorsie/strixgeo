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
//   * qc: 0..40 MPa default (rightward from axis); the scale steps
//     up SECTION-WIDE (60/80/100/150/200/+50) when any CPT shows a
//     real thick layer above the current step — see
//     ``pickQcFullScaleMpa`` below. Gridlines at 10 MPa (interior
//     reference) and the right edge (= the active full scale).
//   * Rf: 0..10% (leftward from axis, mirrored), gridlines at 2 + 4 %.
//   * q_total: shares the qc scale (CPTM totaalweerstand).
//
// PER-CPT auto-scale is intentionally NOT done — DOV's whole point
// is that every column reads on the SAME scale so the eye can compare
// CPTs at a glance. The section-wide step-up preserves that contract
// while letting dense formations fit inside the band.
export const QC_FULL_SCALE_MPA = 40
export const RF_FULL_SCALE_PCT = 10

// Stepped upper bounds for the section-wide qc scale. The smallest
// step that no CPT exceeds (per the consecutive-samples rule) wins.
// Above 200 MPa we keep stepping by 50.
const QC_FULL_SCALE_STEPS_MPA = [40, 60, 80, 100, 150, 200] as const

// Consecutive-sample threshold. At a typical 2 cm CPT sampling
// interval, 20 samples ≈ 40 cm — enough to mean "real layer", not
// "transient spike". This is the user-visible trade-off knob: lower
// it and short hard bands start bumping the scale; raise it and
// only thick continuous layers do.
export const QC_CONSECUTIVE_THRESHOLD = 20

/**
 * Longest run of consecutive qc samples STRICTLY above ``threshold``
 * in a single CPT's depth series. Null / non-finite samples break
 * the run (gaps cannot fake a long high-qc layer).
 */
function longestConsecutiveAboveMpa(
  qc: ReadonlyArray<number | null | undefined> | null,
  threshold: number,
): number {
  if (!qc) return 0
  let best = 0
  let current = 0
  for (const v of qc) {
    if (v === null || v === undefined || !Number.isFinite(v) || v <= threshold) {
      current = 0
      continue
    }
    current += 1
    if (current > best) best = current
  }
  return best
}

/**
 * Section-wide qc full scale in MPa.
 *
 * Picks the smallest step in [40, 60, 80, 100, 150, 200, +50, ...]
 * such that no CPT in the section has ≥ ``consecutiveThreshold``
 * consecutive qc samples strictly above that step. The per-CPT
 * check (rather than aggregating across CPTs) ensures one CPT with
 * a real thick high-qc layer is honoured even when the rest of the
 * section is soft.
 *
 * Returns the DOV-convention default (40 MPa) for an empty section
 * or when no CPT shows a thick high-qc layer.
 */
export function pickQcFullScaleMpa(
  plots: ReadonlyArray<{ qc_mpa: ReadonlyArray<number | null | undefined> | null }>,
  consecutiveThreshold: number = QC_CONSECUTIVE_THRESHOLD,
): number {
  // Trigger threshold for stepping UP from a given scale: the MIDPOINT
  // between that scale and the next step. e.g. at scale 40 we only
  // step up when 20+ consecutive samples sit above 50 (= midpoint of
  // 40 and 60), not above 40 itself. Without this, a CPT with a 20-
  // sample run at 41-45 MPa would push the scale to 60 even though
  // the data clearly fits the 40 MPa range — dogfeed 2026-05-31:
  // "barely values above 30, why is it 60?".
  const triggerForStep = (idx: number): number => {
    const current = QC_FULL_SCALE_STEPS_MPA[idx]
    const next =
      idx + 1 < QC_FULL_SCALE_STEPS_MPA.length
        ? QC_FULL_SCALE_STEPS_MPA[idx + 1]
        : current + 50
    return (current + next) / 2
  }
  const triggersAt = (trigger: number): boolean =>
    plots.some(
      p => longestConsecutiveAboveMpa(p.qc_mpa, trigger) >= consecutiveThreshold,
    )
  for (let i = 0; i < QC_FULL_SCALE_STEPS_MPA.length; i += 1) {
    if (!triggersAt(triggerForStep(i))) return QC_FULL_SCALE_STEPS_MPA[i]
  }
  // Above the top of the table — keep stepping by 50 until the
  // consecutive-run rule no longer triggers. For a step S, the
  // trigger is the midpoint of S and the next step (S + 50), i.e.
  // S + 25.  When triggersAt(S + 25) is false we've found the
  // smallest 50-multiple scale the data fits within.
  let step = QC_FULL_SCALE_STEPS_MPA[QC_FULL_SCALE_STEPS_MPA.length - 1] + 50
  while (triggersAt(step + 25)) step += 50
  return step
}

/**
 * Half-width of the shared CPT band in px at the current horizontal
 * zoom. The band extends ±halfWidth from the column axis (so total
 * pixel width is ``2 * halfWidth``).
 *
 * ``scaleH`` is px-per-metre on the horizontal axis. At a typical
 * Strix layout (300 m section in a 1500 px canvas) the resting zoom
 * is ~5 px/m → factor 1.0 → halfWidth = 24 px (48 px total band).
 * Below ~3 px/m the floor (factor 0.6) keeps columns legible; above
 * ~30 px/m the cap (factor 6.0) prevents truly runaway band widths
 * but still gives plenty of headroom for high-zoom inspection
 * (dogfeed 2026-05-31: previous 3.0× cap was hit too early and
 * locked the wheel-zoom refuse-stretch guard sooner than the user
 * wanted, so they couldn't zoom in further).
 */
export function cptBandHalfWidth(scaleH: number): number {
  const factor = Math.max(0.6, Math.min(6.0, scaleH / 5))
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
  /**
   * ``coded_lithology`` observation — DOV's gecodeerde lithologie, the raw
   * coded log (soil codes + admixtures + colour per layer).
   *
   * Re-added 2026-09-21 (issue #17). It had been dropped as "not worth
   * cross-referencing", but that only holds for a borehole which HAS a
   * ``geotechnical_coding`` stream to cross-reference against. A borehole whose
   * only stream is gecodeerde lithologie drew a bare column, with no way to
   * reach its log at all. Default OFF, so existing sections are unchanged.
   */
  lithology: boolean
  /** ``geotechnical_coding`` observation — what most engineers cite. */
  geotech: boolean
  /** ``formal_stratigraphy`` observation. */
  formal_strat: boolean
  /** ``informal_stratigraphy`` observation. */
  informal_strat: boolean
  // NOTE: ``lithological_description`` and ``quaternary_stratigraphy`` were
  // toggles in an earlier turn but the user dropped them — neither carries
  // ``main_soil_codes``, so the detail panel is the better home for them.
  // ``coded_lithology`` was dropped with them and came back (issue #17): see
  // the field doc above.
  //
  // ``drill_method`` (a borehole-header field, not an observation)
  // and ``field_log`` (separate intervals array with its own kinds)
  // are intentional gaps — both need a different column-render than
  // the strip model.
}

export const DEFAULT_BOREHOLE_CHANNELS: BoreholeChannels = {
  // OFF by default (owner, 2026-09-21): turning it on would change how every
  // existing project's sections look on open. The engineer clicks it on.
  lithology: false,
  geotech: true,
  formal_strat: false,
  informal_strat: false,
}

/** Mapping from channel key to the DOV ``observation_type`` value the
 * backend ships. Iteration order = display order in the band:
 * lithology → geotech → formal → informal, which is the DOV
 * "lengteprofiel" reading order (raw coded log first, then the
 * derived engineering streams). */
export const BOREHOLE_CHANNEL_OBSERVATION_TYPES: ReadonlyArray<
  [keyof BoreholeChannels, string]
> = [
  ['lithology', 'coded_lithology'],
  ['geotech', 'geotechnical_coding'],
  ['formal_strat', 'formal_stratigraphy'],
  ['informal_strat', 'informal_stratigraphy'],
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
    informal_strat: readBool('informal_strat'),
  }
}

/** Count of enabled borehole channels. The width-aware nudge layout
 * uses this to compute how many strip-widths a borehole column
 * occupies, so adjacent columns get pushed apart proportionally.
 *
 * Walks the SAME list ``BoreholeColumn`` draws its strips from, so the
 * footprint can never be narrower than the band: the coded-lithology
 * stream came back (PR #18) as a fourth strip but was not counted here,
 * and at a small column spacing the band overlapped its neighbour
 * (owner's dogfeed 2026-09-22). */
export function enabledBoreholeChannelCount(channels: BoreholeChannels): number {
  return BOREHOLE_CHANNEL_OBSERVATION_TYPES.filter(([key]) => channels[key]).length
}

// ---------------------------------------------------------------------------
// Snap-to-stratigraphy — click-to-place sticky boundaries.
// ---------------------------------------------------------------------------
//
// When the user clicks on a borehole's lithology strip to drop a
// formation top, the click depth gets adjusted toward the nearest
// ``formal_stratigraphy`` / ``informal_stratigraphy`` layer
// boundary (top or base) if one is within an 8 px tolerance on
// screen. Lets engineers snap contacts to known geological breaks
// without zooming to pixel-precision. Off by default — engineers
// who want free placement keep the raw depth.
//
// Persists in ``section.view_state.snap_to_stratigraphy`` so the
// preference rides the .strix file the same way channel toggles
// do.

export const SNAP_TOLERANCE_PX = 8

export function readSnapToStratigraphy(
  viewState: Record<string, unknown> | null | undefined,
): boolean {
  if (!viewState || typeof viewState !== 'object') return false
  const raw = (viewState as Record<string, unknown>).snap_to_stratigraphy
  return typeof raw === 'boolean' ? raw : false
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
