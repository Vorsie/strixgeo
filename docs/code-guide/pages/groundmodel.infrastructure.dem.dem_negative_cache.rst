groundmodel.infrastructure.dem.dem_negative_cache
=================================================

.. CG-PAGE source=src/groundmodel/infrastructure/dem/dem_negative_cache.py complete=true

*Source file:* ``src/groundmodel/infrastructure/dem/dem_negative_cache.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-44

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/dem_negative_cache.py
   :language: python
   :lines: 1-44
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces a small, process-wide memory of DEM tile requests that have recently and permanently failed, and defines the shape of a tile's identity key (the provider name, the four box edges, and the resolution, all rounded to millimetres).

**Why it is here.** The docstring records the exact bug this fixes (dogfeed 2026-08-02): one impossible request — a degenerate strip anchored at the origin — was sent to the web service dozens of times in a single session because nothing remembered the previous ``404``. A *cache* is a store of past answers so they need not be recomputed; this is its "negative" twin, remembering failures rather than successes. Rounding the key to millimetres means tiny rounding noise in the box arithmetic cannot make the same tile look like a new one.

.. CG-EXPLANATION-END id=module-header

Function ``def make_tile_key``
------------------------------

.. CG-BLOCK id=function:make_tile_key lines=45-78

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/dem_negative_cache.py
   :language: python
   :lines: 45-78
   :lineno-match:

.. CG-EXPLANATION-START id=function:make_tile_key

**What this does.** Builds one tile's identity: the provider id plus its four box edges and cell size, each multiplied by a thousand and rounded to a whole number.

**Why it is here.** Both recording a failure and looking one up must produce the exact same key for the same tile, so the key is built in one place. Rounding to whole millimetres (times a thousand) removes floating-point noise that would otherwise split one real tile into many near-identical keys.

.. CG-EXPLANATION-END id=function:make_tile_key

Class ``DemNegativeCache`` — header
-----------------------------------

.. CG-BLOCK id=class:DemNegativeCache lines=79-88

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/dem_negative_cache.py
   :language: python
   :lines: 79-88
   :lineno-match:

.. CG-EXPLANATION-START id=class:DemNegativeCache

**What this does.** Declares the short-lived record of failed tile keys, holding the suppression window (how long a failure is remembered) and a table of key-to-time-of-failure.

**Why it is here.** The suppression window has a sensible default from the constants file but can be set for tests. Keeping this as a plain class lets one shared instance carry the memory across many per-request provider objects.

.. CG-EXPLANATION-END id=class:DemNegativeCache

Method ``DemNegativeCache``. ``def __init__``
---------------------------------------------

.. CG-BLOCK id=method:DemNegativeCache.__init__ lines=89-93

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/dem_negative_cache.py
   :language: python
   :lines: 89-93
   :lineno-match:

.. CG-EXPLANATION-START id=method:DemNegativeCache.__init__

**What this does.** Sets up an empty record with the given remember-for-how-long window.

**Why it is here.** Every cache starts empty; the window is stored so each lookup can decide whether a past failure has aged out.

.. CG-EXPLANATION-END id=method:DemNegativeCache.__init__

Method ``DemNegativeCache``. ``def record_failure``
---------------------------------------------------

.. CG-BLOCK id=method:DemNegativeCache.record_failure lines=94-107

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/dem_negative_cache.py
   :language: python
   :lines: 94-107
   :lineno-match:

.. CG-EXPLANATION-START id=method:DemNegativeCache.record_failure

**What this does.** Notes that a given tile key just failed, stamping it with the current time. The clock can be supplied by a test.

**Why it is here.** A *monotonic clock* is a steadily-rising timer that is immune to the wall clock being changed; using it means the suppression window is measured correctly even if the system time jumps. Letting a test pass its own time value means the window can be tested without actually waiting.

.. CG-EXPLANATION-END id=method:DemNegativeCache.record_failure

Method ``DemNegativeCache``. ``def seconds_until_retry``
--------------------------------------------------------

.. CG-BLOCK id=method:DemNegativeCache.seconds_until_retry lines=108-139

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/dem_negative_cache.py
   :language: python
   :lines: 108-139
   :lineno-match:

.. CG-EXPLANATION-START id=method:DemNegativeCache.seconds_until_retry

**What this does.** Returns how many seconds a tile stays suppressed, or ``0.0`` when it may be tried now; an entry whose window has elapsed is dropped as it is read.

**Why it is here.** This is the question the provider asks before touching the network. The docstring notes the accepted trade-off: a key that fails once and is never asked about again lingers in memory for the life of the program, which is fine because it is one number and the realistic worst case is a handful of impossible tiles per session.

.. CG-EXPLANATION-END id=method:DemNegativeCache.seconds_until_retry

Method ``DemNegativeCache``. ``def clear``
------------------------------------------

.. CG-BLOCK id=method:DemNegativeCache.clear lines=140-150

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/dem_negative_cache.py
   :language: python
   :lines: 140-150
   :lineno-match:

.. CG-EXPLANATION-START id=method:DemNegativeCache.clear

**What this does.** Forgets every recorded failure.

**Why it is here.** Used only by tests. The docstring explains there is deliberately no user-facing "reset": only permanent failures are recorded, so a manual retry would only ask the same impossible question again.

.. CG-EXPLANATION-END id=method:DemNegativeCache.clear

Module-level constants and statements
-------------------------------------

.. CG-BLOCK id=module-statements lines=151-151

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/dem_negative_cache.py
   :language: python
   :lines: 151-151
   :lineno-match:

.. CG-EXPLANATION-START id=module-statements

**What this does.** Creates one shared instance of the negative cache at the bottom of the file.

**Why it is here.** A *singleton* is a single shared object used everywhere. The docstring explains why it must be process-wide: DEM providers are built fresh for each request, so if the memory lived on the provider it would forget everything between two clicks — exactly the flood this module exists to stop.

.. CG-EXPLANATION-END id=module-statements

