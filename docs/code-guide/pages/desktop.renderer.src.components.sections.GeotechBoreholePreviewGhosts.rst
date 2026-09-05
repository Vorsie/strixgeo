desktop.renderer.src.components.sections.GeotechBoreholePreviewGhosts
=====================================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/GeotechBoreholePreviewGhosts.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/GeotechBoreholePreviewGhosts.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-92

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/GeotechBoreholePreviewGhosts.tsx
   :language: tsx
   :lines: 1-92
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the large file that draws ghost packing bands over borehole columns not yet divided on the geotech axis — a preview of what 'Divide boreholes' would write, before the button is pressed. The imports pull in React hooks, the preview and layer data types, a preview-summary store, the NAD-class helpers, the generic menu, and geometry helpers.

**Why it is here.** The gap it closes (owner dogfeed 2026-08-04): correlation bands were not drawn over boreholes, so there was no way to see what dividing them would do before clicking. The bands are drawn from the server's dry run of the same planner the commit uses, and a backend parity gate asserts the preview matches the commit band for band. A borehole that already carries committed bands is a re-divide, drawn as an outline-only diff over the committed band rather than a solid overpaint (debt #269).

.. CG-EXPLANATION-END id=module-header

``const TIERS``
---------------

.. CG-BLOCK id=const:TIERS lines=93-98

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/GeotechBoreholePreviewGhosts.tsx
   :language: tsx
   :lines: 93-98
   :lineno-match:

.. CG-EXPLANATION-START id=const:TIERS

**What this does.** A constant holding the visual weights per confidence level: a strong tier (more opaque fill, sparser hatch) and a weak tier (lighter fill, denser hatch).

**Why it is here.** A class a neighbouring CPT actually resolved and a conservative lithology-floor guess must not look identical on a feature whose whole purpose is 'what packing does this borehole get' — so weaker evidence reads lighter and more heavily hatched, a difference that survives without hovering. The strong fill opacity matches the litho pending-ghost default so a preview carries the same weight on both axes.

.. CG-EXPLANATION-END id=const:TIERS

``type Tier``
-------------

.. CG-BLOCK id=type:Tier lines=99-101

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/GeotechBoreholePreviewGhosts.tsx
   :language: tsx
   :lines: 99-101
   :lineno-match:

.. CG-EXPLANATION-START id=type:Tier

**What this does.** A type naming the two allowed tier keys — strong or weak.

**Why it is here.** It ties the tier value to the two entries in ``TIERS`` so only a real tier can be named.

.. CG-EXPLANATION-END id=type:Tier

``const LABEL_FONT_SIZE``
-------------------------

.. CG-BLOCK id=const:LABEL_FONT_SIZE lines=102-104

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/GeotechBoreholePreviewGhosts.tsx
   :language: tsx
   :lines: 102-104
   :lineno-match:

.. CG-EXPLANATION-START id=const:LABEL_FONT_SIZE

**What this does.** A constant — the text size of the in-band NAD label.

**Why it is here.** It matches the litho ghost label so the two previews read alike.

.. CG-EXPLANATION-END id=const:LABEL_FONT_SIZE

``const LABEL_MIN_HEIGHT_PX``
-----------------------------

.. CG-BLOCK id=const:LABEL_MIN_HEIGHT_PX lines=105-114

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/GeotechBoreholePreviewGhosts.tsx
   :language: tsx
   :lines: 105-114
   :lineno-match:

.. CG-EXPLANATION-START id=const:LABEL_MIN_HEIGHT_PX

**What this does.** A constant — the smallest band height at which the label is still drawn.

**Why it is here.** Below this the label is unreadable, so it is suppressed.

.. CG-EXPLANATION-END id=const:LABEL_MIN_HEIGHT_PX

``const MIN_DRAWN_HEIGHT_PX``
-----------------------------

.. CG-BLOCK id=const:MIN_DRAWN_HEIGHT_PX lines=115-125

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/GeotechBoreholePreviewGhosts.tsx
   :language: tsx
   :lines: 115-125
   :lineno-match:

.. CG-EXPLANATION-START id=const:MIN_DRAWN_HEIGHT_PX

