from __future__ import annotations

import logging

import asyncpg

from app.core.config import settings

logger = logging.getLogger(__name__)

_pool: asyncpg.Pool | None = None


async def init_pool() -> None:
    global _pool
    if settings.database_url is None:
        logger.warning("DB_HOST/DB_PASSWORD not set — skipping Postgres pool, DB-backed routes will fail")
        return
    try:
        _pool = await asyncpg.create_pool(settings.database_url)
    except OSError:
        logger.exception("Could not connect to Postgres — DB-backed routes will fail")


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


def get_pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("Database pool not initialized — check DB_HOST/DB_PASSWORD in .env and that RDS is reachable")
    return _pool
