# Linux Setup Guide — Ground Model Platform

Pull this branch, run the steps below, then delete the branch.

---

## 1. System dependencies

```bash
# Docker (for PostgreSQL + PostGIS)
sudo apt install docker.io docker-compose-plugin
sudo usermod -aG docker $USER   # log out and back in after this

# Node.js 20+ (for Electron desktop)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install nodejs

# UV (Python package manager)
curl -LsSf https://astral.sh/uv/install.sh | sh
# Then restart your shell or run: source $HOME/.local/bin/env
```

---

## 2. Clone & install

```bash
git clone https://github.com/Vorsie/Strix.git
cd Strix
git checkout chore/linux-portable   # this branch — has data files + settings

uv sync --group dev                 # creates .venv, installs all Python deps
cd desktop && npm ci && cd ..       # installs Node deps from package-lock.json
```

---

## 3. Database

```bash
docker compose up -d                # starts PostgreSQL + PostGIS on port 5433
uv run alembic upgrade head         # applies all migrations
```

Verify:
```bash
docker compose ps   # should show strix-db-1 as Up
```

---

## 4. Claude Code settings

Copy the global Claude settings to your home directory:

```bash
mkdir -p ~/.claude
cp portable/claude-global-CLAUDE.md ~/.claude/CLAUDE.md
cp portable/claude-global-settings.json ~/.claude/settings.json
```

The project-level settings (`.claude/settings.local.json` and `.claude/hooks/`) are already in this branch and will be active automatically when you open Claude Code in this directory.

---

## 5. Data files

The real GEF files from DOV are in `data/cpt/` (included in this branch only).

---

## 6. Run the app

```bash
# Terminal 1 — backend (optional; Electron auto-starts it)
uv run uvicorn groundmodel.api.main:app --port 8765

# Terminal 2 — desktop
cd desktop && npm run dev
```

---

## 7. Run tests

```bash
uv run pytest tests/unit                # no Docker needed
uv run pytest tests/integration         # requires docker compose up -d
```

---

## 8. Clean up this branch

Once everything is working, switch to develop and delete this branch:

```bash
git checkout develop
git branch -d chore/linux-portable
git push origin --delete chore/linux-portable
```
