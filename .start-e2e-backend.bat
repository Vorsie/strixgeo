@echo off
set DATABASE_URL=postgresql+asyncpg://groundmodel:groundmodel@localhost:5433/groundmodel_integration
set STRIX_DOV_FIXTURE_MODE=1
uv run uvicorn groundmodel.api.main:app --host 127.0.0.1 --port 8765 > .e2e-backend.log 2>&1
