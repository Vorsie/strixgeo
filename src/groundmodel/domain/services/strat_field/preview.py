"""Self-contained Three.js HTML preview writer for the implicit strat-field builder.

This module is a pure I/O helper used during development and debugging.
It is **not** part of the production pipeline — it writes a single
stand-alone HTML file that the owner opens locally in a browser to inspect
mesh geometry and control-point positions in 3-D.

The file embeds all geometry as JSON in a ``<script>`` block and renders
it with Three.js (importmap, pinned to v0.160.0 via unpkg CDN).  An
internet connection is required to load the CDN assets on first open.

Functions
---------
write_scene_html
    Write the preview HTML file to *path*.
"""

from __future__ import annotations

import json
import os
from collections.abc import Sequence
from pathlib import Path


def write_scene_html(
    path: str | os.PathLike[str],
    meshes: Sequence[dict[str, object]],
    points: Sequence[dict[str, object]] = (),
    surfaces: Sequence[dict[str, object]] = (),
) -> None:
    """Write a self-contained Three.js HTML preview file.

    The file embeds all vertex/triangle/point data as JSON and uses an
    ES-module importmap to load Three.js v0.160.0 + OrbitControls from
    unpkg CDN.  The viewer uses ``OrbitControls`` so the user can
    pan/rotate/zoom the scene.

    Parameters
    ----------
    path : str or os.PathLike
        Destination file path.  Parent directory must exist.
    meshes : sequence of dict
        Each entry is a solid mesh to render as an opaque
        ``MeshPhongMaterial`` object.  Required keys:

        * ``"name"`` : str — label shown in the scene (not yet rendered
          as a legend, reserved for future use).
        * ``"color"`` : str — CSS hex colour string (e.g. ``"#fbbf24"``).
        * ``"vertices"`` : list of (float, float, float) — (x, y, z) triples
          in project CRS + vertical datum.
        * ``"triangles"`` : list of (int, int, int) — vertex-index triples.

    points : sequence of dict, optional
        Control points to render as small spheres.  Required keys:
        ``"x"``, ``"y"``, ``"z"`` (float) and ``"color"`` (str hex).
    surfaces : sequence of dict, optional
        Contact surfaces to render as transparent double-sided
        ``MeshBasicMaterial`` wireframes.  Same shape as *meshes*.

    Returns
    -------
    None
        Writes the file at *path* as UTF-8 text.

    Notes
    -----
    The Three.js importmap pins version ``0.160.0`` via unpkg to ensure
    reproducible rendering — do not change without re-testing OrbitControls
    compatibility.  The scene auto-fits the camera to the geometry bounding
    box on load.
    """
    meshes_json = json.dumps(list(meshes))
    points_json = json.dumps(list(points))
    surfaces_json = json.dumps(list(surfaces))

    html = f"""\
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Strix — Stratigraphic Field Preview</title>
<script type="importmap">
{{
  "imports": {{
    "three": "https://unpkg.com/three@0.160.0/build/three.module.js",
    "three/addons/": "https://unpkg.com/three@0.160.0/examples/jsm/"
  }}
}}
</script>
<style>
  body {{ margin: 0; background: #1a1a2e; overflow: hidden; }}
  canvas {{ display: block; }}
  #info {{ position: absolute; top: 8px; left: 8px; color: #ccc;
           font: 12px/1.5 monospace; pointer-events: none; }}
</style>
</head>
<body>
<div id="info">Strix · Strat-field preview · drag to orbit · scroll to zoom</div>
<script type="module">
import * as THREE from 'three';
import {{ OrbitControls }} from 'three/addons/controls/OrbitControls.js';

// ── embedded geometry ────────────────────────────────────────────────────────
const MESHES   = {meshes_json};
const POINTS   = {points_json};
const SURFACES = {surfaces_json};

// ── scene setup ──────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({{ antialias: true }});
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene  = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a2e);
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const dir = new THREE.DirectionalLight(0xffffff, 1.2);
dir.position.set(1, 2, 3);
scene.add(dir);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1e6);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// ── helpers ──────────────────────────────────────────────────────────────────
function buildGeometry(verts, tris) {{
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(verts.length * 3);
  verts.forEach(([x, y, z], i) => {{ pos[i*3]=x; pos[i*3+1]=z; pos[i*3+2]=-y; }});
  // swap Y↔Z so Z-up project coords render upright in Three.js (Y-up)
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const idx = new Uint32Array(tris.flat());
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  return geo;
}}

const bbox = new THREE.Box3();

// ── solid meshes ─────────────────────────────────────────────────────────────
MESHES.forEach(m => {{
  const geo = buildGeometry(m.vertices, m.triangles);
  const mat = new THREE.MeshPhongMaterial({{
    color: m.color,
    side: THREE.DoubleSide,
    opacity: 0.85,
    transparent: true,
  }});
  const mesh = new THREE.Mesh(geo, mat);
  scene.add(mesh);
  bbox.expandByObject(mesh);
}});

// ── contact surfaces (wireframe) ─────────────────────────────────────────────
SURFACES.forEach(s => {{
  const geo = buildGeometry(s.vertices, s.triangles);
  const mat = new THREE.MeshBasicMaterial({{
    color: s.color,
    wireframe: true,
    side: THREE.DoubleSide,
  }});
  scene.add(new THREE.Mesh(geo, mat));
}});

// ── control points ───────────────────────────────────────────────────────────
const sphereGeo = new THREE.SphereGeometry(1, 8, 8);
POINTS.forEach(p => {{
  const mat = new THREE.MeshBasicMaterial({{ color: p.color }});
  const sphere = new THREE.Mesh(sphereGeo, mat);
  sphere.position.set(p.x, p.z, -p.y);
  scene.add(sphere);
  bbox.expandByObject(sphere);
}});

// ── fit camera to scene ──────────────────────────────────────────────────────
if (!bbox.isEmpty()) {{
  const centre = new THREE.Vector3();
  bbox.getCenter(centre);
  const size   = bbox.getSize(new THREE.Vector3()).length();
  const dir3 = new THREE.Vector3(1, 0.6, 1).normalize();
  camera.position.copy(centre).addScaledVector(dir3, size * 1.8);
  controls.target.copy(centre);
  camera.near = size * 0.001;
  camera.far  = size * 10;
  camera.updateProjectionMatrix();
  controls.update();
}}

// ── render loop ──────────────────────────────────────────────────────────────
window.addEventListener('resize', () => {{
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}});

(function animate() {{
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}})();
</script>
</body>
</html>
"""

    Path(path).write_text(html, encoding="utf-8")
