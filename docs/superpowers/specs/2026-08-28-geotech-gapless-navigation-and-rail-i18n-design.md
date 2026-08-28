# Geotech gapless navigation and rail localization

## Problem

The geotechnical build report currently fails its first guarantee for two
sub-millimetre area differences even though the rendered geotech ground has no
unpainted litho cover.  That report also sends the engineer to Sections without
selecting the geotechnical axis, then loses the visual reveal if the newly
mounted section panel is not ready after a fixed delay.  Separately, Dutch mode
does not localize the vertical workflow rail because its labels and summaries
are static English strings.

The model must preserve the lithology cover it derives from exactly.  A model
check must therefore report an actual missing or surplus patch, not an artefact
of a later rendering cleanup or an allowance tuned to its width.

## Scope and outcome

For a Dutch-speaking geotechnical engineer, selecting **Show me** for a
geotechnical report finding will open the named section on the geotechnical
axis, centre the exact span between its two investigations, and visibly mark
that span after its panel can honour the request.  A failed area-conservation
clause will mean the final geotech build geometry is genuinely not the litho
cover.

The left workflow rail will react immediately to language changes: stage
labels, hover/accessibility labels, its navigation landmark, and the selection
footer will all use the existing translation catalogues.  This change does not
attempt to translate unrelated Geotechnical-stage toolbar or report-banner
copy.

## Geometry contract

`computeHierarchicalGeotechFill` starts from litho regions, partitions them
into classed regions and litho fallback, then currently applies
`dropRegionNeedles` to the finished surfaces.  Removing an entire closed
sliver changes the emitted geometry and can make the summed output differ from
its source cover.

The build/accounting surfaces will retain every closed source-derived region.
Vertex cleanup may remove a zero-area reversal, but it may not remove a closed
region or alter its area.  Any visual seam suppression required for an
unpaintable hairline is a rendering concern and cannot delete model ground.
Clause 1 will compare the final classed plus fallback geometry with litho cover
at exact geometric precision; only a machine-rounding floor is permitted.  It
will not use a gap-width-derived geometric tolerance.

Tests will prove both sides of that contract: a thin but closed region remains
in the final coverage, while a materially missing region still fails clause 1.

## Deep-link delivery

`sectionsDeepLinkTarget` will include the destination section axis when a
caller needs one.  The geotech report will set that axis to `geotechnical`.
`AppShell` will set the axis before selecting the section and will retain the
request until the mounted section bridge reports a successful reveal.

The reveal attempt uses the bridge outcome as its condition, not a single
600-ms guess.  Repeated attempts stop immediately after success and remain
bounded; a final failure is logged with the missing columns/section and then
cleared so an unavailable panel cannot leave stale navigation state behind.
The two-column report case centres and flashes the span, never either endpoint.

Tests will cover the real route from the report callback through the shell,
including an initially unavailable bridge and the geotechnical-axis selection.

## Workflow rail localization

Stage descriptors will identify their display label by a typed message key.
`StageSpine` will translate that key through `useT`, which makes its visible
labels, tooltips, and ARIA labels subscribe to the device language setting.
The stage-summary hooks used for rail status will also use the same translator,
so dynamic counts and readiness state cannot fall back to English in Dutch.
The selection footer's complete text will likewise use catalogued messages.

English remains the source catalogue; Dutch adds matching translations with
identical interpolation keys.  Tests will toggle Dutch and assert both visible
rail text and accessibility labels, while retaining existing English coverage.

## Non-goals and safeguards

- Do not hide genuine area loss behind a larger tolerance.
- Do not change the owner's currently uncommitted fill work.
- Do not change the 3-D Geotechnical stage into the destination for a 2-D
  section finding; the destination is the Geotechnical axis of Sections.
- Do not translate unrelated Geotechnical toolbar/report surfaces in this
  change.

Focused Vitest suites, TypeScript checks, and a real app dogfood pass will
verify the resulting geometry, navigation, and Dutch rail output.
