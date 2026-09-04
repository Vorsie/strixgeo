groundmodel.domain.services.nad_classification_constants
========================================================

.. CG-PAGE source=src/groundmodel/domain/services/nad_classification_constants.py complete=true

*Source file:* ``src/groundmodel/domain/services/nad_classification_constants.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-95

.. literalinclude:: ../../../src/groundmodel/domain/services/nad_classification_constants.py
   :language: python
   :lines: 1-95
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Holds the actual look-up table that turns a (soil, variant,
cone-resistance) into a NAD packing class from 1 to 31, plus the admixture code
sets that decide the clean-versus-secondary column. For each soil and each
variant it lists ascending ``(upper-cut-off, class)`` bands; the classifier picks
the first band the reading falls under.

**Why it is here.** This is the heart of the geotech stage — the production
thresholds, ported from NBN EN 1997-1 ANB (the Belgian national annex to Eurocode 7),
table 2.1. The docstring records a subtle but important point verified against the
norm: the classification is done on *raw* cone resistance with no normalisation,
because that is the norm's own stated method for this table ("where no
normalisation is applied"); the normalisation warning in the norm belongs to a
*different*, Phase-5 step that converts field readings before pulling design
parameters. The two admixture code sets encode which admixtures make a coarse soil
"silty/clayey" and which make a fine soil "sandy", with the tricky code
collisions (for example ``SL``, which the norm and the interface each use for a
different thing) resolved explicitly per owner ruling.

.. CG-EXPLANATION-END id=module-header

