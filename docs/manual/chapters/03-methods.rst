Methods and correlations
========================

This chapter documents **exactly how StrixGeo computes every derived value**,
as implemented in the code. For each method you will find the equation, the
symbols and their units, the published reference, the validity rule the code
applies, a worked number you can reproduce, and whether a hand-worked
verification test guards it.

Everything here is **characterisation**. None of it is a design output. The
soil-behaviour classification and relative density feed the litho segmenter's
*suggestions*; the NAD class is the geotech stage's *classification*. No value in
this chapter is φ′, c′, cu, E50, OCR, Vs, G0 or M — those are Phase-5 work and
stay blank.

.. note::

   **Reproducing the worked numbers.** Every worked value below comes from the
   real functions, not a hand transcription. You can reproduce them from the
   repository root with ``uv run python``. For example, the sand point used
   throughout this chapter (qc = 12 MPa, fs = 0.08 MPa, at 8 m depth, ground at
   10 m TAW, water table at 8 m TAW) is computed by:

   .. code-block:: python

      from groundmodel.domain.services.robertson_2015 import (
          unit_weight, stress_profile, qtn_f_ic_series, sbt_zone_series,
          relative_density_sand,
      )
      depths = [0.5,1.0,1.5,2.0,2.5,3.0,3.5,4.0,4.5,5.0,5.5,6.0,6.5,7.0,7.5,8.0]
      qc     = [3,4,5,6,7,8,9,10,11,12,12,12,12,12,12,12]
      fs     = [0.05,0.06,0.07,0.07,0.07,0.08,0.08,0.08,0.08,0.08,0.08,0.08,0.08,0.08,0.08,0.08]
      prof = stress_profile(depths, qc, fs, niveau_m=10.0, yw_m=8.0)
      res  = qtn_f_ic_series(depths, qc, fs, prof)
      i = depths.index(8.0)
      print(prof[i], res[i], sbt_zone_series(res)[i])

.. note::

   **A note on qc vs. qt.** The published Robertson expressions are written in
   terms of the pore-pressure-corrected cone resistance ``qt``. StrixGeo's
   implementation uses the recorded cone resistance ``qc`` directly in the
   unit-weight, Q_tn and F_r expressions (it does not substitute ``qt`` even when
   a CPTU records u2). For sands and for CPTs without reliable pore pressure the
   two are practically equal; in soft fine soils with high excess pore pressure
   they differ. This is a faithful description of the code as built; where a
   paper says ``qt`` and the code uses ``qc``, that is called out in the
   discrepancy notes.

Where each method lives in the code: ``domain/services/robertson_2015.py``
(unit weight, stress profile, Q_tn / F_r / I_c, SBT zone, Dr),
``domain/services/robertson_sbt_non_normalised.py`` (I_SBT),
``domain/services/nad_classifier.py`` (NAD class),
``domain/services/litho_segmentation.py`` (segmentation), and
``domain/services/representative_statistic.py`` (the representative qc).

.. contents:: On this page
   :local:
   :depth: 1


1. Unit weight from CPT (Robertson & Cabal 2010)
------------------------------------------------

StrixGeo estimates the bulk unit weight of the soil at each cone reading, which
it then integrates into the stress profile.

.. math::

   \gamma = 9.81 \left( 0.27 \, \log_{10} R_f + 0.36 \, \log_{10}\!\frac{q_c}{0.1} + 1.236 \right)

with the friction ratio

.. math::

   R_f = \frac{f_s}{q_c} \times 100 \;\; [\%].

**Symbols and units.** :math:`\gamma` bulk unit weight (kN/m³);
:math:`q_c` cone resistance (MPa); :math:`f_s` sleeve friction (MPa);
:math:`R_f` friction ratio (%). The constant ``0.1`` is atmospheric pressure in
MPa (100 kPa), so :math:`q_c/0.1` is the dimensionless :math:`q_c/p_a`, and
``9.81`` is the unit weight of water in kN/m³.

**Reference.** Robertson, P.K. & Cabal, K.L. (2010), *Estimating soil unit
weight from CPT*. The published expression is written with the corrected
resistance :math:`q_t`; the code uses :math:`q_c`.

**Validity gate.** The function returns *no value* (``None``) when the result is
mathematically undefined — :math:`q_c \le 0`, :math:`f_s \le 0`, or
:math:`R_f \le 0` (a logarithm of a non-positive number). The stress-profile
integration then forward-fills a missing unit weight from the next-deeper valid
reading, so a short undefined stretch never breaks the integration.

**Worked number.** For :math:`q_c = 12` MPa and :math:`f_s = 0.08` MPa,
:math:`R_f = 0.6667\,\%`:

.. math::

   \gamma = 9.81\,(0.27 \cdot \log_{10}0.6667 + 0.36 \cdot \log_{10}120 + 1.236)
          = 19.0016 \;\text{kN/m}^3.

**Verification test.** Yes — a hand-worked numeric pin,
``test_unit_weight_matches_the_robertson_formula`` in
``tests/unit/domain/services/test_robertson_2015.py``, re-derives
:math:`\gamma` from the formula independently and asserts equality; a companion
test pins the undefined-input behaviour.


2. The stress profile — total and effective vertical stress
-----------------------------------------------------------

From the per-reading unit weights StrixGeo integrates the vertical stress down
the column. The integration step is the *actual* depth increment between
successive readings (the series is already depth-tagged), using the trapezoidal
average of the two bounding unit weights:

.. math::

   \sigma_{v,k} = \sigma_{v,k-1} + \tfrac{1}{2}\left( \gamma_{k-1} + \gamma_k \right)\,\Delta z_k ,

pore water pressure below the water table

.. math::

   u_k = \gamma_w \, (z_{w} - z_k) ,

and effective vertical stress

.. math::

   \sigma'_{v,k} = \max\!\left( \sigma_{v,k} - u_k,\; 0.001 \right).

**Symbols and units.** :math:`\sigma_v` total vertical stress (kPa);
:math:`\sigma'_v` effective vertical stress (kPa); :math:`u` pore water pressure
(kPa); :math:`\gamma_k` bulk unit weight at reading :math:`k` (kN/m³);
:math:`\gamma_w` unit weight of water (default 9.81 kN/m³); :math:`\Delta z_k`
depth increment (m); :math:`z_w` water-table elevation, :math:`z_k` reading
elevation (m TAW).

**The three water-table cases.** The profile handles the water table sitting
(1) at or above the ground surface — saturated from the top, pore pressure grows
from zero at the surface; (2) between the surface and the first reading — the
soil above the water table uses an unsaturated unit weight (default 16 kN/m³);
(3) below the first reading — unsaturated to the water table, then integrated
below it. The unsaturated unit weight and the water unit weight are project
settings, bounded to physically plausible ranges (8–25 kN/m³ soil, 9–10.5 kN/m³
water).

**Validity gate.** The effective stress is floored at 0.001 kPa because the
normalisation that consumes it (below) uses :math:`\sigma'_v` in a division and
as an exponent base, and near-surface points above the water table can produce
:math:`\sigma'_v \approx 0`. A missing unit weight is forward-filled from the
next-deeper valid reading; if every reading is undefined, the unsaturated default
is used so the integration can still run.

**The default water table.** When a CPT records no water table, every consumer
of the Robertson pipeline substitutes the **same** default — **0.0 m, i.e. water
at the ground surface** (``DEFAULT_GWT_DEPTH_M``). This is an *assumption*, not a
measurement: it is the conservative choice (lowest effective stress, so the
soil-behaviour type reads finer), and single-sourcing it means the Ic curve you
validate against and the boundaries the segmenter offers are computed from the
same effective stress.

**Worked number.** At 8 m depth in the reference sand column (ground 10 m TAW,
water table 8 m TAW, i.e. 2 m deep), with :math:`\gamma = 19.0016` kN/m³ at that
reading: :math:`\sigma_v = 146.8136` kPa, :math:`u = 58.86` kPa, so
:math:`\sigma'_v = 87.9536` kPa.

**Verification test.** A behavioural guard,
``test_stress_profile_water_at_surface_is_buoyant`` in the same file, asserts the
water-at-surface case is buoyant (:math:`\sigma'_v < \sigma_v`), floored positive
and monotone with depth. (There is no single hand-worked stress-integration pin;
the numeric pins sit on the normalisation that consumes the profile.)


3. Robertson (2009) normalisation — Q_tn, F_r, I_c and the stress exponent
--------------------------------------------------------------------------

This is the normalised soil-behaviour-type index. It iterates because the stress
exponent :math:`n` depends on the very index it helps compute.