**What this does.** A constant — the floor height, one pixel, for a drawn band.

**Why it is here.** A planned band with no pixels would read as 'nothing is planned at this depth', the one thing this overlay must never imply; a hairline in the right place is a truthful, if imprecise, answer.

.. CG-EXPLANATION-END id=const:MIN_DRAWN_HEIGHT_PX

``const PROVENANCE_PROSE``
--------------------------

.. CG-BLOCK id=const:PROVENANCE_PROSE lines=126-133

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/GeotechBoreholePreviewGhosts.tsx
   :language: tsx
   :lines: 126-133
   :lineno-match:

.. CG-EXPLANATION-START id=const:PROVENANCE_PROSE

**What this does.** A constant dictionary mapping each provenance token the planner emits (interpolated from CPTs, weakest class in the body, lithology floor, loosest class the column measured) to a plain sentence.

**Why it is here.** It is exhaustive over the tokens this build knows; an unknown token is shown verbatim rather than given a default sentence, because describing an unrecognised provenance as 'no CPT evidence' could state something false about the evidence behind an engineering class.

.. CG-EXPLANATION-END id=const:PROVENANCE_PROSE

``function donorDistance``
--------------------------

.. CG-BLOCK id=function:donorDistance lines=134-147

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/GeotechBoreholePreviewGhosts.tsx
   :language: tsx
   :lines: 134-147
   :lineno-match:

.. CG-EXPLANATION-START id=function:donorDistance

**What this does.** A helper that formats a donor test's distance and side into a short string like '5 m left' or '256 m'.

**Why it is here.** It gives the engineer the distance and side of the test the machine listened to, so the preview names its evidence concretely.

.. CG-EXPLANATION-END id=function:donorDistance

``function donorProse``
-----------------------

.. CG-BLOCK id=function:donorProse lines=148-170

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/GeotechBoreholePreviewGhosts.tsx
   :language: tsx
   :lines: 148-170
   :lineno-match:

.. CG-EXPLANATION-START id=function:donorProse

**What this does.** A helper that builds a donor-aware provenance sentence for one band — naming the actual test or tests and their distances — or nothing when the band carries no donor fields.

**Why it is here.** Naming the actual tests lets the engineer go and look at the CPT the machine listened to, instead of the older 'surrounding CPTs' phrasing that read as a consensus even when one donor 624 m away spoke alone.

.. CG-EXPLANATION-END id=function:donorProse

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=171-215

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/GeotechBoreholePreviewGhosts.tsx
   :language: tsx
   :lines: 171-215
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** The inputs: the per-borehole planned bands from the preview endpoint, the committed geotech layers and whether they currently reflect the server, the placed columns and coordinate converter, the plot bounds, and an optional per-column accept callback.

**Why it is here.** The 'loaded' flag matters because the model layer array is cleared to empty before every refetch and on a failed load; read literally, an empty array would claim no borehole is divided and put solid ghosts back over columns that already carry committed bands. While the flag is false the last known answer is used instead. The accept callback commits one column alone (right-click); absent, the ghosts stay a read-only overlay.

.. CG-EXPLANATION-END id=interface:Props

``interface GhostBand``
-----------------------

.. CG-BLOCK id=interface:GhostBand lines=216-226

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/GeotechBoreholePreviewGhosts.tsx
   :language: tsx
   :lines: 216-226
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GhostBand

**What this does.** The shape of one resolved ghost band in screen coordinates: its top depth, its Y and height, its fill colour, its tier, its label, and its tooltip title.

**Why it is here.** It is the per-band record the render draws from, resolved once so the drawing loop stays simple.

.. CG-EXPLANATION-END id=interface:GhostBand

``interface GhostColumn``
-------------------------

.. CG-BLOCK id=interface:GhostColumn lines=227-243

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/GeotechBoreholePreviewGhosts.tsx
   :language: tsx
   :lines: 227-243
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GhostColumn

**What this does.** The shape of one borehole column's ghost geometry: its investigation id, display name, left edge and width, its bands, and whether it is a re-divide.

