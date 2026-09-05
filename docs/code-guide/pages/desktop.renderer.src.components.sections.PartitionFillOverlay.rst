desktop.renderer.src.components.sections.PartitionFillOverlay
=============================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/PartitionFillOverlay.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/PartitionFillOverlay.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-173

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/PartitionFillOverlay.tsx
   :language: tsx
   :lines: 1-173
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the central overlay that fills the litho cross-section as a TRUE PARTITION between adjacent columns — a complete tiling where every point belongs to exactly one body, with no overlaps and no empty spaces. A partition here means the whole section is covered once, with no holes and no double-coverage. It imports React's hooks and a very long list of helpers: the partition engine selector, the apex- and contact-override builders, the strip-fill and seam-stroke builders, the geotech hierarchical fill, the litho-frame partition helpers, the ghost-handle probe, the drag-UX and correlate-on-drag helpers, the unbanded hatch, the shared unit-statistics menu, and the fill-opacity constants.

**Why it is here.** The docstring records why the whole thing exists (owner directive 5 June 2026): the 2-D section defines the 3-D model, so an overlap or gap in 2-D becomes one in 3-D. It replaced an earlier overlay that painted per-body bands and overpainted pinch triangles by z-order — a visual fake whose envelopes overlapped and left gaps. Here each gap is tiled by the engine so the tiling is structurally hole-free and overlap-free. It also names the three gesture surfaces that live here: lens-edge free-draw, matched-boundary free-draw, and the add-strip click that inserts or removes a control point.

.. CG-EXPLANATION-END id=module-header

``interface GeotechLithoFrame``
-------------------------------

.. CG-BLOCK id=interface:GeotechLithoFrame lines=174-205

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/PartitionFillOverlay.tsx
   :language: tsx
   :lines: 174-205
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GeotechLithoFrame

**What this does.** The named shape of the LITHO frame drawn over the geotech axis's own partition: the litho layer rows and their approved edges, the litho colour and soil maps, the geotech soil map, and the geotech class-key map.

**Why it is here.** The docstring cites owner ruling of 13 August 2026: the geotech axis no longer refines the litho partition by class — it runs the SAME partition engine over the geotech model's own columns and ties ('we only have more classes'), which is byte-for-byte the 3-D build's computation. The litho geometry stays visually authoritative, so this bundle lets the litho partition be built a second time and drawn as dark region outlines over the packing fills plus litho-colour fallback fills where the geotech model has no bands. Its presence means the view-only geotech axis, and the class map lets duplicate formation rows per geological parent read as one mass (owner 21 August 2026, 'one mass one body').

.. CG-EXPLANATION-END id=interface:GeotechLithoFrame

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=206-437

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/PartitionFillOverlay.tsx
   :language: tsx
   :lines: 206-437
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** The full set of inputs the overlay accepts: the accepted layers and their contact-correlation edges (the litho model's on the litho axis, the geotech model's on the geotech axis), the placed columns, the colour and label maps, the elevation-to-screen transform, the show-bands switch, the plot bounds, the stored per-body boundary shapes, the warp-aware along transform and its inverses, the persist-boundary and correlate-on-drag callbacks, the open-end stub length, the body list and body context-menu callback, the Join arm and its class and soil maps, the correlate-mode and selected/highlight switches, the geotech litho frame, the separated-pairs set, the axis mode, the jump-to-conflict and conflict-keys callbacks, and the litho and geotech unit-statistics handlers.

**Why it is here.** The comments record the load-bearing rules on many fields: the fill bands two units only when an APPROVED edge connects them (the trustworthy signal, versus the resolver's over-lumped body id, which only names identity not shape); the pinch wedges and their handles render regardless of the show-bands switch so the engineer can shape pinch-outs on a clean view then turn the fill on (owner 5 June 2026); correlate mode drops every interactive element to pointer-inert so clicks fall through to the correlate targets beneath (dogfeed 19 June 2026, 'can't connect two bottom markers'); and the jump-to-conflict callback carries a resolved screen x, not a gap index, because on the geotech axis the fill's gap axis is the litho frame's column list, not the caller's, so handing an index across that boundary would centre the wrong gap.

.. CG-EXPLANATION-END id=interface:Props

``const FILL_OPACITY``
----------------------

.. CG-BLOCK id=const:FILL_OPACITY lines=438-438

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/PartitionFillOverlay.tsx
   :language: tsx
   :lines: 438-438
   :lineno-match:

