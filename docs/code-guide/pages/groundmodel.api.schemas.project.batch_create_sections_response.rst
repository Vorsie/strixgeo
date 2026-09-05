groundmodel.api.schemas.project.batch_create_sections_response
==============================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/batch_create_sections_response.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/batch_create_sections_response.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-9

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/batch_create_sections_response.py
   :language: python
   :lines: 1-9
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports the single-section response schema.

**Why it is here.** It reuses the single-section response shape so each returned entry matches what a lone create returns.

.. CG-EXPLANATION-END id=module-header

Class ``BatchCreateSectionsResponse``
-------------------------------------

.. CG-BLOCK id=class:BatchCreateSectionsResponse lines=10-20

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/batch_create_sections_response.py
   :language: python
   :lines: 10-20
   :lineno-match:

.. CG-EXPLANATION-START id=class:BatchCreateSectionsResponse

**What this does.** The reply for a batch create: the created sections, one entry per submitted section, in the same order as the request.

**Why it is here.** Returning them in request order lets the desktop line each result up with what it sent without matching on ids. A *response schema* is the declared shape of the JSON the server sends back.

.. CG-EXPLANATION-END id=class:BatchCreateSectionsResponse

