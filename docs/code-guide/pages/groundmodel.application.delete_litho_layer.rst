groundmodel.application.delete_litho_layer
==========================================

.. CG-PAGE source=src/groundmodel/application/delete_litho_layer.py complete=true

*Source file:* ``src/groundmodel/application/delete_litho_layer.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-55

.. literalinclude:: ../../../src/groundmodel/application/delete_litho_layer.py
   :language: python
   :lines: 1-55
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's opening: a docstring (the quoted note at the top describing the file) that lays out this use case and then the list of tools it borrows. A use case is one complete unit of work the program can be asked to do; this one deletes a single lithostratigraphic layer (one soil band drawn on one investigation column) and tidies up everything that deletion touches. The imports pull in the partition lock, the litho-instance resolver, the layer database row type, and the three repositories (a repository is the object that reads and writes database rows so the use case never writes raw database commands).

**Why it is here.** The docstring records the whole reconciliation contract, so the reader sees the consequences before the code. Deleting an accepted layer lets the database's own triggers (small automatic rules the database runs on a change) remove its mirrored formation-contact row, and lets correlation edges that referenced it fall away by cascade (a foreign-key rule that deletes dependent rows automatically). Afterwards the use case re-runs the resolver so the instance-ordinal numbering stays coherent, marks the affected surface stale (accepted layers only, because only they feed the interpolated surface), and unseeds the deleted id from every section. It deliberately does NOT recompute bodies (owner directive 2026-05-31): stale body rows survive until the startup or restore sweep reconciles them. The closing paragraph records the real bug it fixed: after the writers moved to the layers endpoint, the delete endpoint was missed and returned 405, so this use case supplies the missing server side.

.. CG-EXPLANATION-END id=module-header

Class ``DeleteLithoLayer`` — header
-----------------------------------

.. CG-BLOCK id=class:DeleteLithoLayer lines=56-65

.. literalinclude:: ../../../src/groundmodel/application/delete_litho_layer.py
   :language: python
   :lines: 56-65
   :lineno-match:

.. CG-EXPLANATION-START id=class:DeleteLithoLayer

**What this does.** The class header. It declares a class that carries the delete operation and inherits ``GroundModelLogger`` so it can write log lines. It also sets one constant, a boundary-coincidence tolerance of one centimetre, used later to decide whether two depths count as the same physical level.

**Why it is here.** The docstring says it mirrors the shape of the older delete-formation-contact use case so the newer layer path behaves identically to the contact path it replaced. The one-centimetre tolerance matches the snap and drag knobs used elsewhere, so a boundary that a drag left at, say, 2.000001 m still counts as meeting a neighbour at 2.0 m.

.. CG-EXPLANATION-END id=class:DeleteLithoLayer

Method ``DeleteLithoLayer``. ``def __init__``
---------------------------------------------

.. CG-BLOCK id=method:DeleteLithoLayer.__init__ lines=66-73

.. literalinclude:: ../../../src/groundmodel/application/delete_litho_layer.py
   :language: python
   :lines: 66-73
   :lineno-match:

.. CG-EXPLANATION-START id=method:DeleteLithoLayer.__init__

**What this does.** The setup step that runs when the use case is created. It stores the database session it was handed and builds the three repositories it will use: the litho-layer repository, the geology repository and the cross-section repository.

**Why it is here.** The session (the open conversation with the database that groups reads and writes into one transaction) is owned by the caller and passed in, not opened here, so the whole delete lands in one commit the caller controls. Passing this module's name to the logger makes the log lines read as coming from this use case.

.. CG-EXPLANATION-END id=method:DeleteLithoLayer.__init__

Method ``DeleteLithoLayer``. ``async def _close_surface_gap``
-------------------------------------------------------------

.. CG-BLOCK id=method:DeleteLithoLayer._close_surface_gap lines=74-117

.. literalinclude:: ../../../src/groundmodel/application/delete_litho_layer.py
   :language: python
   :lines: 74-117
   :lineno-match:

.. CG-EXPLANATION-START id=method:DeleteLithoLayer._close_surface_gap

**What this does.** A private helper that, when the just-deleted layer was the shallowest one on its column, pulls the new shallowest layer's top up to the deleted layer's old top so no hole is left at the surface. It lists the column's remaining accepted layers, returns nothing if a layer's base already met the deleted top (meaning the delete was in the middle, not at the surface), otherwise finds the new topmost layer and extends its top upward.

**Why it is here.** The soil column must have no gaps (owner directive 2026-06-04). The mirror trigger re-derives every layer's base from the next contact down, so deleting a middle or bottom layer already closes the column downward, but it never extends the first layer's top. Deleting the shallowest layer would therefore leave a hole between the ground surface and the new first contact; this closes it. It returns the extended layer's formation id so the caller can mark that formation's surface stale.

.. CG-EXPLANATION-END id=method:DeleteLithoLayer._close_surface_gap

Method ``DeleteLithoLayer``. ``async def execute``
--------------------------------------------------

.. CG-BLOCK id=method:DeleteLithoLayer.execute lines=118-193

.. literalinclude:: ../../../src/groundmodel/application/delete_litho_layer.py
   :language: python
   :lines: 118-193
   :lineno-match:

.. CG-EXPLANATION-START id=method:DeleteLithoLayer.execute

**What this does.** The one public entry point. It takes the partition lock, snapshots the layer before removing it, deletes the row, and then reconciles: for an accepted layer it marks the formation surface stale (plus any surface changed by the gap-fill), stales the 3-D solid cache, re-runs the litho-instance resolver, and unseeds the deleted id from every section. It commits once and returns true when a row was removed, false when it was already gone.

**Why it is here.** The comments give the reason for each step. The partition lock is taken BEFORE the first write, not later inside the resolver, because this transaction deletes the layer and edits its neighbour while the debounced background body-recompute stamps the same rows in a different order; taking it late caused a deadlock (owner dogfeed 2026-08-23). A deadlock is two operations each waiting for a row the other holds, so neither can finish; the lock is re-entrant per session so the resolver's later take stays free. The pre-state is captured before the delete because the row is gone afterwards. Only accepted layers stale a surface, because pending and rejected layers never contributed to the interpolated surface. Returning false for an already-gone row makes the delete idempotent (running it twice leaves the same result as running it once), and the router treats both outcomes as a 204 success.

.. CG-EXPLANATION-END id=method:DeleteLithoLayer.execute

