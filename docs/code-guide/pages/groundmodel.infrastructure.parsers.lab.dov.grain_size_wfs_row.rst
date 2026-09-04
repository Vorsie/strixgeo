groundmodel.infrastructure.parsers.lab.dov.grain_size_wfs_row
=============================================================

.. CG-PAGE source=src/groundmodel/infrastructure/parsers/lab/dov/grain_size_wfs_row.py complete=true

*Source file:* ``src/groundmodel/infrastructure/parsers/lab/dov/grain_size_wfs_row.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-28

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/lab/dov/grain_size_wfs_row.py
   :language: python
   :lines: 1-28
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A docstring explaining why grain-size tests are filtered on the server, then the import for the row type.

**Why it is here.** The shared observations layer holds every lab test across every test type, so a rectangle could return tens of thousands of features nearly all of which are unwanted. Filtering by test type on the server cuts both the download and the recursive-split work, so a sparse stream stays sparse.

.. CG-EXPLANATION-END id=module-header

Class ``GrainSizeWfsRow``
-------------------------

.. CG-BLOCK id=class:GrainSizeWfsRow lines=29-69

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/lab/dov/grain_size_wfs_row.py
   :language: python
   :lines: 29-69
   :lineno-match:

.. CG-EXPLANATION-START id=class:GrainSizeWfsRow

**What this does.** An unchangeable data-holder for one grain-size observation from the WFS: its key, its parent sample's key, the record URLs, and the source-vocabulary method string.

**Why it is here.** It keeps the method from the WFS row as a fallback, because the detail XML sometimes omits the method tag — so the stored method is never blank just because the XML left it out. It does not carry the parent borehole key: the chain from grain-size to sample to borehole is already intact through the sample's own link, so tracking it again here would be redundant.

.. CG-EXPLANATION-END id=class:GrainSizeWfsRow

