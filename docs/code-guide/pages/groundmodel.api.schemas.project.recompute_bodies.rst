groundmodel.api.schemas.project.recompute_bodies
================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/recompute_bodies.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/recompute_bodies.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-21

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/recompute_bodies.py
   :language: python
   :lines: 1-21
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A docstring explaining that the request and response form one contract, then imports UUID, the Pydantic tools, the section-partition shape reused from the voxel build, the strict base class, and the domain partition type.

**Why it is here.** The docstring records that the section payload reuses the voxel build's partition shape verbatim (the don't-repeat rule) and that fallback-paint regions are omitted before posting, per an owner ruling (2026-08-12): fallback paint never defines body identity.

.. CG-EXPLANATION-END id=module-header

Class ``RecomputeBodiesRequest`` — header
-----------------------------------------

.. CG-BLOCK id=class:RecomputeBodiesRequest lines=22-44

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/recompute_bodies.py
   :language: python
   :lines: 22-44
   :lineno-match:

.. CG-EXPLANATION-START id=class:RecomputeBodiesRequest

**What this does.** The desktop's connectivity evidence for one model: every section's partition (fallback regions omitted), the section ids parallel to that list, and per-section connectivity groups of layer ids.

**Why it is here.** The comments record a hard-won decision: layer ids are the only currency on the wire, because body ids are labels the recompute itself rewrites, and body-labelled evidence oscillated in production — a merge erased its own grounds on the next payload (dogfeed 2026-08-12 evening). The section ids are sent so the server can verify the set equals the project's sections, since geometry alone cannot prove full coverage (audit item).

.. CG-EXPLANATION-END id=class:RecomputeBodiesRequest

Method ``RecomputeBodiesRequest``. ``def _groups_parallel_to_sections``
-----------------------------------------------------------------------

.. CG-BLOCK id=method:RecomputeBodiesRequest._groups_parallel_to_sections lines=45-54

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/recompute_bodies.py
   :language: python
   :lines: 45-54
   :lineno-match:

.. CG-EXPLANATION-START id=method:RecomputeBodiesRequest._groups_parallel_to_sections

**What this does.** Checks that the connectivity groups list, when present, has exactly one entry per section.

**Why it is here.** A mismatched-length payload is malformed, so it is rejected at the boundary with a clear ``422`` rather than mis-associated deeper in.

.. CG-EXPLANATION-END id=method:RecomputeBodiesRequest._groups_parallel_to_sections

Method ``RecomputeBodiesRequest``. ``def _ids_parallel_to_sections``
--------------------------------------------------------------------

.. CG-BLOCK id=method:RecomputeBodiesRequest._ids_parallel_to_sections lines=55-64

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/recompute_bodies.py
   :language: python
   :lines: 55-64
   :lineno-match:

.. CG-EXPLANATION-START id=method:RecomputeBodiesRequest._ids_parallel_to_sections

**What this does.** Checks that the section-ids list names exactly one section per partition frame.

**Why it is here.** Every frame must name its section for the coverage check to be sound, so an unbalanced list is refused with a clear message.

.. CG-EXPLANATION-END id=method:RecomputeBodiesRequest._ids_parallel_to_sections

Method ``RecomputeBodiesRequest``. ``def to_domain_sections``
-------------------------------------------------------------

.. CG-BLOCK id=method:RecomputeBodiesRequest.to_domain_sections lines=65-69

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/recompute_bodies.py
   :language: python
   :lines: 65-69
   :lineno-match:

.. CG-EXPLANATION-START id=method:RecomputeBodiesRequest.to_domain_sections

**What this does.** Converts the section payload into the frozen domain value objects the recompute service consumes.

**Why it is here.** The web schema is translated into the domain's own immutable types at the boundary, so the service never depends on the web shape (the layer model: the domain has no knowledge of the API).

.. CG-EXPLANATION-END id=method:RecomputeBodiesRequest.to_domain_sections

Class ``RecomputeBodiesResponse``
---------------------------------

.. CG-BLOCK id=class:RecomputeBodiesResponse lines=70-92

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/recompute_bodies.py
   :language: python
   :lines: 70-92
   :lineno-match:

.. CG-EXPLANATION-START id=class:RecomputeBodiesResponse

**What this does.** The difference one recompute produced, for the desktop's toast: facts written, facts dropped as stale, bodies merged and split, and the names displaced by a merge.

**Why it is here.** Reporting the diff lets the desktop tell the engineer exactly what changed. Stale facts are those dropped because a layer left the model since the payload was snapshotted; on a merge the oldest name wins and the others are listed as renamed.

.. CG-EXPLANATION-END id=class:RecomputeBodiesResponse

