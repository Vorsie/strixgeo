groundmodel.domain.services.assign_borehole_band_body
=====================================================

.. CG-PAGE source=src/groundmodel/domain/services/assign_borehole_band_body.py complete=true

*Source file:* ``src/groundmodel/domain/services/assign_borehole_band_body.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-35

.. literalinclude:: ../../../src/groundmodel/domain/services/assign_borehole_band_body.py
   :language: python
   :lines: 1-35
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the file and imports its two tools: the ``dataclass``
decorator (a shorthand that turns a class into a plain holder of named values)
and ``UUID`` (the type of the long unique identifier the app gives every row).
The docstring states the file's one job: take a borehole packing band that has
just been given a packing class, and find which geotech body it belongs to.

**Why it is here.** A borehole has no cone-penetration-test (CPT) tip-resistance
series, so its packing bands are filled by copying from neighbouring CPT bands of
the same soil (see the flanking-CPT rule in ``borehole_packing_fill``). Once
filled, each band still has to join the right **geotech body** — the group of
same-packing sub-bands that the resolver has connected across tests (a geotech
body is one soil and one packing class, "one mass one body"). The docstring
records the exact rule: among the CPT bands in the same litho-body group that
share this band's NAD packing class (1–31 per NBN EN 1997-1 ANB Tabel 2.1) and
already carry a body, pick the spatially nearest one; when none exists, return
nothing; and on an exact distance tie the body whose identifier text sorts first
wins, so the answer is the same no matter what order the data arrived in. It is
pure domain knowledge — no database, no logging.

.. CG-EXPLANATION-END id=module-header

Class ``CptBandRef``
--------------------

.. CG-BLOCK id=class:CptBandRef lines=36-59

.. literalinclude:: ../../../src/groundmodel/domain/services/assign_borehole_band_body.py
   :language: python
   :lines: 36-59
   :lineno-match:

.. CG-EXPLANATION-START id=class:CptBandRef

**What this does.** Defines a small read-only record describing one CPT geotech
band: the CPT's map position (x and y in metres, for example Lambert 72 easting
and northing), the band's NAD packing class, and the band's geotech body
identifier, which may be empty. ``@dataclass(frozen=True)`` means "this is just a
bundle of named values, and it cannot be changed once it is made".

**Why it is here.** The nearest-body search below needs exactly these four facts
about each candidate band and nothing else, so bundling them under clear names is
safer than passing four loose values around. The body identifier is allowed to be
empty because a band is sometimes unresolved — a skeleton band with no usable tip
resistance, or a lone CPT with no correlation edges to its neighbours — and the
search must be able to skip those rather than trip over them.

.. CG-EXPLANATION-END id=class:CptBandRef

Function ``def assign_borehole_band_body``
------------------------------------------

.. CG-BLOCK id=function:assign_borehole_band_body lines=60-113

.. literalinclude:: ../../../src/groundmodel/domain/services/assign_borehole_band_body.py
   :language: python
   :lines: 60-113
   :lineno-match:

.. CG-EXPLANATION-START id=function:assign_borehole_band_body

**What this does.** Keeps only the CPT bands that share the borehole band's
packing class and that already have a body. If none remain, it returns nothing.
Otherwise it returns the body of the closest such CPT, measuring distance from
the borehole's map position and breaking an exact tie on the body identifier's
text.

**Why it is here.** This is the rule from the docstring turned into code. It
measures distance as the *squared* distance (the sum of the squared x and y gaps)
and never takes the square root, because the nearest point is the same either way
and the square root would be wasted work. Returning nothing when no same-class CPT
band exists is deliberate: it means the borehole band was filled by a conservative
fallback and there is no CPT evidence of that packing class in the group, so
inventing a body would be a false claim. The text tie-break makes the result
independent of the order the bands happened to be listed in.

.. CG-EXPLANATION-END id=function:assign_borehole_band_body

