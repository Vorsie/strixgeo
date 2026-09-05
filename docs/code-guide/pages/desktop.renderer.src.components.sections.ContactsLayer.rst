desktop.renderer.src.components.sections.ContactsLayer
======================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/ContactsLayer.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/ContactsLayer.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-85

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/ContactsLayer.tsx
   :language: tsx
   :lines: 1-85
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the large file that draws formation contacts on the cross-section in two layers: per-column soil slabs (a horizontal top line plus a centred formation label for each unit) and cross-column formation surface polylines (one line per formation through every column that carries it). A *polyline* is a connected run of straight line segments. The imports pull in React hooks, the backend data types, a TIN-slicing helper, snap and geometry helpers, the sub-menus and dialogs, and the translation helper.

**Why it is here.** The comment records the design choice: engineers think in layer slabs, not point picks, so the old dot-per-contact affordance was replaced with slabs. The cross-column surface polyline is the formation SURFACE — the thing a downstream exporter like Plaxis actually wants — and is the value the section view adds over reading isolated borelogs one at a time.

.. CG-EXPLANATION-END id=module-header

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=86-496

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/ContactsLayer.tsx
   :language: tsx
   :lines: 86-496
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** The full input contract for this component — a large set of fields. In broad groups: the data (contacts, formations, and the placed columns to look positions up in); the coordinate converters (elevation-to-screen, and the warp-aware along-metre-to-screen mapping); the edit callbacks (update a depth, delete, batch-update for move, batch-create for copy); selection and box-select (marquee) state; the geological backdrop (reference formations, surfaces, and contacts drawn subordinately underneath); the axis mode and its per-axis visual switches; and the geotech-only clamp that stops a dragged boundary crossing the next packing boundary.

**Why it is here.** The size reflects that this one overlay serves all three model axes and every contact gesture. The prop docstrings pin the reasons individually: cross-column drag defaults to COPY (stamp a known-good interpretation onto a thin nearby test) and only becomes MOVE with Alt held; the along-metre mapping must be the warp-aware ``warpedXToScreen`` because the section's column spacing is deliberately stretched and a raw position would float off its column (the section-fill trap that has bitten three times); and the geological backdrop is subordinate, never hit-tested, and exempt from the explicit-content rule because it is surface geometry, not an editable contact.

.. CG-EXPLANATION-END id=interface:Props

``interface DragContact``
-------------------------

.. CG-BLOCK id=interface:DragContact lines=497-523

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/ContactsLayer.tsx
   :language: tsx
   :lines: 497-523
   :lineno-match:

.. CG-EXPLANATION-START id=interface:DragContact

**What this does.** The shape of one contact carried inside a drag: its id, its formation, its anchor column and kind, its original depth, the source column's surface position and vertical scale, and its display colour and formation name.

**Why it is here.** The formation is carried so the copy path can create new contacts with the right formation without re-querying; the source surface and scale are needed to work out the change in metres from the cursor movement when this contact was not the one explicitly grabbed.

.. CG-EXPLANATION-END id=interface:DragContact

``interface SnapCandidate``
---------------------------

.. CG-BLOCK id=interface:SnapCandidate lines=524-528

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/ContactsLayer.tsx
   :language: tsx
   :lines: 524-528
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SnapCandidate

**What this does.** The shape of one snap-target depth for a column: the depth, and optionally the id of the contact it came from.

**Why it is here.** Carrying the originating contact id lets the drag suppress self-snapping — excluding the dragged contact's own depth from its candidate list — so a small drag can actually budge the contact instead of being pulled straight back to its start (debt #136).

.. CG-EXPLANATION-END id=interface:SnapCandidate

``interface ContactCopyPayload``
--------------------------------

.. CG-BLOCK id=interface:ContactCopyPayload lines=529-537

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/ContactsLayer.tsx
   :language: tsx
   :lines: 529-537
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ContactCopyPayload

**What this does.** The shape of one new contact in a copy commit: its formation, its top depth, which column it belongs to (borehole or CPT), and its provenance and confidence.

**Why it is here.** It mirrors the create payload the backend expects, so the copy path can hand the parent a ready list to POST. Provenance and confidence are set so a copied pick records honestly where it came from.

.. CG-EXPLANATION-END id=interface:ContactCopyPayload

``interface DragState``
-----------------------

.. CG-BLOCK id=interface:DragState lines=538-612

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/ContactsLayer.tsx
   :language: tsx
   :lines: 538-612
   :lineno-match:

.. CG-EXPLANATION-START id=interface:DragState

