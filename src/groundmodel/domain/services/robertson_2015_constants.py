"""Robertson (2015) SBT chart boundary polylines + hydraulic-conductivity correlation.

Source: the soil-behaviour-type chart boundaries of Robertson (2009, 2015)
with the organic/peat boundary of Lengkeek & Brinkgreve (2022). The X/Y
arrays below are the chart's polyline knots; do not approximate or simplify
them.

The Robertson (2009) chart zones are the NINE-zone Q_tn / F boundary
definition described in:

    Robertson, P.K. (2009). "Interpretation of cone penetration tests —
    a unified approach." *Canadian Geotechnical Journal*, 46, 1337-1355.

The 2015 iterative stress-normalisation approach (with the converging
stress-exponent n) is described in:

    Robertson, P.K. (2015). "Estimating in-situ state parameter and
    friction angle in sandy soils from CPT." *AIMS Geosciences*, 1(1), 1-11.

The peat boundary (Z8) is extended per:

    Lengkeek & Brinkgreve (2022). "Automated CPT-based peat identification."
    *Proc. CPT'22*, Delft.

Usage
-----
The polylines define log10(F) → log10(Qtn) mappings for each of the seven
physical boundaries between the nine Robertson zones. Evaluate via
numpy.interp on the log10-scaled X and Y arrays, then raise 10**result.
X arrays are sorted ascending (required by numpy.interp — verified in .sce,
confirmed by inspection below).
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Assumed water table when a CPT does not record one
# ---------------------------------------------------------------------------
# Every consumer of the Robertson pipeline that has to substitute a missing
# water table MUST use this constant — the Ic chart, the litho segmenter and
# anything derived from either. Two different substitutions mean the curve the
# engineer validates against and the boundaries he is offered were computed
# from different effective stresses (at 2 m depth, a 0 m vs 1 m water table is
# a ~50 % difference in sigma'v0 — enough to flip the SBT zone across the
# Ic = 2.60 sand-mixture / silt-mixture line).
#
# Value: 0.0 m — water at ground surface. Conservative when unknown (lowest
# effective stress → highest Qtn-normalised Ic → finer soil behaviour type),
# and it is what the segmenter, whose output is what gets ACCEPTED into the
# model, has always assumed. NOTE: this is an ASSUMPTION, not a measurement —
# a surface that shows a value derived from it must say so (Data Integrity
# Rule 1).
DEFAULT_GWT_DEPTH_M: float = 0.0

# ---------------------------------------------------------------------------
# Unit weights the effective-stress profile is built on
# ---------------------------------------------------------------------------
# Same single-source rule as the water table above, and for the same reason:
# ``stress_profile`` normalises against sigma'v0, so a surface that draws Ic or
# an SBT zone under gamma_unsat = 16 while the segmenter proposed boundaries
# under the engineer's 19 shows a disagreement it will attribute to something
# else entirely. Settings -> Litho segmenter writes the value; every consumer
# defaults and bounds it HERE, so the two cannot drift apart.
#
# Defaults are the segmenter's standing defaults. The bounds
# are physical plausibility, not preference: 8 kN/m3 is soft peat, 25 is dense
# gravel, and water is 9.0-10.5 (fresh to brine).
DEFAULT_GUNSAT_KNM3: float = 16.0
DEFAULT_GWATER_KNM3: float = 9.81
GUNSAT_KNM3_MIN: float = 8.0
GUNSAT_KNM3_MAX: float = 25.0
GWATER_KNM3_MIN: float = 9.0
GWATER_KNM3_MAX: float = 10.5

# ---------------------------------------------------------------------------
# Zone boundary polylines — X = log10(F [%]), Y = log10(Qtn [-])
# Values copied VERBATIM from CPTE_2025.sce lines 249-262.
# Boundary semantics: a data point at (F, Qtn) lies ABOVE boundary i when
# Qtn > 10**interp(X_i, Y_i, log10(F)).
# ---------------------------------------------------------------------------

# Zone 1 / Zone 2 boundary (sensitive fine-grained vs organic)
ZONE_X1: list[float] = [
    -3,
    -1,
    -0.890243902439026,
    -0.774390243902441,
    -0.66158536585366,
    -0.548780487804878,
    -0.439024390243903,
    -0.326219512195123,
    -0.210365853658537,
    -0.112804878048781,
    -0.00609756097560987,
    0.082317073170729,
    0.161585365853658,
    0.204268292682926,
    0.225609756097559,
    0.397940008672038,
    0.52244423350632,
    3,
]
ZONE_Y1: list[float] = [
    1,
    1,
    0.998624484181568,
    0.98624484181568,
    0.961485557083906,
    0.92847317744154,
    0.878954607977991,
    0.812929848693259,
    0.726272352132049,
    0.631361760660247,
    0.50343878954608,
    0.359009628610727,
    0.189821182943603,
    0.0784044016506188,
    0,
    -0.476892499139314,
    -1,
    -1,
]

# Zone 2 / Zone 3-4-5-6-7 boundary (upper envelope)
ZONE_X2: list[float] = [
    -3,
    0.079181246,
    0.131097560975609,
    0.182926829268291,
    0.246951219512193,
    0.292682926829266,
    0.335365853658536,
    0.38109756097561,
    0.445121951219511,
    0.493902439024389,
    0.551829268292683,
    0.631097560975609,
    0.740853658536585,
    0.838414634146341,
    0.984756097560975,
    1.04878048780488,
    1.17609125905568,
    3,
]
ZONE_Y2: list[float] = [
    4,
    4,
    3.03301237964236,
    2.88445667125172,
    2.72352132049518,
    2.6079779917469,
    2.50068775790921,
    2.40165061898212,
    2.26134800550206,
    2.15405777166437,
    2.04264099037139,
    1.91884456671252,
    1.82806052269601,
    1.78266850068776,
    1.75378266850069,
    1.7455295735901,
    1.74036268949424,
    1.73639650227664,
]

# Zone 2/3 boundary (clay to silty clay lower envelope)
ZONE_X3: list[float] = [
    -3,
    -2,
    -1.04575749056068,
    -0.522878745280338,
    -0.0457574905606751,
    0.216463414634144,
    0.420731707317072,
    0.594512195121951,
    0.771341463414634,
    0.887195121951219,
    0.963414634146341,
    0.996951219512195,
    1.04139268515823,
    1.11394335230684,
    1.20411998265592,
    1.252574989,
    1.30102999566398,
    1.47712125471966,
    1.61172330800734,
    3,
]
ZONE_Y3: list[float] = [
    -0.107504662868674,
    -0.107504662868674,
    -0.099484807248056,
    -0.0784326862439331,
    -0.0182837690892966,
    0.045392022008251,
    0.15268225584594,
    0.292984869325996,
    0.491059147180191,
    0.664374140302613,
    0.808803301237964,
    0.878954607977991,
    0.994223003013752,
    1.19471939352921,
    1.49546397930239,
    1.6959604,
    1.8964567603333,
    2.89893871291058,
    4,
    4,
]

# Zone 3/4 boundary (clayey silt to silty clay)
ZONE_X4: list[float] = [
    -3,
    -2,
    -1,
    -0.522878745280338,
    -0.301029995663981,
    -0.140243902439025,
    -0.0213414634146342,
    0.128048780487803,
    0.277439024390242,
    0.378048780487804,
    0.47560975609756,
    0.570121951219511,
    0.655487804878049,
    0.71951219512195,
    0.774390243902439,
    0.845098040014257,
    0.954242509439325,
    1.07918124604762,
    1.21218760440396,
    3,
]
ZONE_Y4: list[float] = [
    0.548714105446867,
    0.548714105446867,
    0.567812943589182,
    0.610254806127659,
    0.652696668666137,
    0.664374140302613,
    0.734525447042641,
    0.837689133425034,
    0.969738651994498,
    1.08115543328748,
    1.20082530949106,
    1.34112792297111,
    1.49793672627235,
    1.63823933975241,
    1.80742778541953,
    2.03205720116665,
    2.45647582655142,
    3.09310376462857,
    4,
    4,
]

# Zone 4/5 boundary (silty sand to sandy silt)
ZONE_X5: list[float] = [
    -3,
    -2,
    -1.39794000867204,
    -0.823908740944319,
    -0.503048780487805,
    -0.332317073170732,
    -0.128048780487805,
    0.0579268292682913,
    0.222560975609754,
    0.390243902439023,
    0.506097560975609,
    0.582317073170732,
    0.643292682926829,
    0.658536585365853,
    0.673780487804877,
    0.679878048780487,
    0.700578048780487,
    3,
]
ZONE_Y5: list[float] = [
    0.793022628459515,
    0.793022628459515,
    0.803892063893693,
    0.84374666048568,
    0.907840440165061,
    0.994497936726272,
    1.11416781292985,
    1.25034387895461,
    1.40302613480055,
    1.60522696011004,
    1.79917469050894,
    1.98899587345254,
    2.30674002751032,
    2.45116918844567,
    2.69050894085282,
    2.98762035763411,
    4,
    4,
]

# Zone 5/6 boundary (clean sand to silty sand)
ZONE_X6: list[float] = [
    -3,
    -2,
    -1.39794000867204,
    -1,
    -0.771341463414636,
    -0.533536585365855,
    -0.283536585365854,
    -0.0487804878048781,
    0.164634146341461,
    0.314024390243902,
    0.393292682926828,
    0.423780487804877,
    0.544068044350276,
    0.698970004336019,
    0.807589142389764,
    3,
]
ZONE_Y6: list[float] = [
    1.39511433919444,
    1.39511433919444,
    1.4073041167125,
    1.41953232462173,
    1.4484181568088,
    1.50206327372765,
    1.62173314993122,
    1.76342799356294,
    1.97661623108666,
    2.20357634112792,
    2.36863823933975,
    2.45942228335626,
    2.81319179046214,
    3.42268066636517,
    4,
    4,
]

# Zone 6/7 boundary (gravelly sand to dense sand)
ZONE_X7: list[float] = [
    -3,
    -2,
    -1.52287874528034,
    -1.15490195998574,
    -1,
    -0.786585365853661,
    -0.588414634146342,
    -0.39329268292683,
    -0.219512195121951,
    -0.076219512195122,
    0.00609756097560594,
    0.0304878048780472,
    0.113943352306837,
    0.204119982655925,
    0.34409740359441,
    3,
]
ZONE_Y7: list[float] = [
    2.10124566205107,
    2.10124566205107,
    2.11851911705649,
    2.15306602706735,
    2.17881705639615,
    2.22833562585969,
    2.3191196698762,
    2.45116918844567,
    2.6162310866575,
    2.8101788170564,
    2.97111416781293,
    3.03301237964236,
    3.21538350990112,
    3.47448533498253,
    4,
    4,
]

# ---------------------------------------------------------------------------
# Hydraulic-conductivity correlation (Robertson 2010 + Lunne 1997)
# KIC = Ic breakpoints, KK = corresponding k [m/s] values
# Used by CPTE_2025.sce but NOT exposed in the segmenter (Phase 5 scope).
# Included for completeness per the "verbatim source" directive.
# ---------------------------------------------------------------------------
KIC: list[float] = [0.0, 1.0, 1.31, 2.05, 2.6, 2.95, 3.6, 3.61]
KK: list[float] = [
    0.00816582371358592,
    0.00816582371358592,
    0.000932395137540632,
    5.24807460249773e-06,
    1.11686324778056e-07,
    0.0000000009,
    0.0000000001,
    0.0000000001,
]
