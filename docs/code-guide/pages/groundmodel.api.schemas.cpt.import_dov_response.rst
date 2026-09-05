groundmodel.api.schemas.cpt.import_dov_response
===============================================

.. CG-PAGE source=src/groundmodel/api/schemas/cpt/import_dov_response.py complete=true

*Source file:* ``src/groundmodel/api/schemas/cpt/import_dov_response.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-7

.. literalinclude:: ../../../src/groundmodel/api/schemas/cpt/import_dov_response.py
   :language: python
   :lines: 1-7
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A one-line docstring and imports of ``UUID`` and ``BaseModel``.

**Why it is here.** The response-schema pattern; a plain summary shape.

.. CG-EXPLANATION-END id=module-header

Class ``ImportDovResponse``
---------------------------

.. CG-BLOCK id=class:ImportDovResponse lines=8-14

.. literalinclude:: ../../../src/groundmodel/api/schemas/cpt/import_dov_response.py
   :language: python
   :lines: 8-14
   :lineno-match:

.. CG-EXPLANATION-START id=class:ImportDovResponse

**What this does.** The summary of a completed DOV CPT import: imported / duplicate / failed counts and the list of imported CPT ids.

**Why it is here.** The minimal counts-and-ids shape the desktop needs after a bounding-box import; the borehole equivalent adds the lab-attachment counts.

.. CG-EXPLANATION-END id=class:ImportDovResponse