.. CG-EXPLANATION-START id=const:FILL_OPACITY

**What this does.** The see-through level of the main band fill, taken from the shared fill-opacity constant.

**Why it is here.** The comment: shared with the per-column band stack so the fill in the gaps and the fill over a column card are the same number by construction (owner: 'same transparency everywhere').

.. CG-EXPLANATION-END id=const:FILL_OPACITY

``const LENS_OPACITY``
----------------------

.. CG-BLOCK id=const:LENS_OPACITY lines=439-439

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/PartitionFillOverlay.tsx
   :language: tsx
   :lines: 439-439
   :lineno-match:

.. CG-EXPLANATION-START id=const:LENS_OPACITY

**What this does.** The see-through level of a lens fill, from the shared lens-opacity constant.

**Why it is here.** Same shared source as the band opacity, so a lens matches the rest of the fill's tone.

.. CG-EXPLANATION-END id=const:LENS_OPACITY

``const FALLBACK_COLOR``
------------------------

.. CG-BLOCK id=const:FALLBACK_COLOR lines=440-440

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/PartitionFillOverlay.tsx
   :language: tsx
   :lines: 440-440
   :lineno-match:

.. CG-EXPLANATION-START id=const:FALLBACK_COLOR

**What this does.** A neutral grey used when a region has no formation colour.

**Why it is here.** A region that cannot be coloured from the formation map still needs to paint something rather than leaving a hole.

.. CG-EXPLANATION-END id=const:FALLBACK_COLOR

``const EDGE_STUB_PX``
----------------------

.. CG-BLOCK id=const:EDGE_STUB_PX lines=441-441

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/PartitionFillOverlay.tsx
   :language: tsx
   :lines: 441-441
   :lineno-match:

.. CG-EXPLANATION-START id=const:EDGE_STUB_PX

**What this does.** The pixel length of the open-end stub when there is no plot edge to fill to, 64 px.

**Why it is here.** Gives the first and last column's open-ended units a fixed reach past the test when no plot edge is available to extend to.

.. CG-EXPLANATION-END id=const:EDGE_STUB_PX

``const OPEN_END_M``
--------------------

.. CG-BLOCK id=const:OPEN_END_M lines=442-458

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/PartitionFillOverlay.tsx
   :language: tsx
   :lines: 442-458
   :lineno-match:

.. CG-EXPLANATION-START id=const:OPEN_END_M

**What this does.** The default open-end stub length in metres, 5 m.

**Why it is here.** The fallback reach for an open-ended unit when the 'Open extent length' setting has not reached this overlay.

.. CG-EXPLANATION-END id=const:OPEN_END_M

``const LABEL_FONT_MIN``
------------------------

.. CG-BLOCK id=const:LABEL_FONT_MIN lines=459-459

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/PartitionFillOverlay.tsx
   :language: tsx
   :lines: 459-459
   :lineno-match:

.. CG-EXPLANATION-START id=const:LABEL_FONT_MIN

**What this does.** The smallest region-label font size, 8 px. The following constants (max, K, margin, char-width ratio) size and gate the label together.

**Why it is here.** The docstring explains the whole scheme: the font scales linearly with the region's on-screen height and is clamped between this minimum and the maximum, and a label is only drawn when it fits both vertically and horizontally, so short bands get smaller labels and never overflow.

.. CG-EXPLANATION-END id=const:LABEL_FONT_MIN

``const LABEL_FONT_MAX``
------------------------

.. CG-BLOCK id=const:LABEL_FONT_MAX lines=460-460

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/PartitionFillOverlay.tsx
   :language: tsx
   :lines: 460-460
   :lineno-match:

.. CG-EXPLANATION-START id=const:LABEL_FONT_MAX

**What this does.** The largest region-label font size, 13 px.

**Why it is here.** Caps the label on an unusually tall band so it does not become oversized.

.. CG-EXPLANATION-END id=const:LABEL_FONT_MAX

``const LABEL_FONT_K``
----------------------

.. CG-BLOCK id=const:LABEL_FONT_K lines=461-461

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/PartitionFillOverlay.tsx
   :language: tsx
   :lines: 461-461
   :lineno-match:

.. CG-EXPLANATION-START id=const:LABEL_FONT_K

**What this does.** The factor linking region height to font size in the clamp.

**Why it is here.** The docstring: chosen so a comfortably tall band yields a font close to the old fixed 11 px.

.. CG-EXPLANATION-END id=const:LABEL_FONT_K

``const LABEL_V_MARGIN``
------------------------

