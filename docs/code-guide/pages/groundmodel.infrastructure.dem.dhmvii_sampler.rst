groundmodel.infrastructure.dem.dhmvii_sampler
=============================================

.. CG-PAGE source=src/groundmodel/infrastructure/dem/dhmvii_sampler.py complete=true

*Source file:* ``src/groundmodel/infrastructure/dem/dhmvii_sampler.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-39

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/dhmvii_sampler.py
   :language: python
   :lines: 1-39
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces a file of pure helpers: split the Belgian service's two-part reply to get the raw image, and sample an image's heights at evenly-spaced points along a line. It imports the image library and the Belgian NoData marker.

**Why it is here.** The docstring records that the network and cache side of line-sampling now lives on the shared base (feature #234 retired the old second HTTP stack), leaving only the pure, testable pieces here. It also records the georeferencing facts verified on live data — that a pixel's size is the box width divided by the image width, and that image row 0 is the top (highest Y) edge — and why the lightweight Pillow library is enough for a few thousand look-ups rather than pulling in a heavier numerical stack.

.. CG-EXPLANATION-END id=module-header

Class ``SamplePoint``
---------------------

.. CG-BLOCK id=class:SamplePoint lines=40-51

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/dhmvii_sampler.py
   :language: python
   :lines: 40-51
   :lineno-match:

.. CG-EXPLANATION-START id=class:SamplePoint

**What this does.** A small frozen data holder for one elevation sample: how far along the line it sits (in metres) and its height in m TAW, which is ``None`` when the cell had no data.

**Why it is here.** It is the single, tidy shape the profile is returned as. Height being ``None`` — not a number — is how "no measurement here" travels honestly up to the drawing code, so a data hole is never drawn as a real elevation. (0 m TAW itself is a real height, never a stand-in for missing.)

.. CG-EXPLANATION-END id=class:SamplePoint

Function ``def parse_wcs_multipart``
------------------------------------

.. CG-BLOCK id=function:parse_wcs_multipart lines=52-79

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/dhmvii_sampler.py
   :language: python
   :lines: 52-79
   :lineno-match:

.. CG-EXPLANATION-START id=function:parse_wcs_multipart

**What this does.** Splits the Belgian service's two-part reply and returns just the image; if there is no image part it raises a clear error.

**Why it is here.** The reply is an XML description followed by the image, and only the image is needed — the request box plus the image size are enough to place it. A reply with no image is almost always the server's own error message sent with a success code, so surfacing that as a readable error points straight at the likely cause (a box outside Flanders).

.. CG-EXPLANATION-END id=function:parse_wcs_multipart

Function ``def _sample_bilinear``
---------------------------------

.. CG-BLOCK id=function:_sample_bilinear lines=80-124

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/dhmvii_sampler.py
   :language: python
   :lines: 80-124
   :lineno-match:

.. CG-EXPLANATION-START id=function:_sample_bilinear

**What this does.** Blends the four grid cells surrounding a fractional pixel position to estimate a height, returning ``None`` if any of the four is NoData; it clamps positions on the right or bottom edge so an edge sample still works. Which values count as NoData can be supplied, defaulting to the Belgian ``-9999`` rule.

**Why it is here.** This is the same honest bilinear blend used elsewhere: a smooth estimate between measured cells, but a refusal to blend a real height with a "no data" marker. Making the NoData test swappable lets the Dutch threshold rule reuse the exact same sampler.

.. CG-EXPLANATION-END id=function:_sample_bilinear

Function ``def _dhmvii_is_nodata``
----------------------------------

.. CG-BLOCK id=function:_dhmvii_is_nodata lines=125-129

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/dhmvii_sampler.py
   :language: python
   :lines: 125-129
   :lineno-match:

.. CG-EXPLANATION-START id=function:_dhmvii_is_nodata

**What this does.** The default NoData test — a value is missing when it equals ``-9999``.

**Why it is here.** It is the Belgian source's rule, used whenever a caller does not pass its own.

.. CG-EXPLANATION-END id=function:_dhmvii_is_nodata

Function ``def sample_geotiff_along_line``
------------------------------------------

.. CG-BLOCK id=function:sample_geotiff_along_line lines=130-184

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/dhmvii_sampler.py
   :language: python
   :lines: 130-184
   :lineno-match:

.. CG-EXPLANATION-START id=function:sample_geotiff_along_line

**What this does.** Opens an image and returns a chosen number of evenly-spaced elevation samples from a line's start point to its end point: it works out the pixel size from the box and image dimensions, walks the line in equal steps, converts each world point to a pixel position (flipping the vertical axis because row 0 is the top), and blends the surrounding cells.

**Why it is here.** This is the whole 1-D profile in one pure function, kept apart from any network or cache concern so it is easy to test on a fixed image. It returns nothing for a zero-length line or fewer than two requested points, because a profile needs at least two ends.

.. CG-EXPLANATION-END id=function:sample_geotiff_along_line

