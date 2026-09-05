desktop.renderer.src.utils.robertsonSbt
=======================================

.. CG-PAGE source=desktop/src/renderer/src/utils/robertsonSbt.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/robertsonSbt.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-24

.. literalinclude:: ../../../desktop/src/renderer/src/utils/robertsonSbt.ts
   :language: typescript
   :lines: 1-24
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file holds one shared table of Robertson soil-behaviour-type (SBT) bands keyed on the Ic index, so every part of the interface that shows an Ic classification reads the same breakpoints. The block also declares the top of the Ic axis.

**Why it is here.** The comment records the bug that forced one shared table (audit 2026-08-02): the Parameters per-test table and the Ic chart on the same screen used different breakpoints, so a Boom Clay CPT read "Clay" in the table and "Organic" in the chart just below it. The breakpoints here are the very ones the engine uses, and Robertson's sensitive-fine-grained zone is not an Ic band at all (it is read off a different chart), which is why nothing here is labelled "Sensitive". Ic classification is a characterisation output in the MVP, not a design parameter — the published source is Robertson (2009).

.. CG-EXPLANATION-END id=module-header

``const IC_AXIS_MAX``
---------------------

.. CG-BLOCK id=const:IC_AXIS_MAX lines=25-27

.. literalinclude:: ../../../desktop/src/renderer/src/utils/robertsonSbt.ts
   :language: typescript
   :lines: 25-27
   :lineno-match:

.. CG-EXPLANATION-START id=const:IC_AXIS_MAX

**What this does.** The upper Ic bound of the highest band, 4, which is also the top of the chart's Ic axis.

**Why it is here.** Naming it once lets both the last band and the chart axis share the same ceiling.

.. CG-EXPLANATION-END id=const:IC_AXIS_MAX

``interface SbtIcBand``
-----------------------

.. CG-BLOCK id=interface:SbtIcBand lines=28-44

.. literalinclude:: ../../../desktop/src/renderer/src/utils/robertsonSbt.ts
   :language: typescript
   :lines: 28-44
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SbtIcBand

**What this does.** A declared shape for one Ic band: its inclusive lower bound, its exclusive upper bound, a full label, and a short abbreviation for narrow chart labels. The block ends with the documentation for the band list below.

**Why it is here.** The comment records that fill colours are deliberately NOT part of this table — colours are a chart concern and live with the chart, keyed by band position — so this table stays purely about the classification.

.. CG-EXPLANATION-END id=interface:SbtIcBand

``const SBT_IC_BANDS``
----------------------

.. CG-BLOCK id=const:SBT_IC_BANDS lines=45-54

.. literalinclude:: ../../../desktop/src/renderer/src/utils/robertsonSbt.ts
   :language: typescript
   :lines: 45-54
   :lineno-match:

.. CG-EXPLANATION-START id=const:SBT_IC_BANDS

**What this does.** The six Ic bands in ascending order, from gravelly sand at the low end to organic at the high end, each with its interval, label and abbreviation.

**Why it is here.** The comment records that colours are kept out of this list on purpose, living with the chart instead, so the same bands can serve any consumer without dragging chart styling along.

.. CG-EXPLANATION-END id=const:SBT_IC_BANDS

``interface SbtZoneSpec``
-------------------------

.. CG-BLOCK id=interface:SbtZoneSpec lines=55-82

.. literalinclude:: ../../../desktop/src/renderer/src/utils/robertsonSbt.ts
   :language: typescript
   :lines: 55-82
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SbtZoneSpec

**What this does.** A declared shape for one Robertson chart zone: the zone number, a full soil-behaviour-type name, and a short abbreviation. The block ends with the documentation for the zone list below.

**Why it is here.** It names the shape the backend's zone numbers are turned into for display, separate from the Ic bands above.

.. CG-EXPLANATION-END id=interface:SbtZoneSpec

``const ROBERTSON_SBT_ZONES``
-----------------------------

.. CG-BLOCK id=const:ROBERTSON_SBT_ZONES lines=83-109

.. literalinclude:: ../../../desktop/src/renderer/src/utils/robertsonSbt.ts
   :language: typescript
   :lines: 83-109
   :lineno-match:

.. CG-EXPLANATION-START id=const:ROBERTSON_SBT_ZONES

**What this does.** The nine Robertson chart zones, keyed by the number the engine sends, each with a full name and a short abbreviation.

**Why it is here.** The comment records these are zones read off the Robertson (2009) chart, not Ic bands, so three of them have no Ic interval at all. The labels are derived from the engine's own documentation, not copied loosely, and two deliberate rewordings are recorded in a shared contract file that a parity test holds every label to — so the wording is machine-checked, not merely asserted. The published sources are Robertson (2009/2015); zone 2's peat naming follows the extended Lengkeek & Brinkgreve (2022) boundary the engine feeds it.

.. CG-EXPLANATION-END id=const:ROBERTSON_SBT_ZONES

``function sbtZoneSpec``
------------------------

.. CG-BLOCK id=function:sbtZoneSpec lines=110-129

.. literalinclude:: ../../../desktop/src/renderer/src/utils/robertsonSbt.ts
   :language: typescript
   :lines: 110-129
   :lineno-match:

.. CG-EXPLANATION-START id=function:sbtZoneSpec

**What this does.** Looks up one zone's full name and abbreviation by its number, returning nothing when the number is outside 1 to 9. The block ends with the documentation for the Ic-to-label helper below.

**Why it is here.** The docstring records that a number outside 1 to 9 means the engine emitted something this table does not know, which is rendered as unclassified rather than inventing a soil name.

.. CG-EXPLANATION-END id=function:sbtZoneSpec

``function sbtZoneFromIc``
--------------------------

.. CG-BLOCK id=function:sbtZoneFromIc lines=130-136

.. literalinclude:: ../../../desktop/src/renderer/src/utils/robertsonSbt.ts
   :language: typescript
   :lines: 130-136
   :lineno-match:

.. CG-EXPLANATION-START id=function:sbtZoneFromIc

**What this does.** Returns the Robertson band label for one Ic value, or nothing when the value is zero, negative or not a real number; values above the last band still fall into the last band.

**Why it is here.** The docstring records that Ic is undefined at zero or below and for non-finite inputs, so those are not classifiable, and that Ic itself has no hard ceiling — only the chart axis does — so a very high value still reads as the topmost band.

.. CG-EXPLANATION-END id=function:sbtZoneFromIc

