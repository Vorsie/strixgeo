groundmodel.api.schemas.project.batch_create_sections_request
=============================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/batch_create_sections_request.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/batch_create_sections_request.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-10

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/batch_create_sections_request.py
   :language: python
   :lines: 1-10
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports the single-section create schema and the strict base class.

**Why it is here.** It reuses the single-create schema for each item so a batch validates each section exactly as a lone create would (the don't-repeat rule).

.. CG-EXPLANATION-END id=module-header

Class ``BatchCreateSectionsRequest``
------------------------------------

.. CG-BLOCK id=class:BatchCreateSectionsRequest lines=11-21

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/batch_create_sections_request.py
   :language: python
   :lines: 11-21
   :lineno-match:

.. CG-EXPLANATION-START id=class:BatchCreateSectionsRequest

**What this does.** A request body carrying a list of cross-sections to create together. An empty list is allowed and creates nothing.

**Why it is here.** A *request body* is the JSON payload a client sends with a POST. Creating several sections in one call lets the desktop accept a whole set of tie-sections in a single database transaction (all-or-nothing), rather than one round-trip each.

.. CG-EXPLANATION-END id=class:BatchCreateSectionsRequest

