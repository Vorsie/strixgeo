desktop.renderer.src.utils.arrays
=================================

.. CG-PAGE source=desktop/src/renderer/src/utils/arrays.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/arrays.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-6

.. literalinclude:: ../../../desktop/src/renderer/src/utils/arrays.ts
   :language: typescript
   :lines: 1-6
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A one-line comment marking this as a home for tiny array helpers.

**Why it is here.** The comment records that these were promoted out of inline copies scattered across the codebase, following the "extract on the second copy" rule in the user's CLAUDE.md — one shared helper instead of the same few lines repeated.

.. CG-EXPLANATION-END id=module-header

``function arraysEqual``
------------------------

.. CG-BLOCK id=function:arraysEqual lines=7-14

.. literalinclude:: ../../../desktop/src/renderer/src/utils/arrays.ts
   :language: typescript
   :lines: 7-14
   :lineno-match:

.. CG-EXPLANATION-START id=function:arraysEqual

**What this does.** Compares two arrays and reports whether they hold the same values in the same positions: it returns true immediately if they are literally the same array, false if their lengths differ, otherwise it walks the items and returns false at the first mismatch. It is written as a *generic* — the ``<T>`` is a placeholder for the item type, filled in by the caller, so one function works for arrays of any value shape.

**Why it is here.** The comment records where it fits: callers use it for arrays of simple values (string ids, numeric EPSG codes, tag labels) where checking whether two arrays are the exact same object is too strict but turning them into text to compare would be overkill.

.. CG-EXPLANATION-END id=function:arraysEqual

