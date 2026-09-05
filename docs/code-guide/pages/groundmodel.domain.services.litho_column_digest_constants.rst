groundmodel.domain.services.litho_column_digest_constants
=========================================================

.. CG-PAGE source=src/groundmodel/domain/services/litho_column_digest_constants.py complete=true

*Source file:* ``src/groundmodel/domain/services/litho_column_digest_constants.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-39

.. literalinclude:: ../../../src/groundmodel/domain/services/litho_column_digest_constants.py
   :language: python
   :lines: 1-39
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Defines the digest's tuning values: a version prefix, millimetre depth precision, a 16-byte hash size, and the field and record separators used to build the canonical text.

**Why it is here.** The comments record why each value was chosen. Bumping the version deliberately invalidates every stored stamp, so it must come with a migration that clears the stored map, or it would read as the whole model being stale. Millimetre precision is finer than the litho boundary clamp yet still catches the hand-edit the provenance test relies on. The separators were picked because neither can appear inside a formatted depth or an id, so the canonical string is never ambiguous between two different stacks.

.. CG-EXPLANATION-END id=module-header

