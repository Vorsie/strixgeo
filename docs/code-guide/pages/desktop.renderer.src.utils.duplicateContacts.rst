desktop.renderer.src.utils.duplicateContacts
============================================

.. CG-PAGE source=desktop/src/renderer/src/utils/duplicateContacts.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/duplicateContacts.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-21

.. literalinclude:: ../../../desktop/src/renderer/src/utils/duplicateContacts.ts
   :language: typescript
   :lines: 1-21
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A comment explaining what this helper counts — how many formation contacts a "Dedupe" run would delete — and the import of the contact response shape.

**Why it is here.** The comment records that Dedupe deletes from the database, so per the reversible-versus-irreversible rule it must confirm first, and a confirmation that cannot say how much it will destroy is barely a confirmation; the loaded contact list is the same set the server groups, so the number is knowable before the call. It records that the grouping mirrors the server's deduplication exactly — key on the anchor and formation, skip rows with neither, count every member past the survivor — and that the two must agree or the dialog lies. The count is a preview of a server-side decision, not a promise; the toast after the run reports what actually happened.

.. CG-EXPLANATION-END id=module-header

``interface DuplicateContactCount``
-----------------------------------

.. CG-BLOCK id=interface:DuplicateContactCount lines=22-43

.. literalinclude:: ../../../desktop/src/renderer/src/utils/duplicateContacts.ts
   :language: typescript
   :lines: 22-43
   :lineno-match:

.. CG-EXPLANATION-START id=interface:DuplicateContactCount

**What this does.** Describes the preview: how many contacts would be deleted, and across how many distinct investigation-and-formation pairs.

**Why it is here.** These are the two numbers the confirmation dialog needs to tell the engineer the scale of the deletion; both are zero for a clean model.

.. CG-EXPLANATION-END id=interface:DuplicateContactCount

``function countDuplicateContacts``
-----------------------------------

.. CG-BLOCK id=function:countDuplicateContacts lines=44-70

.. literalinclude:: ../../../desktop/src/renderer/src/utils/duplicateContacts.ts
   :language: typescript
   :lines: 44-70
   :lineno-match:

.. CG-EXPLANATION-START id=function:countDuplicateContacts

**What this does.** Counts the duplicates in the contact list. It groups the contacts by their anchor (borehole or CPT) and formation — skipping any contact with no anchor and tagging the key with the anchor flavour — then, for each group with more than one member, adds every member past the survivor to the deletion count and counts the pair.

**Why it is here.** The comments record two decisions matching the server: a synthetic pinch-out tip has no anchor and belongs to no pair, so the server skips it and so does this; and the anchor flavour is part of the key so a borehole and a CPT are treated as distinct investigations even in the impossible case that their ids collide.

.. CG-EXPLANATION-END id=function:countDuplicateContacts

