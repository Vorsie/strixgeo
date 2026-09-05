groundmodel.domain.services.dem_clip_constants
==============================================

.. CG-PAGE source=src/groundmodel/domain/services/dem_clip_constants.py complete=true

*Source file:* ``src/groundmodel/domain/services/dem_clip_constants.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-32

.. literalinclude:: ../../../src/groundmodel/domain/services/dem_clip_constants.py
   :language: python
   :lines: 1-32
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Defines three constants for the DEM clip service: the label for a contact whose surveyed top exceeds the terrain, the label for a vertex on a NoData cell, and how far the ground surface is carried past the outermost investigation.

**Why it is here.** The two label strings are a public contract read by the API schema and the desktop when they display an issue, so changing them is a breaking change treated like renaming a REST field. The margin exists because a surface that stops exactly at the last borehole reads as a floating slab; carrying it about fifty metres past gives the eye enough context to read it as ground, a distance negligible against the DEM tile cap.

.. CG-EXPLANATION-END id=module-header

