desktop.renderer.src.components.sections.GeotechBandEditOverlay
===============================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/GeotechBandEditOverlay.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/GeotechBandEditOverlay.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-76

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/GeotechBandEditOverlay.tsx
   :language: tsx
   :lines: 1-76
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the large file for the hand-edit gesture surface for packing sub-bands on the geotech section axis. It lets the engineer split a packing band, merge adjacent ones, drag their shared boundary, remove a band into a neighbour, set a borehole band's class, absorb an enclosed lens, and join or un-join bodies from a column. The imports pull in React hooks, the layer type, and the pure band-edit rules, lens-suggestion, NAD-class, join, and geometry helpers.

**Why it is here.** The geotech render is otherwise view-only (``docs/design/geotech-stage.md``): the partition overlay suppresses every freedraw path there and contacts cannot be created, dragged, or deleted. This overlay is a deliberate, bounded hole in that closed gate — its verbs go through their own endpoints, which re-derive the NAD class from the cone resistance rather than moving a contact. The gesture shape is mirrored from the litho axis, but the persistence is not: these bands are committed rows and every edit is a server round-trip. Nothing here decides anything geological — the clamp, the absorb prediction, and the merge eligibility are pure rules in ``geotechBandEdit.ts``; this file is only the hit targets, the live lines, and the menu.

.. CG-EXPLANATION-END id=module-header

``const MERGE_HANDLE_PX``
-------------------------

.. CG-BLOCK id=const:MERGE_HANDLE_PX lines=77-98

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/GeotechBandEditOverlay.tsx
   :language: tsx
   :lines: 77-98
   :lineno-match:

.. CG-EXPLANATION-START id=const:MERGE_HANDLE_PX

**What this does.** A constant — the height in pixels of the strip that sits on a shared band boundary, used for both dragging and right-clicking it.

**Why it is here.** A fixed grab height for the boundary strip.

.. CG-EXPLANATION-END id=const:MERGE_HANDLE_PX

``const BAND_HIT_INSET_PX``
---------------------------

.. CG-BLOCK id=const:BAND_HIT_INSET_PX lines=99-107

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/GeotechBandEditOverlay.tsx
   :language: tsx
   :lines: 99-107
   :lineno-match:

.. CG-EXPLANATION-START id=const:BAND_HIT_INSET_PX

**What this does.** A constant — how far in pixels a per-band press target stops short of the band's own top and bottom edges.

**Why it is here.** The band rect is the last thing painted, so covering its own boundaries made it win over the litho contact lines beneath, where it owns no mousedown — the press then bubbled to the canvas and started a pan, and the contact drag could never begin. Six pixels clears the litho grab strip (five pixels either side of the line) with one pixel of slack. A band too short for a press target loses nothing, because every pixel of it is already inside one of the two boundary grab strips.

.. CG-EXPLANATION-END id=const:BAND_HIT_INSET_PX

``const CAPTURE_WIDTH_PX``
--------------------------

.. CG-BLOCK id=const:CAPTURE_WIDTH_PX lines=108-110

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/GeotechBandEditOverlay.tsx
   :language: tsx
   :lines: 108-110
   :lineno-match:

.. CG-EXPLANATION-START id=const:CAPTURE_WIDTH_PX

**What this does.** A constant — the very large width of the invisible rectangle that captures the cursor while a split boundary is being placed.

**Why it is here.** It is wider than any plausible viewport so the boundary keeps following the cursor horizontally; the SVG clips the overflow and the rect exists only while a placement is armed, so it never sits over the canvas at rest.

.. CG-EXPLANATION-END id=const:CAPTURE_WIDTH_PX

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=111-252

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/GeotechBandEditOverlay.tsx
   :language: tsx
   :lines: 111-252
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** The inputs — a large set: the geotech and litho layer rows, the placed columns and coordinate converters, the plot bounds, and the request callbacks for split, merge, move-boundary, absorb-lens, and set-class, plus the NAD-class and soil-code lookups, a small-lens threshold, a suspended flag, the unit-statistics jump, and the whole Join / Un-join wiring from a column.

**Why it is here.** Every action is optional so a verb appears only when its endpoint is wired — the no-affordance pattern. The docstrings pin the rulings: the class menu is built from the GROUND's soil family, never the band's current class, because a packing class describes one soil column ('the nad coupling is absolute', owner 2026-08-26); set-class is offered on borehole bands only because a CPT band's class is measured from its own qc; and the litho layers are passed as the hard walls a packing boundary never crosses.

.. CG-EXPLANATION-END id=interface:Props

``interface ColumnModel``
-------------------------

.. CG-BLOCK id=interface:ColumnModel lines=253-284

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/GeotechBandEditOverlay.tsx
   :language: tsx
   :lines: 253-284
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ColumnModel

**What this does.** The shape of one column's resolved geometry and stacks: its investigation id, its left and right edges, its surface Y and vertical scale, the packing bands, the litho bodies, the boundaries where a merge or drag is legal, the boundaries that are litho contacts (where it is not), the screen extents of each grab strip, and the thin enclosed lenses that earn a badge.

