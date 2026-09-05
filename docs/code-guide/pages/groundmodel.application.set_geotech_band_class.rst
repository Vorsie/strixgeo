groundmodel.application.set_geotech_band_class
==============================================

.. CG-PAGE source=src/groundmodel/application/set_geotech_band_class.py complete=true

*Source file:* ``src/groundmodel/application/set_geotech_band_class.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-45

.. literalinclude:: ../../../src/groundmodel/application/set_geotech_band_class.py
   :language: python
   :lines: 1-45
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the set-class file. It imports the band-edit helpers, the materialiser base, and the NAD family helpers, and its docstring records the ruling.

**Why it is here.** A borehole band's class is donor-extrapolated, never measured, so the engineer's judgement outranks it (owner 2026-08-18); this repoints the band at the chosen NAD formation and stamps manual provenance without moving geometry. A CPT band is refused (the inverse of the split/merge rule) because its class is measured from its own cone resistance and a hand class would dress an opinion as a measurement.

.. CG-EXPLANATION-END id=module-header

Class ``SetGeotechBandClass`` — header
--------------------------------------

.. CG-BLOCK id=class:SetGeotechBandClass lines=46-57

.. literalinclude:: ../../../src/groundmodel/application/set_geotech_band_class.py
   :language: python
   :lines: 46-57
   :lineno-match:

.. CG-EXPLANATION-START id=class:SetGeotechBandClass

**What this does.** The use case that repoints one borehole band at an engineer-chosen NAD class. It extends the borehole-materialiser base.

**Why it is here.** It inherits the find-or-create helpers so the hand class lands on the same formation rows the build would produce.

.. CG-EXPLANATION-END id=class:SetGeotechBandClass

Method ``SetGeotechBandClass``. ``def __init__``
------------------------------------------------

.. CG-BLOCK id=method:SetGeotechBandClass.__init__ lines=58-60

.. literalinclude:: ../../../src/groundmodel/application/set_geotech_band_class.py
   :language: python
   :lines: 58-60
   :lineno-match:

.. CG-EXPLANATION-START id=method:SetGeotechBandClass.__init__

**What this does.** Initialises the base with this module's name and the session.

**Why it is here.** Same base-and-logger setup.

.. CG-EXPLANATION-END id=method:SetGeotechBandClass.__init__

Method ``SetGeotechBandClass``. ``async def execute``
-----------------------------------------------------

.. CG-BLOCK id=method:SetGeotechBandClass.execute lines=61-208

.. literalinclude:: ../../../src/groundmodel/application/set_geotech_band_class.py
   :language: python
   :lines: 61-208
   :lineno-match:

.. CG-EXPLANATION-START id=method:SetGeotechBandClass.execute

**What this does.** Loads the column, refuses a CPT band and a band with no soil, validates the class against the soil's NAD family, takes the partition lock, repoints the band at the chosen formation with high confidence and manual provenance, re-validates its ties, resolves bodies, sweeps orphan formations, and commits.

**Why it is here.** The class must belong to the soil's family because the coupling between a unit's soil and its packing class is absolute — a packing class describes one soil column and is never valid on another. The confidence becomes high because the class is the engineer's own statement now, and the low donor-distance confidence would be a lie about it. The lock and orphan sweep are for the same reasons as the other band edits.

.. CG-EXPLANATION-END id=method:SetGeotechBandClass.execute

