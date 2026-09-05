groundmodel.domain.services.tin_surface_constants
=================================================

.. CG-PAGE source=src/groundmodel/domain/services/tin_surface_constants.py complete=true

*Source file:* ``src/groundmodel/domain/services/tin_surface_constants.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-82

.. literalinclude:: ../../../src/groundmodel/domain/services/tin_surface_constants.py
   :language: python
   :lines: 1-82
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Defines two tuning numbers for the TIN service: the concave-hull tightness factor that trims the surface boundary, and a small tolerance for the model's footprint-coverage check. It carries a long comment recording why the boundary trim works this way and how the tightness was tuned.

**Why it is here.** The tightness factor is the principled "interpolate only, do not extrapolate" rule (owner directive 2026-05-18), chosen after a longest-edge filter and a slope cap were both tried and removed. Delaunay always triangulates the full convex hull, throwing large triangles across regions with no boreholes — interpolation in name, a guess across a data void in fact — and the alpha-shape clips the surface to where the data actually is, which is what LeapFrog, gINT and GemPy do. The comment records the honest consequences the engineer must know: each formation gets its own extent so inter-formation edges are ragged by design, and to extend a surface past the outer boreholes you add a pick. The coverage tolerance of one millimetre stops the footprint check from false-flagging hull-edge tests, which lie exactly on the ring, while still catching a genuinely dropped component tens of metres away.

.. CG-EXPLANATION-END id=module-header

