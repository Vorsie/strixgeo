desktop.renderer.src.components.sections.LithoSuggestionGhostColumns
====================================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/LithoSuggestionGhostColumns.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/LithoSuggestionGhostColumns.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-57

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/LithoSuggestionGhostColumns.tsx
   :language: tsx
   :lines: 1-57
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the interactive ghost-column overlay that shows lithostratigraphic layer suggestions from the segmenter for one investigation at a time, each suggested layer drawn as a coloured, semi-transparent rectangle beside the investigation's data band. This is a React component — a function that returns a piece of screen — drawn in SVG (Scalable Vector Graphics, the drawing language the section is painted in). It imports React's hooks (useEffect, useMemo, useRef, useState — small tools a component calls to run a side-effect, cache a computation, hold a handle to a real element, and remember a value), a way to draw a floating menu outside the normal layout (createPortal), the suggestion and formation data types, the boundary-drag hook, the label and colour helpers, the composition editor, the copy-confirm and hover-readout cards, the shared multi-line label, the CPT interpolation helper, the depth-axis helper, and the child that draws a single layer.

**Why it is here.** The docstring records the division of labour: the component is a pure SVG drawer, and the accept/reject decision-state lives in the caller's hook so the state machine is not here. It also records the layout decision — the ghost column sits to the LEFT of the data band, opposite the DOV ghost columns on the right, to avoid collision — and that its opacity mirrors the DOV ghosts so the two overlays look consistent.

.. CG-EXPLANATION-END id=module-header

``const HEADER_FONT_SIZE``
--------------------------

.. CG-BLOCK id=const:HEADER_FONT_SIZE lines=58-75

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/LithoSuggestionGhostColumns.tsx
   :language: tsx
   :lines: 58-75
   :lineno-match:

.. CG-EXPLANATION-START id=const:HEADER_FONT_SIZE

**What this does.** The font size (8 px) of the small header label above the ghost column. The long comment that follows is the explanation for the next constant, the hit-strip half-height.

**Why it is here.** A ghost column is narrow, so its header text is kept small enough to fit without crowding the neighbouring band.

.. CG-EXPLANATION-END id=const:HEADER_FONT_SIZE

``const HIT_STRIP_HALF_PX``
---------------------------

.. CG-BLOCK id=const:HIT_STRIP_HALF_PX lines=76-84

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/LithoSuggestionGhostColumns.tsx
   :language: tsx
   :lines: 76-84
   :lineno-match:

.. CG-EXPLANATION-START id=const:HIT_STRIP_HALF_PX

**What this does.** The half-height, in pixels, of the invisible strip along a suggested layer's edge that catches the mouse when the engineer grabs a boundary to drag it — five pixels each way, so the strip is 10 px tall.

**Why it is here.** The docstring records the exact bug it fixes: the pending suggestion's hit-strip must fully shadow the committed contact's own 10-px drag strip so that when the user grabs 'the pending edge' the pending strip wins the mousedown; at the old 3 px (a 6-px strip) the 4-px outer ring of the contact strip had no overlapping pending pixel and grabbed the mousedown instead, so grabbing the pending edge actually dragged the committed contact off and opened a gap (P2 of the dogfeed report 30 May 2026). SVG paint order (this overlay renders after the contacts layer) then guarantees the pending strip wins on the shared boundary.

.. CG-EXPLANATION-END id=const:HIT_STRIP_HALF_PX

``interface LithoSuggestionGhostColumnsProps``
----------------------------------------------

.. CG-BLOCK id=interface:LithoSuggestionGhostColumnsProps lines=85-315

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/LithoSuggestionGhostColumns.tsx
   :language: tsx
   :lines: 85-315
   :lineno-match:

.. CG-EXPLANATION-START id=interface:LithoSuggestionGhostColumnsProps

**What this does.** The full set of inputs (props — the values a component is given) the overlay accepts: the placed columns and the investigation id to find its column, the top-to-bottom suggestion list, the elevation-to-screen mapping, the surface elevation, the plot bounds, the data-band half-width, the sets of accepted and rejected layer indices, the accept and reject callbacks, the formation vocabulary for tooltips, and a long tail of optional callbacks for editing a layer's depth, copying a composition across columns, inserting, splitting, merging and extending layers, and dispatching a cross-store drag to a committed contact, plus the optional CPT depth series for the live drag readout.

**Why it is here.** The comments on each optional callback record its dogfeed or debt origin — for example, the cross-column paste (debt #86), insert layer (debt #85), split (debt #98) and merge (debt #102). Every optional callback lets a caller opt into an extra gesture; when it is absent that gesture is simply not offered, so a simpler caller works with zero regression.

.. CG-EXPLANATION-END id=interface:LithoSuggestionGhostColumnsProps

``function LithoSuggestionGhostColumns``
----------------------------------------

.. CG-BLOCK id=function:LithoSuggestionGhostColumns lines=316-1308

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/LithoSuggestionGhostColumns.tsx
   :language: tsx
   :lines: 316-1308
   :lineno-match:

.. CG-EXPLANATION-START id=function:LithoSuggestionGhostColumns

**What this does.** The large orchestrator component. Above any early return it declares all its hooks so the hook count never changes between renders: it derives the set of effectively-rejected layers (folding in any that a drag has collapsed to near-zero thickness), holds state for the open composition editor, the Alt-drag copy gesture, the pending overwrite confirmation, the boundary and per-layer context menus, and wires the document-level Escape and click-away dismissal. It computes the pixels-per-metre from the level transform, calls the shared boundary-drag hook (which owns the live drag state and the mouseup commit), and runs a document-level effect that resolves an Alt-drag drop target across sibling overlay instances by reading the stamped anchor and index attributes under the cursor. After the early returns (no suggestions, no surface elevation, no column found) it draws each layer through the single-layer child, the boundary hit-strips, and several portalled surfaces: the per-layer and boundary context menus, the composition editor, the copy-confirm dialog, and the floating copy-drag chip and hover readout.

**Why it is here.** The comments record the load-bearing decisions. Hooks sit above every early return because React forbids a hook below a conditional return and the project has been bitten by hook-order runtime crashes (the temporal-dead-zone trap). The effectively-rejected set is a safety net: a drag that collapses a layer's top onto its base commits a plain depth edit without marking the layer rejected, and folding such a zero-thickness layer into the rejected set at the walker boundary stops it from locking the next layer's drag at that depth. The drag state and its listeners were extracted into the shared hook (slice 1 of the unified boundary-drag work) so this component owns only the hit-strip render. The cross-column drop uses the stamped anchor and index attributes read via the element-under-the-cursor list so the gesture works across separate overlay instances, degrading gracefully where that browser feature is missing (so tests can render without it).

.. CG-EXPLANATION-END id=function:LithoSuggestionGhostColumns

