References
==========

The published sources behind the methods, and the standards and data formats the
program relies on. Each method in the methods chapter names the reference it
implements; this list gathers them in one place.

CPT correlations
----------------

* **Robertson, P. K. (2009).** Interpretation of cone penetration tests - A
  unified approach. Canadian Geotechnical Journal, 46(11), 1337–1355. The
  normalised cone parameters, the soil-behaviour-type index, and the iterative
  stress exponent.

* **Robertson, P. K., & Cabal, K. L. (2015).** Guide to Cone Penetration Testing
  for Geotechnical Engineering. The CPT unit-weight correlation, the
  soil-behaviour-type chart and zones, the non-normalised index, and the
  relative-density correlation as tabulated for practice.

* **Jamiolkowski, M., lo Presti, D. C. F., & Manassero, M. (2003).** Evaluation of
  Relative Density and Shear Strength of Sands from CPT and DMT, 201–238. The
  relative-density correlation for clean sands and its compressibility factor.

* **Lengkeek, A. W., & Brinkgreve, R. B. J. (2022).** Automated CPT-based peat
  identification. The organic and peat boundary extension to the
  soil-behaviour-type chart.

* **Lunne, T., Robertson, P. K., & Powell, J. J. M. (1997).** Cone Penetration
  Testing in Geotechnical Practice. The standard practitioner text on CPT
  interpretation, the background to the correlations above.

Soil mechanics
--------------

* **Terzaghi, K., Peck, R. B., & Mesri, G. (1996).** Soil Mechanics in
  Engineering Practice (3rd edition). The effective-stress principle behind the
  vertical-stress profile.

* **Verruijt, A. (2001).** Soil Mechanics. A modern treatment of the same
  effective-stress principle.

Soil identification and classification
--------------------------------------

The lithological descriptions follow the soil-identification standard.

* **NBN (Belgisch normalisatie bureau). (2018).** Geotechnical investigation and
  testing - Identification and classification of soil - Part 1: Identification and
  description (ISO 14688-1:2018).

* **NBN (Belgisch normalisatie bureau). (2018).** Geotechnical investigation and
  testing - Identification and classification of soil - Part 2: Principles for a
  classification (ISO 14688-2:2018).

Field and sampling standards
----------------------------

* **NBN (Belgisch normalisatie bureau). (2023).** Geotechnical investigation and
  testing - Field testing - Part 1: Electrical cone and piezocone penetration
  test, NBN EN ISO 22476-1:2023. The CPT itself.

* **NBN (Belgisch normalisatie bureau). (2021).** Geotechnical investigation and
  testing - Sampling methods and groundwater measurements - Part 1: Technical
  principles for the sampling of soil, rock and groundwater (ISO 22475-1:2021).
  The borehole sampling.

The NAD classification table
----------------------------

* **NBN (Belgisch normalisatie bureau). (2022).** Eurocode 7 : Geotechnisch
  ontwerp - Deel 1 : Algemene regels - Nationale bijlage (NBN EN 1997-1 ANB), the
  Belgian national annex to Eurocode 7, Tabel 2.1. The NAD packing-class table
  (classes 1 to 31, and the characteristic soil parameters per class). The Dutch
  annex NEN 9997-1 carries an analogous table; it is not the source used here.

Belgian stratigraphy
--------------------

The formation names follow the Belgian stratigraphic nomenclature maintained by
the **National Commission for Stratigraphy Belgium (NCS)**
(`https://ncs.naturalsciences.be <https://ncs.naturalsciences.be>`_).

* **Steurbaut, E., de Ceukelaire, M., Lanckacker, T., Matthijs, J., Stassen, P.,
  van Baelen, H., & Vandenberghe, N. (2017).** An update of the lithostratigraphy
  of the Ieper Group.

* **Laga, P., Louwye, S., & Geets, S. (2001).** Paleogene and Neogene
  lithostratigraphic units (Belgium). Geologica Belgica, 4/1-2, 135–152.

* **Gullentops, F., Bogemans, F., de Moor, G., Paulissen, E., & Pissart, A.
  (2002).** Quaternary lithostratigraphic units (Belgium). Geologica Belgica,
  4(1–2), 153–164.

Eurocode 7, second generation
-----------------------------

* **NBN (Belgisch normalisatie bureau). (2024).** Eurocode 7 - Geotechnical
  design - Part 1: General rules.

* **NBN (Belgisch normalisatie bureau). (2024).** Eurocode 7 - Geotechnical
  design - Part 2: Ground properties.

StrixGeo does not target EC7 design conformance and performs no EC7 design
calculation. These are listed because the NAD packing-class table is the Belgian
national annex to Eurocode 7, and because the second generation asks for a ground
model to be built and maintained per project.

Data sources and formats
------------------------

* **GEF, the Geotechnical Exchange Format**, the Dutch text format for CPT data
  that StrixGeo's GEF importer reads (quantities, measurement variables,
  coordinate-system codes).

* **DOV, Databank Ondergrond Vlaanderen**
  (`https://www.dov.vlaanderen.be <https://www.dov.vlaanderen.be>`_), the public
  Flemish subsurface database, read for CPT and borehole downloads over a bounding
  box, with the DOV code lists translated at the presentation boundary.
