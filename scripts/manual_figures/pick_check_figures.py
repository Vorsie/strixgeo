"""Generate the pick consistency check figures of the user manual from the fixture.

Run with::

    uv run --group docs python scripts/manual_figures/pick_check_figures.py

Writes four PNGs to ``docs/manual/_static/figures/pick-check/`` and prints the numbers
each figure shows. It uses the SHIPPED domain code (no second implementation), so the
manual always shows what the app computes; the B16 numbers of figures 1 and 2 are
cross-checked against ``check_formation_picks`` and the script stops if they drift.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

from groundmodel.domain.services.geostat.fit_covariance_model import (  # noqa: E402
    fit_covariance_model,
)
from groundmodel.domain.services.geostat.geostat_constants import (  # noqa: E402
    COVERAGE_Z,
    PICK_NOISE_FLOOR_M,
    REFIT_MAX_ITERATIONS,
    Z_FLAG,
)
from groundmodel.domain.services.geostat.leave_one_out_check import (  # noqa: E402
    check_formation_picks,
)
from groundmodel.domain.services.geostat.matern_covariance import (  # noqa: E402
    expected_absolute_difference,
    matern32_covariance,
    pairwise_distances,
)
from groundmodel.domain.services.geostat.ordinary_kriging import ordinary_kriging  # noqa: E402
from groundmodel.domain.services.geostat.pick_noise_floor import pick_noise_floor_m  # noqa: E402
from groundmodel.domain.value_objects.covariance_model import CovarianceModel  # noqa: E402
from groundmodel.domain.value_objects.pick_observation import PickObservation  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "tests" / "fixtures" / "geostat" / "worked_example_top_egem.json"
OUT = ROOT / "docs" / "manual" / "_static" / "figures" / "pick-check"
HIDDEN = "GEO-02/146-B16"
PARTNER = "GEO-02/145-S16"
BLUE, GREEN, RED, GREY, INK = "#2563eb", "#16a34a", "#dc2626", "#6b7280", "#111827"
# An opaque light green: the band without the wrong pick is painted OVER the light red
# band, and an opaque fill keeps the overlap from mixing into a third colour.
GREEN_FILL = "#b4e3c1"
DPI = 150

plt.rcParams.update(
    {
        "font.size": 9,
        "axes.titlesize": 10,
        "axes.titleweight": "bold",
        "axes.spines.top": False,
        "axes.spines.right": False,
    }
)


def _load() -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Return the fixture picks (with elevation and floor variance added) and the section."""
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))
    for p in data["picks"]:
        p["z"] = p["ground_elevation_m"] - p["depth_top_m"]
        p["floor2"] = pick_noise_floor_m(p["kind"]) ** 2
    return data["picks"], data["section"]


