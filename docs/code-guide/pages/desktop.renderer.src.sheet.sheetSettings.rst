desktop.renderer.src.sheet.sheetSettings
========================================

.. CG-PAGE source=desktop/src/renderer/src/sheet/sheetSettings.ts complete=false

*Source file:* ``desktop/src/renderer/src/sheet/sheetSettings.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-3

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetSettings.ts
   :language: typescript
   :lines: 1-3
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A one-line comment and the import of the settings types. The comment says this file holds the default settings and the read/write of the ``view_state.pdf_sheet`` block, and that the block is additive — absent until the sheet is used for the first time.

**Why it is here.** The sheet's choices are saved with the section so a sheet reopens as the engineer left it. Storing them as an optional block that is simply absent until first use means older projects that never opened a sheet are unaffected, which the spec's ``Settings and persistence`` section requires.

.. CG-EXPLANATION-END id=module-header

``interface FieldLabels``
-------------------------

.. CG-BLOCK id=interface:FieldLabels lines=4-5

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetSettings.ts
   :language: typescript
   :lines: 4-5
   :lineno-match:

.. CG-EXPLANATION-START id=interface:FieldLabels

**What this does.** Declares the four default title-field labels: project, profile, client and date-author.

**Why it is here.** The labels are passed in already translated so this file never hard-codes English or Dutch wording; it just places whichever labels it is given into the defaults.

.. CG-EXPLANATION-END id=interface:FieldLabels

``function defaultSheetSettings``
---------------------------------

.. CG-BLOCK id=function:defaultSheetSettings lines=6-20

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetSettings.ts
   :language: typescript
   :lines: 6-20
   :lineno-match:

.. CG-EXPLANATION-START id=function:defaultSheetSettings

**What this does.** Builds the starting settings from a seed: the fill axis of the current stage, the section's current exaggeration and spacing, fit mode with no explicit scales, and the four title fields pre-filled — the project name, the section name, an empty client, and today's date.

**Why it is here.** So a first-time sheet opens already sensibly filled: the same exaggeration and spacing the engineer is using on screen, and the obvious title fields ready to print. These defaults are exactly the ones the spec lists.

.. CG-EXPLANATION-END id=function:defaultSheetSettings

``const FILLS``
---------------

.. CG-BLOCK id=const:FILLS lines=21-21

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetSettings.ts
   :language: typescript
   :lines: 21-21
   :lineno-match:

.. CG-EXPLANATION-START id=const:FILLS

**What this does.** Lists the two valid fill words: ``litho`` and ``geotech``.

**Why it is here.** Kept as a checkable list so a stored fill value read back from a file can be confirmed to be one of the two before it is trusted.

.. CG-EXPLANATION-END id=const:FILLS

``const MODES``
---------------

.. CG-BLOCK id=const:MODES lines=22-23

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetSettings.ts
   :language: typescript
   :lines: 22-23
   :lineno-match:

.. CG-EXPLANATION-START id=const:MODES

**What this does.** Lists the two valid scale-mode words: ``fit`` and ``explicit``.

**Why it is here.** The same guard for the scale mode: a value read from a file is only accepted if it is one of these two.

.. CG-EXPLANATION-END id=const:MODES

``function isField``
--------------------

.. CG-BLOCK id=function:isField lines=24-28

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetSettings.ts
   :language: typescript
   :lines: 24-28
   :lineno-match:

.. CG-EXPLANATION-START id=function:isField

**What this does.** Checks that a value really is a title field: an object with a text label and a text value.

**Why it is here.** Settings read back from a saved file cannot be trusted to be well-formed, so each field is checked before use; a malformed one is rejected rather than drawn.

.. CG-EXPLANATION-END id=function:isField

``function readSheetSettings``
------------------------------

.. CG-BLOCK id=function:readSheetSettings lines=29-53

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetSettings.ts
   :language: typescript
   :lines: 29-53
   :lineno-match:

.. CG-EXPLANATION-START id=function:readSheetSettings

**What this does.** Reads the saved sheet block out of a section's view state and returns clean settings. If the block is missing or not an object it returns the fallback untouched. Otherwise it accepts the four fields only if all four are valid, coerces the numbers (using the fallback where a value is missing or not a finite number), keeps the explicit scales only when they are positive numbers, defaults the scale mode to fit if unrecognised, clamps the spacing to the 0-to-1 range, and rejects the whole block if the fill word is not one of the two valid ones.

**Why it is here.** A saved file can be old, hand-edited or corrupt, so every field is validated or replaced before the sheet trusts it; a bad block falls back to safe defaults rather than crashing or drawing nonsense. This is the read half of the additive, backward-safe persistence the spec describes.

.. CG-EXPLANATION-END id=function:readSheetSettings

``function writeSheetSettings``
-------------------------------

.. CG-BLOCK id=function:writeSheetSettings lines=54-59

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetSettings.ts
   :language: typescript
   :lines: 54-59
   :lineno-match:

.. CG-EXPLANATION-START id=function:writeSheetSettings

**What this does.** Returns a copy of the section's view state with the sheet settings merged in under the ``pdf_sheet`` key.

**Why it is here.** The settings are saved by patching the section's view state (the same mechanism the spacing slider already uses), so they travel in the project file; this builds that patch body without disturbing anything else already in the view state.

.. CG-EXPLANATION-END id=function:writeSheetSettings

