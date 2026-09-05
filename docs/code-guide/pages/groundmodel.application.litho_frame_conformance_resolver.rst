groundmodel.application.litho_frame_conformance_resolver
========================================================

.. CG-PAGE source=src/groundmodel/application/litho_frame_conformance_resolver.py complete=true

*Source file:* ``src/groundmodel/application/litho_frame_conformance_resolver.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-50

.. literalinclude:: ../../../src/groundmodel/application/litho_frame_conformance_resolver.py
   :language: python
   :lines: 1-50
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the frame-conformance resolver. It imports the pure domain warning function and the database rows, and defines a small depth-containment tolerance. The docstring says the pure decision lives in the domain and this module is the application half that walks the database to resolve its inputs.

**Why it is here.** Two paths need exactly this resolution — the hand-drawn tie and the machine tie — so the shared free functions live here rather than in two copies (extract on the second copy). Every function takes the session as a parameter and holds no state, so it stays a thin, testable I/O layer over the pure rule.

.. CG-EXPLANATION-END id=module-header

Function ``async def containing_litho_layer``
---------------------------------------------

.. CG-BLOCK id=function:containing_litho_layer lines=51-97

.. literalinclude:: ../../../src/groundmodel/application/litho_frame_conformance_resolver.py
   :language: python
   :lines: 51-97
   :lineno-match:

.. CG-EXPLANATION-START id=function:containing_litho_layer

**What this does.** Returns the accepted litho layer whose depth range contains a given geotech band on the same column, or nothing.

**Why it is here.** A geotech band subdivides a parent litho layer; matching by depth on the same investigation finds that parent. The tight tolerance is enough because both depths come from the same arithmetic pipeline.

.. CG-EXPLANATION-END id=function:containing_litho_layer

Function ``async def main_soil_of``
-----------------------------------

.. CG-BLOCK id=function:main_soil_of lines=98-119

.. literalinclude:: ../../../src/groundmodel/application/litho_frame_conformance_resolver.py
   :language: python
   :lines: 98-119
   :lineno-match:

.. CG-EXPLANATION-START id=function:main_soil_of

**What this does.** Returns the main soil code of a unit's formation, or nothing when the formation is missing.

**Why it is here.** The frame check compares the two ties' soils, so it needs each unit's soil.

.. CG-EXPLANATION-END id=function:main_soil_of

Function ``async def litho_units_connected``
--------------------------------------------

.. CG-BLOCK id=function:litho_units_connected lines=120-177

.. literalinclude:: ../../../src/groundmodel/application/litho_frame_conformance_resolver.py
   :language: python
   :lines: 120-177
   :lineno-match:

.. CG-EXPLANATION-START id=function:litho_units_connected

**What this does.** Returns whether an accepted correlation path connects two litho units, by a breadth-first search over the model's approved correlation edges.

**Why it is here.** A breadth-first search walks the correlation graph outward level by level to test reachability. It is deliberately permissive — any path counts — so an over-connection under-flags rather than nagging about a conforming tie (the correlation edges are section-scoped but bodies union across sections).

.. CG-EXPLANATION-END id=function:litho_units_connected

Function ``async def describe_geotech_band``
--------------------------------------------

.. CG-BLOCK id=function:describe_geotech_band lines=178-209

.. literalinclude:: ../../../src/groundmodel/application/litho_frame_conformance_resolver.py
   :language: python
   :lines: 178-209
   :lineno-match:

.. CG-EXPLANATION-START id=function:describe_geotech_band

**What this does.** Builds a human label for a geotech band — its formation name on its investigation — falling back to the bare id only when nothing resolves.

**Why it is here.** The engineer reads the warning on a column they can see, so a name is preferred over a UUID whenever one is available.

.. CG-EXPLANATION-END id=function:describe_geotech_band

Function ``async def band_frame_warning``
-----------------------------------------

.. CG-BLOCK id=function:band_frame_warning lines=210-265

.. literalinclude:: ../../../src/groundmodel/application/litho_frame_conformance_resolver.py
   :language: python
   :lines: 210-265
   :lineno-match:

.. CG-EXPLANATION-START id=function:band_frame_warning

**What this does.** Returns the draw-time warning when a packing tie exceeds the litho frame, or nothing. It resolves each band's parent litho unit and soil, walks the correlation edges for a same-soil path, and calls the pure warning function.

**Why it is here.** Owner order 2026-08-21, after a silt-to-clay tie rendered as nothing: flag a tie that does not conform to the litho model. Unresolvable parents stay silent because absence of evidence is not evidence of non-conformance; the correlation search only decides the same-soil case.

.. CG-EXPLANATION-END id=function:band_frame_warning

