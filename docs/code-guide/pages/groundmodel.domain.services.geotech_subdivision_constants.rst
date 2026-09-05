groundmodel.domain.services.geotech_subdivision_constants
=========================================================

.. CG-PAGE source=src/groundmodel/domain/services/geotech_subdivision_constants.py complete=true

*Source file:* ``src/groundmodel/domain/services/geotech_subdivision_constants.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-30

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_subdivision_constants.py
   :language: python
   :lines: 1-30
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The whole file is one lookup table,
``LITHO_ABSOLUTE_MIN_NAD`` (a lookup table is a dictionary — a set of named
entries, here each of the five soil families paired with a number). It maps
GRIND (gravel), ZAND (sand), SILT, KLEI (clay) and VEEN (peat) to the weakest,
lowest-numbered NAD packing class in that family.

**Why it is here.** NAD packing classes are numbered weak-to-strong within a
lithology (NBN EN 1997-1 ANB Tabel 2.1), so the smallest number in a family is
the most conservative — the loosest packing or weakest consistency. Kept in its
own constants file per the project rule that module-level constants live beside
their class file. A comment records that the borehole absolute-minimum fallback
no longer reads this table (it uses the variant-aware
``nad_classifier.loosest_class_for``, which floors a silty sand to 9, not 5);
the table stays because the integration suite's family-floor checks are
variant-blind by construction.

.. CG-EXPLANATION-END id=module-header

