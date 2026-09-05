groundmodel.domain.services.assign_sample_to_band
=================================================

.. CG-PAGE source=src/groundmodel/domain/services/assign_sample_to_band.py complete=true

*Source file:* ``src/groundmodel/domain/services/assign_sample_to_band.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-19

.. literalinclude:: ../../../src/groundmodel/domain/services/assign_sample_to_band.py
   :language: python
   :lines: 1-19
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces the file and imports the ``dataclass`` decorator (a
shorthand that turns a class into a plain holder of named values). The file
answers one question: which geotech band does a lab sample fall inside?

**Why it is here.** A sample is placed by its **midpoint** — the depth halfway
between its top and its base. A sample whose depth interval straddles a band
boundary is assigned to the band that holds its midpoint, so a thin, hard-to-place
boundary never splits an otherwise consistent sample. The docstring also notes
that a DOV spot sample, whose top and base depths are equal, has a midpoint equal
to both and is matched correctly by the same containment check. Like its sibling
module it is pure domain logic, with no database and no logging.

.. CG-EXPLANATION-END id=module-header

Class ``Band``
--------------

.. CG-BLOCK id=class:Band lines=20-57

.. literalinclude:: ../../../src/groundmodel/domain/services/assign_sample_to_band.py
   :language: python
   :lines: 20-57
   :lineno-match:

.. CG-EXPLANATION-START id=class:Band

**What this does.** Defines a read-only record holding just enough about one
geotech packing band to place a sample in it: the band's top and base depths
(metres, measured downward), its geotech body identifier (which may be empty),
its NAD packing class (1–31, which may be empty), and a provenance tag saying how
the band was filled.

**Why it is here.** The caller builds this from the fill bands persisted during
"Divide boreholes", adding the body identifier worked out by
``assign_borehole_band_body``. Both the body and the class are allowed to be
empty for the same honest reason: a band filled by a conservative fallback has no
body, and a band the model could not classify has no class. The docstring is
emphatic that an unclassified band must let the sample inherit the gap rather
than a made-up class, which is why the class field is deliberately nullable and
the sample's stored class is nullable too. The provenance tag records whether the
band was interpolated from CPTs or filled by one of the two conservative
fallbacks.

.. CG-EXPLANATION-END id=class:Band

Function ``def assign_sample_to_band``
--------------------------------------

.. CG-BLOCK id=function:assign_sample_to_band lines=58-108

.. literalinclude:: ../../../src/groundmodel/domain/services/assign_sample_to_band.py
   :language: python
   :lines: 58-108
   :lineno-match:

.. CG-EXPLANATION-START id=function:assign_sample_to_band

**What this does.** Computes the sample's midpoint depth, then walks the bands in
order and returns the body, class, and provenance of the first band whose depth
interval contains that midpoint. If the midpoint lies outside every band, it
returns empty values tagged ``"unresolved"``.

**Why it is here.** Placing a sample by its midpoint is the rule set out in the
docstring: it keeps a straddling sample whole instead of cutting it at a boundary.
Because the fill bands are contiguous and non-overlapping, at most one band can
contain a midpoint that does not land exactly on a boundary; in the rare
exact-boundary case the shallowest matching band wins, which is why the list order
matters only there. The ``"unresolved"`` answer is honest rather than a guess — it
marks a sample that sits outside the borehole's geotech-modelled extent, such as a
shallow surface sample above the first geotech layer. The provenance tag it
returns is richer than the plain confident/not-confident flag stored on the layer
row, so the caller keeps the fuller story of how the band was filled.

.. CG-EXPLANATION-END id=function:assign_sample_to_band

