groundmodel.domain.services.body_fact_translation
=================================================

.. CG-PAGE source=src/groundmodel/domain/services/body_fact_translation.py complete=true

*Source file:* ``src/groundmodel/domain/services/body_fact_translation.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-31

.. literalinclude:: ../../../src/groundmodel/domain/services/body_fact_translation.py
   :language: python
   :lines: 1-31
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces the helper that turns geometric layer-connectivity groups into pairwise facts. A fact is a small record saying two layers were observed to touch. It imports the collection and dataclass tools and names its one public function.

**Why it is here.** The docstring records a load-bearing lesson. The first design expressed this evidence in BODY ids and oscillated in production: once a recompute merged two bodies, the next payload's evidence collapsed and the bodies split again, flapping every few minutes. Evidence must be expressed in LAYER ids, which never change, so the same geometry always plans the same facts and the recompute is idempotent. Facts are emitted as ALL pairs of a group, never a star on one anchor, so losing one layer detaches only itself.

.. CG-EXPLANATION-END id=module-header

Class ``FactTranslationResult``
-------------------------------

.. CG-BLOCK id=class:FactTranslationResult lines=32-45

.. literalinclude:: ../../../src/groundmodel/domain/services/body_fact_translation.py
   :language: python
   :lines: 32-45
   :lineno-match:

.. CG-EXPLANATION-START id=class:FactTranslationResult

**What this does.** A frozen data holder wrapping the planned facts: a tuple of layer-id pairs, each ordered so the smaller id is first, de-duplicated and sorted.

**Why it is here.** Bundling the result in a named, ordered, de-duplicated form makes the output deterministic, so two runs on the same geometry produce byte-identical facts. That determinism is what lets the recompute be a safe wholesale replace.

.. CG-EXPLANATION-END id=class:FactTranslationResult

Function ``def plan_geometry_facts``
------------------------------------

.. CG-BLOCK id=function:plan_geometry_facts lines=46-104

.. literalinclude:: ../../../src/groundmodel/domain/services/body_fact_translation.py
   :language: python
   :lines: 46-104
   :lineno-match:

.. CG-EXPLANATION-START id=function:plan_geometry_facts

**What this does.** Unions all the input groups with a union-find structure, then emits every pair within each resulting group. A union-find is a bookkeeping trick that answers which items have been merged into the same set. It takes the per-section touching groups and the cross-section groups, merges them, collects the connected components, and returns all within-component pairs.

**Why it is here.** This is how observed adjacency, both within a section and across sections at shared columns or fence crossings, becomes the evidence the body resolver later reads. Bodies are resolver connected-components over these facts unioned with approved correlation edges, per the owner ruling that every same-soil mass that is connected should get one body id. Emitting all pairs rather than a star follows the module docstring's rule so one dead layer cannot shatter a whole component.

.. CG-EXPLANATION-END id=function:plan_geometry_facts