**What this does.** The shape of a drag in progress — the large record the drag machinery keeps: which contact was grabbed, its anchor and surface geometry, the start cursor position, the latest dragged depth and whether it snapped, the live cursor position, whether and which way a clamp is engaging, what releasing now would do, the target column if the cursor crossed into one, every contact carried by the drag, whether Shift was held, and the cached display details for the floating readout.

**Why it is here.** A drag on this axis can mean several different commits — re-pick a depth, shift a whole multi-selection, copy or move across to another column, or paint a depth across intermediate columns — so all the facts needed to decide and preview the outcome live in one record updated each frame. The clamp and release fields exist because on the geotech axis a boundary is not free: it stops at the next packing boundary, and the record has to telegraph that live rather than snap back on release.

.. CG-EXPLANATION-END id=interface:DragState

``interface MarqueeState``
--------------------------

.. CG-BLOCK id=interface:MarqueeState lines=613-624

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/ContactsLayer.tsx
   :language: tsx
   :lines: 613-624
   :lineno-match:

.. CG-EXPLANATION-START id=interface:MarqueeState

**What this does.** The shape of a box-select drag: the start and current cursor positions, the drawing's offset, and whether the selection is additive (Shift or Ctrl was held at the start).

**Why it is here.** It is exported because the parent owns this state — the background capture rectangle must be painted before the column glyphs so it does not steal their clicks, which means it lives in the parent, not here. Additive marquee preserves the existing selection, matching the UX rule that a marquee always adds.

.. CG-EXPLANATION-END id=interface:MarqueeState

``const LAYER_LABEL_MIN_HEIGHT_PX``
-----------------------------------

.. CG-BLOCK id=const:LAYER_LABEL_MIN_HEIGHT_PX lines=625-628

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/ContactsLayer.tsx
   :language: tsx
   :lines: 625-628
   :lineno-match:

.. CG-EXPLANATION-START id=const:LAYER_LABEL_MIN_HEIGHT_PX

**What this does.** A constant — the smallest layer height, in screen pixels, at which a centred formation label is still drawn.

**Why it is here.** Below this height the label cannot be read, so the text is skipped while the top boundary line is still drawn — a truthful boundary without an unreadable label.

.. CG-EXPLANATION-END id=const:LAYER_LABEL_MIN_HEIGHT_PX

``const DRAG_HIT_HALF_HEIGHT_PX``
---------------------------------

.. CG-BLOCK id=const:DRAG_HIT_HALF_HEIGHT_PX lines=629-632

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/ContactsLayer.tsx
   :language: tsx
   :lines: 629-632
   :lineno-match:

.. CG-EXPLANATION-START id=const:DRAG_HIT_HALF_HEIGHT_PX

**What this does.** A constant — half the height, in pixels, of the invisible grab strip around each contact's top line.

**Why it is here.** It is wide enough that the thin line can be grabbed without precise aiming, yet narrow enough that adjacent layers do not fight for the same pointer.

.. CG-EXPLANATION-END id=const:DRAG_HIT_HALF_HEIGHT_PX

``const MIN_BAND_HIT_PX``
-------------------------

.. CG-BLOCK id=const:MIN_BAND_HIT_PX lines=633-642

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/ContactsLayer.tsx
   :language: tsx
   :lines: 633-642
   :lineno-match:

.. CG-EXPLANATION-START id=const:MIN_BAND_HIT_PX

**What this does.** A constant — the smallest comfortable clickable height for a per-column soil band.

