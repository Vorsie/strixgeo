desktop.renderer.src.components.sections.useFocusColumn
=======================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/useFocusColumn.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/useFocusColumn.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-48

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/useFocusColumn.ts
   :language: typescript
   :lines: 1-48
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A hook for column focus mode: snap the viewport to a tight window around one test and restore the previous view on exit.

**Why it is here.** Debt #30. It encapsulates the focused column, the pre-focus viewport and vertical-exaggeration snapshots (kept in refs, not state, because nothing renders them), and the enter and exit callbacks. It is event-driven rather than effect-driven, which avoids the stale-read pattern that bites subtly; and a sub-focus chain (entering focus on a second column while already focused on a first) preserves the first's snapshot as the eventual restore target. The header also explains that fitting the test's depth means solving for the vertical exaggeration that maps its metre span onto the plot height, because a tight level range alone changes only the vertical centre and does nothing to the zoom, which was the focus-is-zoom-insensitive bug.

.. CG-EXPLANATION-END id=module-header

``function clamp``
------------------

.. CG-BLOCK id=function:clamp lines=49-56

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/useFocusColumn.ts
   :language: typescript
   :lines: 49-56
   :lineno-match:

.. CG-EXPLANATION-START id=function:clamp

**What this does.** A tiny helper that keeps a number between a minimum and a maximum.

**Why it is here.** It keeps the computed vertical exaggeration inside its slider bounds.

.. CG-EXPLANATION-END id=function:clamp

``const FOCUS_X_HALF_WIDTH_M``
------------------------------

.. CG-BLOCK id=const:FOCUS_X_HALF_WIDTH_M lines=57-61

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/useFocusColumn.ts
   :language: typescript
   :lines: 57-61
   :lineno-match:

.. CG-EXPLANATION-START id=const:FOCUS_X_HALF_WIDTH_M

**What this does.** Half the horizontal window, twenty metres, that the focused view snaps to.

**Why it is here.** It is wide enough to give the column band breathing room and narrow enough that the test reads as the obvious subject.

.. CG-EXPLANATION-END id=const:FOCUS_X_HALF_WIDTH_M

``const FOCUS_DEFAULT_DEPTH_M``
-------------------------------

.. CG-BLOCK id=const:FOCUS_DEFAULT_DEPTH_M lines=62-66

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/useFocusColumn.ts
   :language: typescript
   :lines: 62-66
   :lineno-match:

.. CG-EXPLANATION-START id=const:FOCUS_DEFAULT_DEPTH_M

**What this does.** A fallback test depth of thirty metres, used when the row records no depth.

**Why it is here.** It gives the focus zoom something sensible to fit against rather than collapsing to the surface.

.. CG-EXPLANATION-END id=const:FOCUS_DEFAULT_DEPTH_M

``const FOCUS_LEVEL_PADDING_M``
-------------------------------

.. CG-BLOCK id=const:FOCUS_LEVEL_PADDING_M lines=67-68

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/useFocusColumn.ts
   :language: typescript
   :lines: 67-68
   :lineno-match:

.. CG-EXPLANATION-START id=const:FOCUS_LEVEL_PADDING_M

**What this does.** The vertical padding, two metres, above the surface and below the test bottom.

**Why it is here.** It keeps the column caps off the plot edge.

.. CG-EXPLANATION-END id=const:FOCUS_LEVEL_PADDING_M

``interface FocusTarget``
-------------------------

.. CG-BLOCK id=interface:FocusTarget lines=69-74

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/useFocusColumn.ts
   :language: typescript
   :lines: 69-74
   :lineno-match:

.. CG-EXPLANATION-START id=interface:FocusTarget

**What this does.** Which column to focus: kind, id and name.

**Why it is here.** It names the test that enter and exit act on.

.. CG-EXPLANATION-END id=interface:FocusTarget

``interface UseFocusColumnResult``
----------------------------------

.. CG-BLOCK id=interface:UseFocusColumnResult lines=75-111

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/useFocusColumn.ts
   :language: typescript
   :lines: 75-111
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseFocusColumnResult

**What this does.** What the hook returns: the focused column or nothing, plus enter and exit. The long comment after explains the depth-fit and the true-along-distance centring.

**Why it is here.** Enter no-ops when the column is not currently placed (for instance it was removed since the right-click), and exit restores the snapshot. Centring uses the column's true projected along-distance, not its packed nudged X, because the earlier nudged-X inversion baked in the collision offset and left the test off-centre, the had-to-pan-to-find-the-test bug.

.. CG-EXPLANATION-END id=interface:UseFocusColumnResult

``function useFocusColumn``
---------------------------

.. CG-BLOCK id=function:useFocusColumn lines=112-204

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/useFocusColumn.ts
   :language: typescript
   :lines: 112-204
   :lineno-match:

.. CG-EXPLANATION-START id=function:useFocusColumn

**What this does.** Holds the focused column and the two snapshot refs. Enter finds the column, snapshots the viewport once, computes the fitted level window and the vertical exaggeration that maps the test's metre span onto the plot height for the tight window, and sets the viewport centred on the column's true along-distance; exit restores the snapshot and clears focus.

**Why it is here.** The level minimum and maximum set only the vertical centre, so fitting the test needs solving for the exaggeration (vertical scale over horizontal scale), not just a tight level range; setting the range alone did nothing, which was the zoom-insensitive bug. Snapshotting only when the ref is still empty preserves the truly-original framing across a sub-focus chain.

.. CG-EXPLANATION-END id=function:useFocusColumn

