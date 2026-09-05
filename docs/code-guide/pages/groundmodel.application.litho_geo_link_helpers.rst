groundmodel.application.litho_geo_link_helpers
==============================================

.. CG-PAGE source=src/groundmodel/application/litho_geo_link_helpers.py complete=true

*Source file:* ``src/groundmodel/application/litho_geo_link_helpers.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-21

.. literalinclude:: ../../../src/groundmodel/application/litho_geo_link_helpers.py
   :language: python
   :lines: 1-21
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening docstring and imports of a small shared-helpers module. The docstring says two use cases — the accept-time auto-link and the manual re-link — both couple a litho contact to the nearest geological contact on the same investigation, and these two helpers are the shared arithmetic; the imports are the database query builder, the session type and the contact row type.

**Why it is here.** The docstring records that both use cases previously carried near-identical private copies of these helpers (audit reference, debt #224), so they are extracted here under the project's extract-on-second-copy rule. A single shared copy means a fix lands in one place, and the two routes cannot drift apart.

.. CG-EXPLANATION-END id=module-header

Function ``def nearest_geo_contact_within_tolerance``
-----------------------------------------------------

.. CG-BLOCK id=function:nearest_geo_contact_within_tolerance lines=22-56

.. literalinclude:: ../../../src/groundmodel/application/litho_geo_link_helpers.py
   :language: python
   :lines: 22-56
   :lineno-match:

.. CG-EXPLANATION-START id=function:nearest_geo_contact_within_tolerance

**What this does.** A pure function (it computes only from its inputs, touching no database) that, given a litho depth, a list of geological contacts at the same investigation, and a tolerance, returns the id of the nearest geological contact within that tolerance, or nothing.

**Why it is here.** It is the single definition of how a litho contact chooses its geological partner: nearest wins, and only if within the tolerance. Being pure, it is trivial to test and is shared by both the accept-time and manual link paths so they choose identically.

.. CG-EXPLANATION-END id=function:nearest_geo_contact_within_tolerance

Function ``async def load_geo_contacts_at_investigation``
---------------------------------------------------------

.. CG-BLOCK id=function:load_geo_contacts_at_investigation lines=57-96

.. literalinclude:: ../../../src/groundmodel/application/litho_geo_link_helpers.py
   :language: python
   :lines: 57-96
   :lineno-match:

.. CG-EXPLANATION-START id=function:load_geo_contacts_at_investigation

**What this does.** An async helper that reads the geological model's contacts on one investigation — filtered to the borehole or the CPT, whichever anchors the contact — ordered shallow-to-deep, and returns each as a depth, formation id and contact id.

**Why it is here.** It is the database read that feeds the pure nearest-contact chooser above. Ordering by depth gives a stable, readable list, and scoping to the one investigation keeps the candidate set to the contacts that could actually couple.

.. CG-EXPLANATION-END id=function:load_geo_contacts_at_investigation

