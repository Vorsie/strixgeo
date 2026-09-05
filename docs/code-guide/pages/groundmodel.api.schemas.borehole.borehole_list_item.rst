groundmodel.api.schemas.borehole.borehole_list_item
===================================================

.. CG-PAGE source=src/groundmodel/api/schemas/borehole/borehole_list_item.py complete=true

*Source file:* ``src/groundmodel/api/schemas/borehole/borehole_list_item.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-8

.. literalinclude:: ../../../src/groundmodel/api/schemas/borehole/borehole_list_item.py
   :language: python
   :lines: 1-8
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A one-line docstring and imports of ``date``, ``UUID``, ``BaseModel``, and ``ConfigDict``.

**Why it is here.** The response-schema pattern; this is the lightweight list row, kept separate from the full detail tree above.

.. CG-EXPLANATION-END id=module-header

Class ``BoreholeListItem``
--------------------------

.. CG-BLOCK id=class:BoreholeListItem lines=9-83

.. literalinclude:: ../../../src/groundmodel/api/schemas/borehole/borehole_list_item.py
   :language: python
   :lines: 9-83
   :lineno-match:

.. CG-EXPLANATION-START id=class:BoreholeListItem

**What this does.** A lightweight summary the sidebar and map need: id, name, source id, location, coordinate system, elevation and its source and vertical system, drill method, type, total depth, start date, and two denormalised counts. No drill segments, observations, or samples. Reads off the row via ``from_attributes``.

**Why it is here.** It carries only what the list, markers, and "needs Z" badge need, so listing many boreholes stays fast — the full tree is fetched only on opening one. The docstring is emphatic that a missing elevation stays empty and must NOT default to 0.0, because empty is the exact trigger for the manual-Z badge, and 0 m is itself a real elevation (the owner's elevation-trust rule). The counts and source tag are denormalised so the sidebar avoids a per-row detail fetch (debt #8).

.. CG-EXPLANATION-END id=class:BoreholeListItem

