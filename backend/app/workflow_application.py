"""Packet and advisor factory shared by the unified backend and tests."""

from __future__ import annotations

import os
from pathlib import Path
from collections.abc import Awaitable, Callable
from urllib.parse import urlparse

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import settings
from app.api.routes.workflow import workflow_router
from app.advisor.api import advisor_router
from app.advisor.model import AdvisorProvider
from app.advisor.store import AdvisorError, AdvisorStore
from app.workflow.model import ProposalProvider
from app.workflow.team import MultiAgentProvider
from app.workflow.repository import Repository, WorkflowError
from app.workflow.service import WorkflowService


_ROLE_MODEL_ENV = {
    "extractor": "BEDROCK_EXTRACTOR_MODEL_ID",
    "orchestrator": "BEDROCK_ORCHESTRATOR_MODEL_ID",
    "reader": "BEDROCK_READER_MODEL_ID",
    "writer": "BEDROCK_WRITER_MODEL_ID",
    "verifier": "BEDROCK_VERIFIER_MODEL_ID",
}


def create_workflow_app(
    *, database_path: str | None = None, provider: ProposalProvider | None = None,
    advisor_provider: AdvisorProvider | None = None, test_mode: bool = False,
) -> FastAPI:
    if database_path is None:
        database_path = os.environ.get("RELAY_WORKFLOW_DB") or str(Path.cwd() / ".relay" / "workflow.sqlite3")
    if provider is None and not test_mode:
        model_id = os.environ.get("BEDROCK_MODEL_OR_PROFILE_ID", "").strip()
        role_model_ids = {
            role: value for role, name in _ROLE_MODEL_ENV.items()
            if (value := os.environ.get(name, "").strip())
        }
        if model_id or role_model_ids:
            provider = MultiAgentProvider(
                model_id=model_id, region=settings.aws_region,
                profile=settings.aws_profile or None,
                role_model_ids=role_model_ids,
            )
    if advisor_provider is None and not test_mode:
        advisor_model = os.environ.get("BEDROCK_ORCHESTRATOR_MODEL_ID", "")
        if advisor_model:
            advisor_provider = AdvisorProvider(
                advisor_model, os.environ.get("AWS_REGION", "us-east-1"),
                os.environ.get("AWS_PROFILE") or None,
            )
    repository = Repository(database_path)
    advisor_store = AdvisorStore(database_path)
    repository.recover_interrupted_jobs()
    service = WorkflowService(repository, provider)
    app = FastAPI(title="Relay founder packet workflow (local demo)")
    app.state.workflow_service = service
    app.state.advisor_store = advisor_store
    app.state.advisor_provider = advisor_provider

    @app.middleware("http")
    async def loopback_only(
        request: Request, call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        host = request.url.hostname or ""
        peer = request.client.host if request.client else ""
        allowed = {"127.0.0.1", "localhost", "::1"}
        if test_mode:
            allowed |= {"testserver", "testclient"}
        if host not in allowed or peer not in allowed:
            return JSONResponse(status_code=403,
                                content={"error": {"code": "LOOPBACK_ONLY",
                                                   "message": "Local demo only"}})
        origin = request.headers.get("origin")
        if origin and (urlparse(origin).hostname or "") not in allowed:
            return JSONResponse(status_code=403,
                                content={"error": {"code": "ORIGIN_FORBIDDEN",
                                                   "message": "Local origin required"}})
        return await call_next(request)

    @app.exception_handler(WorkflowError)
    async def workflow_error(_request: Request, exc: WorkflowError) -> JSONResponse:
        return JSONResponse(status_code=exc.status,
                            content={"error": {"code": exc.code, "message": exc.code,
                                               "retryable": exc.status >= 500}})

    @app.exception_handler(AdvisorError)
    async def advisor_error(_request: Request, exc: AdvisorError) -> JSONResponse:
        return JSONResponse(status_code=exc.status,
                            content={"error": {"code": exc.code, "message": exc.code,
                                               "retryable": exc.retryable}})

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://127.0.0.1:5173", "http://localhost:5173",
                       "http://127.0.0.1:5189", "http://localhost:5189"],
        allow_credentials=True,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", "X-CSRF-Token", "Idempotency-Key"],
    )
    app.include_router(workflow_router(repository, service, test_mode=test_mode))
    app.include_router(advisor_router(advisor_store, advisor_provider, test_mode=test_mode))
    return app
