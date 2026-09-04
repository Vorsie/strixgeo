groundmodel.infrastructure.parsers.borehole.dov.dov_constants
=============================================================

.. CG-PAGE source=src/groundmodel/infrastructure/parsers/borehole/dov/dov_constants.py complete=true

*Source file:* ``src/groundmodel/infrastructure/parsers/borehole/dov/dov_constants.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-261

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/borehole/dov/dov_constants.py
   :language: python
   :lines: 1-261
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Holds the fixed values the borehole DOV code reads against. It re-exports the shared DOV values and defines the borehole-specific ones: the WFS layer names for boreholes and samples, the map from interpretation kind to its WFS layer, the URL prefixes for the redirect-skipping trick, the WFS property names for samples and interpretations, and the many element-name tags of the borehole and interpretation XML.

**Why it is here.** Keeping every fixed value in one place, with a comment on why it was chosen, is the project convention, and the comments here carry hard-won facts. Several record the exact WFS property name DOV really uses versus the name the documentation suggested — using the wrong one once caused every interpretation row to be skipped, and two sample fields turned out to be named differently from the docs. These are the store-what-the-API-really-returns lessons captured next to the values they fixed.

.. CG-EXPLANATION-END id=module-header