def _arrays(picks: list[dict[str, Any]]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return positions, elevations and floor variances as arrays."""
    xy = np.array([[p["x"], p["y"]] for p in picks])
    return xy, np.array([p["z"] for p in picks]), np.array([p["floor2"] for p in picks])


def _observations(picks: list[dict[str, Any]]) -> list[PickObservation]:
    """Turn fixture rows into the domain's pick observations."""
    return [
        PickObservation(
            p["name"],
            p["name"],
            p["kind"],
            p["name"],
            p["x"],
            p["y"],
            p["z"],
            math.sqrt(p["floor2"]),
        )
        for p in picks
    ]


def _short(name: str, names: list[str]) -> str:
    """Return the short label an engineer uses on the drawing (B16, S16, ...).

    The last part of a DOV name when that is unique among ``names``; else the last two
    parts (there are two S1 tests: GEO-07/181-S1 and GEO-07/191-S1).
    """
    if not name.startswith("GEO-"):
        return name
    last = name.split("-")[-1]
    if sum(n.split("-")[-1] == last for n in names if n.startswith("GEO-")) > 1:
        return name.split("/")[-1]
    return last


def _vote_text(weight: float) -> str:
    """Return a vote as a whole percentage with a real minus sign, or '' when below 0.5 %."""
    if abs(weight) < 0.005:
        return ""
    return _minus(f"{weight:.0%}")


def _minus(text: str) -> str:
    """Replace hyphen-minus by the typographic minus sign, as on the axis ticks."""
    return text.replace("-", "\N{MINUS SIGN}")


def _groups(points: np.ndarray, radius_m: float) -> list[list[int]]:
    """Group point indices that stand within ``radius_m`` of each other (one label each)."""
    groups: list[list[int]] = []
    for i, point in enumerate(points):
        for group in groups:
            if np.hypot(*(points[group[0]] - point)) <= radius_m:
                group.append(i)
                break
        else:
            groups.append([i])
    return groups


def _held_out_model(picks: list[dict[str, Any]]) -> CovarianceModel:
    """Fit the model exactly as the check does for B16: full fit, then warm refit without B16."""
    xy, z, f2 = _arrays(picks)
    full = fit_covariance_model(pairwise_distances(xy, xy), z, f2)
    others = [p for p in picks if p["name"] != HIDDEN]
    oxy, oz, of2 = _arrays(others)
    return fit_covariance_model(
        pairwise_distances(oxy, oxy),
        oz,
        of2,
        start=full.log_params(),
        max_iterations=REFIT_MAX_ITERATIONS,
    )


def figure_votes_and_guess(picks: list[dict[str, Any]]) -> dict[str, float]:
    """Figures 1 and 2: the neighbours' votes for B16, and the guess against the pick."""
    others = [p for p in picks if p["name"] != HIDDEN]
    hidden = next(p for p in picks if p["name"] == HIDDEN)
    xy, z, f2 = _arrays(others)
    model = _held_out_model(picks)
    dist = pairwise_distances(xy, xy)
    k_data = matern32_covariance(dist, model.sill_m2, model.range_m) + np.diag(f2 + model.nugget_m2)
    target = np.array([[hidden["x"], hidden["y"]]])
    k_target = matern32_covariance(pairwise_distances(target, xy)[0], model.sill_m2, model.range_m)
    guess, variance, weights = ordinary_kriging(k_data, k_target, z, model.sill_m2)
    sigma = float(np.sqrt(variance + hidden["floor2"] + model.nugget_m2))
    z_score = (hidden["z"] - guess) / sigma

    # Cross-check against the shipped check: the figure must show what the app shows.
    check = check_formation_picks(_observations(picks))
    flag = next(f for f in check.flags if f.pick.investigation_name == HIDDEN)
    assert abs(flag.predicted_elevation_m - guess) < 1e-6, (flag.predicted_elevation_m, guess)
    assert abs(flag.sigma_m - sigma) < 1e-6, (flag.sigma_m, sigma)

    vote = {p["name"]: float(w) for p, w in zip(others, weights, strict=True)}
    partner = next(p for p in others if p["name"] == PARTNER)
    gap_m = float(np.hypot(partner["x"] - hidden["x"], partner["y"] - hidden["y"]))

    # Figure 1: whole site on the left, a zoom of the B16 spot on the right (S16 stands
    # 0.4 m away, so on the site map the two dots are one).
    x0, y0 = hidden["x"], hidden["y"]
    names = [p["name"] for p in picks]
    rel = xy - np.array([x0, y0])
    fig, (ax, zoom) = plt.subplots(1, 2, figsize=(10, 4.9), gridspec_kw={"width_ratios": [1.7, 1]})
    for (x, y), w in zip(rel, weights, strict=True):
        if w > 0.005:
            ax.plot([x, 0], [y, 0], color=BLUE, lw=0.8 + 8 * w, alpha=0.55, zorder=2)
    ax.scatter(rel[:, 0], rel[:, 1], s=22, color=BLUE, zorder=3)
    # Tests that stand together (B12 + S12, 181-S2 + 182-B2) get one label, so the text
    # never overprints; the B16 spot itself is labelled separately.
    for group in _groups(rel, radius_m=8.0):
        if any(others[i]["name"] == PARTNER for i in group):
            continue
        parts = []
        for i in group:
            vote_i = _vote_text(float(weights[i]))
            short = _short(others[i]["name"], names)
            parts.append(f"{short} {vote_i}" if vote_i else short)
        ax.annotate(
            " + ".join(parts),
            tuple(rel[group[0]]),
            fontsize=7,
            color=INK,
            xytext=(5, 3),
            textcoords="offset points",
        )
    ax.scatter([0], [0], marker="x", s=90, color=GREY, lw=2, zorder=4)
    ax.annotate(
        "B16 + S16 (zoom on the right)",
        (0, 0),
        fontsize=7,
        color=GREY,
        xytext=(8, 6),
        textcoords="offset points",
    )
    rest = 1.0 - vote[PARTNER]
    ax.text(
        0.03,
        0.04,
        f"S16: {vote[PARTNER]:.0%} of the vote\nall 15 others together: {rest:.0%}",
        transform=ax.transAxes,
        fontsize=8,
        color=BLUE,
        va="bottom",
    )
    ax.set(
        xlabel="east of B16 (m)",
        ylabel="north of B16 (m)",
        title="The site: the 16 neighbours of B16",
        aspect="equal",
    )
    ax.margins(0.14)

    sx, sy = partner["x"] - x0, partner["y"] - y0
    zoom.plot([sx, 0], [sy, 0], color=BLUE, lw=0.8 + 8 * vote[PARTNER], alpha=0.55)
    zoom.scatter([sx], [sy], s=60, color=BLUE, zorder=3)
    zoom.annotate(
        f"S16 (CPT)\nvote {vote[PARTNER]:.0%}",
        (sx, sy),
        fontsize=8,
        color=BLUE,
        xytext=(0, 12),
        textcoords="offset points",
        ha="center",
    )
    zoom.scatter([0], [0], marker="x", s=120, color=GREY, lw=2, zorder=4)
    zoom.annotate(
        "B16 (borehole)\ncovered up",
        (0, 0),
        fontsize=8,
        color=GREY,
        xytext=(0, -30),
        textcoords="offset points",
        ha="center",
    )
    zoom.set(
        xlim=(-0.35, sx + 0.35),
        ylim=(-0.3, 0.3),
        aspect="equal",
        xlabel="east of B16 (m)",
        ylabel="north of B16 (m)",
        title=f"Zoom: S16 stands {gap_m:.1f} m from B16",
    )
    fig.suptitle(
        "Step 1: cover up B16; every neighbour votes for its pick (thicker line = bigger vote)",
        fontsize=10,
    )
    fig.tight_layout()
    fig.savefig(OUT / "01-votes.png", dpi=DPI)
    plt.close(fig)

    # Figure 2: the guess with its 90 % band against the real pick.
    low, high = guess - COVERAGE_Z * sigma, guess + COVERAGE_Z * sigma
    fig, ax = plt.subplots(figsize=(8, 2.4))
    ax.axvspan(low, high, color=GREEN, alpha=0.25, lw=0)
    ax.axvspan(guess - Z_FLAG * sigma, guess + Z_FLAG * sigma, color=GREEN, alpha=0.08, lw=0)
    ax.plot([guess], [0], "o", color=GREEN, ms=9)
    ax.plot([hidden["z"]], [0], "D", color=RED, ms=9)
    ax.annotate(
        _minus(f"guess from the neighbours\n{guess:.2f} m ± {sigma:.2f} m"),
        (guess, 0),
        xytext=(0, 16),
        textcoords="offset points",
        ha="center",
        fontsize=8,
        color=GREEN,
    )
    ax.annotate(
        _minus(f"B16 pick\n{hidden['z']:.2f} m"),
        (hidden["z"], 0),
        xytext=(0, 16),
        textcoords="offset points",
        ha="center",
        fontsize=8,
        color=RED,
    )
    ax.annotate(
        "",
        xy=(hidden["z"], -0.45),
        xytext=(guess, -0.45),
        arrowprops={"arrowstyle": "<->", "color": INK, "lw": 1},
    )
    ax.text(
        (guess + hidden["z"]) / 2,
        -0.62,
        f"{hidden['z'] - guess:.2f} m off = {z_score:.1f} × the 'give or take'",
        ha="center",
        va="top",
        fontsize=8,
        color=INK,
    )
    ax.text(high, 0.85, " 90 % band", fontsize=7, color=GREEN, va="top")
    ax.text(guess + Z_FLAG * sigma, 0.85, " flag line (3×)", fontsize=7, color=GREEN, va="top")
    ax.set(
        yticks=[],
        xlabel="top of Egem at B16 (m TAW)",
        ylim=(-1, 1),
        xlim=(min(low, hidden["z"]) - 0.6, max(high, hidden["z"]) + 0.9),
        title="Step 2: the guess (green, with its 90 % band) against the real pick (red)",
    )
    ax.spines["left"].set_visible(False)
    fig.tight_layout()
    fig.savefig(OUT / "02-guess.png", dpi=DPI)
    plt.close(fig)

    s4 = next((f for f in check.flags if f.pick.investigation_name == "2025-01415 S4"), None)
    return {
        "model_sill_m2": model.sill_m2,
        "model_range_m": model.range_m,
        "model_nugget_m2": model.nugget_m2,
        "s16_vote": vote[PARTNER],
        "b16_s16_gap_m": gap_m,
        "guess_m": guess,
        "sigma_m": sigma,
        "pick_m": hidden["z"],
        "z_score": z_score,
        "app_z_b16": flag.z_score,
        "app_flags": float(len(check.flags)),
        "app_z_s4": s4.z_score if s4 else float("nan"),
        "second_vote": sorted(vote.values())[-2],
    }


def figure_variogram(picks: list[dict[str, Any]]) -> dict[str, float]:
    """Figure 3: every pair of tests and the fitted 'normal difference' curve."""
    model = _held_out_model(picks)
    pairs = []
    for i in range(len(picks)):
        for j in range(i + 1, len(picks)):
            a, b = picks[i], picks[j]
            d = float(np.hypot(a["x"] - b["x"], a["y"] - b["y"]))
            pairs.append((d, abs(a["z"] - b["z"]), frozenset((a["name"], b["name"]))))
    flagged_pair = frozenset((HIDDEN, PARTNER))
    calm_pair = frozenset(("GEO-02/146-B12", "GEO-02/145-S12"))
    h = np.geomspace(0.2, 2000, 300)
    # The curve is drawn for one borehole + one CPT, the floors of the B16/S16 pair, so
    # the red dot is compared with exactly the curve it is judged against.
    mixed2 = PICK_NOISE_FLOOR_M["cpt"] ** 2 + PICK_NOISE_FLOOR_M["borehole"] ** 2
    curve = expected_absolute_difference(h, model, pick_noise_m2=mixed2)
    # |difference| of a normal difference with standard deviation s: the mean is
    # s·√(2/π) (the curve), and 90 % of pairs differ by less than 1.645·s.
    upper90 = curve / math.sqrt(2.0 / math.pi) * COVERAGE_Z
    fig, ax = plt.subplots(figsize=(8, 4.8))
    ax.fill_between(
        h, 0, upper90, color=GREEN, alpha=0.12, lw=0, label="90 % of pairs fall in here"
    )
    others = [p for p in pairs if p[2] not in (flagged_pair, calm_pair)]
    ax.scatter(
        [p[0] for p in others],
        [p[1] for p in others],
        s=12,
        color=BLUE,
        alpha=0.55,
        label="one pair of tests",
    )
    ax.plot(h, curve, color=GREEN, lw=2.5, label="normal (average) difference, fitted")
    calm = next(p for p in pairs if p[2] == calm_pair)
    ax.scatter([calm[0]], [calm[1]], s=60, color=INK, zorder=4, label="B12 and S12")
    hs = next(p for p in pairs if p[2] == flagged_pair)
    ax.scatter([hs[0]], [hs[1]], s=90, color=RED, zorder=4, label="B16 and S16")
    at_pair = float(expected_absolute_difference(np.array([hs[0]]), model, pick_noise_m2=mixed2)[0])
    at_pair90 = at_pair / math.sqrt(2.0 / math.pi) * COVERAGE_Z
    ax.annotate(
        f"B16 and S16: {hs[0]:.1f} m apart, {hs[1]:.2f} m different\n"
        f"normal at {hs[0]:.1f} m: about {at_pair:.2f} m, rarely over {at_pair90:.1f} m",
        (hs[0], hs[1]),
        xytext=(12, 4),
        textcoords="offset points",
        fontsize=8,
        color=RED,
        va="bottom",
    )
    ax.annotate(
        f"B12 and S12: {calm[0]:.1f} m apart, {calm[1]:.2f} m different (normal)",
        (calm[0], calm[1]),
        xytext=(10, 8),
        textcoords="offset points",
        fontsize=8,
        color=INK,
        va="bottom",
    )
    top = max(p[1] for p in pairs) * 1.08
    ax.set(
        xscale="log",
        xlim=(0.2, 2000),
        ylim=(0, top),
        xlabel="distance between the two tests (m, log scale)",
        ylabel="difference in top of Egem (m)",
        title="Step 3: what is 'normal'? Close tests differ little, far tests more",
    )
    ax.legend(fontsize=8, loc="upper left", frameon=False)
    fig.tight_layout()
    fig.savefig(OUT / "03-variogram.png", dpi=DPI)
    plt.close(fig)
    return {
        "pair_distance_m": hs[0],
        "pair_difference_m": hs[1],
        "normal_at_pair_m": at_pair,
        "upper90_at_pair_m": at_pair90,
        "calm_pair_distance_m": calm[0],
        "calm_pair_difference_m": calm[1],
        "curve_far_m": float(curve[-1]),
        "max_pair_difference_m": max(p[1] for p in pairs),
        "pairs": float(len(pairs)),
    }


def _band_along(
    subset: list[dict[str, Any]], line: np.ndarray
) -> tuple[np.ndarray, np.ndarray, CovarianceModel]:
    """Return the kriged mean and standard deviation along ``line`` from ``subset``."""
    xy, z, f2 = _arrays(subset)
    dist = pairwise_distances(xy, xy)
    model = fit_covariance_model(dist, z, f2)
    k_data = matern32_covariance(dist, model.sill_m2, model.range_m) + np.diag(f2 + model.nugget_m2)
    means, sds = [], []
    for point in line:
        k_target = matern32_covariance(
            pairwise_distances(point[None, :], xy)[0], model.sill_m2, model.range_m
        )
        guess, variance, _ = ordinary_kriging(k_data, k_target, z, model.sill_m2)
        means.append(guess)
        sds.append(math.sqrt(variance))
    return np.array(means), np.array(sds), model


def figure_bands(picks: list[dict[str, Any]], section: dict[str, Any]) -> dict[str, float]:
    """Figure 4: the P5-P95 band on Cross-section 1 with and without B16's wrong pick."""
    start = np.array([section["start_x"], section["start_y"]])
    end = np.array([section["end_x"], section["end_y"]])
    length = float(np.linalg.norm(end - start))
    along = np.linspace(0, length, 240)
    line = start + np.outer(along / length, end - start)
    with_mean, with_sd, with_model = _band_along(picks, line)
    without_mean, without_sd, without_model = _band_along(
        [p for p in picks if p["name"] != HIDDEN], line
    )
    with_width = 2 * COVERAGE_Z * with_sd
    without_width = 2 * COVERAGE_Z * without_sd
    numbers = {
        "with_median_width_m": float(np.median(with_width)),
        "without_median_width_m": float(np.median(without_width)),
        "with_min_width_m": float(np.min(with_width)),
        "without_min_width_m": float(np.min(without_width)),
        "with_nugget_m2": with_model.nugget_m2,
        "without_nugget_m2": without_model.nugget_m2,
        "ratio": float(np.median(with_width) / np.median(without_width)),
        "wider_everywhere": float(np.all(with_width > without_width)),
        "min_width_gain_m": float(np.min(with_width - without_width)),
    }

    fig, (ax, wax) = plt.subplots(
        2, 1, figsize=(8.5, 6.4), sharex=True, gridspec_kw={"height_ratios": [2.3, 1]}
    )
    # The band WITH the wrong pick is drawn as a light fill with dashed edges and the
    # band WITHOUT it as a solid fill on top, so the overlap never mixes into a third colour.
    ax.fill_between(
        along,
        with_mean - COVERAGE_Z * with_sd,
        with_mean + COVERAGE_Z * with_sd,
        color=RED,
        alpha=0.10,
        lw=0,
    )
    for edge in (with_mean - COVERAGE_Z * with_sd, with_mean + COVERAGE_Z * with_sd):
        ax.plot(along, edge, color=RED, lw=1.2, ls="--", zorder=3)
    ax.fill_between(
        along,
        without_mean - COVERAGE_Z * without_sd,
        without_mean + COVERAGE_Z * without_sd,
        color=GREEN_FILL,
        alpha=1.0,
        lw=0,
    )
    ax.plot(along, without_mean, color=GREEN, lw=1.2)
    ax.plot(along, with_mean, color=RED, lw=1.2)

    direction = (end - start) / length
    normal = np.array([-direction[1], direction[0]])
    names = [q["name"] for q in picks]
    for p in picks:
        rel = np.array([p["x"], p["y"]]) - start
        if abs(rel @ normal) > section["projection_buffer_m"]:
            continue
        if not -5 <= rel @ direction <= length + 5:
            continue
        is_hidden = p["name"] == HIDDEN
        ax.plot(
            rel @ direction,
            p["z"],
            "D" if is_hidden else "o",
            color=RED if is_hidden else INK,
            ms=6 if is_hidden else 4,
            zorder=4,
        )
        if p["name"] in (HIDDEN, PARTNER):
            ax.annotate(
                _short(p["name"], names) + (" (wrong pick)" if is_hidden else ""),
                (rel @ direction, p["z"]),
                xytext=(7, 4 if is_hidden else -12),
                textcoords="offset points",
                fontsize=8,
                color=RED if is_hidden else INK,
            )
    ax.plot([], [], color=RED, ls="--", label="90 % band WITH B16's wrong pick")
    ax.fill_between([], [], [], color=GREEN_FILL, label="90 % band without it")
    ax.plot([], [], "o", color=INK, ms=4, label="picks on the section")
    ax.set(
        ylabel="top of Egem (m TAW)",
        title="Step 4: one wrong pick widens the band along the whole section",
    )
    ax.legend(fontsize=8, loc="lower right", frameon=False)

    wax.plot(along, with_width, color=RED, lw=2, ls="--", label="with B16's wrong pick")
    wax.plot(along, without_width, color=GREEN, lw=2, label="without it")
    wax.text(
        0.01,
        0.95,
        f"band width, middle value: {numbers['with_median_width_m']:.1f} m with, "
        f"{numbers['without_median_width_m']:.1f} m without "
        f"({numbers['ratio'] - 1:.0%} wider)",
        transform=wax.transAxes,
        fontsize=8,
        va="top",
        color=INK,
    )
    wax.set(
        xlabel=f"distance along {section['name']} (m)",
        ylabel="band width (m)",
        ylim=(0, float(max(with_width.max(), without_width.max())) * 1.3),
    )
    wax.legend(fontsize=8, loc="upper right", ncol=2, frameon=False)
    fig.tight_layout()
    fig.savefig(OUT / "04-bands.png", dpi=DPI)
    plt.close(fig)
    return numbers


def main() -> None:
    """Write all four figures and print the numbers they show."""
    OUT.mkdir(parents=True, exist_ok=True)
    picks, section = _load()
    numbers = {}
    numbers.update(figure_votes_and_guess(picks))
    numbers.update(figure_variogram(picks))
    numbers.update(figure_bands(picks, section))
    for key, value in numbers.items():
        print(f"  {key:28s} {value:10.4f}")
    print(f"[pick-check figures] wrote 4 PNGs to {OUT}")


if __name__ == "__main__":
    main()
