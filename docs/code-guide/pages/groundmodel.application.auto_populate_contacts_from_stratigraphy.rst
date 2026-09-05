groundmodel.application.auto_populate_contacts_from_stratigraphy
================================================================

.. CG-PAGE source=src/groundmodel/application/auto_populate_contacts_from_stratigraphy.py complete=true

*Source file:* ``src/groundmodel/application/auto_populate_contacts_from_stratigraphy.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-127

.. literalinclude:: ../../../src/groundmodel/application/auto_populate_contacts_from_stratigraphy.py
   :language: python
   :lines: 1-127
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening of the auto-populate use case: a long docstring that explains the whole idea, then the imports, then a re-export list. A *use case* is one complete job the program can be asked to do, written as one class. The docstring describes the job: read a borehole's two stratigraphy streams — the FORMAL one (the standardised regional names, e.g. a member of the Egem sands) and the INFORMAL one (the engineer's working name, e.g. Boom clay) — and turn each layer into a formation contact (a recorded top-of-a-formation depth). The imports pull in helpers this file borrows: the outcome data holder, the collision holder, the shared naming/key helpers (extracted to the stratigraphy-bridge and stratigraphy-scan files), the database row types, and the two repositories. The re-export list at the bottom keeps older code working that used to import those helpers from here.

**Why it is here.** This is the engine behind the geological-model editor's "Seed from stratigraphy" and Fill buttons. The docstring pins down the rules that make it safe and repeatable: FORMAL is the authoritative source and INFORMAL is only walked when there is no formal stream; a layer's identity is a stable key (the formal code when present, else the working name) so the same unit merges across boreholes; and each contact is linked back to the exact observation layer it came from so pressing the button again does nothing new (this is the "idempotent" property — running twice leaves the same result as running once). It also states the transaction discipline: one commit for the whole batch, and any mid-run failure rolls everything back, so the model is never left half-seeded. The re-exports and the note about the key helper moving to a shared module exist to avoid an infrastructure-imports-application layering violation while keeping old import paths alive.

.. CG-EXPLANATION-END id=module-header

Class ``AutoPopulateContactsFromStratigraphy`` — header
-------------------------------------------------------

.. CG-BLOCK id=class:AutoPopulateContactsFromStratigraphy lines=128-130

.. literalinclude:: ../../../src/groundmodel/application/auto_populate_contacts_from_stratigraphy.py
   :language: python
   :lines: 128-130
   :lineno-match:

.. CG-EXPLANATION-START id=class:AutoPopulateContactsFromStratigraphy

**What this does.** Names the use-case class and gives it a one-line summary: seed a geological model with contacts derived from DOV stratigraphy. DOV is the public Flemish subsurface database the boreholes were imported from.

**Why it is here.** One class per unit of work is the application-layer convention. It inherits the shared logger base so its log lines carry this module's name.

.. CG-EXPLANATION-END id=class:AutoPopulateContactsFromStratigraphy

Method ``AutoPopulateContactsFromStratigraphy``. ``def __init__``
-----------------------------------------------------------------

.. CG-BLOCK id=method:AutoPopulateContactsFromStratigraphy.__init__ lines=131-136

.. literalinclude:: ../../../src/groundmodel/application/auto_populate_contacts_from_stratigraphy.py
   :language: python
   :lines: 131-136
   :lineno-match:

.. CG-EXPLANATION-START id=method:AutoPopulateContactsFromStratigraphy.__init__

**What this does.** The set-up step. It stores the database *session* (the open connection-and-workspace in which reads and writes happen and are later committed) and builds a geology *repository* — the object that reads and writes geology rows so this class never writes raw SQL.

**Why it is here.** The session is passed in rather than opened here because the caller owns the transaction boundary; this use case only commits once, at the end of ``execute``. Passing ``__name__`` to the logger base makes the log read as coming from this use case.

.. CG-EXPLANATION-END id=method:AutoPopulateContactsFromStratigraphy.__init__

Method ``AutoPopulateContactsFromStratigraphy``. ``async def execute``
----------------------------------------------------------------------

.. CG-BLOCK id=method:AutoPopulateContactsFromStratigraphy.execute lines=137-890

.. literalinclude:: ../../../src/groundmodel/application/auto_populate_contacts_from_stratigraphy.py
   :language: python
   :lines: 137-890
   :lineno-match:

.. CG-EXPLANATION-START id=method:AutoPopulateContactsFromStratigraphy.execute

**What this does.** The one public step, run as one transaction. In order it: coerces the requested add-or-overwrite mode; normalises the caller's selected formation keys through the same function that minted them; loads every requested borehole with its observations and layers in one round-trip; pre-loads every existing project formation and indexes it by stable key (so dash/space/case variants and old raw-code formations collapse to one slot); purges orphaned contacts left by a crashed prior run; loads the model's existing contacts into two fast look-up sets (one keyed on the source layer, one on the borehole-plus-formation pair); then walks each borehole's layers shallowest-first, pairs each layer with its best-overlapping counterpart in the other stream, derives the (name, regional reference, key) triple, applies the lumping/bridge resolution, filters by the selected keys, drops same-borehole duplicates keeping only the shallowest, finds-or-creates the formation, and adds a contact unless the engineer already has one on that column. After the walk it re-orders the newly-created formations oldest-first (by regional geological age when every new unit is in the G3Dv3 catalogue, else by mean depth), marks the touched formation surfaces stale so the section view shows them dashed until the next Build, optionally deletes unselected formations in overwrite mode, assembles the lumping-collision warnings, commits once, and returns the counts and ids.

**Why it is here.** Every branch here guards a specific past failure named in the comments. Add is the default mode and the deletion pass is *skipped* — not computed-then-discarded — because an old client or a forgotten field must never be able to delete the engineer's saved model by omission (the 2026-08-03 data-loss incident). The ``create_missing_formations=False`` path enforces the explicit-content invariant (owner directive 2026-05-17): the Sections "Seed" path places contacts only for formations the engineer already curated and never mints a new one, which is what stopped Seed from silently adding a second Ieper/Roubaix. The shared naming/key/lumping helpers are used verbatim so the discover preview, the write path and the seed all produce identical keys — the discover-equals-apply-equals-seed invariant. Shallowest-wins on a same-borehole collision because the shallowest contact is the formation's first appearance and two tops for one formation would corrupt the surface triangulation. The delete is restricted to formations that actually have a contact in THIS model because formations are a project-wide shared vocabulary with no model foreign key, so a project-only scope would cascade-delete units belonging to sibling models. New formations are ordered oldest-first to honour the modelling-hierarchy convention (lower display order = older). Marking surfaces stale rather than rebuilding them is the on-click-build contract: only an explicit Build clears the stale flag.

.. CG-EXPLANATION-END id=method:AutoPopulateContactsFromStratigraphy.execute

