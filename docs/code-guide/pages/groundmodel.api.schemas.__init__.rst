groundmodel.api.schemas
=======================

.. CG-PAGE source=src/groundmodel/api/schemas/__init__.py complete=true

*Source file:* ``src/groundmodel/api/schemas/__init__.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-12

.. literalinclude:: ../../../src/groundmodel/api/schemas/__init__.py
   :language: python
   :lines: 1-12
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A documentation-only file that names the folder's contents: the request and response *schemas*, organised into sub-folders by subject (CPT, borehole, and a shared validation-finding schema). It states the convention that each schema class lives in its own file and is imported by its own path.

**Why it is here.** A *schema* is the declared shape of the data going into or coming out of an endpoint — which fields exist, their types, and whether each is required. This file marks the folder as a package and records the one-class-per-file convention (matching the project's code conventions), so a reader always finds a schema where its name says it will be. The ``__init__`` files are intentionally empty so nothing is re-exported implicitly.

.. CG-EXPLANATION-END id=module-header

