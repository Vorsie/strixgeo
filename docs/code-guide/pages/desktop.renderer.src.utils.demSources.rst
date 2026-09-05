desktop.renderer.src.utils.demSources
=====================================

.. CG-PAGE source=desktop/src/renderer/src/utils/demSources.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/demSources.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-20

.. literalinclude:: ../../../desktop/src/renderer/src/utils/demSources.ts
   :language: typescript
   :lines: 1-20
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A comment describing this file as the registry of digital-elevation-model (terrain) sources for the map's hillshade overlay: each entry maps a project's horizontal coordinate reference system, named by its EPSG number, to a public map service and the layer that renders as shaded relief. It then imports a view-state reader.

**Why it is here.** The comment records that the overlay is for visual context only — sampling raw elevation for the cross-section ground line is a separate path — that the endpoints were verified live against each provider's capabilities on 2026-05-11, and that adding a new country is just a new entry in this one map because it is the only thing that needs to know about it.

.. CG-EXPLANATION-END id=module-header

``interface DemSource``
-----------------------

.. CG-BLOCK id=interface:DemSource lines=21-38

.. literalinclude:: ../../../desktop/src/renderer/src/utils/demSources.ts
   :language: typescript
   :lines: 21-38
   :lineno-match:

.. CG-EXPLANATION-START id=interface:DemSource

**What this does.** Describes one terrain source: its service endpoint, the layer to request, the image format, the required attribution, a human label, and a short provider name.

**Why it is here.** The field comments record that the layer must return a hillshade-style image and that the attribution is required by both providers' licences — so the shape carries exactly what a licence-correct request and badge need.

.. CG-EXPLANATION-END id=interface:DemSource

``const DEM_SOURCES``
---------------------

.. CG-BLOCK id=const:DEM_SOURCES lines=39-73

.. literalinclude:: ../../../desktop/src/renderer/src/utils/demSources.ts
   :language: typescript
   :lines: 39-73
   :lineno-match:

.. CG-EXPLANATION-START id=const:DEM_SOURCES

**What this does.** The map from a project's horizontal EPSG number to its terrain source: EPSG 31370 (Belgian Lambert 72) uses the Flemish hillshade service, and EPSG 28992 (the Dutch grid) uses the Netherlands terrain service.

**Why it is here.** The comments record that both entries were verified live on 2026-05-11, that the Dutch provider has no dedicated hillshade so its terrain layer's built-in shaded-relief style is used instead (to be swapped if a proper one lands), and that the project's default horizontal EPSG drives the selection — a project with no horizontal EPSG simply has no terrain overlay.

.. CG-EXPLANATION-END id=const:DEM_SOURCES

``function demSourceForEpsg``
-----------------------------

.. CG-BLOCK id=function:demSourceForEpsg lines=74-86

.. literalinclude:: ../../../desktop/src/renderer/src/utils/demSources.ts
   :language: typescript
   :lines: 74-86
   :lineno-match:

.. CG-EXPLANATION-START id=function:demSourceForEpsg

**What this does.** Looks up the terrain source for a project's horizontal EPSG, returning nothing when that coordinate system has no source mapped.

**Why it is here.** The docstring records that when it returns nothing the UI hides the terrain toggle entirely, so an unsupported coordinate system offers no dead control.

.. CG-EXPLANATION-END id=function:demSourceForEpsg

``interface DemOverlayState``
-----------------------------

.. CG-BLOCK id=interface:DemOverlayState lines=87-94

.. literalinclude:: ../../../desktop/src/renderer/src/utils/demSources.ts
   :language: typescript
   :lines: 87-94
   :lineno-match:

.. CG-EXPLANATION-START id=interface:DemOverlayState

**What this does.** Describes the saved state of the terrain overlay: whether it is enabled and its opacity from zero to one.

**Why it is here.** The comment records that this state is persisted in the project bundle (unlike the screen-chrome toggles) and that opacity is clamped at write time so a hand-edited bundle cannot leave the overlay invisible or fully saturated forever.

.. CG-EXPLANATION-END id=interface:DemOverlayState

``const DEFAULT_DEM_OVERLAY``
-----------------------------

.. CG-BLOCK id=const:DEFAULT_DEM_OVERLAY lines=95-106

.. literalinclude:: ../../../desktop/src/renderer/src/utils/demSources.ts
   :language: typescript
   :lines: 95-106
   :lineno-match:

.. CG-EXPLANATION-START id=const:DEFAULT_DEM_OVERLAY

**What this does.** The default overlay state: disabled, at half opacity.

**Why it is here.** A sensible starting point when a project has never set the overlay, and the value a revert restores.

.. CG-EXPLANATION-END id=const:DEFAULT_DEM_OVERLAY

``function readDemOverlay``
---------------------------

.. CG-BLOCK id=function:readDemOverlay lines=107-120

.. literalinclude:: ../../../desktop/src/renderer/src/utils/demSources.ts
   :language: typescript
   :lines: 107-120
   :lineno-match:

.. CG-EXPLANATION-START id=function:readDemOverlay

**What this does.** Pulls the overlay state out of a project's view-state bag, filling in defaults for missing keys and clamping opacity: it reads the enabled flag and opacity, and collapses any non-finite or out-of-range opacity to the default.

**Why it is here.** The docstring records that it treats a hand-edited or migrated bundle gracefully — never throwing, always returning a usable shape — and the comment records that a bad opacity number must not render an invisible or permanently saturated overlay.

.. CG-EXPLANATION-END id=function:readDemOverlay

