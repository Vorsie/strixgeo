groundmodel.infrastructure.db.models.cpt_series_orm
===================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/models/cpt_series_orm.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/models/cpt_series_orm.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-15

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/cpt_series_orm.py
   :language: python
   :lines: 1-15
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line and a small toolbox: ``ForeignKey`` and ``String``, the Postgres ``ARRAY`` and ``DOUBLE_PRECISION`` types, the Postgres ``UUID`` type, ``Mapped`` / ``mapped_column`` / ``relationship``, ``Base`` and the loader-strategy constant.

**Why it is here.** ``ARRAY`` is a Postgres column that stores a whole list of numbers in a single field; ``DOUBLE_PRECISION`` is a high-precision float. Together they let one row hold an entire depth series.

.. CG-EXPLANATION-END id=module-header

Class ``CptSeriesOrm``
----------------------

.. CG-BLOCK id=class:CptSeriesOrm lines=16-55

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/cpt_series_orm.py
   :language: python
   :lines: 16-55
   :lineno-match:

.. CG-EXPLANATION-START id=class:CptSeriesOrm

**What this does.** Defines the ``cpt_series`` table: the raw depth-series arrays for one CPT — parallel ``depths_m``, ``qc_mpa``, ``fs_mpa``, ``u2_mpa``, ``rf_pct``, and a CPTM ``q_total_mpa`` — plus an ``rf_source`` provenance flag. Its ``cpt_id`` is both the foreign key and the primary key (one series per CPT).

**Why it is here.** Storing each channel as a Postgres array — one row, one round-trip to fetch the whole curve — is the depth-series decision from CLAUDE.md. The comment records a data-integrity boundary: the CPTU corrected resistance ``qt = qc + u2(1-a)`` is deliberately NOT stored, because it is a fixed formula the cone software already applied, so we recompute it on read instead (Data-Integrity rule 1). The mechanical CPTM total resistance ``q_total`` IS stored, because the apparatus genuinely cannot separate tip from sleeve, so it is a real measurement. ``rf_source`` tags whether Rf came from the file (``measured``) or was divided out by our parser (``computed``).

.. CG-EXPLANATION-END id=class:CptSeriesOrm