.. CG-BLOCK id=const:LABEL_V_MARGIN lines=462-463

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/PartitionFillOverlay.tsx
   :language: tsx
   :lines: 462-463
   :lineno-match:

.. CG-EXPLANATION-START id=const:LABEL_V_MARGIN

**What this does.** The vertical clearance, in pixels, a label needs beyond its font size before it is drawn.

**Why it is here.** Part of the show-if-it-fits gate — the band must be taller than the font plus this margin, so a label never touches the band edges.

.. CG-EXPLANATION-END id=const:LABEL_V_MARGIN

``const LABEL_CHAR_W_RATIO``
----------------------------

.. CG-BLOCK id=const:LABEL_CHAR_W_RATIO lines=464-465

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/PartitionFillOverlay.tsx
   :language: tsx
   :lines: 464-465
   :lineno-match:

.. CG-EXPLANATION-START id=const:LABEL_CHAR_W_RATIO

**What this does.** The approximate character width as a fraction of font size, 0.55.

**Why it is here.** The comment: a monospace estimate used to check whether the label's text fits the region's width before drawing it.

.. CG-EXPLANATION-END id=const:LABEL_CHAR_W_RATIO

``const BOUNDARY_R``
--------------------

.. CG-BLOCK id=const:BOUNDARY_R lines=466-466

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/PartitionFillOverlay.tsx
   :language: tsx
   :lines: 466-466
   :lineno-match:

.. CG-EXPLANATION-START id=const:BOUNDARY_R

**What this does.** The visible radius of a matched-boundary control-point handle, 3 px.

**Why it is here.** The small visible dot for a shared-boundary handle.

.. CG-EXPLANATION-END id=const:BOUNDARY_R

``const BOUNDARY_HIT_R``
------------------------

.. CG-BLOCK id=const:BOUNDARY_HIT_R lines=467-467

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/PartitionFillOverlay.tsx
   :language: tsx
   :lines: 467-467
   :lineno-match:

.. CG-EXPLANATION-START id=const:BOUNDARY_HIT_R

**What this does.** The invisible hit radius around a matched-boundary handle, 10 px.

**Why it is here.** A larger invisible target makes the small visible dot comfortably grabbable.

.. CG-EXPLANATION-END id=const:BOUNDARY_HIT_R

``const BOUNDARY_COLOR``
------------------------

.. CG-BLOCK id=const:BOUNDARY_COLOR lines=468-469

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/PartitionFillOverlay.tsx
   :language: tsx
   :lines: 468-469
   :lineno-match:

.. CG-EXPLANATION-START id=const:BOUNDARY_COLOR

**What this does.** The colour of the matched-boundary handles, sky/teal.

**Why it is here.** The comment further down records that this one teal is now the UNIFIED handle colour: the separate lens-handle amber was retired so the user cannot tell a lens edge from a contact edge by colour.

.. CG-EXPLANATION-END id=const:BOUNDARY_COLOR

``const LENS_R``
----------------

.. CG-BLOCK id=const:LENS_R lines=470-470

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/PartitionFillOverlay.tsx
   :language: tsx
   :lines: 470-470
   :lineno-match:

.. CG-EXPLANATION-START id=const:LENS_R

**What this does.** The visible radius of a lens-edge node handle, 5 px.

**Why it is here.** The visible dot for a lens-edge handle, from the same amber family as the old apex handle.

.. CG-EXPLANATION-END id=const:LENS_R

``const LENS_HIT_R``
--------------------

.. CG-BLOCK id=const:LENS_HIT_R lines=471-478

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/PartitionFillOverlay.tsx
   :language: tsx
   :lines: 471-478
   :lineno-match:

.. CG-EXPLANATION-START id=const:LENS_HIT_R

**What this does.** The invisible hit radius around a lens-edge handle, 11 px. The comment below introduces the minimum grab radius.

**Why it is here.** A larger invisible target makes the lens handle grabbable.

.. CG-EXPLANATION-END id=const:LENS_HIT_R

``const LENS_HIT_MIN_PX``
-------------------------

.. CG-BLOCK id=const:LENS_HIT_MIN_PX lines=479-486

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/PartitionFillOverlay.tsx
   :language: tsx
   :lines: 479-486
   :lineno-match:

.. CG-EXPLANATION-START id=const:LENS_HIT_MIN_PX

**What this does.** The minimum grab radius, in raw pixels, for a lens handle — 9 px, never smaller even when the handle scales down.

