/**
 * Behavioural tests for the section bed-override clip (owner question
 * 2026-09-07: "does the canal fill also cut out in the litho model?").
 *
 * The rule, in the owner's words: inside the canal polygon the litho fill stops
 * at the bed level in the section; outside every bed polygon nothing changes.
 * The clip is a render-layer cut built from the section's ground+bed DEM line
 * (already fetched with the bed applied through `/dem/sample?project_id`), and
 * it is a no-op — byte-identical — when the section crosses no bed polygon.
 */

import { describe, expect, it } from "vitest";

import { buildBedClipPath, type BedClipParams } from "./sectionBedClip";

/** Parse an SVG path `d` of only M/L commands into `[x, y]` points. */
function parsePoints(d: string): Array<[number, number]> {
  return d
    .trim()
    .split(/(?=[ML])/)
    .map((tok) => tok.trim())
    .filter((tok) => tok.length > 0 && (tok[0] === "M" || tok[0] === "L"))
    .map((tok) => {
      const [x, y] = tok.slice(1).trim().split(",").map(Number);
      return [x, y] as [number, number];
    });
}

// A W-E section 100 m long along y=0; identity along→X so screen X == along_m.
// levelToScreen maps elevation → Y with the usual "up is a smaller Y": elev 5 m
// (natural ground) sits at 50, the dredged bed at -4 m sits at 140.
const LEVEL_TO_SCREEN = (elev: number): number => (10 - elev) * 10;
const NATURAL = 5;
const BED = -4;

// A canal bed at -4 m over the map strip x in [35, 65], drawn slightly wider
// than the sampled interior points (40, 50, 60) so those samples fall STRICTLY
// inside — a sample exactly on a polygon edge is a boundary case the ray-cast
// does not decide either way (matching the backend's `_point_in_ring`).
const CANAL: BedClipParams["polygons"][number] = {
  level_m: BED,
  vertices: [
    [35, -10],
    [65, -10],
    [65, 10],
    [35, 10],
  ],
};

/** 11 DEM samples every 10 m; the ones inside the canal carry the bed level. */
function demSamples(): BedClipParams["samples"] {
  const out: Array<{ along_m: number; elevation_m: number | null }> = [];
  for (let a = 0; a <= 100; a += 10) {
    // The backend has already substituted the bed level inside the polygon.
    const inside = a >= 40 && a <= 60;
    out.push({ along_m: a, elevation_m: inside ? BED : NATURAL });
  }
  return out;
}

function baseParams(overrides: Partial<BedClipParams> = {}): BedClipParams {
  return {
    samples: demSamples(),
    sectionStartX: 0,
    sectionStartY: 0,
    sectionEndX: 100,
    sectionEndY: 0,
    polygons: [CANAL],
    alongToScreenX: (a: number) => a,
    levelToScreen: LEVEL_TO_SCREEN,
    plotLeft: 0,
    plotRight: 100,
    plotTop: 0,
    plotBottom: 200,
    ...overrides,
  };
}

describe("buildBedClipPath — the canal cut-out", () => {
  it("inside the canal polygon the clip top sits at the bed level, not the plot top", () => {
    const d = buildBedClipPath(baseParams());
    expect(d).not.toBeNull();
    const pts = parsePoints(d as string);
    const bedY = LEVEL_TO_SCREEN(BED); // 140

    // The three DEM samples inside the canal (x = 40, 50, 60) become the clip's
    // top edge AT THE BED LEVEL — the fill above them is cut away.
    for (const x of [40, 50, 60]) {
      expect(pts).toContainEqual([x, bedY]);
    }
    // The clip top never rises above the bed anywhere in the canal range: no
    // point with 40 <= x <= 60 sits above the bed line (a smaller Y).
    for (const [x, y] of pts) {
      if (x > 40 && x < 60) expect(y).toBeGreaterThanOrEqual(bedY - 1e-6);
    }
  });

  it("outside every bed polygon the clip stays at the plot top (nothing is cut)", () => {
    const d = buildBedClipPath(baseParams());
    const pts = parsePoints(d as string);
    // The top edge reaches the plot top at both section ends, so the fill left
    // and right of the canal is not cut at all.
    expect(pts).toContainEqual([0, 0]); // plotLeft, plotTop
    expect(pts).toContainEqual([100, 0]); // plotRight, plotTop
    // The ONLY points that dip below the plot top (and above the plot bottom)
    // are the bed line inside the canal range — nothing outside it is cut.
    for (const [x, y] of pts) {
      if (y > 0 && y < 200) {
        expect(x).toBeGreaterThanOrEqual(40);
        expect(x).toBeLessThanOrEqual(60);
      }
    }
  });

  it("returns null when the section crosses no bed polygon (byte-identical no-op)", () => {
    expect(buildBedClipPath(baseParams({ polygons: [] }))).toBeNull();
  });

  it("returns null when no DEM sample falls inside a bed polygon", () => {
    // A canal far off the section line: every reconstructed sample point is
    // outside it, so there is nothing to cut and the clip is a no-op.
    const faraway: BedClipParams["polygons"][number] = {
      level_m: BED,
      vertices: [
        [40, 1000],
        [60, 1000],
        [60, 1010],
        [40, 1010],
      ],
    };
    expect(buildBedClipPath(baseParams({ polygons: [faraway] }))).toBeNull();
  });
});
