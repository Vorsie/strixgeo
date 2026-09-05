desktop.renderer.src.utils.sectionDefaults
==========================================

.. CG-PAGE source=desktop/src/renderer/src/utils/sectionDefaults.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/sectionDefaults.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-15

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionDefaults.ts
   :language: typescript
   :lines: 1-15
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file holds the per-project defaults used when a new cross-section is created. The import brings in two helpers that read a bounded number and a bag out of a project's saved view state.

**Why it is here.** The comment records that the defaults are stored in the project's view state, the same mechanism as the litho-segmenter preferences, so they ride in the project file and a colleague opening it creates sections with the project's tuning. It stresses these are create-time defaults only: editing an existing section's buffer or vertical exaggeration uses the inline controls on the section header and writes to that section's own row, and changing the project default afterwards does not retroactively re-tune existing sections, because that would surprise the user.

.. CG-EXPLANATION-END id=module-header

``interface SectionDefaults``
-----------------------------

.. CG-BLOCK id=interface:SectionDefaults lines=16-30

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionDefaults.ts
   :language: typescript
   :lines: 16-30
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SectionDefaults

**What this does.** A declared shape for the three tunable defaults: the projection-corridor half-width in metres, the vertical exaggeration multiplier, and the along-strike spread allowed within one auto-proposed tie-section.

**Why it is here.** The comment records the meaning and typical ranges of each — for example the corridor half-width is 50 m by default but shrunk to ±15 m for tight foundation footprints or widened to ±100 m for regional studies, and vertical exaggeration of 1 is geometrically honest while regional studies use 2 to 5 times to make thin layers legible.

.. CG-EXPLANATION-END id=interface:SectionDefaults

``const SECTION_DEFAULTS``
--------------------------

.. CG-BLOCK id=const:SECTION_DEFAULTS lines=31-36

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionDefaults.ts
   :language: typescript
   :lines: 31-36
   :lineno-match:

.. CG-EXPLANATION-START id=const:SECTION_DEFAULTS

**What this does.** The fallback values used when a project has stored none: 50 m corridor half-width, 1.0 vertical exaggeration, 45 m tie-strike tolerance.

**Why it is here.** The comment records that the corridor half-width matches the backend's own default of 50 m, so a project with no stored tuning behaves the same on both sides.

.. CG-EXPLANATION-END id=const:SECTION_DEFAULTS

``const SECTION_DEFAULTS_BOUNDS``
---------------------------------

.. CG-BLOCK id=const:SECTION_DEFAULTS_BOUNDS lines=37-42

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionDefaults.ts
   :language: typescript
   :lines: 37-42
   :lineno-match:

.. CG-EXPLANATION-START id=const:SECTION_DEFAULTS_BOUNDS

**What this does.** The allowed minimum and maximum for each of the three defaults.

**Why it is here.** They are the range each field is clamped to when read, so a malformed or extreme stored value can never produce a nonsensical section.

.. CG-EXPLANATION-END id=const:SECTION_DEFAULTS_BOUNDS

``const VIEW_STATE_KEY``
------------------------

.. CG-BLOCK id=const:VIEW_STATE_KEY lines=43-49

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionDefaults.ts
   :language: typescript
   :lines: 43-49
   :lineno-match:

.. CG-EXPLANATION-START id=const:VIEW_STATE_KEY

**What this does.** The name of the view-state bag these defaults live in: ``section_defaults``. The block ends with the documentation for the read function below.

**Why it is here.** Naming it once means the read and the write cannot drift onto different keys.

.. CG-EXPLANATION-END id=const:VIEW_STATE_KEY

``function readSectionDefaults``
--------------------------------

.. CG-BLOCK id=function:readSectionDefaults lines=50-77

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionDefaults.ts
   :language: typescript
   :lines: 50-77
   :lineno-match:

.. CG-EXPLANATION-START id=function:readSectionDefaults

**What this does.** Reads the per-project section defaults out of the saved view state, checking each field against its bounds independently and falling back to the global default for any field that is missing or malformed.

**Why it is here.** The docstring records that each field is bounds-checked on its own, so one bad stored value does not spoil the others — the rest still load correctly.

.. CG-EXPLANATION-END id=function:readSectionDefaults

``function buildSectionDefaultsPatch``
--------------------------------------

.. CG-BLOCK id=function:buildSectionDefaultsPatch lines=78-88

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionDefaults.ts
   :language: typescript
   :lines: 78-88
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildSectionDefaultsPatch

**What this does.** Builds the small patch that saves the three defaults under the section-defaults key so they survive the next save.

**Why it is here.** It is the write counterpart to the reader above, packaging the defaults in the shape the view-state patch mechanism expects.

.. CG-EXPLANATION-END id=function:buildSectionDefaultsPatch

