groundmodel.infrastructure.parsers.borehole.dov.sample_wfs_row
==============================================================

.. CG-PAGE source=src/groundmodel/infrastructure/parsers/borehole/dov/sample_wfs_row.py complete=true

*Source file:* ``src/groundmodel/infrastructure/parsers/borehole/dov/sample_wfs_row.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-38

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/borehole/dov/sample_wfs_row.py
   :language: python
   :lines: 1-38
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A docstring explaining why the sample row alone is enough, then the imports for the row type.

**Why it is here.** The per-sample detail XML is mostly redundant with the WFS row, and every field the sample entity needs can be read from the row, so this platform never fetches that XML. Every metadata field is optional on DOV's side — older samples omit most — so the builder treats each as possibly blank and stores blanks faithfully rather than inventing defaults.

.. CG-EXPLANATION-END id=module-header

Class ``SampleWfsRow``
----------------------

.. CG-BLOCK id=class:SampleWfsRow lines=39-95

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/borehole/dov/sample_wfs_row.py
   :language: python
   :lines: 39-95
   :lineno-match:

.. CG-EXPLANATION-START id=class:SampleWfsRow

**What this does.** An unchangeable data-holder for one soil sample from the WFS: its key, its parent borehole key, the detail URL, the depth interval, and the optional metadata — sample number, type, composition, instrument, date, and reported observation count.

**Why it is here.** Source-vocabulary words like the sample type are stored exactly as DOV sent them and translated only at the screen. The detail URL is kept even though it is unused today, so a future step could fetch the XML without re-querying. A spot sample where top equals base is valid.

.. CG-EXPLANATION-END id=class:SampleWfsRow

