from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import calls, chat, client_log, documents, health
from app.core.config import settings
from app.core.logging import setup_logging
from app.db.pool import close_pool, init_pool

setup_logging(settings.log_level)
log = logging.getLogger("relay.http")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_pool()
    yield
    await close_pool()


app = FastAPI(title=settings.app_name, lifespan=lifespan)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        log.exception("%s %s -> unhandled error", request.method, request.url.path)
        raise
    if request.url.path != "/health":
        log.info(
            "%s %s -> %s (%.0f ms)", request.method, request.url.path,
            response.status_code, (time.perf_counter() - start) * 1000,
        )
    return response


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(chat.router, prefix="/api")
app.include_router(documents.router, prefix="/api")
app.include_router(calls.router, prefix="/api")
app.include_router(client_log.router, prefix="/api")


@app.get("/")
async def root() -> dict[str, str]:
    return {"name": settings.app_name, "status": "ok"}
