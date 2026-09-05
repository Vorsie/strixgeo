groundmodel.api.routers.codelists
=================================

.. CG-PAGE source=src/groundmodel/api/routers/codelists.py complete=true

*Source file:* ``src/groundmodel/api/routers/codelists.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-29

.. literalinclude:: ../../../src/groundmodel/api/routers/codelists.py
   :language: python
   :lines: 1-29
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A docstring naming the file's purpose, then imports of the router type, Pydantic's base model, and the two in-app catalogues (the G3Dv3 stratigraphic units and the DOV formal-stratigraphy list), and it creates the ``/codelists`` router.

**Why it is here.** A *codelist* is a fixed reference table of allowed values. These routes feed the desktop's autocomplete in the formation dialog. They are read-only and unauthenticated because the catalogues ship inside the app (not per-user data) and never change while the app runs, so the desktop can cache them hard.

.. CG-EXPLANATION-END id=module-header

Class ``G3Dv3UnitResponse`` — header
------------------------------------

.. CG-BLOCK id=class:G3Dv3UnitResponse lines=30-47

.. literalinclude:: ../../../src/groundmodel/api/routers/codelists.py
   :language: python
   :lines: 30-47
   :lineno-match:

.. CG-EXPLANATION-START id=class:G3Dv3UnitResponse

**What this does.** The response shape for one G3Dv3 stratigraphic unit: its code, abbreviation, rank, parent, Dutch name, age rank, and colour.

**Why it is here.** It mirrors the internal unit but leaves off the hydrogeology codes the autocomplete does not need, which shrinks the payload and lets that part of the model change later without touching this contract. It is a response schema, so it does not inherit the strict request base.

.. CG-EXPLANATION-END id=class:G3Dv3UnitResponse

Method ``G3Dv3UnitResponse``. ``def from_unit``
-----------------------------------------------

.. CG-BLOCK id=method:G3Dv3UnitResponse.from_unit lines=48-61

.. literalinclude:: ../../../src/groundmodel/api/routers/codelists.py
   :language: python
   :lines: 48-61
   :lineno-match:

.. CG-EXPLANATION-START id=method:G3Dv3UnitResponse.from_unit

**What this does.** A constructor that copies a domain unit into the response shape.

**Why it is here.** Keeps the mapping from the internal unit to the wire shape in one place next to the schema it builds.

.. CG-EXPLANATION-END id=method:G3Dv3UnitResponse.from_unit

Class ``G3Dv3CatalogResponse``
------------------------------

.. CG-BLOCK id=class:G3Dv3CatalogResponse lines=62-72

.. literalinclude:: ../../../src/groundmodel/api/routers/codelists.py
   :language: python
   :lines: 62-72
   :lineno-match:

.. CG-EXPLANATION-START id=class:G3Dv3CatalogResponse

**What this does.** The top-level wrapper for the catalogue endpoint: an object holding the list of units.

**Why it is here.** Wrapping the list in an object leaves room to add catalogue metadata later (version, refresh date) without breaking the desktop's parsing.

.. CG-EXPLANATION-END id=class:G3Dv3CatalogResponse

Function ``async def get_g3dv3_catalog``
----------------------------------------

.. CG-BLOCK id=function:get_g3dv3_catalog lines=73-91

.. literalinclude:: ../../../src/groundmodel/api/routers/codelists.py
   :language: python
   :lines: 73-91
   :lineno-match:

.. CG-EXPLANATION-START id=function:get_g3dv3_catalog

**What this does.** The handler for ``GET /codelists/g3dv3`` — return every G3Dv3 unit, youngest first.

**Why it is here.** The catalogue is built once per process, so this is effectively a serialise-and-return; the desktop caches the answer after the first call.

.. CG-EXPLANATION-END id=function:get_g3dv3_catalog

Class ``FormalStratigraphyUnitResponse`` — header
-------------------------------------------------

.. CG-BLOCK id=class:FormalStratigraphyUnitResponse lines=92-117

.. literalinclude:: ../../../src/groundmodel/api/routers/codelists.py
   :language: python
   :lines: 92-117
   :lineno-match:

.. CG-EXPLANATION-START id=class:FormalStratigraphyUnitResponse

**What this does.** The response shape for one DOV formal-stratigraphy unit: its formal code, Dutch name, age rank, and colour.

**Why it is here.** It powers the formation dialog's link from an informal formation to its formal code, which is then stored on the formation and drives lens auto-naming (the docstring records this). Same response-schema pattern as the G3Dv3 unit above.

.. CG-EXPLANATION-END id=class:FormalStratigraphyUnitResponse

Method ``FormalStratigraphyUnitResponse``. ``def from_entry``
-------------------------------------------------------------

.. CG-BLOCK id=method:FormalStratigraphyUnitResponse.from_entry lines=118-128

.. literalinclude:: ../../../src/groundmodel/api/routers/codelists.py
   :language: python
   :lines: 118-128
   :lineno-match:

.. CG-EXPLANATION-START id=method:FormalStratigraphyUnitResponse.from_entry

**What this does.** A constructor that copies a catalogue entry into the response shape.

**Why it is here.** Same one-place-mapping reason as the G3Dv3 constructor above.

.. CG-EXPLANATION-END id=method:FormalStratigraphyUnitResponse.from_entry

Class ``FormalStratigraphyCatalogResponse``
-------------------------------------------

.. CG-BLOCK id=class:FormalStratigraphyCatalogResponse lines=129-134

.. literalinclude:: ../../../src/groundmodel/api/routers/codelists.py
   :language: python
   :lines: 129-134
   :lineno-match:

.. CG-EXPLANATION-START id=class:FormalStratigraphyCatalogResponse

**What this does.** The top-level wrapper for the formal-stratigraphy endpoint: an object holding the list of units.

**Why it is here.** Same object-wrapper reason as the G3Dv3 catalogue response above.

.. CG-EXPLANATION-END id=class:FormalStratigraphyCatalogResponse

Function ``async def get_formal_stratigraphy_catalog``
------------------------------------------------------

.. CG-BLOCK id=function:get_formal_stratigraphy_catalog lines=135-151

.. literalinclude:: ../../../src/groundmodel/api/routers/codelists.py
   :language: python
   :lines: 135-151
   :lineno-match:

.. CG-EXPLANATION-START id=function:get_formal_stratigraphy_catalog

**What this does.** The handler for ``GET /codelists/formal-stratigraphy`` — return every formal-stratigraphy unit (code plus Dutch name).

**Why it is here.** Same build-once, serialise-and-return, client-caches pattern as the G3Dv3 catalogue endpoint.

.. CG-EXPLANATION-END id=function:get_formal_stratigraphy_catalog

