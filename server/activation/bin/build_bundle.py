"""Build the Combell upload bundle for the activation server.

Packs the deploy set the runbook names — the router (``public/`` → the
server's ``activation/`` folder), ``src/``, ``bin/``, ``migrations/`` and
``schema.sql`` — into ``dist/strixgeo-activation-<stamp>.zip`` with
forward-slash member names, so ``unzip`` on the Linux host lays the files out
exactly as ``www/api/`` expects. ``config.php`` is never included: the secrets
stay on the server (runbook §5).

Usage
-----
    uv run python server/activation/bin/build_bundle.py            # → dist/
    uv run python server/activation/bin/build_bundle.py --out /tmp # elsewhere
"""

from __future__ import annotations

import argparse
import datetime as dt
import zipfile
from pathlib import Path

#: Source folder → member prefix on the server. ``public`` is served as
#: ``www/api/activation/`` (the front controller); the rest keep their names.
DEPLOY_DIRS: dict[str, str] = {
    "public": "activation",
    "src": "src",
    "bin": "bin",
    "migrations": "migrations",
}

#: Top-level files that deploy as-is.
DEPLOY_FILES: tuple[str, ...] = ("schema.sql",)

#: Never shipped, wherever they sit: secrets and local artefacts.
EXCLUDED_NAMES: tuple[str, ...] = ("config.php",)


def build_bundle(activation_dir: Path, out_dir: Path) -> Path:
    """Write the upload zip and return its path.

    Parameters
    ----------
    activation_dir : Path
        The ``server/activation`` folder of the repo.
    out_dir : Path
        Where the zip is written (created when missing).

    Returns
    -------
    Path
        The zip written, named ``strixgeo-activation-<UTC stamp>.zip``.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now(dt.UTC).strftime("%Y%m%d-%H%M%S")
    out = out_dir / f"strixgeo-activation-{stamp}.zip"
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for src_name, member_prefix in DEPLOY_DIRS.items():
            folder = activation_dir / src_name
            if not folder.is_dir():
                continue
            for path in sorted(folder.rglob("*")):
                if path.is_dir() or path.name in EXCLUDED_NAMES:
                    continue
                rel = path.relative_to(folder).as_posix()
                zf.write(path, f"{member_prefix}/{rel}")
        for name in DEPLOY_FILES:
            path = activation_dir / name
            if path.is_file():
                zf.write(path, name)
    return out


def main() -> None:
    """CLI entry: build the bundle into ``dist/`` (or ``--out``)."""
    activation_dir = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, default=activation_dir / "dist")
    args = parser.parse_args()
    out = build_bundle(activation_dir, args.out)
    print(f"bundle written: {out}")


if __name__ == "__main__":
    main()
