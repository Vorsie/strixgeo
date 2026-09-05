groundmodel.api.schemas.project.geotech_band_edit.geotech_band_interval_item
============================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/geotech_band_edit/geotech_band_interval_item.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/geotech_band_edit/geotech_band_interval_item.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-7

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geotech_band_edit/geotech_band_interval_item.py
   :language: python
   :lines: 1-7
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the schema and imports the Pydantic tools.

**Why it is here.** The item schema embedded in the plan response above; the same schema pattern.

.. CG-EXPLANATION-END id=module-header

Class ``GeotechBandIntervalItem``
---------------------------------

.. CG-BLOCK id=class:GeotechBandIntervalItem lines=8-55

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geotech_band_edit/geotech_band_interval_item.py
   :language: python
   :lines: 8-55
   :lineno-match:

.. CG-EXPLANATION-START id=class:GeotechBandIntervalItem

**What this does.** One interval a split or merge would produce: its top and base depth, its representative cone resistance (with a deprecated older field name kept alongside it), its re-derived NAD packing class, the class it carries today, whether the class changed, and a reason when no class could be derived. The ``| None`` on several fields means the value may be absent.

**Why it is here.** The docstring records two decisions: the ``median_qc_mpa`` name is kept populated for older clients but carries the same value as the correctly-named representative field (the field predates the selectable-statistic ruling); and when the cone resistance cannot answer, the class is left absent and the band is flagged for review rather than given a guessed value. The NAD packing class is a characterisation output (MVP scope); design-ready parameters stay Phase 5. Class source: NBN EN 1997-1 ANB Tabel 2.1.

.. CG-EXPLANATION-END id=class:GeotechBandIntervalItem

