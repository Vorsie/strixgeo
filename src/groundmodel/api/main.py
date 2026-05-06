"""FastAPI application entry point."""

from fastapi import FastAPI

from groundmodel.api.routers import borehole, cpt, jobs

app = FastAPI(title="Ground Model Platform", version="0.1.0")

app.include_router(cpt.router)
app.include_router(borehole.router, prefix="/borehole", tags=["borehole"])
app.include_router(jobs.router)
