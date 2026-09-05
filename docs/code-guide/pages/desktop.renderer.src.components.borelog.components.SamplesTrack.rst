desktop.renderer.src.components.borelog.components.SamplesTrack
===============================================================

.. CG-PAGE source=desktop/src/renderer/src/components/borelog/components/SamplesTrack.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/borelog/components/SamplesTrack.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-21

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/components/SamplesTrack.tsx
   :language: tsx
   :lines: 1-21
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's imports and its documentation comment. It imports the sample type, the lab-test icon table, the ``usePxPerM`` scale helper, and the translation helper. The comment says this is the clickable samples column: each sample is a vertical bracket (for an interval) or a round spot (for a point sample), with the sample number on the left and the lab-test glyphs on the right; selected samples get a soft blue highlight, and clicking a selected one deselects it. Even samples with no lab tests are clickable.

**Why it is here.** The samples column is one of the depth tracks introduced on the ``desktop.renderer.src.components.borelog.components.AdmixtureChips`` page, but this one is interactive. The comment records that no-test samples must stay clickable because the detail panel still shows their sampling metadata — so nothing on the log is a dead click.

.. CG-EXPLANATION-END id=module-header

``function SamplesTrack``
-------------------------

.. CG-BLOCK id=function:SamplesTrack lines=22-114

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/components/SamplesTrack.tsx
   :language: tsx
   :lines: 22-114
   :lineno-match:

.. CG-EXPLANATION-START id=function:SamplesTrack

**What this does.** The track component. It reads the translation helper and the pixels-per-metre scale, then for each sample computes its top, bottom and middle pixel positions, whether it is a point or an interval, whether it is currently selected, and which lab-test glyphs apply. It builds a multi-line hover tooltip and draws a clickable group: an optional blue highlight behind a selected sample, the bracket or spot marker, the sample number, and either the test glyphs or an italic "no tests" note. Clicking toggles selection.

**Why it is here.** ``usePxPerM`` places every sample at its true depth on the shared rail. Clicking a selected sample reports back nothing, which deselects it — a reversible toggle that fires immediately, matching the reversible-action rule. The tooltip's depth line is left unit-only so it reads the same in any language, while the wordy lines use translated text.

.. CG-EXPLANATION-END id=function:SamplesTrack