.. math::

   Q_{tn} &= \frac{q_c \cdot 1000 - \sigma_v}{100}\left(\frac{100}{\sigma'_v}\right)^{\! n} \\[4pt]
   F_r    &= \frac{f_s \cdot 100000}{q_c \cdot 1000 - \sigma_v} \;\; [\%] \\[4pt]
   I_c    &= \sqrt{\left(3.47 - \log_{10} Q_{tn}\right)^2 + \left(\log_{10} F_r + 1.22\right)^2} \\[4pt]
   n      &= \operatorname{clamp}\!\left(0.381\,I_c + 0.05\,\frac{\sigma'_v}{100} - 0.15,\; 0,\; 1\right)

**Symbols and units.** :math:`Q_{tn}` normalised cone resistance
(dimensionless); :math:`F_r` normalised friction ratio (%); :math:`I_c`
soil-behaviour-type index (dimensionless); :math:`n` stress exponent (0–1);
:math:`q_c` MPa, :math:`f_s` MPa, :math:`\sigma_v` and :math:`\sigma'_v` kPa. The
factors ``1000`` convert MPa to kPa; the ``100`` in :math:`Q_{tn}` and the
exponent term is atmospheric pressure in kPa; the ``100000`` in :math:`F_r` is
the MPa→kPa factor times the ×100 that makes the ratio a percentage. The net cone
resistance is :math:`q_c\cdot1000 - \sigma_v` in kPa.

**The iteration.** Starting from :math:`n = 1`, StrixGeo computes
:math:`Q_{tn}`, then :math:`I_c`, then a new :math:`n`, and repeats. The
**convergence criterion is** :math:`|n_{\text{new}} - n_{\text{old}}| < 0.002`;
:math:`n` is clamped to :math:`[0, 1]` each pass. In practice five iterations
suffice for any real CPT (a safety cap of 200 iterations exists but is never
reached).

**Reference.** Robertson, P.K. (2009), *Interpretation of cone penetration tests
— a unified approach*, Canadian Geotechnical Journal 46, 1337–1355. The 2009
paper defines :math:`Q_{tn}`, :math:`F_r`, :math:`I_c` and the stress-exponent
iteration; the published forms use :math:`q_t`, the code uses :math:`q_c`.

**Validity gate.** A reading is skipped (returns *no value*) when :math:`f_s` is
missing, when the net cone resistance :math:`q_c\cdot1000 - \sigma_v \le 0`
(overburden exceeds cone resistance, which happens very near the surface, making
:math:`\log Q_{tn}` undefined), or when :math:`F_r \le 0`.

**Worked number.** At the 8 m sand reading (:math:`\sigma_v = 146.8136` kPa,
:math:`\sigma'_v = 87.9536` kPa): :math:`Q_{tn} = 127.206`,
:math:`F_r = 0.6749\,\%`, :math:`I_c = 1.7221`, converged :math:`n = 0.5501`.

**Verification test.** Yes —
``test_qtn_f_ic_matches_an_independent_computation`` in
``tests/unit/domain/services/test_robertson_2015.py`` runs a *second,
independent* implementation of the whole iterative loop and asserts agreement to
1e-9 on :math:`Q_{tn}` and :math:`F_r` and 1e-3 on :math:`I_c`, for a sand-like
and a clay-like point. A companion test pins the skip-undefined behaviour.


4. Robertson (2015) SBT zones and the peat boundary
---------------------------------------------------

The converged :math:`(Q_{tn}, F_r)` pair is placed on the Robertson
soil-behaviour-type chart, which is divided into nine zones by seven boundary
polylines. StrixGeo stores each boundary as a set of knots in
:math:`(\log_{10} F_r, \log_{10} Q_{tn})` space and evaluates a boundary at a
reading's :math:`F_r` by linear interpolation:

.. math::

   Z_i(F_r) = 10^{\,\operatorname{interp}\left(\log_{10} F_r,\; X_i,\; Y_i\right)},

a reading lying above :math:`Z_i` (its :math:`Q_{tn}` exceeds the boundary value)
is in a higher-numbered zone. The nine zones are: 1 sensitive fine-grained,
2 organic soil / clay (including peat), 3 clay to silty clay, 4 clayey silt to
silty clay, 5 silty sand to sandy silt, 6 clean sand to silty sand, 7 gravelly
sand to dense sand, 8 very stiff sand to clayey sand, 9 very stiff fine-grained.

The organic/peat boundary (zone 8 of the boundary set, which pulls a reading into
zone 2) is the extension of Lengkeek & Brinkgreve (2022):

.. math::

   Z_8 = \begin{cases} 0 & F_r \le 5.2 \\[2pt] 8\,(F_r - 5.2)^{0.5} & F_r > 5.2 \end{cases}

**Reference.** Robertson, P.K. (2015), *Estimating in-situ state parameter and
friction angle in sandy soils from CPT*, AIMS Geosciences 1(1), 1–11, for the
iterative-normalisation chart; the nine-zone boundary definition is Robertson
(2009); the peat boundary :math:`Z_8` is Lengkeek, A.W. & Brinkgreve, R.B.J.
(2022), *Automated CPT-based peat identification*, Proc. CPT'22, Delft. The
boundary polyline knots are stored verbatim in
``robertson_2015_constants.py``.

**How the litho segmenter uses the zone.** The zone drives a *lithology
suggestion* through a fixed lookup (``ROBERTSON_ST_TO_LITHOLOGY``): zones 1, 3,
9 → KLEI; zone 2 → VEEN; zones 4, 5 → SILT; zones 6, 7, 8 → ZAND. Gravel (GRIND)
is deliberately **not** derived from the CPT — the standard chart cannot separate
gravel from dense sand reliably, so gravel is confirmed only from a borehole.

**Worked number.** The 8 m sand reading (:math:`Q_{tn} = 127.206`,
:math:`F_r = 0.6749\,\%`, :math:`I_c = 1.7221`) lands in **zone 6** (clean sand
to silty sand), which maps to lithology ZAND.

**Verification test.** ``test_sbt_zone_clay_vs_clean_sand_vs_peat`` in
``tests/unit/domain/services/test_robertson_2015.py`` asserts that unambiguous
dense-sand, soft-clay and organic inputs land in the expected zone bands. The
boundary knot arrays themselves are contract-tested in
``test_robertson_sbt_band_contract.py`` (monotonic X, correct lengths). These are
band/sanity checks rather than a single hand-worked chart-position pin.


5. The non-normalised index I_SBT (Robertson 2010)
--------------------------------------------------

When the effective-stress profile is unreliable — shallow depth, made ground, an
unknown water table — the normalised index is itself unreliable, because it
depends on that stress profile. StrixGeo then offers the **non-normalised**
soil-behaviour-type index, which reads :math:`q_c/p_a` and :math:`R_f` directly
with no stress profile and no iteration:

.. math::

   I_{SBT} = \sqrt{\left(3.47 - \log_{10}\frac{q_c}{p_a}\right)^2 + \left(\log_{10} R_f + 1.22\right)^2},
   \qquad R_f = \frac{f_s}{q_c}\times 100 .

The index is banded into zones with the same numeric boundaries the normalised
:math:`I_c` uses (Robertson designed it that way):

.. list-table:: I_SBT → zone
   :header-rows: 1
   :widths: 40 60

   * - Index range
     - Zone
   * - :math:`I_{SBT} < 1.31`
     - 7 — gravelly sand to dense sand
   * - :math:`1.31 \le I_{SBT} < 2.05`
     - 6 — clean sand to silty sand
   * - :math:`2.05 \le I_{SBT} < 2.60`
     - 5 — silty sand to sandy silt
   * - :math:`2.60 \le I_{SBT} < 2.95`
     - 4 — clayey silt to silty clay
   * - :math:`2.95 \le I_{SBT} < 3.60`
     - 3 — clay to silty clay
   * - :math:`I_{SBT} \ge 3.60`
     - 2 — organic soil / peat

**Symbols and units.** :math:`I_{SBT}` dimensionless; :math:`q_c` MPa;
:math:`p_a` atmospheric reference pressure (0.1 MPa = 100 kPa); :math:`R_f` %.
Only zones 2–7 are emitted — zones 1, 8 and 9 need the full chart position and
cannot be read from the index alone, which is sufficient for lithology
segmentation.

**Reference.** Robertson, P.K. (2010), *Soil behaviour type from the CPT: an
update*, 2nd International Symposium on Cone Penetration Testing (CPT'10). The
form uses :math:`q_t`; the code uses :math:`q_c`.

**Validity gate.** Returns *no value* when :math:`f_s` is missing, or when
:math:`q_c \le 0`, :math:`f_s \le 0`, or :math:`R_f \le 0` (undefined logarithm).

**Worked number.** For the sand reading :math:`q_c = 12` MPa,
:math:`f_s = 0.08` MPa: :math:`I_{SBT} = 1.7390`, which lands in **zone 6**
(clean sand to silty sand) — the same zone the normalised pipeline gave at that
reading.

**Verification test.** Yes — ``test_i_sbt_matches_the_published_formula`` in
``tests/unit/domain/services/test_robertson_sbt_non_normalised.py`` re-derives
:math:`I_{SBT}` from the closed form and asserts agreement to 1e-9;
``test_zone_boundaries_are_robertson_2010`` pins every band boundary.


6. Relative density Dr for clean sand (Jamiolkowski et al. 2003)
----------------------------------------------------------------

For clean sands StrixGeo estimates the relative density from the cone resistance
and the effective stress:

.. math::

   D_r = 100 \left( 0.268 \, \ln\!\frac{q_c/0.1}{\left(\sigma'_v/100\right)^{0.5}} - C \right) \;\; [\%],

**Symbols and units.** :math:`D_r` relative density (%); :math:`q_c` cone
resistance (MPa); :math:`\sigma'_v` effective vertical stress (kPa); :math:`C`
the compressibility factor. The ``0.1`` is atmospheric pressure in MPa
(:math:`q_c/0.1 = q_c/p_a`), and the ``100`` under the root is atmospheric
pressure in kPa (:math:`\sigma'_v/100 = \sigma'_v/p_a`).

**The compressibility factor.** :math:`C` defaults to **0.675** (average quartz
sand). Two alternatives from the reference are available: **0.525** for
high-compressibility (calcareous) sands and **0.825** for low-compressibility
(quartz) sands. Changing :math:`C` shifts :math:`D_r` by
:math:`100(C_{\text{default}} - C)` percentage points. A factor outside the
physically meaningful range (0.1, 2.0) is rejected as a probable unit error.

**Reference.** Jamiolkowski, M., Lo Presti, D.C.F. & Manassero, M. (2003),
*Evaluation of relative density and shear strength of sands from CPT and DMT*, in
*Soil Behavior and Soft Ground Construction* (ASCE GSP 119), 201–238, as
tabulated in Robertson & Cabal's *Guide to Cone Penetration Testing*.

**Validity gate — the clean-sand gate.** :math:`D_r` is only computed for a
reading whose soil-behaviour type is clean sand, defined as
:math:`I_c < 2.45` **and** :math:`R_f < 1.2` (using the *raw* friction ratio
:math:`R_f = f_s/q_c \cdot 100`, not the Robertson-normalised :math:`F_r`).
Readings that fail this gate contribute no :math:`D_r`, and a unit with no
qualifying reading gets no relative density (its NAD packing suggestion stays
blank — the silt/clayey and admixture classes need borehole confirmation). The
math itself additionally returns *no value* when :math:`q_c \le 0` or
:math:`\sigma'_v \le 0`.

**Worked number.** For :math:`q_c = 12` MPa and :math:`\sigma'_v = 87.9536` kPa
at the reference reading, with :math:`C = 0.675`: :math:`D_r = 62.52\,\%`.

**Verification test.** Yes — the relative-density pin in
``tests/unit/domain/services/test_robertson_2015.py`` re-derives :math:`D_r`
from the published formula independently and asserts exact equality, plus the
compression-factor shift and the undefined-input and out-of-range guards. (See
the discrepancy note below regarding this test's function name.)


7. From Dr to a sand packing suggestion (litho segmenter)
---------------------------------------------------------

The litho segmenter turns a clean-sand :math:`D_r` into a *suggested* sand NAD
packing class (5–8) by averaging the qualifying readings' :math:`D_r` over the
layer and banding:

.. list-table:: Dr → suggested sand NAD class (segmenter only)
   :header-rows: 1
   :widths: 40 60

   * - Relative density
     - Suggested class
   * - :math:`D_r < 35\%` (los)
     - 5 — sand, loose
   * - :math:`35 \le D_r < 65\%` (matig)
     - 6 — sand, medium dense
   * - :math:`65 \le D_r < 85\%` (dicht)
     - 7 — sand, dense
   * - :math:`D_r \ge 85\%` (zeer dicht)
     - 8 — sand, very dense

.. important::

   This Dr-based banding is **only** the litho segmenter's suggestion aid. The
   **geotech stage's committed NAD class is chosen differently** — from a
   representative raw-qc value against the NAD qc-band table (section 8), not
   from :math:`D_r`. The two paths can give different classes for the same sand,
   by design: for the reference reading, :math:`D_r = 62.52\%` suggests class 6
   (matig), whereas the raw-qc lookup at :math:`q_c = 12` MPa (section 8) gives
   class 7 (dicht). The segmenter suggests; the geotech stage classifies.

**Worked number.** :math:`D_r = 62.52\%` → suggested class **6** (matig).

**Verification test.** The segmenter's layer output is exercised in
``tests/unit/domain/services/test_litho_segmentation.py`` (behavioural, on
synthetic and representative series); the Dr formula it calls is the
hand-worked pin of section 6.


8. NAD packing classes 1–31 (NEN 9997-1 Tabel 2.b)
--------------------------------------------------

The geotechnical stage assigns each unit a **Belgian NAD packing class** by
looking up a **representative cone resistance** against the class's qc band for
the unit's soil type and admixture variant. The lookup is on **raw qc (MPa),
with no normalisation** — this is the source's own method (the NAD soil-type
assignment is made where no normalisation is applied).

**The representative qc.** The readings inside a body are reduced to one value by
a selectable statistic (``representative_qc``): **median** (the default,
spike-robust), **arithmetic** mean, **harmonic** mean or **geometric** mean. For
the same positive series these order as harmonic ≤ geometric ≤ arithmetic, so the
choice systematically shifts classes; the harmonic mean is the conservative
choice, weighted toward the low readings. The same statistic is read by the
classifier and by every band-edit warning, so they cannot disagree.

**The qc-band table.** Each ``(soil, variant)`` column is an ascending list of
``(qc upper bound, class)`` bands. The classifier walks the bands and returns the
first whose upper bound exceeds the representative qc; a qc above every band takes
the densest class, and a qc below the first band takes the loosest (the bottoms
are open — the soil type is already fixed by the litho model, so a reading below
the printed floor still belongs to that soil and takes its loosest class). The
production thresholds:

.. list-table:: NAD qc bands (classes 1–31), qc in MPa
   :header-rows: 1
   :widths: 22 20 20 38

   * - Soil / variant
     - Band (qc)
     - Class
     - Packing
   * - GRIND clean
     - qc < 20 / ≥ 20
     - 1 / 2
     - matig / dicht
   * - GRIND secondary (silt-/kleihoudend)
     - qc < 20 / ≥ 20
     - 3 / 4
     - matig / dicht
   * - ZAND clean
     - [–,4) / [4,10) / [10,15) / ≥15
     - 5 / 6 / 7 / 8
     - los / matig / dicht / zeer dicht
   * - ZAND secondary (silt-/kleihoudend)
     - [–,4) / [4,10) / [10,15) / ≥15
     - 9 / 10 / 11 / 12
     - los / matig / dicht / zeer dicht
   * - SILT (leem) clean
     - [–,1) / [1,2) / [2,4) / ≥4
     - 13 / 14 / 15 / 16
     - weinig-vast / matig-vast / vrij-vast / vast
   * - SILT secondary (zandhoudend)
     - [–,1) / [1,2) / [2,4) / ≥4
     - 17 / 18 / 19 / 20
     - weinig-vast / matig-vast / vrij-vast / vast
   * - KLEI clean
     - [–,1) / [1,2) / [2,4) / ≥4
     - 21 / 22 / 23 / 24
     - weinig-vast / matig-vast / vrij-vast / vast
   * - KLEI secondary (zandhoudend)
     - [–,1) / [1,2) / [2,4) / ≥4
     - 25 / 26 / 27 / 28
     - weinig-vast / matig-vast / vrij-vast / vast
   * - VEEN clean and secondary
     - [–,0.5) / [0.5,1) / ≥1
     - 29 / 30 / 31
     - weinig-vast / matig-vast / vast

(VEEN has no secondary variant in the table, so its secondary column mirrors the
clean one. GRIND has only two classes per variant — the table carries no loose or
very-dense gravel.)

**The admixture variant.** The **clean** column applies to a pure soil; the
**secondary** column to a soil carrying its one NAD admixture variant — sand and
gravel go secondary on a silt or clay admixture ("silt-/kleihoudend"), the fine
soils go secondary on a sand admixture ("zandhoudend"). Any other admixture
(gravelly sand, say) is not a NAD variant and falls to clean. The variant is
either derived from the unit's admixtures or **forced by the engineer's answer**
to the admixture prompt (the first gate of the geotech Build; "pure" forces the
clean column, "with admixture" forces the secondary column).

**Lithology is hard truth.** The cone resistance never changes the soil type — a
clay at a sand-like qc stays a clay and takes the densest *clay* class. A packing
class from the wrong soil column is dropped, never rank-mapped into another
family.

**Reference.** The NAD packing-class table of **NEN 9997-1** (the Dutch national
annex to Eurocode 7), **Tabel 2.b**. (The class *names* and *thresholds* are
frozen in a committed reference manifest, ``docs/reference/nad_reference_manifest.json``.)

**Validity gate.** A missing, NaN, infinite or negative qc is **rejected** with
an error — never silently mapped to the densest (NaN) or loosest (negative)
class. A genuine measured ``0.0`` is valid and maps to the loosest class. An
unrecognised soil raises a readable error naming it.

**What happens without a CPT.** A unit with no cone reading to classify gets **no
machine class** — its class is left blank (needs review) rather than guessed. For
a borehole with no CPT in its body group, StrixGeo can fall back to the *loosest*
class of the soil's own variant column (the conservative floor), but only through
the same variant rule, so it never lands a silty sand in the clean column.

**Worked numbers.** ZAND clean at representative qc = 12 MPa → class **7**
(dicht); at qc = 8 MPa → class **6** (matig); KLEI clean at qc = 1.5 MPa → class
**22** (matig-vast).

**Verification test.** Yes, extensively — ``tests/unit/domain/test_nad_classifier.py``
pins the band selection per soil and variant, the open-bottom rule, the
invalid-input rejection, the variant-override (admixture prompt) behaviour and the
table-structure invariants; ``tests/unit/domain/services/test_nad_reference_manifest.py``
pins the class names and thresholds against the committed manifest so the table
cannot drift silently.


9. Litho segmentation — minimum thickness and smoothing window
--------------------------------------------------------------

The segmenter turns a per-reading zone sequence into a small set of suggested
layers in five steps:

#. **Classify** each reading into an SBT zone (section 3 for the normalised path,
   section 5 for the non-normalised path).
#. **Smooth** the zone sequence with a **rolling median** whose half-window is
   sized to the minimum layer thickness:

   .. math::

      \text{half-window} = \max\!\left(1,\; \operatorname{round}\!\left(\frac{t_{\min}/2}{\Delta z}\right)\right)

   rows above and below each reading, i.e. a total window of
   :math:`2\cdot\text{half-window}+1` readings. The median is robust to
   single-reading qc spikes (thin interbeds) and preserves sharp transitions
   better than a mean; missing readings are excluded from the median sample but
   kept as gaps.
#. **Run-length encode** the smoothed sequence into runs of one zone.
#. **Greedy-merge** any run thinner than the minimum thickness into its preceding
   neighbour (or the following one at the very top), rescanning until every run
   meets the threshold or only one remains.
#. **Emit** one layer per surviving run: map its dominant zone to a lithology,
   compute the mean raw qc over the layer, and — for clean sand — the relative
   density and the suggested packing class (sections 6–7).

**Symbols and units.** :math:`t_{\min}` minimum layer thickness (m, default
**0.15 m**, project-tunable); :math:`\Delta z` the mean depth increment of the
series (m). The layer partition is contiguous — each layer's base is the next
layer's top — so a set of accepted contacts has no unassigned gap.

**Confidence.** Each suggested layer carries a confidence: HIGH when it is at
least twice the minimum thickness, MEDIUM when it just meets it, LOW when it
survived only by a merge.

**Borehole path.** For a borehole there is no cone reading: each observed layer's
DOV soil code (``main_soil_codes[0]``) maps to a base lithology through a fixed
code table, and the same greedy-merge is applied.

**Verification test.** ``tests/unit/domain/services/test_litho_segmentation.py``
(behavioural — layer counts, thickness merging, lithology mapping, the
contiguous-partition property).


10. The 2 / 1 / 0 fill rule — band, onlap, lens
------------------------------------------------

The interpreted geometry of a section is a **partition** of bands, onlaps and
lenses produced by one rule (introduced in the Litho chapter). A unit's shape
toward a neighbour is decided purely by how many of its **two** bounding contacts
(top and base) are correlated to that neighbour:

* **2 correlated → BAND.** The unit is a continuous band between the two tests.
* **1 correlated → ONLAP.** The unit is flat on the correlated bracket and
  pinches to a tip toward the neighbour (laps up if the top contact is tied, down
  if the base is tied).
* **0 correlated → LENS.** The unit is a lens with a horizontal apex at its own
  elevation, closing off between the tests.

The rule is applied **per gap and per side** (a unit can band one way and pinch
the other), and there is **no automatic facies inference** — two mismatched units
meet at a straight seam unless you draw the facies contact yourself. Below a
shallow test's total depth, the deeper stratigraphy runs as straight
deep-to-deep bands (a dedicated substrate pass), so the deep model is continuous
even where a shallow test does not reach it. In the geotech stage the *same* rule
draws the packing bands.

This partition is the **single source of truth** for the interpreted geometry:
the 2-D render, the 3-D voxel build and every geometry export all derive from it.

**Verification test.** The fill engine is client-side TypeScript
(``desktop/.../utils/partitionFill.ts``), so its tests are TypeScript, not the
Python ``tests/unit`` suite. Its arbiter is the **CS1 real-data gate**
(``partitionFill.cs1void.test.ts``, run with ``CS1_GATE=1`` against a real
project), which asserts zero cross-formation overlap, zero interior void, correct
lithology and zero degenerate quads. Synthetic tests are treated as
necessary-but-not-sufficient; any change to the fill engine must pass the CS1
gate.


11. Body identity — geometry only
---------------------------------

A **body** is a resolver connected-component: the maximal set of same-lithology
layers joined, directly or transitively, by approved correlation edges and
observed geometric adjacencies. StrixGeo stamps each component's layers with one
body id. Identity is **geometry only** — the body id says *which mass*, not *what
shape* (the shape comes from the partition of section 10). A body's user state
(name, colour, hand-drawn boundary) follows the mass across a renumber.

**Groups are labels, not merges.** When you Join bodies into a group, every body
keeps its own id; the group is a label ("group N") carried on each member. This
is deliberate: a group can span two different litho parents, and merging would
lose that provenance. Grouped statistics pool the members; a group exports as one
class. (See the Geotech and Parameters chapters.)


12. The voxel labelling, in one paragraph
-----------------------------------------

The 3-D build does not create new geometry; it **labels space** from the 2-D
partition. StrixGeo lays a voxel grid over the modelled volume (bounded by the
geological formation surfaces and floored at the deepest investigation) and, for
each voxel, decides its unit by mapping the voxel's position back onto the
section partitions using the *same* fraction→metres mapping the 2-D fill and the
D-Stability export use — so the 3-D solid, the sections and the closed-geometry
export all describe the same ground. Boreholes are honoured: a voxel column at a
borehole is labelled from that borehole's observed stratigraphy. A greedy-meshing
step (accelerated in a native code path) then extracts a renderable mesh from the
labelled grid.


13. Unit statistics — which statistics, over what samples
---------------------------------------------------------

The Parameters stage describes each unit's **measured spread**. For a unit,
StrixGeo pools **every finite CPT reading that falls inside the unit's bands**,
across all the CPTs the unit stands on, in the depth frame *metres below the
collar*. It summarises three channels independently, each on its own axis:

* **qc** — cone resistance (MPa);
* **fs** — sleeve friction (MPa);
* **Rf** — friction ratio (%).

For each channel it reports the **count** of finite samples and, when the count
supports them, the **five-number summary** — minimum, 5th percentile, first
quartile, **median**, third quartile, 95th percentile, maximum — plus the
**arithmetic mean** and the **sample standard deviation (n − 1)**. Any statistic
the sample count cannot support is reported **blank**, never ``0``: an empty unit
has no median and a single reading has no standard deviation. The panel also
reports how many bands and how many distinct CPTs the samples came from and the
total metres of ground the unit covers. The individual samples are drawn beside
the box so you can see how many readings stand behind the summary.

These are descriptive statistics of measurements — no correlation, conversion or
calibration into a design value.

**Verification test.** The statistics are client-side TypeScript
(``desktop/.../parameters/unitStatistics.ts``); their tests are TypeScript
(``unitStatistics.test.ts``), not the Python ``tests/unit`` suite.


14. Export mapping — a group to one class
-----------------------------------------

Every export identifies a unit by a token built from its NAD class and soil code
(``NAD-06_ZAND``, ``NAD-06``, ``ZAND``, or none for a geological formation — see
the Export chapter). Because a **group** is a set of separate bodies sharing a
label, the export maps the whole group to **one class**: the group's members
share the identifier, so a downstream tool sees one material for the group. The
class is zero-padded so text-sorting material lists keep the classes in order,
and it leads the token so a wildcard selects every instance of a class. The
D-Series exporters attach the class's characteristic γ / φ′ / c′ *only* where the
NEN 9997-1 Tabel 2.b table has a row for the class, and write no other design
parameter.


Discrepancies and things to confirm
-----------------------------------

These are places where the code and a published source do not line up exactly, or
where a reference could not be fully confirmed from the code alone. They are
listed here in the interest of honesty; none is a defect, but each is worth an
engineer's eye.

* **qc used where the papers write qt.** The unit-weight, :math:`Q_{tn}`,
  :math:`F_r` and :math:`I_{SBT}` expressions are published in terms of the
  pore-pressure-corrected resistance :math:`q_t`. StrixGeo uses the recorded
  :math:`q_c` in all of them, and does not substitute :math:`q_t` even when a
  CPTU records the pore pressure u2 needed to compute it. For sands and for CPTs
  without reliable pore pressure this is immaterial; in soft, low-permeability
  soils with high excess pore pressure it is a real difference.

* **The NAD table is cited under two names in the code.** The classifier module's
  own comments name the source both as the Belgian **NBN EN 1997-1 ANB Tabel
  2.1** and as the Dutch **NEN 9997-1 Tabel 2.b**. These are the national annexes
  of two countries to the same Eurocode 7. This manual cites **NEN 9997-1 Tabel
  2.b** (per the instruction to reference the standard NAD table of EC7). An
  engineer applying the table in Belgium should confirm the thresholds against
  the NBN EN 1997-1 ANB edition they work to.

* **The relative-density verification test's function name.** The Dr numeric pin
  in ``test_robertson_2015.py`` is a genuine independent re-derivation of the
  Jamiolkowski et al. (2003) formula and is fully valid; its *function name*
  refers to the author of the original numerical port rather than to the
  published correlation. The name is a code-level artefact only — this manual
  cites the published reference (Jamiolkowski, Lo Presti & Manassero 2003), which
  is what the formula implements.

* **Default assumptions, not measurements.** Where a CPT records no water table,
  the pipeline assumes water at the ground surface (0.0 m); where a reading has no
  computable unit weight it is forward-filled; the unsaturated unit weight default
  is 16 kN/m³. These are conservative single-sourced assumptions, not
  measurements, and any surface that shows a value derived from them is labelled a
  CPT-derived estimate.
