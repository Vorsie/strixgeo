groundmodel.infrastructure.db.migrations.versions.c4e8a7d3f201_split_qt_mpa_into_qt_and_q_total
===============================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/c4e8a7d3f201_split_qt_mpa_into_qt_and_q_total.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/c4e8a7d3f201_split_qt_mpa_into_qt_and_q_total.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-31

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/c4e8a7d3f201_split_qt_mpa_into_qt_and_q_total.py
   :language: python
   :lines: 1-31
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A migration that splits one column into two physically different quantities and drops a short-lived provenance column. The header carries its revision id and the id it follows.

**Why it is here.** The docstring explains the old single ``qt_mpa`` column conflated two different things: the CPTU piezocone-corrected cone resistance (a calculation, qt = qc + u2(1 minus a)) and the CPTM mechanical-cone total resistance (a single combined reading a Begemann cone cannot separate). It adds ``q_total_mpa`` for the mechanical value, moves the CPTM data across, and drops ``qt_source``, which would always have been measured or empty and so carried no information. The ``rf_source`` flag stays because Rf really does switch between measured and computed.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=32-63

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/c4e8a7d3f201_split_qt_mpa_into_qt_and_q_total.py
   :language: python
   :lines: 32-63
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Adds the ``q_total_mpa`` array column; copies each CPTM row's ``qt_mpa`` into it and then empties the original so the two columns are mutually exclusive; and drops ``qt_source``.

**Why it is here.** The move keeps the mechanical measurement while separating it from the CPTU correction, so later code never confuses the two (see CLAUDE.md, ``q_total_mpa`` for CPTM versus ``qt_mpa`` for CPTU).

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=64-77

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/c4e8a7d3f201_split_qt_mpa_into_qt_and_q_total.py
   :language: python
   :lines: 64-77
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Re-adds ``qt_source``, copies ``q_total_mpa`` back into ``qt_mpa`` where present, then drops ``q_total_mpa``.

**Why it is here.** It restores the old conflated shape as closely as possible; the comment notes provenance for those rows cannot be reconstructed, so ``qt_source`` is left empty.

.. CG-EXPLANATION-END id=function:downgrade

