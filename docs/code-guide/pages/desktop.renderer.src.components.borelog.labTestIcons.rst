desktop.renderer.src.components.borelog.labTestIcons
====================================================

.. CG-PAGE source=desktop/src/renderer/src/components/borelog/labTestIcons.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/borelog/labTestIcons.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-6

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/labTestIcons.ts
   :language: typescript
   :lines: 1-6
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's one import: the sample response type.

**Why it is here.** The file describes the lab-test glyphs and needs to know the shape of a sample so each glyph can test whether that kind of test is present on a given sample.

.. CG-EXPLANATION-END id=module-header

``interface LabTestIcon``
-------------------------

.. CG-BLOCK id=interface:LabTestIcon lines=7-28

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/labTestIcons.ts
   :language: typescript
   :lines: 7-28
   :lineno-match:

.. CG-EXPLANATION-START id=interface:LabTestIcon

**What this does.** Describes the glyph data for one lab-test family: a single-character symbol, a display label, a colour, a test that says whether a sample has this kind of test, and an optional per-sample label override.

**Why it is here.** Bundling the symbol, label, colour and presence-check into one shape lets both the samples track and the legend read from the same list, so the icon vocabulary stays single-source — the comment records this shared use. The per-sample label override exists for the catch-all family, which shows a count rather than a fixed word.

.. CG-EXPLANATION-END id=interface:LabTestIcon

``const LAB_TEST_ICONS``
------------------------

.. CG-BLOCK id=const:LAB_TEST_ICONS lines=29-67

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/labTestIcons.ts
   :language: typescript
   :lines: 29-67
   :lineno-match:

.. CG-EXPLANATION-START id=const:LAB_TEST_ICONS

**What this does.** The ordered list of lab-test family glyphs: grain size, Atterberg limits, carbonate, organic content and water content, each with its symbol, label, colour and presence-check, and finally the catch-all "other" family marked with a star and a count.

**Why it is here.** The order matches DOV's own report so the visual reading stays consistent, and the catch-all family lands last. The comment records the maintenance rule: adding a new typed family means appending one entry here and adding its detail-panel section, after which the borelog glyphs and the legend pick it up automatically — the single-source benefit of describing the families as data.

.. CG-EXPLANATION-END id=const:LAB_TEST_ICONS

