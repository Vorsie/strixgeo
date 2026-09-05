groundmodel.api.schemas.project.litho_suggestion
================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/litho_suggestion/__init__.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/litho_suggestion/__init__.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-30

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_suggestion/__init__.py
   :language: python
   :lines: 1-30
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Re-exports every litho-suggestion schema (the suggest request/response, the single item, the accept request/response, and the batch-accept family) and lists them in ``__all__``.

**Why it is here.** Same package-surface pattern as the litho-layer package: callers import from the package path, so a later file move stays invisible (one class per file, per project convention).

.. CG-EXPLANATION-END id=module-header

