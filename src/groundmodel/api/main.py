"""FastAPI application entry point."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from groundmodel.api.routers import borehole, cpt, jobs, project

app = FastAPI(title="Ground Model Platform", version="0.1.0")

# The API only ever binds to 127.0.0.1 and is accessed exclusively by the
# local Electron renderer (Vite dev server at localhost:5173 in dev, file://
# origin in production).  Allowing all origins is safe here — there is no
# internet exposure.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(cpt.router)
app.include_router(borehole.router, prefix="/borehole", tags=["borehole"])
app.include_router(jobs.router)
app.include_router(project.router)
