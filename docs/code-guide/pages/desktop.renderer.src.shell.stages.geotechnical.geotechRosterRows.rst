desktop.renderer.src.shell.stages.geotechnical.geotechRosterRows
================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/geotechnical/geotechRosterRows.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/geotechnical/geotechRosterRows.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-47

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/geotechRosterRows.tsx
   :language: tsx
   :lines: 1-47
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the file holding the two row renderers for the geotech unit roster: the middle-level litho-body node and the bottom-level packing-body leaf. It pulls in the React state tool, the chevron and reset icons, the translation helper, the two badges, and the row types from the tree builder.

**Why it is here.** These rows were split out of ``GeotechnicalUnitRoster`` so that file stays under the 500-line component cap (debt #201) and reads as the tree wiring alone; the badges these rows show live in ``geotechBadges.tsx`` and the tree arithmetic in ``geotechUnitTree.ts``.

.. CG-EXPLANATION-END id=module-header

``function GeotechPackingBodyRow``
----------------------------------

.. CG-BLOCK id=function:GeotechPackingBodyRow lines=48-206

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/geotechRosterRows.tsx
   :language: tsx
   :lines: 48-206
   :lineno-match:

.. CG-EXPLANATION-START id=function:GeotechPackingBodyRow

**What this does.** Draws one selectable packing body — the bottom leaf of the tree. It shows a colour swatch that is itself the colour control, a reset button (only when a colour has been picked), the body's label with its optional "(group N)" tag and any crossed geological formations, the provenance and confidence badges, and the accepted band count. Clicking the label selects the body; changing the swatch and closing it commits a colour to the body's home unit; the reset clears back to the automatic colour.

**Why it is here.** Clicking selects the body because the owner asked to be able to select the sub-bodies he could previously only see (dogfeed 2026-09-01). The swatch writes the whole HOME unit's ``color_override``, since colour is a per-class property, not a per-body one — so its accessible name deliberately names the unit ("SILT · SF"), not this single body ("SILT · SF #0"), which would imply an edit it does not make (ux-reviewer 2026-09-01). The pending colour is held in local state while the wheel is open and only written on blur, so one decision is one update rather than one per drag step, and re-opening and closing without a change writes nothing. The reset fires immediately with no confirmation because it is reversible (docs/ux.md). The swatch and the select button are siblings, not nested, because an interactive input inside a button is invalid markup.

.. CG-EXPLANATION-END id=function:GeotechPackingBodyRow

``function GeotechLithoBodyGroup``
----------------------------------

.. CG-BLOCK id=function:GeotechLithoBodyGroup lines=207-297

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/geotechRosterRows.tsx
   :language: tsx
   :lines: 207-297
   :lineno-match:

.. CG-EXPLANATION-START id=function:GeotechLithoBodyGroup

**What this does.** Draws one geometrically-disconnected litho body — the middle node — with an expander chevron, its label, a band count, and, when collapsed, a rolled-up provenance and confidence badge; when expanded it lists its packing-body leaves. A node whose litho parent is not yet stamped shows a neutral "No litho body" label.

**Why it is here.** The label reads the way a litho body reads everywhere else ("SILT · #0") so the pane, the cross-section jump breadcrumb and the body menu all name the same mass. When the node is collapsed it shows the worst-case rolled-up badges, so the "No CPT" exception and the confidence stay visible without expanding — collapsing must not hide the data-correctness signal (ux-reviewer 2026-09-01). The selection ring shows on the node when the selected body is one of its leaves, so a selection inside a collapsed node stays visible.

.. CG-EXPLANATION-END id=function:GeotechLithoBodyGroup

