"""PostToolUse hook: ruff format + check --fix on every .py file write."""
import json
import subprocess
import sys
from pathlib import Path

data = json.load(sys.stdin)
ti = data.get("tool_input") or {}
tr = data.get("tool_response") or {}
f = ti.get("file_path") or tr.get("filePath") or ""

if not f or not f.endswith(".py"):
    sys.exit(0)

fp = Path(f)
if not fp.exists():
    sys.exit(0)

# Walk up to find the nearest venv that contains ruff (Linux: bin/ruff, Windows: Scripts/ruff.exe)
root = fp.parent
ruff = None
while root != root.parent:
    for candidate in (root / ".venv" / "bin" / "ruff", root / ".venv" / "Scripts" / "ruff.exe"):
        if candidate.exists():
            ruff = candidate
            break
    if ruff:
        break
    root = root.parent

if ruff is None:
    sys.exit(0)

subprocess.run([str(ruff), "format", str(fp)], capture_output=True)
subprocess.run([str(ruff), "check", "--fix", str(fp)], capture_output=True)
