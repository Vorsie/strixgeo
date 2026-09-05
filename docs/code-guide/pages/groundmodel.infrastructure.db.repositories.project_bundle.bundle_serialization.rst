groundmodel.infrastructure.db.repositories.project_bundle.bundle_serialization
==============================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_serialization.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_serialization.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-132

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_serialization.py
   :language: python
   :lines: 1-132
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A module docstring, imports, the ``_SKIP_COLUMNS`` set of non-portable columns, a table of restore-time key aliases for renamed columns, and the restore-boundary size caps (for the TIN blobs, the CPT series length, and the per-borehole child arrays).

**Why it is here.** It holds the low-level encode / decode helpers plus the constants they need, kept here so any downstream module can import a cap without pulling in the whole build or restore pipeline. ``_SKIP_COLUMNS`` lists exactly the values that do not survive a trip to another machine — the server clocks, the PostGIS blob (rebuilt from x/y), and the build-generation link — per the backwards-compat re-arm (debt #47). The alias table is restore-only: it maps an old bundle key onto its renamed column so an older ``.strix`` written before a rename does not silently lose the value. The size caps are the tamper / accident guard (debt #112, #19): a hostile bundle could otherwise embed a million-row series and exhaust memory.

.. CG-EXPLANATION-END id=module-header

Function ``def _to_json``
-------------------------

.. CG-BLOCK id=function:_to_json lines=133-166

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_serialization.py
   :language: python
   :lines: 133-166
   :lineno-match:

.. CG-EXPLANATION-START id=function:_to_json

**What this does.** Converts one database-side value into a JSON-friendly form — a UUID, date or bytes becomes a string, and lists recurse.

**Why it is here.** JSON has no native UUID, date or bytes, so every such value is flattened before it is written into the bundle.

.. CG-EXPLANATION-END id=function:_to_json

Function ``def _from_json``
---------------------------

.. CG-BLOCK id=function:_from_json lines=167-200

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_serialization.py
   :language: python
   :lines: 167-200
   :lineno-match:

.. CG-EXPLANATION-START id=function:_from_json

**What this does.** The reverse: parses a JSON value back into the database-side Python type, guided by the column's declared type.

**Why it is here.** On restore each value must become the type its column expects again — a string back into a UUID or a date — which the column's type tells it how to do.

.. CG-EXPLANATION-END id=function:_from_json

Function ``def _column_to_json``
--------------------------------

.. CG-BLOCK id=function:_column_to_json lines=201-227

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_serialization.py
   :language: python
   :lines: 201-227
   :lineno-match:

.. CG-EXPLANATION-START id=function:_column_to_json

**What this does.** Snapshots every mapped column of one ORM row into a JSON-friendly dict, skipping the excluded (non-portable) columns and running each value through the encoder.

**Why it is here.** This is the generic per-row serialiser the per-table helpers build on — it reads the column list off the model itself, so a new portable column rides along automatically (which is exactly why the column-pins test freezes that set).

.. CG-EXPLANATION-END id=function:_column_to_json

Function ``def _normalise_restore_keys``
----------------------------------------

.. CG-BLOCK id=function:_normalise_restore_keys lines=228-261

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_serialization.py
   :language: python
   :lines: 228-261
   :lineno-match:

.. CG-EXPLANATION-START id=function:_normalise_restore_keys

**What this does.** Remaps any renamed bundle keys onto their current column names for one row, using the alias table.

**Why it is here.** It is the read-side of the rename story: without it, restoring an older bundle would drop the value under the old key, because the kwargs builder silently ignores keys it does not recognise.

.. CG-EXPLANATION-END id=function:_normalise_restore_keys

Function ``def _apply_json_to_kwargs``
--------------------------------------

.. CG-BLOCK id=function:_apply_json_to_kwargs lines=262-308

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_serialization.py
   :language: python
   :lines: 262-308
   :lineno-match:

.. CG-EXPLANATION-START id=function:_apply_json_to_kwargs

**What this does.** Parses a JSON dict into the keyword arguments an ORM constructor needs: it normalises renamed keys, drops unknown ones, and converts each value back to its database type.

**Why it is here.** It is the inverse of the column snapshot — the bridge from a bundle row dict to a live ORM object. Dropping unknown keys is what lets a bundle written by a newer build (carrying a column this build does not know) still open.

.. CG-EXPLANATION-END id=function:_apply_json_to_kwargs

Function ``def _cpt_to_dict``
-----------------------------

.. CG-BLOCK id=function:_cpt_to_dict lines=309-330

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_serialization.py
   :language: python
   :lines: 309-330
   :lineno-match:

.. CG-EXPLANATION-START id=function:_cpt_to_dict

**What this does.** Serialises one CPT and its optional depth-series into a bundle dict.

**Why it is here.** The per-table serialiser for CPTs; it nests the series under the CPT so the whole thing round-trips as one object.

.. CG-EXPLANATION-END id=function:_cpt_to_dict

Function ``def _borehole_to_dict``
----------------------------------

.. CG-BLOCK id=function:_borehole_to_dict lines=331-357

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_serialization.py
   :language: python
   :lines: 331-357
   :lineno-match:

.. CG-EXPLANATION-START id=function:_borehole_to_dict

**What this does.** Serialises one borehole together with its full child tree (drill segments, field-log intervals, observations with layers and admixtures, and samples with their lab tests).

**Why it is here.** The per-table serialiser for boreholes, mirroring the eager-load tree so nothing in the hole is lost on save.

.. CG-EXPLANATION-END id=function:_borehole_to_dict

Function ``def _observation_to_dict``
-------------------------------------

.. CG-BLOCK id=function:_observation_to_dict lines=358-375

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_serialization.py
   :language: python
   :lines: 358-375
   :lineno-match:

.. CG-EXPLANATION-START id=function:_observation_to_dict

**What this does.** Serialises one observation with its layer children.

**Why it is here.** A nested piece of the borehole serialiser.

.. CG-EXPLANATION-END id=function:_observation_to_dict

Function ``def _layer_to_dict``
-------------------------------

.. CG-BLOCK id=function:_layer_to_dict lines=376-396

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_serialization.py
   :language: python
   :lines: 376-396
   :lineno-match:

.. CG-EXPLANATION-START id=function:_layer_to_dict

**What this does.** Serialises one observation layer with its admixture children.

**Why it is here.** The next level down of the borehole tree.

.. CG-EXPLANATION-END id=function:_layer_to_dict

Function ``def _sample_to_dict``
--------------------------------

.. CG-BLOCK id=function:_sample_to_dict lines=397-424

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_serialization.py
   :language: python
   :lines: 397-424
   :lineno-match:

.. CG-EXPLANATION-START id=function:_sample_to_dict

**What this does.** Serialises one sample with all six lab-test family children.

**Why it is here.** The sample branch of the borehole tree, reading the six families off the shared registry so a seventh would be picked up in one place.

.. CG-EXPLANATION-END id=function:_sample_to_dict

Function ``def _geological_model_to_dict``
------------------------------------------

.. CG-BLOCK id=function:_geological_model_to_dict lines=425-494

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_serialization.py
   :language: python
   :lines: 425-494
   :lineno-match:

.. CG-EXPLANATION-START id=function:_geological_model_to_dict

**What this does.** Serialises one geological model with its formation contacts, cached surfaces, and litho layers nested underneath.

**Why it is here.** The per-table serialiser for the interpretation container — a geological model fills contacts and empties layers, a litho model does the reverse, and both ride the same shape (docs/gmproj-format.md).

.. CG-EXPLANATION-END id=function:_geological_model_to_dict

