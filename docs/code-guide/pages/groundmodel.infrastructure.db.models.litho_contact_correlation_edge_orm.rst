groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm
=======================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/models/litho_contact_correlation_edge_orm.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/models/litho_contact_correlation_edge_orm.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-25

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/litho_contact_correlation_edge_orm.py
   :language: python
   :lines: 1-25
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line and the toolbox: ``Boolean``, ``CheckConstraint``, ``DateTime``, ``ForeignKey``, ``Index``, ``String``, ``Text``, ``UniqueConstraint``, ``func`` and ``text``, plus the Postgres ``UUID`` type, ``Mapped`` / ``mapped_column`` and ``Base``.

**Why it is here.** The building blocks for a correlation-edge table with canonical-order and side-enum guards.

.. CG-EXPLANATION-END id=module-header

Class ``LithoContactCorrelationEdgeOrm``
----------------------------------------

.. CG-BLOCK id=class:LithoContactCorrelationEdgeOrm lines=26-213

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/litho_contact_correlation_edge_orm.py
   :language: python
   :lines: 26-213
   :lineno-match:

.. CG-EXPLANATION-START id=class:LithoContactCorrelationEdgeOrm

**What this does.** Defines the ``litho_contact_correlation_edge`` table: a record that two litho layers carry the *same stratigraphic boundary* at different investigation columns. It holds the model and section ids, the two layer ids (canonical smallest-first), a ``side`` for each endpoint (top or base), a ``source`` (manual or auto) and a ``user_approved`` flag. Check and unique constraints keep the pair ordered, non-self, and unique per (model, section, pair, sides).

**Why it is here.** These edges are what the resolver walks to trace a body across a section: two edges (one at the top, one at the base) bound a band. They are *section-scoped* (owner directive 2026-06-08) — the same pair on two sections gets its own row and ribbon — while the model-level resolver still unions all sections' approved edges into one body. The ``side`` columns let a top-tie and a base 'bottom-tie' between the same two layers coexist, which is how the deepest layer (no layer below it) can still be correlated at its base so it can band. Auto edges are speculative (``user_approved`` false) until the engineer accepts them.

.. CG-EXPLANATION-END id=class:LithoContactCorrelationEdgeOrm

