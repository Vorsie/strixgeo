groundmodel.domain.services.voxel_litho.packing_class_key
=========================================================

.. CG-PAGE source=src/groundmodel/domain/services/voxel_litho/packing_class_key.py complete=true

*Source file:* ``src/groundmodel/domain/services/voxel_litho/packing_class_key.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-35

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/packing_class_key.py
   :language: python
   :lines: 1-35
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This module has one job: turn a geotech formation's row identifier into the identity the 3-D voxel paint uses to decide whether two patches are the same body. It imports only the typing helpers it needs and declares its single public function.

**Why it is here.** Since the R1 ruling (owner 2026-08-31, debt #278) the geotech model keeps one geological-formation row per (NAD packing class, litho parent), and the geological parent is a live-derived label, not identity, so a single litho unit that spans a geological boundary keeps ONE row. The owner's rule for the paint is 'one mass one body': two patches of the same packing class are one body. This module writes that row-to-class translation in one place so the cross-section body merge for the voxel paint compares the same identity the 2-D fill does. The docstring is emphatic that this collapse feeds the 3-D paint ONLY; the persisted body-identity engine went permanently granular (owner 2026-09-01) and keys on the raw row instead, a deliberate divergence. NAD packing classes are the 1 to 31 classes of NBN EN 1997-1 ANB Tabel 2.1. It is a pure domain module that computes and does not act, so nothing inherits the logging base.

.. CG-EXPLANATION-END id=module-header

Function ``def packing_class_key_of``
-------------------------------------

.. CG-BLOCK id=function:packing_class_key_of lines=36-75

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/packing_class_key.py
   :language: python
   :lines: 36-75
   :lineno-match:

.. CG-EXPLANATION-START id=function:packing_class_key_of

**What this does.** Takes the project's geotech formation rows, each a plain triple of (formation id, NAD class, main soil code), and builds a small lookup function. That returned function maps a formation id to the text key soil-code|nad-class when the row carries both halves, and to the id unchanged for anything else, including an id it has never seen.

**Why it is here.** The domain layer must stay free of database types, so the caller passes plain triples of strings and numbers, never database rows. A dict (a lookup table from a key to a value) is built once and captured by the returned function, so keying every region is cheap. The load-bearing rule is what happens when a row is missing half its identity: a skeleton band over unread ground has no class, and a row may lack a soil code. Either way the row keeps its own id and never welds, because, as the docstring puts it, two unknowns are not known to be the same density. Collapsing a missing half to a placeholder token would silently weld formations that were never shown to share a soil. This mirrors the same guard in ``resolve_litho_instances`` and the frontend twin, so backend and frontend agree on what 'same body' means.

.. CG-EXPLANATION-END id=function:packing_class_key_of

