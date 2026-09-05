groundmodel.application.import_interpretations_dov
==================================================

.. CG-PAGE source=src/groundmodel/application/import_interpretations_dov.py complete=true

*Source file:* ``src/groundmodel/application/import_interpretations_dov.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-89

.. literalinclude:: ../../../src/groundmodel/application/import_interpretations_dov.py
   :language: python
   :lines: 1-89
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the interpretation-import file. It gathers the WFS-fetch wrapper, the observation domain type and its database rows (observation, its layers, their admixtures), the dedup helper, the interpretation client and parser, and defines a map from each Boringen availability flag to the observation type its stream carries. The docstring lays out the pipeline and explains why it does not commit.

**Why it is here.** This is the phase-C2 companion to the borehole importer. The docstring records the atomicity reason: it persists into the SAME session the parent opened, so boreholes and their interpretations land in one transaction; committing here and then hitting a network error would leave boreholes-without-interpretations on disk with no way to retry just that half. The flag-to-type map is the source of truth for the later WFS-gap cross-check.

.. CG-EXPLANATION-END id=module-header

Class ``ImportInterpretationsDov`` — header
-------------------------------------------

.. CG-BLOCK id=class:ImportInterpretationsDov lines=90-105

.. literalinclude:: ../../../src/groundmodel/application/import_interpretations_dov.py
   :language: python
   :lines: 90-105
   :lineno-match:

.. CG-EXPLANATION-START id=class:ImportInterpretationsDov

**What this does.** Opens the interpretation-import use case, which takes the parent's session and adds rows without flushing.

**Why it is here.** The docstring states the sharing contract again: the parent orchestrator is the single commit point, so this class only stages rows.

.. CG-EXPLANATION-END id=class:ImportInterpretationsDov

Method ``ImportInterpretationsDov``. ``def __init__``
-----------------------------------------------------

.. CG-BLOCK id=method:ImportInterpretationsDov.__init__ lines=106-110

.. literalinclude:: ../../../src/groundmodel/application/import_interpretations_dov.py
   :language: python
   :lines: 106-110
   :lineno-match:

.. CG-EXPLANATION-START id=method:ImportInterpretationsDov.__init__

**What this does.** Stores the shared session.

**Why it is here.** The session is owned by the parent; this use case only borrows it so its writes join the parent's transaction.

.. CG-EXPLANATION-END id=method:ImportInterpretationsDov.__init__

Method ``ImportInterpretationsDov``. ``async def execute``
----------------------------------------------------------

.. CG-BLOCK id=method:ImportInterpretationsDov.execute lines=111-307

.. literalinclude:: ../../../src/groundmodel/application/import_interpretations_dov.py
   :language: python
   :lines: 111-307
   :lineno-match:

.. CG-EXPLANATION-START id=method:ImportInterpretationsDov.execute

**What this does.** Fetches and attaches all interpretations in the bbox for the known boreholes. It queries the eight streams in parallel and downloads and parses each XML, skips those already stored (dedup by DOV permkey), builds and stages one observation tree per new interpretation, then cross-checks the availability flags to warn about WFS gaps, and returns a per-stream summary.

**Why it is here.** The parser closure resolves each interpretation's borehole from the shared test-id map. The dedup is refresh-on-duplicate: an existing borehole only receives interpretations it does not already have. The WFS-gap check is observational, not blocking — DOV's Boringen flags are authoritative but its per-stream layers occasionally lag, so a missing stream logs a warning with the DOV URL so the engineer can verify by hand (this is the recorded issue #6, confirmed live).

.. CG-EXPLANATION-END id=method:ImportInterpretationsDov.execute

Method ``ImportInterpretationsDov``. ``def _build_orm``
-------------------------------------------------------

.. CG-BLOCK id=method:ImportInterpretationsDov._build_orm lines=308-357

.. literalinclude:: ../../../src/groundmodel/application/import_interpretations_dov.py
   :language: python
   :lines: 308-357
   :lineno-match:

.. CG-EXPLANATION-START id=method:ImportInterpretationsDov._build_orm

**What this does.** Maps one parsed observation, with its layers and their admixtures, into a single database row tree — returning nothing when the observation has no usable layers.

**Why it is here.** Empty observations are dropped at this boundary so a consumer never sees an observation with zero layers; the WFS permkey is stored as the stable identity that re-import dedup keys on.

.. CG-EXPLANATION-END id=method:ImportInterpretationsDov._build_orm

Function ``def _observation_type_value``
----------------------------------------

.. CG-BLOCK id=function:_observation_type_value lines=358-367

.. literalinclude:: ../../../src/groundmodel/application/import_interpretations_dov.py
   :language: python
   :lines: 358-367
   :lineno-match:

.. CG-EXPLANATION-START id=function:_observation_type_value

**What this does.** Returns the plain-text value the database stores for an observation type.

**Why it is here.** The database column is free text (kept that way so a ninth interpretation type needs no schema migration), while the enum is the authoritative allow-list; serialising through the enum's value keeps one source of truth.

.. CG-EXPLANATION-END id=function:_observation_type_value

