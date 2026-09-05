StrixGeo User Manual
====================

StrixGeo builds and manages the unified subsurface dataset for a ground
engineering project. It ingests your CPT and borehole data, lets you interpret
it into a three-level ground model (stratigraphic, then lithological, then
geotechnical), and exports that model to the design tools you already use
(Plaxis, D-Stability, D-Sheet Piling, DXF).

This manual explains, in plain English, **what the program does at every stage**
and, in the methods chapter, **how every calculation is performed**, with the
equation, its symbols and units, and the published reference behind it.

A note on scope, in one sentence. StrixGeo produces a **characterisation** of the
ground (the model geometry, the soil-behaviour classification, the packing class,
and descriptive statistics) and derives characteristic soil parameters from the
Belgian NAD table. It does not, in this version, perform the design calculations
themselves (bearing capacity, settlement, slope stability, pile or wall design).
Those run in your downstream tool, using StrixGeo's export as their input. The
first chapter explains where that line is drawn today, and where it will move as
StrixGeo grows.

.. toctree::
   :maxdepth: 2
   :caption: Contents
   :numbered:

   chapters/01-what-strixgeo-is
   chapters/02-stages
   chapters/03-methods
   chapters/04-references
   chapters/05-support
