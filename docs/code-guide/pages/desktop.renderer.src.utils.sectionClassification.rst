desktop.renderer.src.utils.sectionClassification
================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/sectionClassification.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/sectionClassification.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-7

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionClassification.ts
   :language: typescript
   :lines: 1-7
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file works out which investigations fall inside a section's corridor — the set the render and correlate gates use to filter contacts. The imports bring in the projection helper and its point and endpoint types.

**Why it is here.** The comment records the owner directive of 2026-06-08, classification-follows-the-test: a section shows the classification of every test in its corridor, not only the contacts it was explicitly seeded with (memory: classification follows the test).

.. CG-EXPLANATION-END id=module-header

``type SectionCorridor``
------------------------

.. CG-BLOCK id=type:SectionCorridor lines=8-23

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionClassification.ts
   :language: typescript
   :lines: 8-23
   :lineno-match:

.. CG-EXPLANATION-START id=type:SectionCorridor

**What this does.** A *type* for just enough of a section to define its corridor: its two endpoints, the projection buffer half-width, and the optional lists of excluded CPT and borehole ids. The block ends with the documentation for the function below.

**Why it is here.** It gathers the four facts corridor membership depends on, so the helper below has one declared input.

.. CG-EXPLANATION-END id=type:SectionCorridor

``function inCorridorInvestigationIds``
---------------------------------------

.. CG-BLOCK id=function:inCorridorInvestigationIds lines=24-52

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionClassification.ts
   :language: typescript
   :lines: 24-52
   :lineno-match:

.. CG-EXPLANATION-START id=function:inCorridorInvestigationIds

**What this does.** Returns the ids of every CPT and borehole that projects into the section's corridor — within the projection buffer, between the endpoints, and not on the excluded lists. The block ends with the documentation for the per-section function below.

**Why it is here.** The docstring records the membership rule it defines: a contact or layer belongs to a section exactly when its anchor investigation is in this set.

.. CG-EXPLANATION-END id=function:inCorridorInvestigationIds

``function memberIdsBySection``
-------------------------------

.. CG-BLOCK id=function:memberIdsBySection lines=53-63

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionClassification.ts
   :language: typescript
   :lines: 53-63
   :lineno-match:

.. CG-EXPLANATION-START id=function:memberIdsBySection

**What this does.** Folds that membership rule over every section, returning a map from each section id to its set of member investigation ids, in the sections' order.

**Why it is here.** The docstring records that membership is always this helper's answer, never re-derived, and that the union across all sections is the population pooled for the per-unit statistics (owner ruling 2026-08-27: only CPTs on the sections are pooled). Callers feed the app's visible lists, so investigations that were removed from the project or gated out of the manifest are already excluded before this runs.

.. CG-EXPLANATION-END id=function:memberIdsBySection

