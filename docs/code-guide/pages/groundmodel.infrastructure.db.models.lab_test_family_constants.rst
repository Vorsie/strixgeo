groundmodel.infrastructure.db.models.lab_test_family_constants
==============================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/models/lab_test_family_constants.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/models/lab_test_family_constants.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-39

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/lab_test_family_constants.py
   :language: python
   :lines: 1-39
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports the six typed lab-test ORM classes and lists them, in canonical display order, in ``LAB_TEST_FAMILIES`` — each entry a pair of (the relationship name on the sample, which is also the bundle JSON key, and the leaf ORM class). ``LAB_TEST_RELATIONSHIP_NAMES`` is a names-only view for callers that never touch the classes.

**Why it is here.** This is the single source of truth for 'what are the sample's lab-test child collections'. Everywhere that enumerates them — bundle save, bundle restore, project duplication, the eager-load chain — reads this registry instead of hand-listing the six families, so adding a seventh means one new entry here plus the response field, not edits across seven files. The order is meaningful: it is the display order and also the bundle-key order.

.. CG-EXPLANATION-END id=module-header

