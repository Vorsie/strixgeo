desktop.renderer.src.shell.stages.lithology.LithoFormationRoster
================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/lithology/LithoFormationRoster.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/lithology/LithoFormationRoster.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-25

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/lithology/LithoFormationRoster.tsx
   :language: tsx
   :lines: 1-25
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and imports its tools: a circle icon, the two record types it reads (a formation and a formation-contact) from the engine, the ``lithoDisplayName`` label helper, and the translator type. The comment explains the file holds two things — the flat roster ``LithoFormationRoster`` and the single-row component ``LithoUnitRow`` — and why the row component sits at the top level of the file rather than inside the roster.

**Why it is here.** React is the library that builds the screen from small functions, and each such function is a ``component``. Both were split off ``LithologyInspector.tsx`` during the god-component decomposition round (debt #201). The comment records a real React trap it avoids: a component defined INSIDE another component is treated as a brand-new component on every redraw, so React throws away and rebuilds every row each time the parent redraws (review C-1). Keeping ``LithoUnitRow`` at file scope gives it a stable identity, so rows are updated in place instead of rebuilt.

.. CG-EXPLANATION-END id=module-header

``interface LithoUnitRowProps``
-------------------------------

.. CG-BLOCK id=interface:LithoUnitRowProps lines=26-36

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/lithology/LithoFormationRoster.tsx
   :language: tsx
   :lines: 26-36
   :lineno-match:

.. CG-EXPLANATION-START id=interface:LithoUnitRowProps

**What this does.** Describes one row's inputs: the litho unit ``f``, all ``lithoContacts`` in the model (for the per-unit count), the ``lensCount`` for that unit, an ``onReviewParent`` callback for the parent-review dot, and the translator ``t``.

**Why it is here.** ``props`` are the inputs a parent hands a component. The comment ties two of them to their features: ``lensCount`` is the number of lenses whose parent is this unit (feature slice #101), and ``onReviewParent`` opens the confirm-parent dialog for a unit whose parent needs review (debt #87), its click target being the amber dot on the left of the row.

.. CG-EXPLANATION-END id=interface:LithoUnitRowProps

``function LithoUnitRow``
-------------------------

.. CG-BLOCK id=function:LithoUnitRow lines=37-119

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/lithology/LithoFormationRoster.tsx
   :language: tsx
   :lines: 37-119
   :lineno-match:

.. CG-EXPLANATION-START id=function:LithoUnitRow

**What this does.** Draws one unit row. It counts this unit's contacts, decides whether the parent needs review (the parent was extrapolated, or the unit is an orphan with no parent), and picks the matching tooltip. It draws a colour swatch filled with the unit's stored colour, the unit's name, an amber dot button (only when the parent needs review) that calls ``onReviewParent``, the contact count, and — only when there is at least one lens — a small violet lens-count badge.

**Why it is here.** The name is rendered through ``lithoDisplayName`` from the unit's soil code and admixtures rather than shown raw: the stored ``name`` is the raw Dutch token like "KLEI (KL:Z)", and translating at the presentation boundary (debt #96) shows the readable English label while the domain keeps the raw token. The amber dot makes the parent-review affordance discoverable per row from anywhere in the list (debt #87). The stored colour is the unit's lithology colour, stamped at create time and backfilled (debt #145). The lens badge appears only when a lens exists, so a unit with none stays uncluttered.

.. CG-EXPLANATION-END id=function:LithoUnitRow

``interface LithoFormationRosterProps``
---------------------------------------

.. CG-BLOCK id=interface:LithoFormationRosterProps lines=120-164

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/lithology/LithoFormationRoster.tsx
   :language: tsx
   :lines: 120-164
   :lineno-match:

.. CG-EXPLANATION-START id=interface:LithoFormationRosterProps

**What this does.** Describes the roster's inputs: the ``lithoFormations`` (units in the active litho model), all ``lithoContacts`` in that model, a ``lensCountByFormationId`` map giving each unit its lens count, the ``onReviewParent`` callback, and the translator ``t``. It carries a docstring explaining the flat-list design and each input.

**Why it is here.** ``props`` are the inputs a parent hands a component. The docstring records the key design decision: under the "A2" rule litho units are geo-agnostic, so their parent is always null on accept-created rows; grouping by parent would therefore drop every unit into a single "Unassigned" bucket. A flat list ordered by stratigraphic position is both simpler and more honest than a fake group structure.

.. CG-EXPLANATION-END id=interface:LithoFormationRosterProps

``function LithoFormationRoster``
---------------------------------

.. CG-BLOCK id=function:LithoFormationRoster lines=165-189

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/lithology/LithoFormationRoster.tsx
   :language: tsx
   :lines: 165-189
   :lineno-match:

.. CG-EXPLANATION-START id=function:LithoFormationRoster

**What this does.** Draws the roster: it sorts the units ascending by ``display_order`` (oldest first) and renders one ``LithoUnitRow`` per unit, handing each its lens count (zero when the unit is absent from the map).

**Why it is here.** Sorting oldest-first follows the superposition convention every other renderer uses, so the roster reads like a stratigraphic column. The list is flat and read-only by design: under "A2" all litho units are geo-agnostic so there is no meaningful parent grouping, and formation create/rename/delete stays on the geology stage — the litho roster only shows the shared vocabulary, it does not edit it.

.. CG-EXPLANATION-END id=function:LithoFormationRoster

