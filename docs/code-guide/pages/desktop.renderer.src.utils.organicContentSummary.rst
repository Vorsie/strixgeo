desktop.renderer.src.utils.organicContentSummary
================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/organicContentSummary.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/organicContentSummary.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-43

.. literalinclude:: ../../../desktop/src/renderer/src/utils/organicContentSummary.ts
   :language: typescript
   :lines: 1-43
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening docstring and the imports. This file picks the single organic-content number a compact preview may show for a sample.

**Why it is here.** The docstring records the owner ask (dogfeed 2026-08-15) to surface organic-matter content on hover in the grain-size popup, and a data-integrity point: a sample can carry several organic-content tests, each reporting organic MATTER, organic CARBON, or both, and these are different quantities — matter is carbon scaled by a soil-dependent factor — so showing a carbon value under a "matter" label is a data-integrity error, not a wording nicety. It therefore picks one value AND says which quantity it is, and the caller must print the returned label rather than a fixed one. Matter is preferred across the whole list before carbon, and two sources are consulted in order — the typed organic family first, the scalar catch-all as fallback — because the owner's project had the measurement only in the catch-all. The module is pure.

.. CG-EXPLANATION-END id=module-header

``const SCALAR_ORGANIC_MATTER_TOKEN``
-------------------------------------

.. CG-BLOCK id=const:SCALAR_ORGANIC_MATTER_TOKEN lines=44-46

.. literalinclude:: ../../../desktop/src/renderer/src/utils/organicContentSummary.ts
   :language: typescript
   :lines: 44-46
   :lineno-match:

.. CG-EXPLANATION-START id=const:SCALAR_ORGANIC_MATTER_TOKEN

**What this does.** The lower-cased substring that identifies the DOV organic-matter parameter inside the scalar catch-all: ``organische stof``.

**Why it is here.** The docstring records that the catch-all stores the upstream token verbatim and DOV repeats the name inside its own parentheses, so an exact-equality test would never fire; the substring is deliberately narrow enough to exclude the neighbouring lime row, which sits in the same group and also reports a percent.

.. CG-EXPLANATION-END id=const:SCALAR_ORGANIC_MATTER_TOKEN

``type OrganicQuantity``
------------------------

.. CG-BLOCK id=type:OrganicQuantity lines=47-49

.. literalinclude:: ../../../desktop/src/renderer/src/utils/organicContentSummary.ts
   :language: typescript
   :lines: 47-49
   :lineno-match:

.. CG-EXPLANATION-START id=type:OrganicQuantity

**What this does.** The organic quantity actually measured: either matter or carbon.

**Why it is here.** The docstring records that the two are never interchangeable, which is why the returned value must be tagged with which one it is.

.. CG-EXPLANATION-END id=type:OrganicQuantity

``interface OrganicContentSummary``
-----------------------------------

.. CG-BLOCK id=interface:OrganicContentSummary lines=50-77

.. literalinclude:: ../../../desktop/src/renderer/src/utils/organicContentSummary.ts
   :language: typescript
   :lines: 50-77
   :lineno-match:

.. CG-EXPLANATION-START id=interface:OrganicContentSummary

**What this does.** One organic-content reading: the quantity it is a reading of, and the value as a percent by weight.

**Why it is here.** It carries both the number and its quantity together so the caller can label it truthfully.

.. CG-EXPLANATION-END id=interface:OrganicContentSummary

``function selectOrganicContent``
---------------------------------

.. CG-BLOCK id=function:selectOrganicContent lines=78-100

.. literalinclude:: ../../../desktop/src/renderer/src/utils/organicContentSummary.ts
   :language: typescript
   :lines: 78-100
   :lineno-match:

.. CG-EXPLANATION-START id=function:selectOrganicContent

**What this does.** Picks the organic-content value to show: the first typed organic-matter reading, failing that the first typed organic-carbon reading, failing that the first numeric organic-matter row in the scalar catch-all, and otherwise nothing.

**Why it is here.** The docstring records that matter is preferred across the whole typed list before carbon is considered. A comment records that the catch-all row is organic matter by its own DOV name, so it is reported as matter, and that a row carrying no number was never measured and is treated exactly like an absent test rather than printing a "0 %". Returning nothing lets the caller render nothing at all instead of a dash or an empty row.

.. CG-EXPLANATION-END id=function:selectOrganicContent

