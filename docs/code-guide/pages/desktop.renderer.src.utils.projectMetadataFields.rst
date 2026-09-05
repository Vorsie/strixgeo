desktop.renderer.src.utils.projectMetadataFields
================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/projectMetadataFields.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/projectMetadataFields.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-21

.. literalinclude:: ../../../desktop/src/renderer/src/utils/projectMetadataFields.ts
   :language: typescript
   :lines: 1-21
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file holds, in one place, the list of project fields the engineer can edit, plus the helpers that compare two projects field by field. The block covers the module comment, the imports, and the documentation for the field list below.

**Why it is here.** The comment records why the module exists: the same ten fields had been typed out by hand in three separate places, guarded only by a "keep these in sync" warning, and crash recovery needed the list a fourth time (it carries the not-yet-saved metadata changes into the recovery file — docs/design/autosave-recovery.md §2, item 3). Rather than a fourth copy, the list became one shared export — the don't-repeat-logic rule. It is a pure module: no screen drawing, no engine calls, no logging.

.. CG-EXPLANATION-END id=module-header

``const PROJECT_METADATA_FIELDS``
---------------------------------

.. CG-BLOCK id=const:PROJECT_METADATA_FIELDS lines=22-35

.. literalinclude:: ../../../desktop/src/renderer/src/utils/projectMetadataFields.ts
   :language: typescript
   :lines: 22-35
   :lineno-match:

.. CG-EXPLANATION-START id=const:PROJECT_METADATA_FIELDS

**What this does.** The list of the ten editable project fields: name, project number, client, site label, description, tags, the two coordinate-system settings, phase and status.

**Why it is here.** The comment records that this is every field the user can edit and therefore every field that can be "dirty" (changed but unsaved). The database timestamps, the id, the view state and the lumping columns are deliberately left out, because they are not part of what the user edits.

.. CG-EXPLANATION-END id=const:PROJECT_METADATA_FIELDS

``type ProjectMetadataField``
-----------------------------

.. CG-BLOCK id=type:ProjectMetadataField lines=36-38

.. literalinclude:: ../../../desktop/src/renderer/src/utils/projectMetadataFields.ts
   :language: typescript
   :lines: 36-38
   :lineno-match:

.. CG-EXPLANATION-START id=type:ProjectMetadataField

**What this does.** A *type* meaning "one of the names in the list above".

**Why it is here.** It is derived straight from the list, so the set of valid field names and the list can never drift apart.

.. CG-EXPLANATION-END id=type:ProjectMetadataField

``type ProjectMetadataDraft``
-----------------------------

.. CG-BLOCK id=type:ProjectMetadataDraft lines=39-51

.. literalinclude:: ../../../desktop/src/renderer/src/utils/projectMetadataFields.ts
   :language: typescript
   :lines: 39-51
   :lineno-match:

.. CG-EXPLANATION-START id=type:ProjectMetadataDraft

**What this does.** A *type* for the uncommitted part of a metadata edit: a partial project holding only the fields that differ. The block ends with the documentation for the field-comparison helper below.

**Why it is here.** A draft should carry only what changed, not a whole project copy, so it is declared as a partial pick of just the editable fields.

.. CG-EXPLANATION-END id=type:ProjectMetadataDraft

``function fieldsEqual``
------------------------

.. CG-BLOCK id=function:fieldsEqual lines=52-67

.. literalinclude:: ../../../desktop/src/renderer/src/utils/projectMetadataFields.ts
   :language: typescript
   :lines: 52-67
   :lineno-match:

.. CG-EXPLANATION-START id=function:fieldsEqual

**What this does.** Compares one named field across two projects and reports whether they agree. Tags are compared as a list; every other field is compared as a plain value. The block ends with the documentation for the whole-metadata comparison below.

**Why it is here.** The comment records that tags is the only field that is not a single value, so it is the only one that needs a list-by-list comparison; the rest are strings, numbers or blanks.

.. CG-EXPLANATION-END id=function:fieldsEqual

``function projectMetadataEqual``
---------------------------------

.. CG-BLOCK id=function:projectMetadataEqual lines=68-87

.. literalinclude:: ../../../desktop/src/renderer/src/utils/projectMetadataFields.ts
   :language: typescript
   :lines: 68-87
   :lineno-match:

.. CG-EXPLANATION-START id=function:projectMetadataEqual

**What this does.** Reports whether two projects agree on every editable metadata field. The block ends with the documentation for the draft-patch helper below.

**Why it is here.** It gives the app one call to decide whether the metadata has any unsaved change at all, by checking each field in the shared list.

.. CG-EXPLANATION-END id=function:projectMetadataEqual

``function projectMetadataDraftPatch``
--------------------------------------

.. CG-BLOCK id=function:projectMetadataDraftPatch lines=88-102

.. literalinclude:: ../../../desktop/src/renderer/src/utils/projectMetadataFields.ts
   :language: typescript
   :lines: 88-102
   :lineno-match:

.. CG-EXPLANATION-START id=function:projectMetadataDraftPatch

**What this does.** Works out the metadata changes a crash would destroy: it walks the field list and keeps only the live values that differ from the last-saved snapshot, returning an empty patch when the project is clean or absent. A project with no saved snapshot at all is treated as all-draft.

**Why it is here.** The comment records why only the differences are kept: the saved values are already durable in the database and the project file, so carrying them too would bloat the recovery file without protecting anything. The one localised type cast is noted as necessary because the partial-pick shape hides the field-name index, but since the value is read with the field's real type the name and value can never fall out of step.

.. CG-EXPLANATION-END id=function:projectMetadataDraftPatch

