groundmodel.api.schemas.cpt.cpt_list_item
=========================================

.. CG-PAGE source=src/groundmodel/api/schemas/cpt/cpt_list_item.py complete=true

*Source file:* ``src/groundmodel/api/schemas/cpt/cpt_list_item.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-7

.. literalinclude:: ../../../src/groundmodel/api/schemas/cpt/cpt_list_item.py
   :language: python
   :lines: 1-7
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A one-line docstring and imports of ``UUID`` and ``BaseModel``.

**Why it is here.** The response-schema pattern; the lightweight CPT list row.

.. CG-EXPLANATION-END id=module-header

Class ``CptListItem``
---------------------

.. CG-BLOCK id=class:CptListItem lines=8-60

.. literalinclude:: ../../../src/groundmodel/api/schemas/cpt/cpt_list_item.py
   :language: python
   :lines: 8-60
   :lineno-match:

.. CG-EXPLANATION-START id=class:CptListItem

**What this does.** A lightweight CPT summary for the list and map: id, name, cone type, max depth, row count, location and coordinate system, elevation with its vertical system and source, and a start date. The depth-series arrays are left out. The start date defaults to empty.

**Why it is here.** Omitting the series keeps listing fast whatever the series size. The docstring records that the location fields ride along so map markers render from one list call, and that the start date is a raw pass-through text value never re-parsed here — the desktop normalises it (Data Integrity Rule 2). The start date is optional so an older saved bundle without it still deserialises (additive-only).

.. CG-EXPLANATION-END id=class:CptListItem

