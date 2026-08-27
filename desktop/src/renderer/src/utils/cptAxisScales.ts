// DOV-standard CPT plot axis scales — the ONE source for every surface that
// promises "the same axes as the cpt plot" (owner ruling 2026-08-27 on the
// per-unit statistics dogfeed: "Qc/fs/rf should start at zero, u can use the
// same axes as the cpt plot").
//
// These were private constants inside ``CptChart.tsx`` since Phase 2; the
// per-unit distribution panels are the second consumer, which is the
// extraction trigger (CLAUDE.md "extract on the second copy"). ``CptChart``
// imports them back, so the chart and every panel claiming its axes cannot
// drift apart.
//
// WHY FIXED, NOT DATA-DRIVEN. The values are the DOV report convention —
// every printed sondering in Flanders uses qc 0–40 MPa, fs 0–1 MPa,
// Rf 0–10 %, u2 −100–300 kPa — so an engineer's eye is calibrated to them.
// A data-driven axis makes every hole (and every unit) look the same width;
// the fixed scale is what makes two plots comparable at a glance.
//
// NOT unified here on purpose: the SECTION column's channel scales
// (``components/sections/cptChannels.ts`` — qc with a section-wide step-up,
// fs at 0.5 MPa) are a deliberately different call for a deliberately
// different surface (a 40-px strip beside a column). Do not fold them in.

/** Cone resistance axis: 0 → 40 MPa. */
export const QC_AXIS_MAX_MPA = 40
/** qc tick positions, MPa. */
export const QC_AXIS_TICKS_MPA: readonly number[] = [0, 5, 10, 15, 20, 25, 30, 35, 40]

/** Sleeve friction axis: 0 → 1 MPa. */
export const FS_AXIS_MAX_MPA = 1
/** fs tick positions, MPa. */
export const FS_AXIS_TICKS_MPA: readonly number[] = [0, 0.2, 0.4, 0.6, 0.8, 1.0]

/** Friction ratio axis: 0 → 10 %. */
export const RF_AXIS_MAX_PCT = 10
/** Rf tick positions, %. */
export const RF_AXIS_TICKS_PCT: readonly number[] = [0, 2, 4, 6, 8, 10]

/** Pore pressure axis lower bound, kPa (suction reads negative). */
export const U2_AXIS_MIN_KPA = -100
/** Pore pressure axis upper bound, kPa. */
export const U2_AXIS_MAX_KPA = 300
/** u2 tick positions, kPa. */
export const U2_AXIS_TICKS_KPA: readonly number[] = [-100, 0, 100, 200, 300]
