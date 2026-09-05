desktop.renderer.src.shell.stages.shared.splitViewport
======================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/shared/splitViewport.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/shared/splitViewport.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-28

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/shared/splitViewport.ts
   :language: typescript
   :lines: 1-28
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and pulls in three types it needs. This file is the 3-D viewer's split-viewport 'state machine' — the small set of rules for which of the side-by-side layouts is on screen and how one turns into another. A viewport is the on-screen window into the 3-D world. There are two side-by-side modes and they mean different things: 'split' is a CUT — one model sliced by a plane the user draws, the left pane keeping one half and the right pane the other; 'compare' shows two DIFFERENT whole models at one viewpoint, for example the litho model on the left and the geotech subdivision derived from it on the right.

**Why it is here.** The comment explains that comparing the litho model against its geotech subdivision is the very question the geotech stage exists to answer, and it cannot be answered by flipping between stages because the eye cannot hold a 3-D shape across a stage switch. Splitting the transitions into their own file is not ceremony: the three pieces of state used to be three loose remembered values, and a fourth mode governed by three independent setters is exactly where a bug like 'compare left a stale cut plane behind' lives — which would show half a model in each compare pane and be read as a modelling gap. Keeping it as one value with one transition per verb makes that illegal state impossible to represent. The rules are written to work for any plane and line types so this file needs no 3-D-library import and its tests need no 3-D mock.

.. CG-EXPLANATION-END id=module-header

``type SplitMode``
------------------

.. CG-BLOCK id=type:SplitMode lines=29-31

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/shared/splitViewport.ts
   :language: typescript
   :lines: 29-31
   :lineno-match:

.. CG-EXPLANATION-START id=type:SplitMode

**What this does.** Names the three possible layouts: 'single', 'split' and 'compare'.

**Why it is here.** So the one mode value can only ever be one of these three named layouts, never an arbitrary string.

.. CG-EXPLANATION-END id=type:SplitMode

``interface SplitViewportState``
--------------------------------

.. CG-BLOCK id=interface:SplitViewportState lines=32-46

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/shared/splitViewport.ts
   :language: typescript
   :lines: 32-46
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SplitViewportState

**What this does.** Describes the viewer's complete split state as a single value (an 'interface' names the exact shape): the current mode, the cut plane (present in 'split' mode only, otherwise nothing), and the drawn cut line (again 'split' mode only).

**Why it is here.** It is deliberately one value rather than three loose fields so that an impossible combination — a comparison still carrying a leftover cut plane — simply cannot be written down.

.. CG-EXPLANATION-END id=interface:SplitViewportState

``const SINGLE_VIEWPORT``
-------------------------

.. CG-BLOCK id=const:SINGLE_VIEWPORT lines=47-72

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/shared/splitViewport.ts
   :language: typescript
   :lines: 47-72
   :lineno-match:

.. CG-EXPLANATION-START id=const:SINGLE_VIEWPORT

**What this does.** The resting state: one viewport, the whole model, no cut. It is frozen (made unchangeable) and defined once at the top level of the file. A 'constant' is a named value fixed once and reused.

**Why it is here.** It is frozen and defined once so its identity never changes between redraws — which lets it be listed safely as an input to a React effect without appearing to change and re-triggering that effect.

.. CG-EXPLANATION-END id=const:SINGLE_VIEWPORT

``function splitAfterCutDrawn``
-------------------------------

.. CG-BLOCK id=function:splitAfterCutDrawn lines=73-95

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/shared/splitViewport.ts
   :language: typescript
   :lines: 73-95
   :lineno-match:

.. CG-EXPLANATION-START id=function:splitAfterCutDrawn

**What this does.** The transition that runs once the user finishes the two-click cut-line draw. It returns the 'split' state carrying the new plane and line, and ignores whatever state came before.

**Why it is here.** Drawing a cut states the intent 'cut THIS model' outright, so it replaces a comparison rather than combining with it — a cut applied across two different models would clip each of them against a plane that was drawn on the other.

.. CG-EXPLANATION-END id=function:splitAfterCutDrawn

``function splitAfterCompare``
------------------------------

.. CG-BLOCK id=function:splitAfterCompare lines=96-118

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/shared/splitViewport.ts
   :language: typescript
   :lines: 96-118
   :lineno-match:

.. CG-EXPLANATION-START id=function:splitAfterCompare

**What this does.** The transition that runs when the user asks to compare against the counterpart model. It returns the 'compare' state with no cut, dropping any cut plane that was set.

**Why it is here.** Comparing two models through a clip would show only half of each, and a half-model reads as a modelling gap rather than as a deliberate clip — so the cut is dropped when entering compare.

.. CG-EXPLANATION-END id=function:splitAfterCompare

``function splitAfterExit``
---------------------------

.. CG-BLOCK id=function:splitAfterExit lines=119-130

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/shared/splitViewport.ts
   :language: typescript
   :lines: 119-130
   :lineno-match:

.. CG-EXPLANATION-START id=function:splitAfterExit

**What this does.** The transition back to a single viewport: it returns the resting single-viewport state, whichever split was open.

**Why it is here.** One verb closes both split kinds — the viewer's 'Single view' button and the stage toolbar's Reset both land here — so the user never has to know which kind of split is open in order to get out of it.

.. CG-EXPLANATION-END id=function:splitAfterExit

``interface CompareScene``
--------------------------

.. CG-BLOCK id=interface:CompareScene lines=131-160

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/shared/splitViewport.ts
   :language: typescript
   :lines: 131-160
   :lineno-match:

.. CG-EXPLANATION-START id=interface:CompareScene

**What this does.** Describes the counterpart model drawn in the right-hand pane of a comparison: a human-readable label used as the pane's caption, the counterpart's formations already given their display colours, its built body solids (for Solid view), and its fence walls (for Fence view). A body solid is the model's shape built as a 3-D mesh — many triangles making a surface.

**Why it is here.** The comment notes it is assembled from the shared shell, where both the litho and geotech models already live, so putting up a comparison costs no extra network fetch.

.. CG-EXPLANATION-END id=interface:CompareScene

``function canCompare``
-----------------------

.. CG-BLOCK id=function:canCompare lines=161-166

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/shared/splitViewport.ts
   :language: typescript
   :lines: 161-166
   :lineno-match:

.. CG-EXPLANATION-START id=function:canCompare

**What this does.** Answers whether a comparison against a given scene is worth offering. It returns true only when the counterpart would actually paint something — a body solid with real vertices, or a fence wall with real vertices — and false for a missing scene, an empty solids list, or a list whose entries all have zero vertices.

**Why it is here.** A flagged slab is stored with an empty mesh, so 'has rows' and 'has real geometry' are genuinely different questions — the check tests the geometry, not the row count. A Compare button that opens a blank pane reads as a broken viewer, which is a worse outcome than a disabled button that explains why it is disabled.

.. CG-EXPLANATION-END id=function:canCompare

