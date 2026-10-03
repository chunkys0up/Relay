from __future__ import annotations

from dotenv import load_dotenv
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Export .env into the real process environment. Needed because some
# dependencies (boto3 inside strands' Bedrock provider, provider SDKs like
# anthropic/openai) read os.environ directly — pydantic-settings parsing
# .env into Settings below does NOT also export it to the process.
load_dotenv()


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore", enable_decoding=False
    )

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

    # S3 document storage. aws_profile is optional — set it to pick a named
    # profile from ~/.aws/credentials (e.g. "participant") instead of relying
    # on the default AWS credential chain.
    s3_bucket: str = "relay-documents-576248046713"
    aws_region: str = "us-east-1"
    aws_profile: str | None = None
    demo_tenant_id: str = "relay-demo"
    chime_region: str = "us-east-1"

    # RDS Postgres. Schema lives in db/schema.sql; no ORM/client is wired up
    # yet — these are just typed config for whatever reads them next.
    db_host: str | None = None
    db_port: int = 5432
    db_name: str = "relay"
    db_user: str = "relay_admin"
    db_password: str | None = None

    @property
    def database_url(self) -> str | None:
        if not self.db_host or not self.db_password:
            return None
        return f"postgresql://{self.db_user}:{self.db_password}@{self.db_host}:{self.db_port}/{self.db_name}"

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_cors_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value


settings = Settings()
