desktop.renderer.src.components.sections.TieConflictHalo_constants
==================================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/TieConflictHalo_constants.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/TieConflictHalo_constants.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-27

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/TieConflictHalo_constants.ts
   :language: typescript
   :lines: 1-27
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the small file holding the four visual constants for the crossing-tie conflict marker.

**Why it is here.** Module-level constants live in their own file next to the component that uses them, per the project's constants convention.

.. CG-EXPLANATION-END id=module-header

``const TIE_CONFLICT_COLOR``
----------------------------

.. CG-BLOCK id=const:TIE_CONFLICT_COLOR lines=28-37

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/TieConflictHalo_constants.ts
   :language: typescript
   :lines: 28-37
   :lineno-match:

.. CG-EXPLANATION-START id=const:TIE_CONFLICT_COLOR

**What this does.** The marker's stroke colour, orange-600.

**Why it is here.** The docstring reasons by elimination against the UX guide: amber is taken twice over (it is the dirty colour and, on this surface, the pending-tie colour, and a conflicting tie is accepted, not pending); red is reserved for destructive intent and a crossing destroys nothing; violet is taken by the review flag. What is left is the 'severe' tier — louder than attention, short of danger — which the geotech stage already reads as 'degraded, act on it', so the hue arrives with the right meaning. It is a literal value rather than a utility class because SVG stroke cannot be set by a class.

.. CG-EXPLANATION-END id=const:TIE_CONFLICT_COLOR

``const TIE_CONFLICT_WIDTH_PX``
-------------------------------

.. CG-BLOCK id=const:TIE_CONFLICT_WIDTH_PX lines=38-46

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/TieConflictHalo_constants.ts
   :language: typescript
   :lines: 38-46
   :lineno-match:

.. CG-EXPLANATION-START id=const:TIE_CONFLICT_WIDTH_PX

**What this does.** The stroke width, 6 px.

**Why it is here.** The docstring: wider than any tie line so it reads as a halo around the tie rather than a restyling of it — the tie must keep saying which kind of tie it is — but narrower than the 7-px landing pulse so the two are told apart when a chip press flashes a conflicting tie.

.. CG-EXPLANATION-END id=const:TIE_CONFLICT_WIDTH_PX

``const TIE_CONFLICT_OPACITY``
------------------------------

.. CG-BLOCK id=const:TIE_CONFLICT_OPACITY lines=47-56

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/TieConflictHalo_constants.ts
   :language: typescript
   :lines: 47-56
   :lineno-match:

.. CG-EXPLANATION-START id=const:TIE_CONFLICT_OPACITY

**What this does.** The stroke opacity, 0.9.

**Why it is here.** The docstring: high enough to clear the WCAG 2.2 3:1 non-text contrast floor against the section fills, low enough that the tie's own dashes stay legible through it — and the marker is not the only carrier of the state anyway (the dash is).

.. CG-EXPLANATION-END id=const:TIE_CONFLICT_OPACITY

``const TIE_CONFLICT_DASH``
---------------------------

.. CG-BLOCK id=const:TIE_CONFLICT_DASH lines=57-57

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/TieConflictHalo_constants.ts
   :language: typescript
   :lines: 57-57
   :lineno-match:

.. CG-EXPLANATION-START id=const:TIE_CONFLICT_DASH

**What this does.** The dash pattern, a sparse dot-and-gap (2 5).

**Why it is here.** The docstring: it is the non-colour half of the signal (WCAG 2.2 1.4.1), deliberately unlike every other dash on a section (pending 4 4, interpretive 6 3, review flag 7 3, packing boundary 5 4, stale surface 8 4) so the marker cannot be mistaken for one of them in monochrome; sparse dots read as 'flagged' rather than 'provisional'.

.. CG-EXPLANATION-END id=const:TIE_CONFLICT_DASH

