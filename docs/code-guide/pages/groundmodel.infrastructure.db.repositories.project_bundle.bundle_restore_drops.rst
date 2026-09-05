groundmodel.infrastructure.db.repositories.project_bundle.bundle_restore_drops
==============================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_restore_drops.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_restore_drops.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-20

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_restore_drops.py
   :language: python
   :lines: 1-20
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A short module docstring plus one import of ``dataclass``.

**Why it is here.** The docstring records the audit finding (L6): the restore silently truncates over-cap arrays with only a log line, so a user reopening a big project lost depth series or child rows with nothing on screen to say so. This tally is threaded through the restore so the caller can toast the counts.

.. CG-EXPLANATION-END id=module-header

Class ``BundleRestoreDrops`` — header
-------------------------------------

.. CG-BLOCK id=class:BundleRestoreDrops lines=21-41

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_restore_drops.py
   :language: python
   :lines: 21-41
   :lineno-match:

.. CG-EXPLANATION-START id=class:BundleRestoreDrops

**What this does.** Defines ``BundleRestoreDrops``, a small dataclass counting three kinds of dropped row: CPT series dropped over the cap, borehole child rows truncated, and sample body-stamps dropped because their body is not in the restored project.

**Why it is here.** It is a plain data holder the restore builders increment — it does not log or act, per the convention that dataclasses hold data and do not inherit the logger. A dropped sample stamp is the stale window a re-minted body id can leave in a saved file, set back to NULL on restore.

.. CG-EXPLANATION-END id=class:BundleRestoreDrops

Method ``BundleRestoreDrops``. ``def total``
--------------------------------------------

.. CG-BLOCK id=method:BundleRestoreDrops.total lines=42-49

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_restore_drops.py
   :language: python
   :lines: 42-49
   :lineno-match:

.. CG-EXPLANATION-START id=method:BundleRestoreDrops.total

**What this does.** A property returning the sum across the three dropped-row counters.

**Why it is here.** The caller shows one 'N rows were too large and were capped' figure, so the total is computed on read from the parts.

.. CG-EXPLANATION-END id=method:BundleRestoreDrops.total

