groundmodel.infrastructure.dem.dem_provider_factory
===================================================

.. CG-PAGE source=src/groundmodel/infrastructure/dem/dem_provider_factory.py complete=true

*Source file:* ``src/groundmodel/infrastructure/dem/dem_provider_factory.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-34

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/dem_provider_factory.py
   :language: python
   :lines: 1-34
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces the factory whose one job is to pick the right DEM provider for a project's map system, and lists the fixed rule: the Belgian grid gets the Belgian provider, the Dutch grid gets the Dutch provider, and any other grid gets no provider at all.

**Why it is here.** A *factory* is a function that builds the correct object for you so callers do not have to know the concrete types. The docstring records that this two-region rule was owner-confirmed (2026-05-16), matching the recorded DEM design of BE + NL support selected by project CRS. Like every infrastructure file it may use its sibling DEM modules but must not reach into the domain or application layers.

.. CG-EXPLANATION-END id=module-header

Class ``NoDemProviderError`` — header
-------------------------------------

.. CG-BLOCK id=class:NoDemProviderError lines=35-43

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/dem_provider_factory.py
   :language: python
   :lines: 35-43
   :lineno-match:

.. CG-EXPLANATION-START id=class:NoDemProviderError

**What this does.** A named error type raised when a project's map system has no DEM provider, carrying the offending EPSG number.

**Why it is here.** Ground-surface data simply does not exist for every map system; giving this its own error type lets the interface show the user a clean "no DEM here" message instead of crashing. The full sentence, listing the two supported systems, is written to be shown as-is.

.. CG-EXPLANATION-END id=class:NoDemProviderError

Method ``NoDemProviderError``. ``def __init__``
-----------------------------------------------

.. CG-BLOCK id=method:NoDemProviderError.__init__ lines=44-53

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/dem_provider_factory.py
   :language: python
   :lines: 44-53
   :lineno-match:

.. CG-EXPLANATION-START id=method:NoDemProviderError.__init__

**What this does.** Builds the error with a ready-to-read message naming the unsupported EPSG number and the two supported ones, and keeps that number on the error.

**Why it is here.** So the code that catches it has both the offending number (for the log) and the exact user-facing sentence (for the message).

.. CG-EXPLANATION-END id=method:NoDemProviderError.__init__

Function ``def build_dem_provider``
-----------------------------------

.. CG-BLOCK id=function:build_dem_provider lines=54-106

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/dem_provider_factory.py
   :language: python
   :lines: 54-106
   :lineno-match:

.. CG-EXPLANATION-START id=function:build_dem_provider

**What this does.** Given a map-system number and a cache folder, looks up which provider serves it, builds that provider's disk cache, and returns a fresh Belgian or Dutch provider; an unsupported number raises ``NoDemProviderError`` and an unknown override raises a plain error.

**Why it is here.** This is the single place that turns a project's map system into a working provider. The optional override exists for tests and rare edge cases (an engineer who knows the data is covered even though the project's CRS is unusual); the docstring says plainly not to use it in the normal path.

.. CG-EXPLANATION-END id=function:build_dem_provider

Function ``def supported_epsg_codes``
-------------------------------------

.. CG-BLOCK id=function:supported_epsg_codes lines=107-115

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/dem_provider_factory.py
   :language: python
   :lines: 107-115
   :lineno-match:

.. CG-EXPLANATION-START id=function:supported_epsg_codes

**What this does.** Returns the set of map-system numbers a DEM provider exists for (today the Belgian and Dutch grids).

**Why it is here.** Lets the interface answer, up front, whether ground-surface build is available for a project without trying to build a provider and catching the failure.

.. CG-EXPLANATION-END id=function:supported_epsg_codes

