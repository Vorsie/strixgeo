References
==========

The published sources behind the methods of chapter 3, and the data-format
specifications behind the Data stage. Each correlation in chapter 3 names the
reference it implements; this list gathers them in one place.

CPT correlations
----------------

* **Robertson, P.K. (2009).** *Interpretation of cone penetration tests — a
  unified approach.* Canadian Geotechnical Journal, 46(11), 1337–1355.
  — The normalised cone parameters :math:`Q_{tn}`, :math:`F_r`, the
  soil-behaviour-type index :math:`I_c`, and the iterative stress exponent
  :math:`n`. (Chapter 3, section 3.)

* **Robertson, P.K. (2010).** *Soil behaviour type from the CPT: an update.*
  Proceedings, 2nd International Symposium on Cone Penetration Testing (CPT'10),
  Huntington Beach, CA. — The non-normalised soil-behaviour-type index
  :math:`I_{SBT}`. (Chapter 3, section 5.)

* **Robertson, P.K. & Cabal, K.L. (2010).** *Estimating soil unit weight from
  CPT.* Proceedings, 2nd International Symposium on Cone Penetration Testing
  (CPT'10), Huntington Beach, CA. — The CPT unit-weight correlation. (Chapter 3,
  section 1.) The relative-density correlation of section 6 is taken as tabulated
  in the same authors' *Guide to Cone Penetration Testing for Geotechnical
  Engineering* (Gregg Drilling / GeoLogismiki, several editions).

* **Robertson, P.K. (2015).** *Estimating in-situ state parameter and friction
  angle in sandy soils from CPT.* AIMS Geosciences, 1(1), 1–11. — The iterative
  normalised soil-behaviour-type chart used for the zone assignment. (Chapter 3,
  section 4.) The 2016 update of the same classification system
  (*Cone penetration test-based soil behaviour type (SBT) classification system —
  an update*, Canadian Geotechnical Journal 53(12), 1910–1927) is the peer-
  reviewed companion.

* **Jamiolkowski, M., Lo Presti, D.C.F. & Manassero, M. (2003).** *Evaluation of
  relative density and shear strength of sands from CPT and DMT.* In *Soil
  Behavior and Soft Ground Construction* (ASCE Geotechnical Special Publication
  119), 201–238. — The relative-density (Dr) correlation for clean sands and its
  compressibility factor. (Chapter 3, section 6.)

* **Lengkeek, A.W. & Brinkgreve, R.B.J. (2022).** *Automated CPT-based peat
  identification.* Proceedings, 5th International Symposium on Cone Penetration
  Testing (CPT'22), Bologna / Delft. — The organic/peat boundary extension
  (:math:`Z_8`) to the Robertson SBT chart. (Chapter 3, section 4.)

Classification table
--------------------

* **NEN 9997-1 — Geotechnical design of structures — Part 1: General rules**
  (the Dutch national annex to Eurocode 7, NEN 9997-1+C2), **Tabel 2.b** — the
  NAD packing-class table (classes 1–31: los / matig / dicht / zeer dicht for
  sand and gravel; weinig-vast → vast for the fine soils; per soil and admixture
  variant). (Chapter 3, section 8.) The equivalent Belgian national annex is
  **NBN EN 1997-1 ANB**; see the discrepancy note in chapter 3.

Data-format specifications
--------------------------

* **GEF — Geotechnical Exchange Format** (CUR/SIKB *GEF-CPT-Report* standard) —
  the Dutch text format for CPT data that StrixGeo's GEF importer reads
  (quantities, MEASUREMENTVAR indices, coordinate-system codes). (Chapter 2,
  Data.)

* **DOV — Databank Ondergrond Vlaanderen** (`https://www.dov.vlaanderen.be
  <https://www.dov.vlaanderen.be>`_) — the public Flemish subsurface database,
  accessed over its WFS index and per-record XML for CPT and borehole downloads,
  with the DOV code lists translated at the presentation boundary. (Chapter 2,
  Data.)

Eurocode context
----------------

* **NEN-EN 1997-1 / Eurocode 7 — Geotechnical design.** StrixGeo does **not**
  target EC7 design conformance and performs no EC7 design calculation; the
  reference is listed because the NAD packing-class table is the national annex
  to it. Design checks run in the downstream tool.
