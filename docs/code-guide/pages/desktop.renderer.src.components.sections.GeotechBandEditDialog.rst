desktop.renderer.src.components.sections.GeotechBandEditDialog
==============================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/GeotechBandEditDialog.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/GeotechBandEditDialog.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-31

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/GeotechBandEditDialog.tsx
   :language: tsx
   :lines: 1-31
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the file for the consequence sheet shown before a hand split or merge of packing sub-bands is committed. The imports pull in React's lifecycle and ref hooks, the plan data type, and the shared button, modal, and translation pieces.

**Why it is here.** Two owner rulings fix its shape (debt #227): a warning that a boundary would pull the layer's representative qc up or down (ruling 6), and the ability to override everything (ruling 5). Together those make it a sheet that TELLS but never VETOES — the action button is enabled whatever the warnings say. It is deliberately not styled as an irreversible confirmation, because a split can be merged back. All the numbers and warning sentences are authored on the server, including the phrase 'representative qc', which is the model's chosen statistic (ruling 7).

.. CG-EXPLANATION-END id=module-header

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=32-45

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/GeotechBandEditDialog.tsx
   :language: tsx
   :lines: 32-45
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** The inputs: whether the sheet is open, the plan describing what the edit would do (straight from the preview endpoint), a confirm callback, a cancel callback, and a busy flag.

**Why it is here.** The plan is rendered as handed — the dialog manufactures nothing — so the statistic and its wording exist in one place on the server.

.. CG-EXPLANATION-END id=interface:Props

``function depthRange``
-----------------------

.. CG-BLOCK id=function:depthRange lines=46-50

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/GeotechBandEditDialog.tsx
   :language: tsx
   :lines: 46-50
   :lineno-match:

.. CG-EXPLANATION-START id=function:depthRange

**What this does.** A small helper that formats a top and base depth into a readable range string like '2.00–4.50 m'.

**Why it is here.** It formats depths the same way the section readouts do, so the numbers read consistently.

.. CG-EXPLANATION-END id=function:depthRange

``function classLabel``
-----------------------

.. CG-BLOCK id=function:classLabel lines=51-69

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/GeotechBandEditDialog.tsx
   :language: tsx
   :lines: 51-69
   :lineno-match:

.. CG-EXPLANATION-START id=function:classLabel

**What this does.** A small helper that turns a NAD packing class number into a display label, naming the 'needs review' case rather than showing a blank when the class is not set.

**Why it is here.** Showing a blank would read as a bug; naming the null case tells the engineer the band still needs a class. The NAD packing classes are the Belgian annex table (NBN EN 1997-1 ANB Tabel 2.1).

.. CG-EXPLANATION-END id=function:classLabel

``function GeotechBandEditDialog``
----------------------------------

.. CG-BLOCK id=function:GeotechBandEditDialog lines=70-210

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/GeotechBandEditDialog.tsx
   :language: tsx
   :lines: 70-210
   :lineno-match:

.. CG-EXPLANATION-START id=function:GeotechBandEditDialog

**What this does.** The component. It works out the verb (split, merge, or move), builds a statistic label that names the model's statistic when it is not the default median, moves keyboard focus to the action button on open, and renders the modal: a title, a re-derivation blurb, a list of the resulting intervals with their class changes and representative qc, the warnings (or a 'same class' note), and Cancel plus the action button.

**Why it is here.** Focus lands on the action, not Cancel, because this is not an irreversible action — the UX rule that defaults focus to Cancel is for deletes, and defaulting here would read as a warning about danger rather than a statement of consequence. The action button is never disabled by warnings, per ruling 5: the engineer may place a boundary the qc does not support, having been told what it costs. The statistic is named when it is not the median because a number labelled bare 'representative qc' would read as the median it no longer is (ruling 7).

.. CG-EXPLANATION-END id=function:GeotechBandEditDialog