**Why it is here.** The docstring (section 76): the visible dot may shrink with zoom so a compressed section is not crowded, but the invisible hit target must never drop below a comfortably grabbable size, or a near-miss click slips past and the pan handler fires instead ('the pan fights the gesture', dogfeed 22 July 2026). Nine pixels keeps the target above the roughly 8-px Fitts-law floor even at the minimum handle scale.

.. CG-EXPLANATION-END id=const:LENS_HIT_MIN_PX

``const HANDLE_REF_PX_PER_M``
-----------------------------

.. CG-BLOCK id=const:HANDLE_REF_PX_PER_M lines=487-487

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/PartitionFillOverlay.tsx
   :language: tsx
   :lines: 487-487
   :lineno-match:

.. CG-EXPLANATION-START id=const:HANDLE_REF_PX_PER_M

**What this does.** The horizontal scale (pixels per along-metre) at or above which a handle is drawn full size, 2.5.

**Why it is here.** The comment: above this scale the handle is full size; zooming out shrinks it toward the minimum so the markers do not crowd a compressed section.

.. CG-EXPLANATION-END id=const:HANDLE_REF_PX_PER_M

``const HANDLE_MIN_SCALE``
--------------------------

.. CG-BLOCK id=const:HANDLE_MIN_SCALE lines=488-491

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/PartitionFillOverlay.tsx
   :language: tsx
   :lines: 488-491
   :lineno-match:

.. CG-EXPLANATION-START id=const:HANDLE_MIN_SCALE

**What this does.** The smallest fraction a handle shrinks to when zoomed out, 0.5.

**Why it is here.** Floors the visible handle size so it stays visible on a very compressed section.

.. CG-EXPLANATION-END id=const:HANDLE_MIN_SCALE

``const NODE_OWN_EPS``
----------------------

.. CG-BLOCK id=const:NODE_OWN_EPS lines=492-493

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/PartitionFillOverlay.tsx
   :language: tsx
   :lines: 492-493
   :lineno-match:

.. CG-EXPLANATION-START id=const:NODE_OWN_EPS

**What this does.** The pixel tolerance for deciding a lens node belongs to this gap — its along-x falls within the gap's screen extent.

**Why it is here.** The comment: a two-gap lens's apexes live in different gaps, so each gap renders and edits only its own node.

.. CG-EXPLANATION-END id=const:NODE_OWN_EPS

``const ADDSTRIP_HIT_W``
------------------------

.. CG-BLOCK id=const:ADDSTRIP_HIT_W lines=494-498

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/PartitionFillOverlay.tsx
   :language: tsx
   :lines: 494-498
   :lineno-match:

.. CG-EXPLANATION-START id=const:ADDSTRIP_HIT_W

**What this does.** The width, in pixels, of the transparent add-strip hit area along each boundary, 14 px.

**Why it is here.** Sets how close to a boundary a click must land to insert a new control point there.

.. CG-EXPLANATION-END id=const:ADDSTRIP_HIT_W

``const EMPTY_REGIONS``
-----------------------

.. CG-BLOCK id=const:EMPTY_REGIONS lines=499-504

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/PartitionFillOverlay.tsx
   :language: tsx
   :lines: 499-504
   :lineno-match:

.. CG-EXPLANATION-START id=const:EMPTY_REGIONS

**What this does.** A shared, frozen empty partition used as a stable base for the deferred ghost probe when there is no engine result yet.

**Why it is here.** The comment: a fresh empty array each render would defeat the ghost hook's content-key memoisation, so one frozen array is reused; it is never mutated.

.. CG-EXPLANATION-END id=const:EMPTY_REGIONS

``const EMPTY_CLASS_BY_LAYER``
------------------------------

.. CG-BLOCK id=const:EMPTY_CLASS_BY_LAYER lines=505-515

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/PartitionFillOverlay.tsx
   :language: tsx
   :lines: 505-515
   :lineno-match:

.. CG-EXPLANATION-START id=const:EMPTY_CLASS_BY_LAYER

**What this does.** A shared empty class-lookup map for the Join arm's cross-class guard.

**Why it is here.** The comment: an unset class map (the Separate arm or an older caller) must not mint a fresh map per render, and a missing class is silence to the join resolver (it commits and lets the write guard decide), so an empty map is the correct no-op default.

.. CG-EXPLANATION-END id=const:EMPTY_CLASS_BY_LAYER

``const MIN_VISIBLE_APEX_FRACTION``
-----------------------------------

