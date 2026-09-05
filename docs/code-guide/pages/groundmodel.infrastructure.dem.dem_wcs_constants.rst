groundmodel.infrastructure.dem.dem_wcs_constants
================================================

.. CG-PAGE source=src/groundmodel/infrastructure/dem/dem_wcs_constants.py complete=true

*Source file:* ``src/groundmodel/infrastructure/dem/dem_wcs_constants.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-113

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/dem_wcs_constants.py
   :language: python
   :lines: 1-113
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Holds every fixed value the DEM providers share, in one place: the web-service version and network timeout, the box padding and the size caps, the failure-suppression window, and then the per-source blocks for Belgium (DHMVII) and the Netherlands (AHN4) — their web addresses, coverage names, NoData markers, and sensible-coordinate boxes.

**Why it is here.** The project convention is that fixed values live in a dedicated ``*_constants.py`` file so a web-address change or a NoData correction touches one place, and every comment records why the value was chosen. The two guard caps are safety limits, not tuning: the extent span cap rejects requests larger than any real project (a sign the caller passed bad coordinates), and the decode-pixel cap protects the backend against a hostile or broken server that claims a billion-pixel image in a tiny reply. The "valid extent" boxes are each CRS's own area of use — they reject coordinates that cannot be that map system at all (such as the origin-anchored strip from the 2026-08-02 dogfeed), while still allowing legitimate requests that simply return NoData. The docstring records the dates the two live endpoints were verified.

.. CG-EXPLANATION-END id=module-header