**Why it is here.** Below this, thin bands borrow invisible clickable area from fatter neighbours so they stay grabbable (debt #158, via the ``allocateMinHitExpansions`` helper).

.. CG-EXPLANATION-END id=const:MIN_BAND_HIT_PX

``const REFERENCE_COINCIDENCE_EPSILON_M``
-----------------------------------------

.. CG-BLOCK id=const:REFERENCE_COINCIDENCE_EPSILON_M lines=643-648

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/ContactsLayer.tsx
   :language: tsx
   :lines: 643-648
   :lineno-match:

.. CG-EXPLANATION-START id=const:REFERENCE_COINCIDENCE_EPSILON_M

**What this does.** A constant — a tight one-centimetre depth window within which a geological reference contact counts as sitting on top of a litho contact on the same column.

**Why it is here.** The 'Snap litho / Move geo' flow leaves the two boundaries at the same depth without formally coupling them; when that happens the reference grab strip is suppressed so it cannot sit over the litho drag strip and eat its hover. The window is deliberately tight so it targets only the snap-produced exact coincidence, never a genuinely-distinct nearby geological boundary (#159).

.. CG-EXPLANATION-END id=const:REFERENCE_COINCIDENCE_EPSILON_M

``const LITHO_CONTACT_LINE_COLOR``
----------------------------------

.. CG-BLOCK id=const:LITHO_CONTACT_LINE_COLOR lines=649-652

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/ContactsLayer.tsx
   :language: tsx
   :lines: 649-652
   :lineno-match:

.. CG-EXPLANATION-START id=const:LITHO_CONTACT_LINE_COLOR

**What this does.** A constant — a near-black colour for a litho contact boundary line.

**Why it is here.** A litho band is filled with its soil colour, and drawing the boundary in that same colour made the accepted contact vanish into the band; near-black reads against every soil pastel (#143). It is a raw hex value because this file writes SVG attributes directly, which cannot use the usual colour tokens.

.. CG-EXPLANATION-END id=const:LITHO_CONTACT_LINE_COLOR

``const LITHO_CONTACT_HALO_COLOR``
----------------------------------

.. CG-BLOCK id=const:LITHO_CONTACT_HALO_COLOR lines=653-660

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/ContactsLayer.tsx
   :language: tsx
   :lines: 653-660
   :lineno-match:

.. CG-EXPLANATION-START id=const:LITHO_CONTACT_HALO_COLOR

**What this does.** A constant — a light halo colour painted behind the litho contact line.

**Why it is here.** On the darker soil fills (clay blue-grey, peat dark brown) the near-black line alone would muddy, so a slightly wider light halo behind it keeps the boundary readable.

.. CG-EXPLANATION-END id=const:LITHO_CONTACT_HALO_COLOR

``const PACKING_BOUNDARY_LINE_COLOR``
-------------------------------------

.. CG-BLOCK id=const:PACKING_BOUNDARY_LINE_COLOR lines=661-664

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/ContactsLayer.tsx
   :language: tsx
   :lines: 661-664
   :lineno-match:

.. CG-EXPLANATION-START id=const:PACKING_BOUNDARY_LINE_COLOR

**What this does.** A constant — a mid-slate colour for an internal packing boundary on the geotech axis (a subdivision within one soil unit rather than a boundary between two).

**Why it is here.** Dash and width alone did not let the owner tell the two kinds apart at working zoom, so the packing boundary also drops to a mid-slate that reads as clearly subordinate to the near-black contact — the line weight carries the hierarchy (geological, then litho, then geotech) without needing to be measured.

.. CG-EXPLANATION-END id=const:PACKING_BOUNDARY_LINE_COLOR

``const CLICK_TO_DRAG_THRESHOLD_PX``
------------------------------------

.. CG-BLOCK id=const:CLICK_TO_DRAG_THRESHOLD_PX lines=665-666

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/ContactsLayer.tsx
   :language: tsx
   :lines: 665-666
   :lineno-match:

.. CG-EXPLANATION-START id=const:CLICK_TO_DRAG_THRESHOLD_PX

**What this does.** A constant — the drag distance below which a marquee or drag is treated as a plain click, with no commit.

**Why it is here.** It mirrors the existing zero-movement release rule: a tiny wobble should not be read as a deliberate drag and should change nothing.

.. CG-EXPLANATION-END id=const:CLICK_TO_DRAG_THRESHOLD_PX

``function ContactsLayer``
--------------------------

.. CG-BLOCK id=function:ContactsLayer lines=667-3714

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/ContactsLayer.tsx
   :language: tsx
   :lines: 667-3714
   :lineno-match:

.. CG-EXPLANATION-START id=function:ContactsLayer

**What this does.** The whole component — a large drag-and-selection state machine plus the render. It computes the per-column layer slabs and the cross-column polylines from the contacts, builds the geological backdrop lines, and manages contact selection, box-select, and the multi-mode drag: re-pick a depth on the same column, shift a whole selection, copy or move across to another column (Alt chooses move), paint a depth across intermediate columns, snap to stratigraphy or geological boundaries, and on the geotech axis clamp to the next packing boundary. It also owns the contact and litho-band right-click menus, the delete confirm dialog, and the live drag readout, then draws the backdrop, the bands, the slab lines with their grab strips, the polylines, and any open menu or marquee preview.

**Why it is here.** Everything routes through drawn correlations and explicit picks — the fill follows the engineer's own boundaries, never a geometric guess. Every screen position uses the warp-aware transform because column spacing is stretched (the trap the module and ``docs/design/section-fill.md`` both flag). The drag is suppressed in correlate mode so it cannot compete with the correlation overlay's boundary clicks, and the geotech clamp telegraphs the boundary limit live rather than showing a landing it will not honour and reporting the refusal only afterwards. Deletes go through a styled confirm because a database delete is irreversible per the UX rule.

.. CG-EXPLANATION-END id=function:ContactsLayer

