desktop.renderer.src.components.borelog.components.BoreholeHeader
=================================================================

.. CG-PAGE source=desktop/src/renderer/src/components/borelog/components/BoreholeHeader.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/borelog/components/BoreholeHeader.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-21

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/components/BoreholeHeader.tsx
   :language: tsx
   :lines: 1-21
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's imports and its documentation comment. It imports the borehole response type, a helper that shortens a vertical-datum name, the translation helper, the inline ``ElevationEditor``, and the small ``Field`` pair. The comment says this draws the ordinary HTML header strip above the log's drawing — the boring name, coordinates, elevation, depth, date, executor, water table and drill method.

**Why it is here.** The comment records the one field that branches: the elevation (Z) field shows the inline ``ElevationEditor`` when the parent has wired a save handler, so a missing value can be fixed in place, and otherwise a read-only field that flags a missing elevation in amber italic. It also notes the Z label follows the row's stored vertical reference system and falls back to a plain "Z" when none is set, so the header never claims a datum the row does not actually carry.

.. CG-EXPLANATION-END id=module-header

``function BoreholeHeader``
---------------------------

.. CG-BLOCK id=function:BoreholeHeader lines=22-77

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/components/BoreholeHeader.tsx
   :language: tsx
   :lines: 22-77
   :lineno-match:

.. CG-EXPLANATION-START id=function:BoreholeHeader

**What this does.** The header component. It reads the translation helper, works out the short datum label for the Z field, and lays out a wrapping row of label-over-value fields: the boring name (bold), the X/Y coordinates with their reference-system number, the elevation (either the editor or a read-only field), the depth range, the date, the executor, and — only when present — the water table and drill method.

**Why it is here.** The elevation field warns in amber when the value is missing because an absolute-elevation depth axis cannot be drawn without it, so the user is nudged to supply a real fix — amber, the app's unsaved-or-attention colour, never red. Optional fields are shown only when the data has them, so the header stays clean for sparse records. The boring name keeps its raw DOV field word in the Dutch interface, per the translate-at-the-boundary rule that leaves upstream tokens intact.

.. CG-EXPLANATION-END id=function:BoreholeHeader

