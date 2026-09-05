groundmodel.application.orphan_formation_sweep
==============================================

.. CG-PAGE source=src/groundmodel/application/orphan_formation_sweep.py complete=true

*Source file:* ``src/groundmodel/application/orphan_formation_sweep.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-89

.. literalinclude:: ../../../src/groundmodel/application/orphan_formation_sweep.py
   :language: python
   :lines: 1-89
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A long docstring and the imports for the orphan-formation sweep. The docstring explains why a formation row can be left with nothing pointing at it, why deleting such a row is safe, exactly what "unreferenced" means (checked across three tables that carry a formation id with a delete-cascade: the bands, the accepted contacts, and the bodies), and that the sweep takes no lock and never commits.

**Why it is here.** A formation is vocabulary: created on demand and, until this sweep, never removed. Every verb that re-derives a model's content can strand one — the owner saw 62 of 94 rows in the Geotech-units pane describing ground not in the model (2026-08-26). Deleting them is safe because nothing about a formation row is authored: its identity is a find-or-create key and every column is copied from the source litho unit at create time, so a later divide rebuilds an equivalent row. The trap the docstring flags is the body table: the resolver keeps an orphan body when the engineer has NAMED it, and a body cascades to its hand-drawn boundary — so the sweep must count a body as a reference or it would silently delete a boundary. It takes no lock because it runs inside a verb that already holds the body-partition lock, and the litho-parent-before-geotech-child order forbids a project-scoped helper from taking a lock first.

.. CG-EXPLANATION-END id=module-header

Class ``OrphanFormationSweepResult``
------------------------------------

.. CG-BLOCK id=class:OrphanFormationSweepResult lines=90-111

.. literalinclude:: ../../../src/groundmodel/application/orphan_formation_sweep.py
   :language: python
   :lines: 90-111
   :lineno-match:

.. CG-EXPLANATION-START id=class:OrphanFormationSweepResult

**What this does.** A frozen dataclass reporting one sweep: how many formation rows were deleted, their display names in candidate order, and how many built 3-D solid rows the delete cascaded away.

**Why it is here.** The names let the caller name what was removed in its own log or to the engineer. The cascaded-solid count is reported because those rows vanish through a foreign-key rule rather than a statement the sweep issued — a built solid for a formation with no ground left is stale by definition, but it should not disappear unmentioned.

.. CG-EXPLANATION-END id=class:OrphanFormationSweepResult

Class ``OrphanFormationSweep`` — header
---------------------------------------

.. CG-BLOCK id=class:OrphanFormationSweep lines=112-121

.. literalinclude:: ../../../src/groundmodel/application/orphan_formation_sweep.py
   :language: python
   :lines: 112-121
   :lineno-match:

.. CG-EXPLANATION-START id=class:OrphanFormationSweep

**What this does.** The use-case class: delete project formations that no layer, contact or body references.

**Why it is here.** One class per unit of work; it inherits the shared logger. The caller commits; the sweep only issues its statements.

.. CG-EXPLANATION-END id=class:OrphanFormationSweep

Method ``OrphanFormationSweep``. ``def __init__``
-------------------------------------------------

.. CG-BLOCK id=method:OrphanFormationSweep.__init__ lines=122-126

.. literalinclude:: ../../../src/groundmodel/application/orphan_formation_sweep.py
   :language: python
   :lines: 122-126
   :lineno-match:

.. CG-EXPLANATION-START id=method:OrphanFormationSweep.__init__

**What this does.** Stores the session.

**Why it is here.** The caller owns the transaction; the sweep never commits.

.. CG-EXPLANATION-END id=method:OrphanFormationSweep.__init__

Method ``OrphanFormationSweep``. ``async def sweep_geotech_units``
------------------------------------------------------------------

.. CG-BLOCK id=method:OrphanFormationSweep.sweep_geotech_units lines=127-154

.. literalinclude:: ../../../src/groundmodel/application/orphan_formation_sweep.py
   :language: python
   :lines: 127-154
   :lineno-match:

.. CG-EXPLANATION-START id=method:OrphanFormationSweep.sweep_geotech_units

**What this does.** Sweeps unreferenced geotech units in a project — the candidate set is the formations whose source-litho-formation link is set, covering both classified units and borehole-only skeletons.

**Why it is here.** That link is the authoritative geotech discriminator, so litho and geological formations are outside this scope and can never be reached by this call.

.. CG-EXPLANATION-END id=method:OrphanFormationSweep.sweep_geotech_units

Method ``OrphanFormationSweep``. ``async def sweep_litho_vocabulary``
---------------------------------------------------------------------

.. CG-BLOCK id=method:OrphanFormationSweep.sweep_litho_vocabulary lines=155-185

.. literalinclude:: ../../../src/groundmodel/application/orphan_formation_sweep.py
   :language: python
   :lines: 155-185
   :lineno-match:

.. CG-EXPLANATION-START id=method:OrphanFormationSweep.sweep_litho_vocabulary

**What this does.** Sweeps unreferenced litho units in a project — the candidate set is the formations whose litho soil code is set.

**Why it is here.** This scope is deliberately wider than litho alone: a geotech unit inherits its soil code from its source litho unit, so geotech strays are swept here too — which is the wanted behaviour, matching how clearing the litho model has always retired the geotech vocabulary derived from it. Geological formations, which have no soil code, are never candidates.

.. CG-EXPLANATION-END id=method:OrphanFormationSweep.sweep_litho_vocabulary

Method ``OrphanFormationSweep``. ``async def _delete_unreferenced``
-------------------------------------------------------------------

.. CG-BLOCK id=method:OrphanFormationSweep._delete_unreferenced lines=186-265

.. literalinclude:: ../../../src/groundmodel/application/orphan_formation_sweep.py
   :language: python
   :lines: 186-265
   :lineno-match:

.. CG-EXPLANATION-START id=method:OrphanFormationSweep._delete_unreferenced

**What this does.** The shared engine: it runs the candidate query, then for each of the three cascade-carrying tables (bands, contacts, bodies) collects the referenced formation ids project-wide, subtracts them from the candidates to get the true orphans, counts the built solids that will cascade away, deletes the orphans, and returns the count and names.

**Why it is here.** The reference check is project-wide, not model-scoped, because a unit shared with a sibling model still describes real ground and must survive a sweep run from a model that stopped using it. The bodies table is included because of the named-orphan-body trap the module docstring describes. The surface and absence tables are omitted from the predicate on purpose — they are never written for geotech units and a litho/geo formation carrying either still has contacts, so neither can ever be the sole reference.

.. CG-EXPLANATION-END id=method:OrphanFormationSweep._delete_unreferenced

