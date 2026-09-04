groundmodel.api.boot_migration_constants
========================================

.. CG-PAGE source=src/groundmodel/api/boot_migration_constants.py complete=true

*Source file:* ``src/groundmodel/api/boot_migration_constants.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-21

.. literalinclude:: ../../../src/groundmodel/api/boot_migration_constants.py
   :language: python
   :lines: 1-21
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Defines one value: ``ENGINE_MIGRATE_ENV``, the exact spelling
of the environment switch (``"STRIX_ENGINE_MIGRATE"``) that the launcher sets and
the engine reads.

**Why it is here.** The packaged launcher (written in TypeScript) and the engine
(written in Python) both need to agree on this one word. Putting it in a named
constant means there is a single spelling both sides point at, instead of the
same string typed twice and drifting apart. ``Final`` is a type hint that says
"this value is never reassigned".

.. CG-EXPLANATION-END id=module-header

