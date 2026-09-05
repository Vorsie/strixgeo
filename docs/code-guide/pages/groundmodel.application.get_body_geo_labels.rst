groundmodel.application.get_body_geo_labels
===========================================

.. CG-PAGE source=src/groundmodel/application/get_body_geo_labels.py complete=true

*Source file:* ``src/groundmodel/application/get_body_geo_labels.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-34

.. literalinclude:: ../../../src/groundmodel/application/get_body_geo_labels.py
   :language: python
   :lines: 1-34
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the geo-labels file: a docstring plus imports of the two domain helpers that pick the majority formation and list all crossed formations, and the row types for contacts, formations, models and litho layers. The docstring says each body's geological name is DERIVED, not stored — it is the formation owning the majority of the body's member-layer thickness, recomputed fresh on every read.

**Why it is here.** This is Data Integrity Rule 1 in practice: the label is *derived on read*, never stored, so it stays correct as bodies merge or split or the geological surfaces are edited — a stored name would go stale. The docstring records it was extracted out of the bodies router (audit ARCH-05) because the three-query join plus the majority aggregation is application logic that needed to be unit-testable, not web plumbing.

.. CG-EXPLANATION-END id=module-header

Class ``BodyGeoLabel``
----------------------

.. CG-BLOCK id=class:BodyGeoLabel lines=35-61

.. literalinclude:: ../../../src/groundmodel/application/get_body_geo_labels.py
   :language: python
   :lines: 35-61
   :lineno-match:

.. CG-EXPLANATION-START id=class:BodyGeoLabel

**What this does.** A frozen dataclass for one body's geological label: the majority formation id, its display name, and a list of every formation the body's members cross, shallowest first.

**Why it is here.** A body can span geological boundaries, so debt #278 R2 says its attribution must be a list, not a single stamp; the singular majority pair is kept alongside for callers that show one name. It holds data only, so it does not inherit the logger (the project's logging-via-inheritance rule).

.. CG-EXPLANATION-END id=class:BodyGeoLabel

Class ``GetBodyGeoLabels`` — header
-----------------------------------

.. CG-BLOCK id=class:GetBodyGeoLabels lines=62-70

.. literalinclude:: ../../../src/groundmodel/application/get_body_geo_labels.py
   :language: python
   :lines: 62-70
   :lineno-match:

.. CG-EXPLANATION-START id=class:GetBodyGeoLabels

**What this does.** Opens the use-case class; its docstring states it takes an active session.

**Why it is here.** Same use-case shape as its neighbours; it inherits ``GroundModelLogger`` for logging under this module's name. It is a read, so it does not commit.

.. CG-EXPLANATION-END id=class:GetBodyGeoLabels

Method ``GetBodyGeoLabels``. ``def __init__``
---------------------------------------------

.. CG-BLOCK id=method:GetBodyGeoLabels.__init__ lines=71-75

.. literalinclude:: ../../../src/groundmodel/application/get_body_geo_labels.py
   :language: python
   :lines: 71-75
   :lineno-match:

.. CG-EXPLANATION-START id=method:GetBodyGeoLabels.__init__

**What this does.** Stores the handed-in session and names the logger after this module.

**Why it is here.** The caller owns the session; ``__name__`` makes the log lines read as coming from this use case.

.. CG-EXPLANATION-END id=method:GetBodyGeoLabels.__init__

Method ``GetBodyGeoLabels``. ``async def _resolve_geo_model_id``
----------------------------------------------------------------

.. CG-BLOCK id=method:GetBodyGeoLabels._resolve_geo_model_id lines=76-117

.. literalinclude:: ../../../src/groundmodel/application/get_body_geo_labels.py
   :language: python
   :lines: 76-117
   :lineno-match:

.. CG-EXPLANATION-START id=method:GetBodyGeoLabels._resolve_geo_model_id

**What this does.** Walks a model up the parent chain to the geological model that owns the chronological contacts: a litho model's parent IS the geological model (one hop); a geotech model's geological ancestor is two hops up (its litho parent, then that parent's geological model); a geological model has no parent and returns nothing.

**Why it is here.** The comment records the bug it fixes: the earlier code always stopped after one hop and, for a geotech model, queried contacts against the litho model — which owns none — so every geotech body's crossed-formation list came back empty. It checks the model's kind rather than assuming a fixed depth, so a future re-homing of the hierarchy stays honest.

.. CG-EXPLANATION-END id=method:GetBodyGeoLabels._resolve_geo_model_id

Method ``GetBodyGeoLabels``. ``async def execute``
--------------------------------------------------

.. CG-BLOCK id=method:GetBodyGeoLabels.execute lines=118-224

.. literalinclude:: ../../../src/groundmodel/application/get_body_geo_labels.py
   :language: python
   :lines: 118-224
   :lineno-match:

.. CG-EXPLANATION-START id=method:GetBodyGeoLabels.execute

**What this does.** Returns each body's derived label. It short-circuits to an empty map when no bodies are asked for or no parent geological model is found; otherwise it loads the bodies' member layers, the geological contacts for the resolved geological model (grouped and sorted per investigation), and the names of the formations those contacts reach; then per body it computes the thickness-weighted majority formation and the full crossed-formation list and packs both into a ``BodyGeoLabel``.

**Why it is here.** The full list is one extra pass over the members already loaded — no new query — per the R2 comment, so listing every crossed formation costs nothing beyond the majority computation. A body absent from the returned map simply has no resolvable geological label, for example when no geological model is defined at its investigations.

.. CG-EXPLANATION-END id=method:GetBodyGeoLabels.execute