**Why it is here.** The re-divide flag decides the whole draw: a re-divide is an outline-only diff over the committed band with no accept gesture, while a first divide keeps the solid hatched ghost and can be accepted (debt #269). The name lets the menu say which column it is about to divide.

.. CG-EXPLANATION-END id=interface:GhostColumn

``interface GhostMenuState``
----------------------------

.. CG-BLOCK id=interface:GhostMenuState lines=244-252

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/GeotechBoreholePreviewGhosts.tsx
   :language: tsx
   :lines: 244-252
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GhostMenuState

**What this does.** The shape of an open right-click menu over one ghosted column: its position, the investigation id, the name, and the band count.

**Why it is here.** It carries what the menu header shows and what the accept action needs.

.. CG-EXPLANATION-END id=interface:GhostMenuState

``interface Resolved``
----------------------

.. CG-BLOCK id=interface:Resolved lines=253-258

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/GeotechBoreholePreviewGhosts.tsx
   :language: tsx
   :lines: 253-258
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Resolved

**What this does.** The shape of everything one render needs: the resolved ghost columns plus a summary of what is hatched, for the toolbar.

**Why it is here.** Bundling the render data with the summary lets the same computation feed both the drawing and the toolbar's legend in one pass.

.. CG-EXPLANATION-END id=interface:Resolved

``const NOTHING``
-----------------

.. CG-BLOCK id=const:NOTHING lines=259-284

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/GeotechBoreholePreviewGhosts.tsx
   :language: tsx
   :lines: 259-284
   :lineno-match:

.. CG-EXPLANATION-START id=const:NOTHING

**What this does.** A constant — the empty result returned when the overlay draws no band: no columns and a zero summary.

**Why it is here.** A single shared 'nothing drawn' value keeps the empty case clean and makes the toolbar publish a real zero rather than skip the update.

.. CG-EXPLANATION-END id=const:NOTHING

``function useCommittedBoreholeIds``
------------------------------------

.. CG-BLOCK id=function:useCommittedBoreholeIds lines=285-318

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/GeotechBoreholePreviewGhosts.tsx
   :language: tsx
   :lines: 285-318
   :lineno-match:

.. CG-EXPLANATION-START id=function:useCommittedBoreholeIds

**What this does.** A small custom *hook* — a reusable piece of component logic named ``useX`` — that returns the set of borehole ids already carrying committed geotech bands, falling back to the last known set while the layers do not reflect the server.

**Why it is here.** The already-divided columns are the ones drawn as a re-divide diff; holding the last known set through the mid-refetch window stops a divided column flickering back to a solid ghost over its committed band. The computation is deliberately idempotent so writing its remembered value during the calculation is safe under React's development-mode double-run.

.. CG-EXPLANATION-END id=function:useCommittedBoreholeIds

``function GeotechBoreholePreviewGhosts``
-----------------------------------------

.. CG-BLOCK id=function:GeotechBoreholePreviewGhosts lines=319-599

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/GeotechBoreholePreviewGhosts.tsx
   :language: tsx
   :lines: 319-599
   :lineno-match:

.. CG-EXPLANATION-START id=function:GeotechBoreholePreviewGhosts

**What this does.** The whole overlay component. It computes, per borehole, the ghost bands' screen geometry from the preview payload, marks each column as a first divide or a re-divide, and counts only the first-divide columns and bands for the toolbar summary. It publishes that summary, then draws the hatch patterns, each column's bands (solid hatched for a first divide, dashed outline-only for a re-divide), the in-band labels, and the right-click menu that commits one column.

**Why it is here.** Every position uses the nudged column X because column spacing warps the layout and a ghost from the raw projected distance would float off its borehole. The summary counts first divides only, because a re-divide diff is an outline, not a hatch, and counting it would light the 'Hatched = preview' legend for hatching not on screen. The band rect stays hit-testable so its tooltip can appear (a pointer-events-off ancestor kills every tooltip under it), a trade-off the docstring accepts knowingly since a ghosted column is an undivided borehole with nothing to click below.

.. CG-EXPLANATION-END id=function:GeotechBoreholePreviewGhosts

