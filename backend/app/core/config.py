from __future__ import annotations

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Relay Agent API"
    host: str = "0.0.0.0"
    port: int = 8000
    cors_origins: list[str] = ["*"]

    # Passed straight through to strands_harness.create_harness(). Leave
    # strands_model unset to use the harness default (Bedrock Claude); set it
    # to e.g. "anthropic/claude-opus-5" to use another provider, and export
    # the matching API key (see .env.example).
    strands_model: str | None = None
    strands_effort: str = "auto"
    session_dir: str = "./.agent/sessions"

    log_level: str = "INFO"

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_cors_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value


settings = Settings()
