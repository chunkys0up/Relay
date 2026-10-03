from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator, Awaitable, Callable

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool
from app.services import chime

from app.api.routes import calls, cases, chat, client_log, conversations, documents, health
from app.core.config import settings
from app.core.logging import setup_logging
from app.db.pool import close_pool, init_pool
from app.workflow_application import create_workflow_app
from app.legacy_workflow_scope import LegacyWorkflowScope

setup_logging(settings.log_level)
log = logging.getLogger("relay.http")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    await init_pool()
    try:
        yield
    finally:
        try:
            await run_in_threadpool(chime.shutdown_calls)
        finally:
            await close_pool()


def create_app(workflow_app: FastAPI | None = None) -> FastAPI:
    app = FastAPI(title=settings.app_name, lifespan=lifespan)

    @app.middleware("http")
    async def log_requests(
        request: Request, call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
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
    app.include_router(cases.router, prefix="/api")
    app.include_router(conversations.router, prefix="/api")
    app.include_router(client_log.router, prefix="/api")

    @app.get("/")
    async def root() -> dict[str, str]:
        return {"name": settings.app_name, "status": "ok"}

    # Last route preserves legacy paths and delegates packet/advisor paths unchanged.
    child = workflow_app if workflow_app is not None else create_workflow_app()
    app.add_middleware(LegacyWorkflowScope, repository=child.state.workflow_service.repo)
    app.mount("/", child)
    return app


app = create_app()
