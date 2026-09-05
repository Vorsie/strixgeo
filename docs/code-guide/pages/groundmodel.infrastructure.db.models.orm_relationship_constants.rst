groundmodel.infrastructure.db.models.orm_relationship_constants
===============================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/models/orm_relationship_constants.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/models/orm_relationship_constants.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-74

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/orm_relationship_constants.py
   :language: python
   :lines: 1-74
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A long module docstring plus the definition of ``RELATIONSHIP_LAZY`` — the single loader strategy that every ORM ``relationship()`` in the package passes. It reads an environment variable once at import, falling back to the default ``"raise"``, and is typed against SQLAlchemy's own allowed strategy strings.

**Why it is here.** A *loader strategy* decides when a related row is fetched. Async SQLAlchemy cannot lazily load a relationship on demand — an un-loaded access raises ``MissingGreenlet`` as a runtime error, invisible until the exact response is served in production (the CLAUDE.md async-ORM rule). Setting the strategy to ``"raise"`` turns that latent trap into an immediate, legible error at the access site — ideally caught by an integration test walking the response — and the docstring records that the whole integration and e2e suites ran green under ``"raise"``, so it was promoted to the default. One switch, in one place, so the app and the tests can never disagree.

.. CG-EXPLANATION-END id=module-header

