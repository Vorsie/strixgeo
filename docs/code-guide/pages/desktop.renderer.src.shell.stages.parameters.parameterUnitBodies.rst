desktop.renderer.src.shell.stages.parameters.parameterUnitBodies
================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/parameters/parameterUnitBodies.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/parameters/parameterUnitBodies.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-21

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/parameterUnitBodies.ts
   :language: typescript
   :lines: 1-21
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the file that holds the body level of the Parameters unit scope as pure arithmetic — no React. It lists what lives here: the reduced roster shape ``BodyRosterEntry``, the ``bodyLabelOf`` label helper, and ``bodyHomeUnitId`` for deciding which unit a body-resolved jump reports.

**Why it is here.** The docstring quotes the owner's body definition (2026-08-27): a body is a body only if it is geometrically connected or the user says it is the same as another. The engine's resolver already implements that — a body is a connected component of same-lithology layers plus user-accepted ties — so this module only READS the ``body_id`` the resolver stamped; it never resolves anything itself. The row-building and header composition that used to live here moved into ``parameterBodyTree`` and ``parameterScopeHeader``.

.. CG-EXPLANATION-END id=module-header

``interface BodyRosterEntry``
-----------------------------

.. CG-BLOCK id=interface:BodyRosterEntry lines=22-59

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/parameterUnitBodies.ts
   :language: typescript
   :lines: 22-59
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BodyRosterEntry

**What this does.** Names the reduced set of roster fields a body label reads: the engineer's name (or ``null``), the body's ordinal within its naming group, and optionally its HOME formation — the one unit row the body renders under. It also inherits the crossed-formation fields a body spans.

**Why it is here.** It is a slimmed-down view of the full body-list row so label code depends only on the few fields it truly needs. The home formation is optional so small test fixtures stay valid; a roster entry without it simply degrades to attributing the body by its layer's own formation. The crossed-formation fields come along because the roster is fed full body-list rows that already carry them, so the scope header can read the geological context without a second fetch.

.. CG-EXPLANATION-END id=interface:BodyRosterEntry

``function bodyLabelOf``
------------------------

.. CG-BLOCK id=function:bodyLabelOf lines=60-92

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/parameterUnitBodies.ts
   :language: typescript
   :lines: 60-92
   :lineno-match:

.. CG-EXPLANATION-START id=function:bodyLabelOf

**What this does.** Returns a body's display label the way the 3-D legend names bodies: the engineer's trimmed name if set, otherwise "#<ordinal>", and a stable 8-character id prefix when the roster does not know the body at all.

**Why it is here.** This is the shared fallback the other label helpers lean on. The id-prefix case — matching the body context menu's precedent — means a body whose roster row is still loading or whose stamp is stale is never blank and never lies about being resolved: it shows a short piece of its id instead of pretending to have a name.

.. CG-EXPLANATION-END id=function:bodyLabelOf

``function bodyHomeUnitId``
---------------------------

.. CG-BLOCK id=function:bodyHomeUnitId lines=93-100

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/parameterUnitBodies.ts
   :language: typescript
   :lines: 93-100
   :lineno-match:

.. CG-EXPLANATION-START id=function:bodyHomeUnitId

**What this does.** Given the formation the clicked surface reported, a resolved body id (or none), and the roster, returns which unit id a jump into the Parameters stage should report: the body's HOME formation when a body resolved and the roster knows it, otherwise the reported label.

**Why it is here.** The fill overlays report the LABEL of the region under the click, and that label can be a twin formation row — or, on the geotech axis, a litho-frame id — while the body's own row lives under its home formation. When a body resolved, the home wins so the jump lands on the body's real unit; with no body, or a body the roster does not know, the reported label is the honest answer and stands.

.. CG-EXPLANATION-END id=function:bodyHomeUnitId

