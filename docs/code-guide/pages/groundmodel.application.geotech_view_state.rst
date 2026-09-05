groundmodel.application.geotech_view_state
==========================================

.. CG-PAGE source=src/groundmodel/application/geotech_view_state.py complete=true

*Source file:* ``src/groundmodel/application/geotech_view_state.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-23

.. literalinclude:: ../../../src/groundmodel/application/geotech_view_state.py
   :language: python
   :lines: 1-23
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces a tiny module that holds one project setting: the
smallest thickness a geotech sub-unit (a packing band) is allowed to be. It
imports the shared view-state readers and defines the default, 0.35 m, used when
a project has not chosen its own.

**Why it is here.** The "view-state" is the per-project bag of user settings
saved with the model. The docstring records that this reader was pulled out on
its *second* caller: "subdivide all bodies" (which cuts a CPT into packing bands)
and "divide boreholes" (which fills borehole columns from mapped neighbours) both
read the same minimum, and the project rule is to extract a shared helper on the
second copy rather than let two copies of the key path drift apart.

.. CG-EXPLANATION-END id=module-header

Function ``async def read_geotech_min_thickness_m``
---------------------------------------------------

.. CG-BLOCK id=function:read_geotech_min_thickness_m lines=24-50

.. literalinclude:: ../../../src/groundmodel/application/geotech_view_state.py
   :language: python
   :lines: 24-50
   :lineno-match:

.. CG-EXPLANATION-START id=function:read_geotech_min_thickness_m

**What this does.** An ``async`` function — one that can pause while it waits for
the database and let other work run meanwhile — that reads one number out of the
project's saved settings and returns it: the project's own minimum packing-band
thickness, or the 0.35 m default when the setting is absent, zero, negative or
not a number.

**Why it is here.** The docstring is explicit that this knob is GEOTECH-specific
and separate from the litho segmenter's own minimum, so coarsening the packing
bands never changes how the lithology layers are cut — the two model levels keep
independent thickness floors.

.. CG-EXPLANATION-END id=function:read_geotech_min_thickness_m

