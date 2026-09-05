groundmodel.infrastructure.db.alembic_config_helpers
====================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/alembic_config_helpers.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/alembic_config_helpers.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-10

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/alembic_config_helpers.py
   :language: python
   :lines: 1-10
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens a tiny file of pure helpers for building a migration configuration by hand, and imports Alembic's configuration type.

**Why it is here.** *Alembic* is the tool that applies database *migrations* (ordered, replayable scripts that change the database's shape). The docstring records that the two places that set a database address on a hand-built configuration need the same escaping, and getting it wrong is not cosmetic — it crashes on exactly the addresses the shipped app generates.

.. CG-EXPLANATION-END id=module-header

Function ``def set_config_option``
----------------------------------

.. CG-BLOCK id=function:set_config_option lines=11-38

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/alembic_config_helpers.py
   :language: python
   :lines: 11-38
   :lineno-match:

.. CG-EXPLANATION-START id=function:set_config_option

**What this does.** Sets one option on an Alembic configuration, doubling every percent sign in the value before storing it.

**Why it is here.** The docstring explains the trap: Alembic stores options in a parser that treats a bare percent sign as the start of a substitution and raises an error on anything else — including the percent-encoded characters in a generated per-install password once it is written into a database address. Doubling the percent sign here is undone by the same parser on read, so the value round-trips unchanged. A *DSN* is that single address-and-login string for a database.

.. CG-EXPLANATION-END id=function:set_config_option

