groundmodel.api.routers.geology.exports
=======================================

.. CG-PAGE source=src/groundmodel/api/routers/geology/exports.py complete=true

*Source file:* ``src/groundmodel/api/routers/geology/exports.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-55

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/exports.py
   :language: python
   :lines: 1-55
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file (geology model export routes) and imports its tools: the router building blocks, the shared endpoint helpers, the fence-export request schema, the application use case that builds a model snapshot, the two exporters (Plaxis and DXF fence), the database models it reads, and the logger. It makes one module-level logger and a bare router with no prefix of its own.

**Why it is here.** The router carries no prefix because the package ``__init__`` mounts it under the shared geology prefix, keeping paths unchanged (debt #40). One module-level logger is used because routers are stateless functions, not classes, so the project's logger-by-inheritance pattern does not apply.

.. CG-EXPLANATION-END id=module-header

Function ``async def export_model_plaxis3d``
--------------------------------------------

.. CG-BLOCK id=function:export_model_plaxis3d lines=56-108

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/exports.py
   :language: python
   :lines: 56-108
   :lineno-match:

.. CG-EXPLANATION-START id=function:export_model_plaxis3d

**What this does.** The handler for ``GET .../models/{model_id}/export/plaxis3d`` — turn a geological model into a runnable Plaxis 3-D Python script. It runs the project-scope guard, builds a snapshot of the model, hands it to the Plaxis exporter, and returns the script as a downloadable file.

**Why it is here.** The exported script builds the boreholes and soil-layer stack inside Plaxis with placeholder materials the engineer fills in afterwards — the platform's job stops at delivering the model, not the design parameters (project scope). The scope guard requires the model to belong to the project in the path (a cross-project id-enumeration guard). A failure to resolve the project or model is mapped to ``404`` ("not found") rather than a raw server error.

.. CG-EXPLANATION-END id=function:export_model_plaxis3d

Function ``async def export_model_fence_dxf``
---------------------------------------------

.. CG-BLOCK id=function:export_model_fence_dxf lines=109-189

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/exports.py
   :language: python
   :lines: 109-189
   :lineno-match:

.. CG-EXPLANATION-START id=function:export_model_fence_dxf

**What this does.** The handler for ``POST .../models/{model_id}/export/fence-dxf`` — write the 3-D fence diagram (a set of vertical section panels) the desktop built as a DXF drawing file. It runs the scope guard, reads the project name and coordinate system, looks up each panel's machine identity for layer naming, serialises the panels with the DXF exporter, and returns the file.

**Why it is here.** The fence panels are triangulated in the desktop from the section partition engine, which the server cannot rebuild, so they are sent whole and this endpoint only validates and serialises them — an out-of-range triangle index fails schema validation with a ``422`` before the handler runs. The model id stays in the path for scope consistency even though the geometry is client-supplied. The layer names come from each formation's NAD class and soil code, looked up here rather than sent by the desktop, so the desktop need not know the export naming scheme (debt #104).

.. CG-EXPLANATION-END id=function:export_model_fence_dxf

Function ``async def _resolve_fence_identities``
------------------------------------------------

.. CG-BLOCK id=function:_resolve_fence_identities lines=190-250

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/exports.py
   :language: python
   :lines: 190-250
   :lineno-match:

.. CG-EXPLANATION-START id=function:_resolve_fence_identities

**What this does.** A private helper that, for the formations named by the fence panels, fetches each one's NAD packing class and main soil code in a single database query scoped to the project, and returns them keyed by formation id.

**Why it is here.** The export layer name is the unit's machine identifier (debt #104), built from two fields the panel does not carry. Resolving them in one query rather than per panel avoids repeated round-trips, and scoping the query to the project id stops a panel from pulling a formation out of another project. A panel whose id is not a valid identifier or is not found is simply left out, and the exporter falls back to that panel's display name.

.. CG-EXPLANATION-END id=function:_resolve_fence_identities

