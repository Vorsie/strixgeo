"""Pure geometry: the areas enclosed by a set of lines.

A body's extent along the sections is a network of lines in plan view. Where that
network closes a loop — a cross-section and two tie-sections bounding a block of
ground, say — the ground inside is surrounded by the body on every side. The
enclosed area is what the surrounding body floods; nothing here decides whether it
should, it only finds the areas.

The construction is the standard planar arrangement: split every line where it meets
another, then walk the half-edges taking the tightest turn at each node, which
traverses every face exactly once. Bounded faces come out counter-clockwise and the
outer face clockwise, so the sign of the area separates them.

No I/O, no logging, no state — geometry only.
"""

from __future__ import annotations

import math
from collections import defaultdict

_SNAP = 0.25
"""Grid in metres for deciding two points are the same node.

Runs are sampled along the sections, so two runs crossing at a shared test land within
a few centimetres of each other rather than exactly on the same coordinate.
"""

_COLLINEAR_EPS = 0.05
"""How far off a straight line a sampled point may be before it is kept, in metres."""

Point = tuple[float, float]


def simplify(points: list[Point], eps: float = _COLLINEAR_EPS) -> list[Point]:
    """Drop sampled points that lie on the straight line between their neighbours.

    Runs are sampled at a fixed count, so a straight stretch arrives as many collinear
    points. Removing them cuts the arrangement's segment count by an order of magnitude
    without moving any line.

    Parameters
    ----------
    points : list of tuple of float
        The polyline, in order.
    eps : float
        Maximum distance from the neighbours' line for a point to be dropped.

    Returns
    -------
    list of tuple of float
        The polyline with collinear interior points removed.
    """
    if len(points) < 3:
        return list(points)
    out = [points[0]]
    for prev, cur, nxt in zip(points, points[1:], points[2:], strict=False):
        ax, ay = nxt[0] - prev[0], nxt[1] - prev[1]
        length = math.hypot(ax, ay)
        if length < 1e-9:
            continue
        offset = abs(ax * (cur[1] - prev[1]) - ay * (cur[0] - prev[0])) / length
        if offset > eps:
            out.append(cur)
    out.append(points[-1])
    return out


def _split_segments(segments: list[tuple[Point, Point]]) -> list[tuple[Point, Point]]:
    """Cut every segment at each point where another segment crosses it.

    Parameters
    ----------
    segments : list of tuple
        Segments as ``(start, end)`` point pairs.

    Returns
    -------
    list of tuple
        The same lines, cut so that segments only ever meet at their endpoints.
    """
    cuts: list[list[float]] = [[0.0, 1.0] for _ in segments]
    for i, (p0, p1) in enumerate(segments):
        r = (p1[0] - p0[0], p1[1] - p0[1])
        for j, (q0, q1) in enumerate(segments):
            if i == j:
                continue
            s = (q1[0] - q0[0], q1[1] - q0[1])
            denom = r[0] * s[1] - r[1] * s[0]
            if abs(denom) < 1e-12:
                continue
            d = (q0[0] - p0[0], q0[1] - p0[1])
            t = (d[0] * s[1] - d[1] * s[0]) / denom
            u = (d[0] * r[1] - d[1] * r[0]) / denom
            if 1e-9 < t < 1 - 1e-9 and -1e-9 <= u <= 1 + 1e-9:
                cuts[i].append(t)

    out: list[tuple[Point, Point]] = []
    for (p0, p1), ts in zip(segments, cuts, strict=True):
        ordered = sorted(set(round(t, 9) for t in ts))
        for a, b in zip(ordered, ordered[1:], strict=False):
            pa = (p0[0] + (p1[0] - p0[0]) * a, p0[1] + (p1[1] - p0[1]) * a)
            pb = (p0[0] + (p1[0] - p0[0]) * b, p0[1] + (p1[1] - p0[1]) * b)
            if math.dist(pa, pb) > _SNAP:
                out.append((pa, pb))
    return out


