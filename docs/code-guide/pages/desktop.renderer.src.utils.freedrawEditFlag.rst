desktop.renderer.src.utils.freedrawEditFlag
===========================================

.. CG-PAGE source=desktop/src/renderer/src/utils/freedrawEditFlag.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/freedrawEditFlag.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-26

.. literalinclude:: ../../../desktop/src/renderer/src/utils/freedrawEditFlag.ts
   :language: typescript
   :lines: 1-26
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This whole file is one on/off switch for the litho "free-draw" feature — the interaction where the engineer grabs a boundary and reshapes it by hand. The comment records that the feature is disabled for now, lists which parts of it are unfinished, and describes exactly what "off" has to mean end to end: the section panel withholds the save/correlate boundary handlers (which removes every grab handle and drag path) and also withholds the stored shapes so old nodes cannot warp the fill, and the 3-D build skips loading boundary shapes so the 3-D model stays in step with the 2-D render.

**Why it is here.** The reasons are recorded in the comment. The feature is off by owner directive (2026-07-25) because only part of the handle model is built. The demand that it be off *completely* is an owner ruling (2026-08-07) born from a real incident: a stray hand-drawn shape lingered after a dogfeed session and kept warping a fill for two weeks with no visible handle to remove it, so "off" must mean the stored shapes cannot act, not merely that the handles are hidden. The stored shapes are deliberately not deleted, so flipping the switch back on re-applies all of them at once; the full design is in docs/design/freedraw-onlap-lens-edit-model.md.

.. CG-EXPLANATION-END id=module-header

``const FREEDRAW_EDIT_ENABLED``
-------------------------------

.. CG-BLOCK id=const:FREEDRAW_EDIT_ENABLED lines=27-27

.. literalinclude:: ../../../desktop/src/renderer/src/utils/freedrawEditFlag.ts
   :language: typescript
   :lines: 27-27
   :lineno-match:

.. CG-EXPLANATION-START id=const:FREEDRAW_EDIT_ENABLED

**What this does.** The switch itself, set to off (``false``).

**Why it is here.** A single named switch read everywhere the feature branches, so the whole interaction can be turned on or off from one line; it is off for the reasons the file comment records above.

.. CG-EXPLANATION-END id=const:FREEDRAW_EDIT_ENABLED

