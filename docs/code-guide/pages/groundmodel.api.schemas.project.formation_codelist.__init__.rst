groundmodel.api.schemas.project.formation_codelist
==================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/formation_codelist/__init__.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/formation_codelist/__init__.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-16

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/formation_codelist/__init__.py
   :language: python
   :lines: 1-16
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The package docstring and a re-import of the two codelist schemas, listed in ``__all__``.

**Why it is here.** Python treats a folder as an importable package only when it holds an ``__init__.py`` file. The project keeps one class per file (CLAUDE.md, debt #42), so this file re-exports the package's schemas under the package path — callers write one import instead of reaching into each module.

.. CG-EXPLANATION-END id=module-header