def _node_map(points: list[Point]) -> dict[Point, Point]:
    """Map every point to a shared node, merging any that lie within ``_SNAP``.

    Rounding to a grid instead splits exactly the points that must merge: two points a
    centimetre apart land in different cells whenever they straddle a boundary. On the
    real data that left a body's extent in nine pieces when it is one, and no loop
    could close. Clustering by proximity has no boundaries to straddle.

    Parameters
    ----------
    points : list of tuple of float
        Every endpoint in the arrangement; duplicates are expected.

    Returns
    -------
    dict
        Each input point mapped to the representative point of its cluster.
    """
    unique = sorted(set(points))
    parent = list(range(len(unique)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    # Points are sorted by x, so only those within _SNAP in x can possibly merge.
    for i, p in enumerate(unique):
        for j in range(i + 1, len(unique)):
            if unique[j][0] - p[0] > _SNAP:
                break
            if math.dist(p, unique[j]) <= _SNAP:
                parent[find(i)] = find(j)

    groups: dict[int, list[Point]] = defaultdict(list)
    for i, p in enumerate(unique):
        groups[find(i)].append(p)
    rep: dict[Point, Point] = {}
    for members in groups.values():
        centre = (
            sum(p[0] for p in members) / len(members),
            sum(p[1] for p in members) / len(members),
        )
        for p in members:
            rep[p] = centre
    return rep


def _signed_area(ring: list[Point]) -> float:
    """Twice the signed area of a closed ring, positive counter-clockwise.

    Parameters
    ----------
    ring : list of tuple of float
        The ring's vertices, not repeating the first point at the end.

    Returns
    -------
    float
        Twice the signed area.
    """
    return sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(ring, ring[1:] + ring[:1], strict=True))


def enclosed_faces(polylines: list[list[Point]], min_area: float = 1.0) -> list[list[Point]]:
    """The areas fully surrounded by a set of polylines.

    Parameters
    ----------
    polylines : list of list of tuple of float
        The lines making up the network, each a list of points in order.
    min_area : float
        Faces smaller than this, in square metres, are dropped as slivers of the
        arrangement rather than real enclosed ground.

    Returns
    -------
    list of list of tuple of float
        One ring per enclosed area, counter-clockwise, largest first. Empty when the
        network closes no loops.
    """
    segments: list[tuple[Point, Point]] = []
    for line in polylines:
        pts = simplify(line)
        for a, b in zip(pts, pts[1:], strict=False):
            if math.dist(a, b) > _SNAP:
                segments.append((a, b))
    if len(segments) < 3:
        return []

    pieces = _split_segments(segments)
    node = _node_map([p for piece in pieces for p in piece])

    out_edges: dict[Point, list[Point]] = defaultdict(list)
    seen: set[tuple[Point, Point]] = set()
    for a, b in pieces:
        na, nb = node[a], node[b]
        if na == nb or (na, nb) in seen:
            continue
        seen.add((na, nb))
        seen.add((nb, na))
        out_edges[na].append(nb)
        out_edges[nb].append(na)

    order: dict[Point, list[Point]] = {
        n: sorted(ns, key=lambda m, n=n: math.atan2(m[1] - n[1], m[0] - n[0]))
        for n, ns in out_edges.items()
    }

    faces: list[list[Point]] = []
    walked: set[tuple[Point, Point]] = set()
    for start, targets in order.items():
        for first in targets:
            if (start, first) in walked:
                continue
            ring: list[Point] = []
            cur, nxt = start, first
            while (cur, nxt) not in walked:
                walked.add((cur, nxt))
                ring.append(cur)
                siblings = order[nxt]
                # The tightest turn at the far node: step back one place from the way
                # we came, which walks each face exactly once.
                idx = siblings.index(cur)
                cur, nxt = nxt, siblings[idx - 1]
            if len(ring) >= 3 and _signed_area(ring) / 2.0 >= min_area:
                faces.append(ring)
    return sorted(faces, key=lambda r: -_signed_area(r))
