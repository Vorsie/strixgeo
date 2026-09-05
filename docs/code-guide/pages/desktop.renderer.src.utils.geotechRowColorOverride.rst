desktop.renderer.src.utils.geotechRowColorOverride
==================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/geotechRowColorOverride.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/geotechRowColorOverride.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-21

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechRowColorOverride.ts
   :language: typescript
   :lines: 1-21
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file answers one question: what picked colour should a row of geotech units show, or none when it has one. The comment explains that both trees which group geotech units under a packing class — the units pane and the 3-D legend — draw one swatch for a row that may stand for several units, and they must answer "whose colour?" identically or the two panes would disagree about the same class in front of the engineer. So the rule lives here once.

**Why it is here.** The reasons are recorded in the comment. The rule is that a pick reaches the row only when every unit under it carries the same one; editing a row writes all its units in one gesture, so a row with mixed picks can only arise from outside the pane, and then the automatic colour is the answer that misrepresents neither unit. It is kept apart from the palette helper because this is the row-level question and needs no palette at all — the caller decides the automatic fallback.

.. CG-EXPLANATION-END id=module-header

``interface GeotechPickedColourRef``
------------------------------------

.. CG-BLOCK id=interface:GeotechPickedColourRef lines=22-33

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechRowColorOverride.ts
   :language: typescript
   :lines: 22-33
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GeotechPickedColourRef

**What this does.** Describes the one field this helper reads off a unit: the colour the engineer may have picked for it (which may be absent or empty).

**Why it is here.** Declaring just the field it needs lets the helper accept any unit shape that carries a colour override, without depending on the full formation type.

.. CG-EXPLANATION-END id=interface:GeotechPickedColourRef

``function geotechRowColorOverride``
------------------------------------

.. CG-BLOCK id=function:geotechRowColorOverride lines=34-40

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechRowColorOverride.ts
   :language: typescript
   :lines: 34-40
   :lineno-match:

.. CG-EXPLANATION-START id=function:geotechRowColorOverride

**What this does.** Returns the colour picked for a row only when every unit in it carries that same pick; otherwise returns none. It takes the first unit's pick, and if that is absent, or any other unit differs, it returns nothing.

**Why it is here.** This enforces the module's rule — a pick represents the row only when it is unanimous — so a row with mixed picks falls back to the caller's automatic colour rather than showing one unit's colour as if it spoke for all. An empty list answers "none" rather than throwing.

.. CG-EXPLANATION-END id=function:geotechRowColorOverride