.. CG-BLOCK id=const:MIN_VISIBLE_APEX_FRACTION lines=516-517

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/PartitionFillOverlay.tsx
   :language: tsx
   :lines: 516-517
   :lineno-match:

.. CG-EXPLANATION-START id=const:MIN_VISIBLE_APEX_FRACTION

**What this does.** The minimum visible lens reach a lens override may request, 8 percent of the gap.

**Why it is here.** The docstring: the engine only clamps to its geometric-legality bound, where a 2-percent reach is a hairline that reads as 'the lens disappeared' (owner 22 July 2026, 'i clicked the apex of the silt lens and it disappeared'); clamping symmetrically to at least 8 percent keeps both a left- and right-anchored lens visible, well below any real shaped lens so it never fights a deliberate shape.

.. CG-EXPLANATION-END id=const:MIN_VISIBLE_APEX_FRACTION

``const clamp01``
-----------------

.. CG-BLOCK id=const:clamp01 lines=518-520

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/PartitionFillOverlay.tsx
   :language: tsx
   :lines: 518-520
   :lineno-match:

.. CG-EXPLANATION-START id=const:clamp01

**What this does.** A tiny helper that clamps a value into 0 to 1.

**Why it is here.** Keeps a fraction-along-a-gap inside its legal range (0 at the left column, 1 at the right).

.. CG-EXPLANATION-END id=const:clamp01

``const clampVisibleApex``
--------------------------

.. CG-BLOCK id=const:clampVisibleApex lines=521-525

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/PartitionFillOverlay.tsx
   :language: tsx
   :lines: 521-525
   :lineno-match:

.. CG-EXPLANATION-START id=const:clampVisibleApex

**What this does.** A helper that clamps an apex fraction to the visible reach floor on both sides.

**Why it is here.** Applies the minimum-visible-reach floor so a lens tip stays visible whether anchored on the left or the right.

.. CG-EXPLANATION-END id=const:clampVisibleApex

``function PartitionFillOverlay``
---------------------------------

.. CG-BLOCK id=function:PartitionFillOverlay lines=526-4030

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/PartitionFillOverlay.tsx
   :language: tsx
   :lines: 526-4030
   :lineno-match:

.. CG-EXPLANATION-START id=function:PartitionFillOverlay

**What this does.** The very large component that turns the columns, correlations and stored shapes into the drawn partition. Above any early return it derives its mode flags (whether the axis is view-only, whether the body menu is allowed, and the pointer-events value for correlate mode), declares its drag and menu state and its refs, and defines a helper that reads SVG coordinates from a mouse event. It runs two document-level drag effects — one for dragging a node on a matched shared boundary, one for dragging a node on a lens edge — each of which live-updates the node and persists the full node array on release. It then assembles each column's gap-free unit stack and screen edges (through the shared assembly, twice on the geotech axis), builds the through-card column strip fills, and in one large memo (sectionFillData) builds the apex and contact overrides, runs the partition engine to get the regions, runs the geotech hierarchical fill and the litho-frame partition where those apply, and computes the crossing-tie conflicts and review flags. Further memos turn the world-coordinate regions into screen shapes, add the under-column substrate, compute the seam strokes and the dissolved fill groups, and build the shared-boundary and lens handle sets. Finally it returns the SVG: the dissolved fill groups, seam strokes, labels, open-end stubs, the boundary and lens handles, the add-strips, the crossing-tie warning chip, and the portalled unit-statistics menu.

**Why it is here.** The comments throughout record the load-bearing decisions. Every hook and ref sits above the early returns because a hook below a conditional return crashes React (the hook-order trap, debt #201). The geotech axis is view-only — no lens, boundary or body-editing gesture is wired there since editing lives in a separate overlay — but the body context menu is split out as its own flag so the view-only geotech axis can still open it without loosening any edit gate (owner ruling 31 August 2026). The unit-stack assembly is the SAME shared helper the fence and voxel builds use, so the on-screen partition and the 3-D builds assemble identical columns. The through-card strip fills go into the same dissolved layer as the gap regions so the fill cannot change tone at a card edge (owner 14 August 2026, 'same transparency everywhere'). The conflict callback reports keys, and the jump callback a screen x, because the receiver matches ties by identity while the pan needs an axis-translated position. The whole fill is display-only at its root (pointer-events none) and each interactive surface re-enables the mouse only where a gesture is allowed.

.. CG-EXPLANATION-END id=function:PartitionFillOverlay