**Why it is here.** Separating the mergeable boundaries from the litho contacts lets the overlay say which kind a boundary is (the hover padlock) and lets a strip stop short of a litho contact it must not treat as mergeable. The strip extents are allocated so neighbouring strips never overlap.

.. CG-EXPLANATION-END id=interface:ColumnModel

``interface SplitPlacement``
----------------------------

.. CG-BLOCK id=interface:SplitPlacement lines=285-296

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/GeotechBandEditOverlay.tsx
   :language: tsx
   :lines: 285-296
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SplitPlacement

**What this does.** The shape of a split boundary being placed by hand: the SVG's top edge captured when armed, the column, the litho body the boundary belongs to, the current depth, and whether and why it is clamped.

**Why it is here.** The litho body is fixed when the placement is armed because the boundary cannot leave it — owner ruling 2, that a packing boundary moves freely inside its litho body and clamps at the edge, which has to be felt while moving rather than discovered as a rejection afterwards.

.. CG-EXPLANATION-END id=interface:SplitPlacement

``interface BoundaryDrag``
--------------------------

.. CG-BLOCK id=interface:BoundaryDrag lines=297-310

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/GeotechBandEditOverlay.tsx
   :language: tsx
   :lines: 297-310
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BoundaryDrag

**What this does.** The shape of a boundary drag in progress: the SVG top edge, the column, the upper and lower bands, the pre-drag depth (the no-op guard and undo anchor), the current depth, whether it is at a limit, and which neighbour it would absorb.

**Why it is here.** The pre-drag depth is the anchor a drag is undone against, and the absorb field predicts that squeezing a neighbour below its minimum turns the release into a merge ('Absorb, like litho', owner).

.. CG-EXPLANATION-END id=interface:BoundaryDrag

``interface RemoveSeed``
------------------------

.. CG-BLOCK id=interface:RemoveSeed lines=311-317

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/GeotechBandEditOverlay.tsx
   :language: tsx
   :lines: 311-317
   :lineno-match:

.. CG-EXPLANATION-START id=interface:RemoveSeed

**What this does.** The shape of a remove-band target: the upper and lower band ids and their shared boundary depth.

**Why it is here.** Removing a band is a merge into a neighbour, so it carries the pair and their boundary — the boundary being the anchor a re-split would restore.

.. CG-EXPLANATION-END id=interface:RemoveSeed

``type MenuState``
------------------

.. CG-BLOCK id=type:MenuState lines=318-387

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/GeotechBandEditOverlay.tsx
   :language: tsx
   :lines: 318-387
   :lineno-match:

.. CG-EXPLANATION-START id=type:MenuState

**What this does.** A *type* describing the several shapes an open right-click menu can take — a split menu (with its placement seed, the two absorb options, an enclosed-lens option, and the unit's identifiers), a merge menu, or a set-class menu (with the band's current class, its own soil family's legal classes, and any foreign class shown but not selectable).

**Why it is here.** A menu that lets you pick between distinct shapes is written as a union of those shapes so the code can only ever build a valid one. The set-class menu lists a foreign class (a legacy row from before the soil coupling was enforced) so the engineer can see the wrong state without being able to re-choose it, since choosing it would restate the thing that is wrong.

.. CG-EXPLANATION-END id=type:MenuState

``function depthAtClientY``
---------------------------

.. CG-BLOCK id=function:depthAtClientY lines=388-411

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/GeotechBandEditOverlay.tsx
   :language: tsx
   :lines: 388-411
   :lineno-match:

.. CG-EXPLANATION-START id=function:depthAtClientY

**What this does.** A helper function that converts a cursor's viewport Y into a depth below one column's collar, using the SVG's top edge and the column's surface Y and vertical scale.

**Why it is here.** It is the same arithmetic ``ContactsLayer`` uses for its band click-to-insert, kept as a named function because a window-level drag handler cannot reach the event's current target and must be handed the offset captured at mousedown.

.. CG-EXPLANATION-END id=function:depthAtClientY

``function GeotechBandEditOverlay``
-----------------------------------

.. CG-BLOCK id=function:GeotechBandEditOverlay lines=412-1473

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/GeotechBandEditOverlay.tsx
   :language: tsx
   :lines: 412-1473
   :lineno-match:

.. CG-EXPLANATION-START id=function:GeotechBandEditOverlay

**What this does.** The whole overlay component — a large gesture surface plus render. It resolves each column's bands, litho bodies, mergeable boundaries, litho contacts, and grab-strip extents; handles left-press-drag of a boundary (with a live clamp and absorb prediction), armed split placement (the boundary following the cursor), and left-click Join picks; and opens the split, merge, and set-class right-click menus. It draws the boundary grab strips, the live boundary line during a drag or placement, an enclosed-lens badge, and the menus.

**Why it is here.** The press target is only the thin boundary strip because a press anywhere else pans the section — a band-wide target would make every geotech column un-pannable (the owner's 2026-08-07 dogfeed that motivated the verb). Every position uses the nudged column X because column spacing is warped. When nothing is editable it renders nothing, so the axis stays exactly as view-only as before, and the whole surface drops its hit targets while another gesture (correlate mode) owns the canvas.

.. CG-EXPLANATION-END id=function:GeotechBandEditOverlay

