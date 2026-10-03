/**
 * ONE MASS, ONE IDENTITY — what the render's two "is my neighbour the same
 * thing as me" passes compare.
 *
 * The seam-stroke pass (``sectionSeamStrokes``) keeps a hairline only where
 * the neighbour across an edge is something else; the dissolve pass
 * (``sectionFillGroups``) paints one ``<path>`` per same-thing body so a
 * merged mass composites once and shows no antialiasing hairline. Both used
 * the raw ``formationId``.
 *
 * On the LITHO axis the formation row IS the identity, so that was right.
 * On the GEOTECH axis it is not: legacy data keeps one formation ROW per
 * (nad_class, litho parent, geological parent) — that is how a band's
 * provenance survived — so a single packing class of one litho unit can live
 * under two row ids wherever its geological parent changes. The FILL already
 * knows this and merges such rows into one mass (the 2026-08-21 "one mass one
 * body" ruling, ``packingClassOf`` being its single translation point); the
 * two RENDER passes did not, so a mass that the engine had correctly welded
 * still drew a seam wherever its row id changed. Two litho UNITS are never one
 * mass (owner 2026-10-03: ZAND and ZAND (SL:M) never weld) — the class key
 * leads with the unit, so their contact keeps its seam.
 *
 * On the owner's real CS1 that is the vertical line down the right edge of
 * 1411-GEO-23/126-B3: the stack there matches row for row on both sides
 * except the top SILT·SF, which is one row under B3's own litho parent and
 * another under GEO-23/125-S9's.
 *
 * Collapsing on the class cannot lose a colour: geotech colour is
 * ``nadClassColor(nad_class)`` (``utils/nadClasses``), a pure function of the
 * class, so every row of one class already paints the same colour.
 *
 * Pure module — no I/O, no React.
 *
 * @module components/sections/sectionFillIdentity
 */

/**
 * The identity two adjacent fills are compared on.
 *
 * @param formationId The region's own formation row id.
 * @param packingClassByFormationId Geotech row → packing class key
 *   (``UNIT|SOIL|CLASS``),
 *   from the litho frame bundle. Absent on the litho axis, and absent for any
 *   formation that is not a geotech packing row.
 * @returns The packing class where the formation is a known geotech row, and
 *   the formation id itself otherwise — so the litho axis is untouched.
 */
export function fillIdentityOf(
  formationId: string,
  packingClassByFormationId: ReadonlyMap<string, string> | undefined,
): string {
  return packingClassByFormationId?.get(formationId) ?? formationId
}
